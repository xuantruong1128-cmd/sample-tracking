-- Migration 00002: Enable service_role execution for fail_attachment_upload and retry_attachment_upload
-- Enables Edge Functions running under service_role to mark attachment uploads as FAILED or PENDING during verification

CREATE OR REPLACE FUNCTION public.fail_attachment_upload(p_attachment_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_updated_count INT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        v_role := public.get_current_user_role();
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Active internal account required.';
        END IF;
    END IF;

    SELECT a.id, a.job_id, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot alter attachment on % JOB (only ACTIVE jobs permit attachment operations).', v_att.job_status;
    END IF;

    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
            RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can mark upload failed.';
        END IF;
    END IF;

    -- CRITICAL ANTI-DOWNGRADE GUARD: READY attachments can never be downgraded to FAILED!
    IF v_att.upload_status != 'PENDING' THEN
        RAISE EXCEPTION 'Cannot mark attachment as FAILED: current status is % (only PENDING attachments can fail).',
            v_att.upload_status;
    END IF;

    UPDATE public.attachments
    SET upload_status = 'FAILED',
        last_error = COALESCE(p_error, 'Client upload failed')
    WHERE id = p_attachment_id AND upload_status = 'PENDING';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Concurrent modification conflict while failing attachment %.', p_attachment_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'FAILED', 'id', p_attachment_id, 'error', p_error);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_attachment_upload(
    p_attachment_id UUID,
    p_new_size BIGINT DEFAULT NULL,
    p_new_mime TEXT DEFAULT NULL,
    p_new_hash VARCHAR(64) DEFAULT NULL,
    p_new_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_new_path TEXT;
    v_sanitized_name TEXT;
    v_old_path TEXT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        v_role := public.get_current_user_role();
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Active internal account required.';
        END IF;
    END IF;

    SELECT a.id, a.job_id, a.file_name, a.file_path, a.file_size, a.file_type, a.mime_type, a.content_hash, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot retry upload on % JOB (only ACTIVE jobs permit uploads).', v_att.job_status;
    END IF;

    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
            RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can retry upload.';
        END IF;
    END IF;

    -- R1-02: Strict READY immutability & retry requirements
    IF v_att.upload_status = 'READY' THEN
        RAISE EXCEPTION 'Attachment % is already verified as READY and is strictly immutable.', p_attachment_id;
    END IF;

    IF v_att.upload_status != 'FAILED' THEN
        RAISE EXCEPTION 'Cannot retry attachment % in % status (only FAILED attachments can be retried).',
            p_attachment_id, v_att.upload_status;
    END IF;

    -- Validate new hash format if provided
    IF p_new_hash IS NOT NULL AND p_new_hash !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Invalid hash format: SHA-256 must be 64 hexadecimal characters.';
    END IF;

    -- Validate new size if provided
    IF p_new_size IS NOT NULL AND (p_new_size <= 0 OR p_new_size > 52428800) THEN
        RAISE EXCEPTION 'Invalid file size: % bytes (must be between 1 byte and 50MB).', p_new_size;
    END IF;

    -- Validate new MIME if provided
    IF p_new_mime IS NOT NULL AND p_new_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
        RAISE EXCEPTION 'Invalid MIME type: %. Must be application/pdf, image/jpeg, or image/png.', p_new_mime;
    END IF;

    -- Fix 3: Resolve fresh storage path to strictly prevent collisions with prior failed upload attempts
    v_old_path := v_att.file_path;
    IF p_new_path IS NOT NULL AND length(trim(p_new_path)) > 0 THEN
        v_new_path := trim(p_new_path);
        IF v_new_path = v_old_path THEN
            RAISE EXCEPTION 'Retry requires a different storage path. Reusing the failed path % is forbidden.', v_old_path;
        END IF;
    ELSE
        v_sanitized_name := regexp_replace(v_att.file_name, '[/\\ ]+', '_', 'g');
        v_new_path := v_att.job_id::text || '/' || v_att.file_type::text || '/r' ||
                      floor(extract(epoch from now()))::text || '_' ||
                      substr(md5(random()::text), 1, 6) || '_' ||
                      v_sanitized_name;
    END IF;

    -- Always reset status from FAILED to PENDING so server verification authority can verify bytes before READY.
    UPDATE public.attachments
    SET upload_status = 'PENDING',
        file_path = v_new_path,
        file_size = COALESCE(p_new_size, file_size),
        mime_type = COALESCE(p_new_mime, mime_type),
        content_hash = COALESCE(lower(p_new_hash), content_hash),
        last_error = NULL,
        last_retry_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_attachment_id AND upload_status = 'FAILED';

    RETURN jsonb_build_object(
        'success', true,
        'status', 'PENDING',
        'id', p_attachment_id,
        'file_path', v_new_path,
        'old_file_path', v_old_path,
        'action', 'RESET_TO_PENDING',
        'message', 'Attachment reset to PENDING with collision-free storage path. Verification via verify-and-confirm-upload required before READY.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fail_attachment_upload(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_attachment_upload(UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.retry_attachment_upload(UUID, BIGINT, TEXT, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_attachment_upload(UUID, BIGINT, TEXT, VARCHAR, TEXT) TO authenticated, service_role;
