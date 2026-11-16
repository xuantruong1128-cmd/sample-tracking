-- ============================================================================
-- Migration: 00036_fix_drawing_review_issue_rpc.sql
-- Description: Re-declares allocate_next_drawing_review_issue_no,
-- create_drawing_review_issue, and create_next_drawing_review_version
-- matching drawing_review_versions and drawing_review_issues schema.
-- ============================================================================

-- 1. allocate_next_drawing_review_issue_no
CREATE OR REPLACE FUNCTION public.allocate_next_drawing_review_issue_no(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_date_str VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Auth check: BD, Admin, or service_role
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('BD', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò BD hoặc Admin mới được tạo mã yêu cầu đánh giá bản vẽ.';
        END IF;
    END IF;

    -- Format YYMMDD in Asia/Ho_Chi_Minh (+07:00)
    v_date_str := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD');

    LOOP
        INSERT INTO public.drawing_review_issue_sequences (date_key, last_seq, updated_at)
        VALUES (v_date_str, 1, timezone('Asia/Ho_Chi_Minh', NOW()))
        ON CONFLICT (date_key)
        DO UPDATE SET
            last_seq = public.drawing_review_issue_sequences.last_seq + 1,
            updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
        RETURNING last_seq INTO v_allocated_seq;

        IF v_allocated_seq < 1000 THEN
            v_seq_str := 'N' || LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := 'N' || v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_date_str || '-' || v_seq_str;

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.drawing_review_issues WHERE issue_no = v_candidate_code
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 2. create_drawing_review_issue
CREATE OR REPLACE FUNCTION public.create_drawing_review_issue(
    p_item_no TEXT,
    p_item_name TEXT,
    p_customer TEXT,
    p_drawing_file_path TEXT,
    p_drawing_file_name TEXT,
    p_drawing_file_size BIGINT,
    p_drawing_mime_type TEXT,
    p_attention TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_issue_no TEXT;
    v_issue_id UUID;
    v_version_id UUID;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('BD', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò BD hoặc Admin mới được tạo yêu cầu đánh giá bản vẽ.';
        END IF;
    END IF;

    -- Mandatory validations
    IF NULLIF(trim(p_item_no), '') IS NULL THEN
        RAISE EXCEPTION 'Mã bản vẽ/sản phẩm (Item No.) là bắt buộc.';
    END IF;
    IF NULLIF(trim(p_item_name), '') IS NULL THEN
        RAISE EXCEPTION 'Tên sản phẩm (Item Name) là bắt buộc.';
    END IF;
    IF NULLIF(trim(p_customer), '') IS NULL THEN
        RAISE EXCEPTION 'Khách hàng (Customer) là bắt buộc.';
    END IF;
    IF NULLIF(trim(p_drawing_file_path), '') IS NULL THEN
        RAISE EXCEPTION 'Tệp bản vẽ là bắt buộc.';
    END IF;

    -- Allocate next Issue No atomically
    v_issue_no := public.allocate_next_drawing_review_issue_no();

    -- Insert Master Issue
    INSERT INTO public.drawing_review_issues (
        issue_no,
        item_no,
        item_name,
        customer,
        drawing_file_path,
        drawing_file_name,
        drawing_file_size,
        drawing_mime_type,
        attention,
        created_by
    ) VALUES (
        v_issue_no,
        trim(p_item_no),
        trim(p_item_name),
        trim(p_customer),
        trim(p_drawing_file_path),
        trim(p_drawing_file_name),
        p_drawing_file_size,
        trim(p_drawing_mime_type),
        NULLIF(trim(p_attention), ''),
        v_uid
    )
    RETURNING id INTO v_issue_id;

    -- Insert Initial V1 Version (status: Issued)
    INSERT INTO public.drawing_review_versions (
        issue_id,
        version_number,
        version_name,
        status,
        created_by
    ) VALUES (
        v_issue_id,
        1,
        'V1',
        'Issued',
        v_uid
    )
    RETURNING id INTO v_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'issue_id', v_issue_id,
        'issue_no', v_issue_no,
        'version_id', v_version_id,
        'version_name', 'V1',
        'status', 'Issued'
    );
END;
$$;

-- 3. create_next_drawing_review_version
CREATE OR REPLACE FUNCTION public.create_next_drawing_review_version(
    p_issue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_has_open_ver BOOLEAN;
    v_latest_ver RECORD;
    v_next_num INTEGER;
    v_next_name VARCHAR(10);
    v_new_ver_id UUID;
    v_att RECORD;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền tạo phiên bản đánh giá mới.';
        END IF;
    END IF;

    -- Concurrency safeguard: lock parent issue
    PERFORM 1 FROM public.drawing_review_issues WHERE id = p_issue_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy yêu cầu đánh giá bản vẽ.';
    END IF;

    -- Check if an uncompleted version is still open
    SELECT EXISTS (
        SELECT 1 FROM public.drawing_review_versions
        WHERE issue_id = p_issue_id AND status IN ('Issued', 'Reviewing')
    ) INTO v_has_open_ver;

    IF v_has_open_ver THEN
        RAISE EXCEPTION 'Đã có một phiên bản đang chỉnh sửa cho yêu cầu này. Chỉ cho phép duy nhất một phiên bản mở tại một thời điểm.';
    END IF;

    -- Identify latest Completed version
    SELECT * INTO v_latest_ver
    FROM public.drawing_review_versions
    WHERE issue_id = p_issue_id AND status = 'Completed'
    ORDER BY version_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đã hoàn thành (Completed) để nhân bản.';
    END IF;

    v_next_num := v_latest_ver.version_number + 1;
    v_next_name := 'V' || v_next_num::TEXT;

    -- Create new version with status 'Reviewing'
    INSERT INTO public.drawing_review_versions (
        issue_id,
        version_number,
        version_name,
        parent_version_id,
        status,
        required_material,
        required_tooling,
        special_measuring_equipment,
        engineering_remarks,
        avatar_file_path,
        avatar_crop_box,
        created_by
    ) VALUES (
        p_issue_id,
        v_next_num,
        v_next_name,
        v_latest_ver.id,
        'Reviewing',
        v_latest_ver.required_material,
        v_latest_ver.required_tooling,
        v_latest_ver.special_measuring_equipment,
        v_latest_ver.engineering_remarks,
        v_latest_ver.avatar_file_path,
        v_latest_ver.avatar_crop_box,
        v_uid
    )
    RETURNING id INTO v_new_ver_id;

    -- Clone surviving active operations with stable lineage_id
    INSERT INTO public.drawing_review_operations (
        version_id,
        lineage_id,
        step_order,
        workcenter_code,
        operation_description,
        cycle_time_seconds,
        remark,
        is_removed
    )
    SELECT
        v_new_ver_id,
        lineage_id,
        step_order,
        workcenter_code,
        operation_description,
        cycle_time_seconds,
        remark,
        is_removed
    FROM public.drawing_review_operations
    WHERE version_id = v_latest_ver.id;

    -- Clone attachments
    FOR v_att IN
        SELECT * FROM public.drawing_review_attachments
        WHERE version_id = v_latest_ver.id
    LOOP
        INSERT INTO public.drawing_review_attachments (
            version_id,
            file_name,
            file_path,
            file_size,
            mime_type,
            caption
        ) VALUES (
            v_new_ver_id,
            v_att.file_name,
            v_att.file_path,
            v_att.file_size,
            v_att.mime_type,
            v_att.caption
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', v_new_ver_id,
        'version_name', v_next_name,
        'version_number', v_next_num,
        'status', 'Reviewing'
    );
END;
$$;
