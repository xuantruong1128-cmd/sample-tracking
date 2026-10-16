-- ==============================================================================
-- SAMPLE TRACKING V1.0 — PHASE 1: SECURITY REMEDIATION R7 (FORWARD-ONLY)
-- Migration: 00010_security_remediation_r7.sql
-- Description: Targeted remediation of Codex R6 audit findings (R6-01 through R6-07)
--
-- Findings addressed:
--   1. R6-01 (BLOCKER): Fix SECURITY DEFINER identity bypass. Eliminate unsafe
--      authorization bypasses based on function-owner identity (current_user = 'postgres').
--      Distinguish ordinary authenticated user JWTs, trusted service-role, and direct SQL.
--   2. R6-02 (BLOCKER): Fix attachment department ownership. Enforce server-side
--      binding of uploaded_by, owning_department, permitted file_type, and ACTIVE job state.
--   3. R6-03 (HIGH): Implement approved Option A Document Access Policy. All active
--      internal roles (Admin, Planning, PE-MFG, QA) can read registered documents
--      of all non-PURGED jobs. Unregistered and purged objects are strictly denied.
--   4. R6-04 (HIGH): Safe metadata-first upload lifecycle (PENDING -> READY / FAILED)
--      with server-validated confirmation function confirming Storage object existence.
--   5. R6-05 (HIGH): Remove invalid status regression. IN_PROGRESS -> NOT_STARTED is
--      strictly denied for ordinary users.
--   6. R6-06 (MEDIUM): Trusted QA event ordering via monotonic per-operation sequence
--      (event_seq) and row-locking serialization. Disposition must reference exact latest QA event.
--   7. R6-07 (MEDIUM): Safe legacy data migration preflight checks and guards.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. R6-07: PREFLIGHT SAFETY GUARDS & DIAGNOSTICS
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_dup_count INTEGER;
    v_invalid_path_count INTEGER;
    v_mismatch_count INTEGER;
    v_sample_err TEXT;
BEGIN
    -- 1.1 Check for duplicate file_paths in public.attachments
    SELECT count(*), string_agg(file_path, ', ') INTO v_dup_count, v_sample_err
    FROM (
        SELECT file_path FROM public.attachments GROUP BY file_path HAVING count(*) > 1 LIMIT 5
    ) d;
    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'PREFLIGHT BLOCKED (R6-07): Duplicate file_path detected in attachments catalog: %', v_sample_err;
    END IF;

    -- 1.2 Check for invalid or noncanonical file_paths
    SELECT count(*), string_agg(file_path, ', ') INTO v_invalid_path_count, v_sample_err
    FROM (
        SELECT file_path FROM public.attachments
        WHERE array_length(string_to_array(file_path, '/'), 1) != 3
           OR file_path LIKE '%\%'
           OR file_path LIKE '%..%'
        LIMIT 5
    ) inv;
    IF v_invalid_path_count > 0 THEN
        RAISE EXCEPTION 'PREFLIGHT BLOCKED (R6-07): Noncanonical file_path detected in attachments catalog: %', v_sample_err;
    END IF;

    -- 1.3 Check for cross-job operation mismatches
    SELECT count(*), string_agg(a.id::text, ', ') INTO v_mismatch_count, v_sample_err
    FROM public.attachments a
    JOIN public.job_operations op ON op.id = a.operation_id
    WHERE op.job_id != a.job_id
    LIMIT 5;
    IF v_mismatch_count > 0 THEN
        RAISE EXCEPTION 'PREFLIGHT BLOCKED (R6-07): Cross-job operation reference in attachments catalog: %', v_sample_err;
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. R6-04 & R6-06: SCHEMA ENHANCEMENTS (UPLOAD LIFECYCLE & QA EVENT SEQUENCE)
-- ------------------------------------------------------------------------------

-- 2.1 Attachment upload status lifecycle
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_upload_status') THEN
        CREATE TYPE public.attachment_upload_status AS ENUM ('PENDING', 'READY', 'FAILED');
    END IF;
END $$;

ALTER TABLE public.attachments
ADD COLUMN IF NOT EXISTS upload_status public.attachment_upload_status NOT NULL DEFAULT 'READY';

-- Ensure all existing attachments are marked READY
UPDATE public.attachments
SET upload_status = 'READY'
WHERE upload_status IS NULL;

-- 2.2 Monotonic QA event ordering per operation
ALTER TABLE public.job_operations
ADD COLUMN IF NOT EXISTS qa_event_counter BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.qa_checks
ADD COLUMN IF NOT EXISTS event_seq BIGINT;

-- Backfill legacy qa_checks event_seq based on creation order per operation
WITH ordered_qa AS (
    SELECT id, operation_id,
           row_number() OVER (PARTITION BY operation_id ORDER BY created_at ASC, id ASC) AS seq
    FROM public.qa_checks
    WHERE event_seq IS NULL
)
UPDATE public.qa_checks q
SET event_seq = o.seq
FROM ordered_qa o
WHERE q.id = o.id;

UPDATE public.qa_checks SET event_seq = 1 WHERE event_seq IS NULL;
ALTER TABLE public.qa_checks ALTER COLUMN event_seq SET NOT NULL;

-- Synchronize qa_event_counter on job_operations
UPDATE public.job_operations op
SET qa_event_counter = COALESCE((
    SELECT max(event_seq) FROM public.qa_checks WHERE operation_id = op.id
), 0);

-- Unique index on attachment file_path (guaranteed by preflight check above)
CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_file_path_r7 ON public.attachments(file_path);


-- ------------------------------------------------------------------------------
-- 3. R6-01: FIX SECURITY DEFINER IDENTITY BYPASS
-- ------------------------------------------------------------------------------
-- CRITICAL SECURITY FIX: In PostgreSQL, SECURITY DEFINER switches current_user
-- to the function owner (postgres). Checking current_user = 'postgres' inside
-- a SECURITY DEFINER function grants Admin privileges to EVERY CALLER!
-- We must strictly distinguish:
--   1. Authenticated user with JWT: role MUST be looked up from public.profiles.
--   2. Service-role token: request.jwt.claim.role = 'service_role'.
--   3. Direct SQL maintenance session: session_user = 'postgres' AND no JWT headers.
--   4. Anonymous or inactive user: return NULL (fail closed).

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role AS $$
DECLARE
    v_role public.user_role;
    v_uid uuid;
    v_jwt_role text;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(
        current_setting('request.jwt.claim.role', true),
        (auth.jwt() ->> 'role')
    );

    -- 1. Ordinary authenticated user: role MUST come from their active profile
    IF v_uid IS NOT NULL THEN
        SELECT role INTO v_role
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        RETURN v_role; -- Inactive users or non-existent profiles return NULL
    END IF;

    -- 2. Trusted service-role token (Edge Functions / Admin CLI with service role key, without user impersonation)
    IF v_jwt_role = 'service_role' THEN
        RETURN 'Admin'::public.user_role;
    END IF;

    -- 3. Trusted internal direct SQL maintenance session (e.g. psql running as postgres/supabase_admin with NO HTTP JWT)
    -- IMPORTANT: Check session_user (connection owner), NOT current_user (which changes in SECURITY DEFINER)!
    IF session_user IN ('postgres', 'supabase_admin') AND v_jwt_role IS NULL THEN
        RETURN 'Admin'::public.user_role;
    END IF;

    -- 4. Anonymous or unauthorized callers return NULL
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

CREATE OR REPLACE FUNCTION public.is_user_active()
RETURNS BOOLEAN AS $$
DECLARE
    v_uid uuid;
    v_jwt_role text;
    v_is_active boolean;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(
        current_setting('request.jwt.claim.role', true),
        (auth.jwt() ->> 'role')
    );

    -- 1. Ordinary authenticated user: strictly verify profile active flag
    IF v_uid IS NOT NULL THEN
        SELECT is_active INTO v_is_active
        FROM public.profiles
        WHERE id = v_uid;

        RETURN COALESCE(v_is_active, FALSE);
    END IF;

    -- 2. Service role
    IF v_jwt_role = 'service_role' THEN
        RETURN TRUE;
    END IF;

    -- 3. Trusted direct SQL session
    IF session_user IN ('postgres', 'supabase_admin') AND v_jwt_role IS NULL THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

CREATE OR REPLACE FUNCTION public.is_authorized_pe_decision_maker(p_job_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_role public.user_role;
    v_is_active BOOLEAN;
    v_pe_owner UUID;
    v_delegates UUID[];
    v_jwt_role text;
BEGIN
    v_jwt_role := COALESCE(
        current_setting('request.jwt.claim.role', true),
        (auth.jwt() ->> 'role')
    );

    -- If no target user is specified, allow service-role or direct maintenance session
    IF p_user_id IS NULL THEN
        IF v_jwt_role = 'service_role' OR (session_user IN ('postgres', 'supabase_admin') AND v_jwt_role IS NULL) THEN
            RETURN TRUE;
        END IF;
        RETURN FALSE;
    END IF;

    -- When a user is specified, strictly check their profile and job assignment
    SELECT role, is_active INTO v_role, v_is_active
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_is_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- Admin profile always has administrative override
    IF v_role = 'Admin' THEN
        RETURN TRUE;
    END IF;

    -- Non-PE users cannot make PE decisions
    IF v_role != 'PE-MFG' THEN
        RETURN FALSE;
    END IF;

    SELECT pe_owner_id, pe_delegates INTO v_pe_owner, v_delegates
    FROM public.jobs
    WHERE id = p_job_id;

    -- A. Designated PE Owner for the JOB
    IF v_pe_owner IS NOT NULL AND v_pe_owner = p_user_id THEN
        RETURN TRUE;
    END IF;

    -- B. Explicitly authorized delegate for the JOB
    IF v_delegates IS NOT NULL AND p_user_id = ANY(v_delegates) THEN
        RETURN TRUE;
    END IF;

    -- Ordinary unassigned PE-MFG operator has NO decision authority!
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

-- Revoke dangerous public execute grants
REVOKE EXECUTE ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_user_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_user_active() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_authorized_pe_decision_maker(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_pe_decision_maker(UUID, UUID) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 4. R6-02 & R6-04: ATTACHMENT OWNERSHIP INTEGRITY TRIGGER & LIFECYCLE
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_attachment_integrity_r7()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_caller_uid uuid;
    v_job_status public.job_status;
    v_op_job_id uuid;
    v_parts text[];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow updating upload_status from PENDING to READY or FAILED via trusted functions
        IF OLD.upload_status = 'PENDING' AND NEW.upload_status IN ('READY', 'FAILED') THEN
            -- Only upload_status and timestamps may change
            IF NEW.job_id IS DISTINCT FROM OLD.job_id OR
               NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
               NEW.file_name IS DISTINCT FROM OLD.file_name OR
               NEW.file_path IS DISTINCT FROM OLD.file_path OR
               NEW.file_size IS DISTINCT FROM OLD.file_size OR
               NEW.mime_type IS DISTINCT FROM OLD.mime_type OR
               NEW.file_type IS DISTINCT FROM OLD.file_type OR
               NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR
               NEW.owning_department IS DISTINCT FROM OLD.owning_department THEN
                RAISE EXCEPTION 'Attachment metadata is immutable; only upload_status transition is permitted.';
            END IF;
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Attachment records are immutable.';
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_caller_uid := auth.uid();
        v_role := public.get_current_user_role();

        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller is not an active internal user.';
        END IF;

        -- 1. Identity & Department enforcement
        IF v_role IN ('Planning', 'PE-MFG', 'QA') THEN
            -- Ordinary users MUST have uploaded_by = auth.uid()
            IF NEW.uploaded_by IS NOT NULL AND NEW.uploaded_by != v_caller_uid THEN
                RAISE EXCEPTION 'Uploader identity mismatch: cannot upload as another user.';
            END IF;
            NEW.uploaded_by := v_caller_uid;

            -- Ordinary users CANNOT forge another department's ownership!
            IF NEW.owning_department IS NOT NULL AND NEW.owning_department != v_role THEN
                RAISE EXCEPTION 'Forbidden: Role % cannot set owning_department to %.', v_role, NEW.owning_department;
            END IF;
            NEW.owning_department := v_role;
        ELSIF v_role = 'Admin' THEN
            NEW.uploaded_by := COALESCE(NEW.uploaded_by, v_caller_uid);
            IF NEW.owning_department IS NULL THEN
                NEW.owning_department := 'Admin';
            END IF;
        END IF;

        -- 2. Verify JOB exists and is ACTIVE
        SELECT status INTO v_job_status FROM public.jobs WHERE id = NEW.job_id;
        IF v_job_status IS NULL THEN
            RAISE EXCEPTION 'Referenced JOB % does not exist.', NEW.job_id;
        END IF;
        IF v_job_status != 'ACTIVE' THEN
            RAISE EXCEPTION 'Cannot attach documents to % JOB (only ACTIVE jobs permit uploads).', v_job_status;
        END IF;

        -- 3. Verify Operation consistency
        IF NEW.operation_id IS NOT NULL THEN
            SELECT job_id INTO v_op_job_id FROM public.job_operations WHERE id = NEW.operation_id;
            IF v_op_job_id IS NULL THEN
                RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
            END IF;
            IF v_op_job_id != NEW.job_id THEN
                RAISE EXCEPTION 'Attachment operation % belongs to another JOB %, not JOB %.',
                    NEW.operation_id, v_op_job_id, NEW.job_id;
            END IF;
        END IF;

        -- 4. Storage path canonical format validation: <job_id>/<file_type>/<filename>
        v_parts := string_to_array(NEW.file_path, '/');
        IF array_length(v_parts, 1) != 3
           OR v_parts[1] != NEW.job_id::text
           OR v_parts[2] != NEW.file_type::text
           OR length(v_parts[3]) = 0
           OR v_parts[3] IN ('.', '..')
           OR position('\' in v_parts[3]) > 0
           OR position('/' in v_parts[3]) > 0 THEN
            RAISE EXCEPTION 'Attachment path must strictly match <job_id>/<file_type>/<filename>';
        END IF;

        -- 5. File type category whitelist by role
        IF v_role = 'Planning' AND NEW.file_type NOT IN ('DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER') THEN
            RAISE EXCEPTION 'Planning department is not permitted to upload file type %.', NEW.file_type;
        ELSIF v_role = 'PE-MFG' AND NEW.file_type NOT IN ('CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER') THEN
            RAISE EXCEPTION 'PE-MFG department is not permitted to upload file type %.', NEW.file_type;
        ELSIF v_role = 'QA' AND NEW.file_type NOT IN ('CHECK_SHEET', 'NG_PHOTO', 'OTHER') THEN
            RAISE EXCEPTION 'QA department is not permitted to upload file type %.', NEW.file_type;
        END IF;

        -- 6. Initial upload lifecycle state
        IF NEW.upload_status IS NULL THEN
            NEW.upload_status := 'PENDING';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_attachment_binding_r6 ON public.attachments;
DROP TRIGGER IF EXISTS trg_enforce_attachment_integrity_r7 ON public.attachments;
CREATE TRIGGER trg_enforce_attachment_integrity_r7
BEFORE INSERT OR UPDATE ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_attachment_integrity_r7();


-- ------------------------------------------------------------------------------
-- 5. R6-04: SERVER-SIDE ATTACHMENT CONFIRMATION & RETRY FUNCTIONS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_attachment_upload_r7(p_attachment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_exists boolean;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Active internal account required.';
    END IF;

    SELECT id, file_path, uploaded_by, upload_status INTO v_att
    FROM public.attachments
    WHERE id = p_attachment_id;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    -- Must be the uploader or Admin
    IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: Only the uploader or Admin can confirm upload.';
    END IF;

    -- Verify that the expected Storage object actually exists in sample-documents!
    SELECT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'sample-documents' AND name = v_att.file_path
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Storage object % does not exist in sample-documents. Cannot mark READY.', v_att.file_path;
    END IF;

    UPDATE public.attachments
    SET upload_status = 'READY'
    WHERE id = p_attachment_id;

    RETURN jsonb_build_object('success', true, 'status', 'READY', 'id', p_attachment_id);
END $$;

CREATE OR REPLACE FUNCTION public.fail_attachment_upload_r7(p_attachment_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Active internal account required.';
    END IF;

    SELECT id, uploaded_by INTO v_att
    FROM public.attachments
    WHERE id = p_attachment_id;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: Only the uploader or Admin can mark upload failed.';
    END IF;

    UPDATE public.attachments
    SET upload_status = 'FAILED'
    WHERE id = p_attachment_id;

    RETURN jsonb_build_object('success', true, 'status', 'FAILED', 'id', p_attachment_id, 'error', p_error);
END $$;

GRANT EXECUTE ON FUNCTION public.confirm_attachment_upload_r7(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.confirm_attachment_upload_r7(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fail_attachment_upload_r7(UUID, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fail_attachment_upload_r7(UUID, TEXT) FROM PUBLIC, anon;


-- ------------------------------------------------------------------------------
-- 6. R6-03: APPROVED OPTION A STORAGE & ATTACHMENT POLICIES
-- ------------------------------------------------------------------------------

-- 6.1 Attachments RLS
DROP POLICY IF EXISTS "attachments_select_active" ON public.attachments;
DROP POLICY IF EXISTS "attachments_insert_authorized_r4" ON public.attachments;
DROP POLICY IF EXISTS "attachments_select_active_r7" ON public.attachments;
DROP POLICY IF EXISTS "attachments_insert_authorized_r7" ON public.attachments;

-- Option A SELECT: All active internal roles can read registered attachments of non-PURGED jobs
CREATE POLICY "attachments_select_active_r7" ON public.attachments
FOR SELECT TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'Planning', 'PE-MFG', 'QA')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = attachments.job_id
          AND j.status != 'PURGED'
    )
);

-- Attachments INSERT: Independent RLS authorization enforcement
CREATE POLICY "attachments_insert_authorized_r7" ON public.attachments
FOR INSERT TO authenticated
WITH CHECK (
    public.is_user_active() = TRUE
    AND (
        (
            public.get_current_user_role() IN ('Planning', 'PE-MFG', 'QA')
            AND uploaded_by = auth.uid()
            AND owning_department = public.get_current_user_role()
        )
        OR (
            public.get_current_user_role() = 'Admin'
            AND (uploaded_by = auth.uid() OR owning_department = 'Admin')
        )
    )
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = attachments.job_id
          AND j.status = 'ACTIVE'
    )
    AND (
        public.get_current_user_role() = 'Admin' OR
        (public.get_current_user_role() = 'Planning' AND file_type IN ('DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER')) OR
        (public.get_current_user_role() = 'PE-MFG' AND file_type IN ('CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER')) OR
        (public.get_current_user_role() = 'QA' AND file_type IN ('CHECK_SHEET', 'NG_PHOTO', 'OTHER'))
    )
);

-- 6.2 Storage Objects Policies
DROP POLICY IF EXISTS "storage_registered_read_r6" ON storage.objects;
DROP POLICY IF EXISTS "storage_registered_upload_r6" ON storage.objects;
DROP POLICY IF EXISTS "storage_registered_read_r7" ON storage.objects;
DROP POLICY IF EXISTS "storage_registered_upload_r7" ON storage.objects;

-- Option A Storage SELECT: All active internal roles can read registered objects of non-PURGED jobs
CREATE POLICY "storage_registered_read_r7" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'Planning', 'PE-MFG', 'QA')
    AND EXISTS (
        SELECT 1 FROM public.attachments a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.file_path = storage.objects.name
          AND j.status != 'PURGED'
          AND (a.upload_status = 'READY' OR a.upload_status IS NULL)
          AND a.job_id::text = (storage.foldername(storage.objects.name))[1]
          AND a.file_type::text = (storage.foldername(storage.objects.name))[2]
    )
);

-- Metadata-First Storage INSERT: Object must match registered attachment in PENDING/READY state
CREATE POLICY "storage_registered_upload_r7" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.attachments a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.file_path = storage.objects.name
          AND j.status = 'ACTIVE'
          AND (
              (
                  public.get_current_user_role() IN ('Planning', 'PE-MFG', 'QA')
                  AND a.uploaded_by = auth.uid()
                  AND a.owning_department = public.get_current_user_role()
              )
              OR (
                  public.get_current_user_role() = 'Admin'
                  AND (a.uploaded_by = auth.uid() OR a.owning_department = 'Admin')
              )
          )
          AND a.job_id::text = (storage.foldername(storage.objects.name))[1]
          AND a.file_type::text = (storage.foldername(storage.objects.name))[2]
    )
);


-- ------------------------------------------------------------------------------
-- 7. R6-06: QA CHECK INSERTION TRIGGER (MONOTONIC ORDERING & CONCURRENCY)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_qa_check_before_insert_r7()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_current_counter BIGINT;
    v_op_job_id UUID;
    v_job_status public.job_status;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role NOT IN ('QA', 'Admin') THEN
        RAISE EXCEPTION 'Only QA or Admin can record quality evaluations.';
    END IF;

    -- Lock the parent operation row to serialize concurrent QA checks for this operation! (R6-06)
    SELECT qa_event_counter, job_id INTO v_current_counter, v_op_job_id
    FROM public.job_operations
    WHERE id = NEW.operation_id
    FOR UPDATE;

    IF v_op_job_id IS NULL THEN
        RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
    END IF;

    SELECT status INTO v_job_status FROM public.jobs WHERE id = v_op_job_id;
    IF v_job_status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
        RAISE EXCEPTION 'Cannot record QA checks on % JOB.', v_job_status;
    END IF;

    -- Deterministic monotonic sequence and server timestamp
    NEW.event_seq := COALESCE(v_current_counter, 0) + 1;
    NEW.created_at := timezone('Asia/Ho_Chi_Minh', now());

    UPDATE public.job_operations
    SET qa_event_counter = NEW.event_seq
    WHERE id = NEW.operation_id;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_qa_creation_r6 ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_qa_check_before_insert_r7 ON public.qa_checks;
CREATE TRIGGER trg_qa_check_before_insert_r7
BEFORE INSERT ON public.qa_checks
FOR EACH ROW EXECUTE FUNCTION public.handle_qa_check_before_insert_r7();


-- ------------------------------------------------------------------------------
-- 8. R6-05 & R6-06: OPERATION WORKFLOW & PE COMPLETION INVARIANTS (R7)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules_r7()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_has_runs BOOLEAN;
    v_latest_qa RECORD;
    v_has_valid_disposition BOOLEAN;
BEGIN
    v_role := public.get_current_user_role();

    -- =========================================================================
    -- A. INSERT RULES
    -- =========================================================================
    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'NOT_STARTED' THEN
            RAISE EXCEPTION 'New operations must be created with status NOT_STARTED (attempted: %).', NEW.status;
        END IF;

        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Only Planning or Admin can create new operations.';
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- B. UPDATE RULES
    -- =========================================================================
    IF TG_OP = 'UPDATE' THEN
        IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
            RAISE EXCEPTION 'Unauthorized job_id reassignment is forbidden.';
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
            -- QA can NEVER alter manufacturing operation status
            IF v_role = 'QA' THEN
                RAISE EXCEPTION 'QA is an independent evaluator and cannot alter manufacturing operation status.';
            END IF;

            -- Planning can NEVER alter execution status
            IF v_role = 'Planning' THEN
                RAISE EXCEPTION 'Planning is not authorized to alter operation manufacturing status.';
            END IF;

            -- Permitted State Machine (R6-05 FIX: IN_PROGRESS -> NOT_STARTED is strictly REMOVED):
            -- NOT_STARTED -> IN_PROGRESS (Any active PE-MFG operator or Admin)
            -- IN_PROGRESS -> HOLD, COMPLETED (Authorized PE Owner/delegate only)
            -- HOLD -> IN_PROGRESS, COMPLETED (Authorized PE Owner/delegate only)
            -- COMPLETED -> IN_PROGRESS (Explicit PE reopen with mandatory reason)
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('COMPLETED', 'HOLD') THEN
                RAISE EXCEPTION 'Invalid status transition (R6-05): IN_PROGRESS cannot transition to % (reset to NOT_STARTED is forbidden).', NEW.status;
            ELSIF OLD.status = 'HOLD' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: HOLD cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;

            -- Authority checks on final technical decisions (R6-01):
            -- 1. Advancing to COMPLETED or HOLD
            IF NEW.status IN ('COMPLETED', 'HOLD') THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'User % is not the designated PE Owner or delegate for JOB %.',
                        auth.uid(), NEW.job_id;
                END IF;
            END IF;

            -- 2. Reopening a COMPLETED operation
            IF OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS' THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'Only designated PE Owner or delegate can reopen a completed operation for JOB %.', NEW.job_id;
                END IF;

                IF length(trim(COALESCE(NEW.reopen_reason, ''))) < 5 THEN
                    RAISE EXCEPTION 'Reopening a completed operation requires a recorded reopen_reason (minimum 5 characters).';
                END IF;

                NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.reopened_by := auth.uid();
            END IF;
        END IF;

        -- B.2 Completion Invariant Rule (R6-06 Deterministic QA Event Ordering)
        IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
            -- Must have at least one completed production run with ok_qty > 0
            SELECT EXISTS (
                SELECT 1 FROM public.production_runs
                WHERE operation_id = NEW.id AND ok_qty > 0
            ) INTO v_has_runs;

            IF NOT v_has_runs THEN
                RAISE EXCEPTION 'Cannot complete operation: requires at least one completed production run with OK quantity > 0.';
            END IF;

            -- R6-06: Authoritative latest QA check ordered by event_seq DESC
            SELECT id, result, event_seq, created_at
            INTO v_latest_qa
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY event_seq DESC
            LIMIT 1;

            -- If latest QA check is NG or KIV, requires an explicit valid technical disposition
            IF v_latest_qa.id IS NOT NULL AND v_latest_qa.result IN ('NG', 'KIV') THEN
                -- R6-06 Invariants:
                -- 1. HOLD disposition NEVER authorizes completion!
                -- 2. Disposition MUST be linked to the EXACT latest QA check event (qa_check_id = v_latest_qa.id)
                -- 3. Disposition decision_timestamp must be >= v_latest_qa.created_at (old dispositions cannot authorize newer findings)
                -- 4. If operation was previously reopened, disposition must be >= reopened_at
                SELECT EXISTS (
                    SELECT 1 FROM public.pe_technical_dispositions
                    WHERE operation_id = NEW.id
                      AND decision_type IN ('CONTINUE_AS_IS', 'REWORK_NEXT', 'TECHNICAL_REVIEW', 'CUSTOMER_EVALUATION')
                      AND qa_check_id = v_latest_qa.id
                      AND decision_timestamp >= v_latest_qa.created_at
                      AND (OLD.reopened_at IS NULL OR decision_timestamp >= OLD.reopened_at)
                ) INTO v_has_valid_disposition;

                IF NOT v_has_valid_disposition THEN
                    RAISE EXCEPTION 'Cannot complete operation with outstanding QA % (event #%) without an authorized PE technical continuation disposition (HOLD does not permit completion).',
                        v_latest_qa.result, v_latest_qa.event_seq;
                END IF;
            END IF;
        END IF;

        -- B.3 Planning specifications lock once operation has started
        IF v_role = 'Planning' AND OLD.status != 'NOT_STARTED' THEN
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.step_order IS DISTINCT FROM OLD.step_order OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds THEN
                RAISE EXCEPTION 'Planning cannot alter specifications for operations that have already started.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r4 ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r5 ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r7 ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow_r7
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules_r7();
