-- ============================================================================
-- Migration: 00034_fix_security_definer_session_user.sql
-- Description: Hardens role checks in Drawing Review SECURITY DEFINER functions
-- by replacing current_user with session_user so that functions owned by postgres
-- correctly enforce API client role permissions.
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
        COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::UUID)
    )
    RETURNING id INTO v_issue_id;

    -- Insert Initial Version V1 with status 'Issued'
    INSERT INTO public.drawing_review_versions (
        issue_id,
        version_number,
        version_name,
        status,
        drawing_file_path,
        drawing_file_name,
        drawing_file_size,
        drawing_mime_type,
        created_by
    ) VALUES (
        v_issue_id,
        1,
        'V1',
        'Issued',
        trim(p_drawing_file_path),
        trim(p_drawing_file_name),
        p_drawing_file_size,
        trim(p_drawing_mime_type),
        COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::UUID)
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

-- 3. save_drawing_review_draft
CREATE OR REPLACE FUNCTION public.save_drawing_review_draft(
    p_version_id UUID,
    p_required_material TEXT DEFAULT NULL,
    p_required_tooling TEXT DEFAULT NULL,
    p_special_measuring_equipment TEXT DEFAULT NULL,
    p_engineering_remarks TEXT DEFAULT NULL,
    p_avatar_file_path TEXT DEFAULT NULL,
    p_avatar_crop_box JSONB DEFAULT NULL,
    p_operations JSONB DEFAULT '[]'::jsonb
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
    v_version RECORD;
    v_op RECORD;
    v_step_order INT;
    v_wc TEXT;
    v_op_desc TEXT;
    v_ct NUMERIC;
    v_remark TEXT;
    v_lineage_id UUID;
    v_is_removed BOOLEAN;
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền cập nhật dữ liệu kỹ thuật.';
        END IF;
    END IF;

    -- Lock and inspect version
    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đánh giá kỹ thuật.';
    END IF;

    IF v_version.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành (Completed) và đã bị khóa, không thể chỉnh sửa.';
    END IF;

    -- Update version technical fields and set status to 'Reviewing'
    UPDATE public.drawing_review_versions
    SET
        required_material = p_required_material,
        required_tooling = p_required_tooling,
        special_measuring_equipment = p_special_measuring_equipment,
        engineering_remarks = p_engineering_remarks,
        avatar_file_path = COALESCE(p_avatar_file_path, avatar_file_path),
        avatar_crop_box = COALESCE(p_avatar_crop_box, avatar_crop_box),
        status = 'Reviewing',
        updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
    WHERE id = p_version_id;

    -- Replace operations for this version
    DELETE FROM public.drawing_review_operations
    WHERE version_id = p_version_id;

    -- Insert updated operations
    IF p_operations IS NOT NULL AND jsonb_array_length(p_operations) > 0 THEN
        FOR v_op IN SELECT * FROM jsonb_to_recordset(p_operations) AS x(
            id UUID,
            lineage_id UUID,
            step_order INT,
            workcenter_code TEXT,
            operation_description TEXT,
            cycle_time_seconds NUMERIC,
            remark TEXT,
            is_removed BOOLEAN
        )
        LOOP
            v_step_order := COALESCE(v_op.step_order, 10);
            v_wc := trim(COALESCE(v_op.workcenter_code, ''));
            v_op_desc := trim(COALESCE(v_op.operation_description, ''));
            v_ct := COALESCE(v_op.cycle_time_seconds, 0);
            v_remark := trim(COALESCE(v_op.remark, ''));
            v_lineage_id := COALESCE(v_op.lineage_id, gen_random_uuid());
            v_is_removed := COALESCE(v_op.is_removed, false);

            INSERT INTO public.drawing_review_operations (
                version_id,
                lineage_id,
                step_order,
                workcenter_code,
                operation_description,
                cycle_time_seconds,
                remark,
                is_removed
            ) VALUES (
                p_version_id,
                v_lineage_id,
                v_step_order,
                v_wc,
                NULLIF(v_op_desc, ''),
                v_ct,
                NULLIF(v_remark, ''),
                v_is_removed
            );
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Reviewing'
    );
END;
$$;

-- 4. close_drawing_review_version
CREATE OR REPLACE FUNCTION public.close_drawing_review_version(
    p_version_id UUID
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
    v_version RECORD;
    v_active_ops_count INT;
    v_invalid_wc_count INT;
    v_invalid_ct_count INT;
    v_missing_subcon_count INT;
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền chốt hoàn thành đánh giá kỹ thuật.';
        END IF;
    END IF;

    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đánh giá kỹ thuật.';
    END IF;

    IF v_version.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành trước đó và đã bị khóa.';
    END IF;

    -- Validation 1: Must have at least 1 active routing operation
    SELECT COUNT(*) INTO v_active_ops_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id AND is_removed = FALSE;

    IF v_active_ops_count = 0 THEN
        RAISE EXCEPTION 'Yêu cầu có ít nhất 1 công đoạn routing đang hoạt động để hoàn thành đánh giá.';
    END IF;

    -- Validation 2: Every active operation must have a non-empty workcenter_code
    SELECT COUNT(*) INTO v_invalid_wc_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id
      AND is_removed = FALSE
      AND NULLIF(trim(workcenter_code), '') IS NULL;

    IF v_invalid_wc_count > 0 THEN
        RAISE EXCEPTION 'Tất cả các công đoạn phải được chọn Work Center.';
    END IF;

    -- Validation 3: Every active operation must have finite non-negative cycle time
    SELECT COUNT(*) INTO v_invalid_ct_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id
      AND is_removed = FALSE
      AND (cycle_time_seconds IS NULL OR cycle_time_seconds < 0);

    IF v_invalid_ct_count > 0 THEN
        RAISE EXCEPTION 'Thời gian chu kỳ (Cycle Time) không được âm và không được để trống.';
    END IF;

    -- Validation 4: SUBCON requires non-empty operation_description
    SELECT COUNT(*) INTO v_missing_subcon_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id
      AND is_removed = FALSE
      AND UPPER(trim(workcenter_code)) = 'SUBCON'
      AND NULLIF(trim(operation_description), '') IS NULL;

    IF v_missing_subcon_count > 0 THEN
        RAISE EXCEPTION 'Công đoạn gia công ngoài (SUBCON) bắt buộc phải có mô tả công đoạn (Operation Description).';
    END IF;

    -- Stamp closed status
    UPDATE public.drawing_review_versions
    SET
        status = 'Completed',
        closed_by = v_uid,
        closed_at = timezone('Asia/Ho_Chi_Minh', NOW()),
        updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
    WHERE id = p_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Completed',
        'closed_by', v_uid,
        'closed_at', timezone('Asia/Ho_Chi_Minh', NOW())
    );
END;
$$;

-- 5. create_next_drawing_review_version
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
    v_latest_version RECORD;
    v_open_version_count INT;
    v_new_version_id UUID;
    v_new_version_number INT;
    v_new_version_name TEXT;
    v_op RECORD;
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

    -- Enforce single editable version rule
    SELECT COUNT(*) INTO v_open_version_count
    FROM public.drawing_review_versions
    WHERE issue_id = p_issue_id AND status != 'Completed';

    IF v_open_version_count > 0 THEN
        RAISE EXCEPTION 'Không thể tạo phiên bản mới: Bản vẽ đang có phiên bản chưa hoàn thành (Issued/Reviewing).';
    END IF;

    -- Fetch latest completed version
    SELECT * INTO v_latest_version
    FROM public.drawing_review_versions
    WHERE issue_id = p_issue_id
    ORDER BY version_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản trước đó để nhân bản.';
    END IF;

    v_new_version_number := v_latest_version.version_number + 1;
    v_new_version_name := 'V' || v_new_version_number::TEXT;

    -- Clone version with status = 'Reviewing'
    INSERT INTO public.drawing_review_versions (
        issue_id,
        version_number,
        version_name,
        status,
        drawing_file_path,
        drawing_file_name,
        drawing_file_size,
        drawing_mime_type,
        required_material,
        required_tooling,
        special_measuring_equipment,
        engineering_remarks,
        avatar_file_path,
        avatar_crop_box,
        created_by
    ) VALUES (
        p_issue_id,
        v_new_version_number,
        v_new_version_name,
        'Reviewing',
        v_latest_version.drawing_file_path,
        v_latest_version.drawing_file_name,
        v_latest_version.drawing_file_size,
        v_latest_version.drawing_mime_type,
        v_latest_version.required_material,
        v_latest_version.required_tooling,
        v_latest_version.special_measuring_equipment,
        v_latest_version.engineering_remarks,
        v_latest_version.avatar_file_path,
        v_latest_version.avatar_crop_box,
        COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::UUID)
    )
    RETURNING id INTO v_new_version_id;

    -- Clone operations keeping identical lineage_id
    FOR v_op IN
        SELECT * FROM public.drawing_review_operations
        WHERE version_id = v_latest_version.id
        ORDER BY step_order ASC
    LOOP
        INSERT INTO public.drawing_review_operations (
            version_id,
            lineage_id,
            step_order,
            workcenter_code,
            operation_description,
            cycle_time_seconds,
            remark,
            is_removed
        ) VALUES (
            v_new_version_id,
            v_op.lineage_id,
            v_op.step_order,
            v_op.workcenter_code,
            v_op.operation_description,
            v_op.cycle_time_seconds,
            v_op.remark,
            v_op.is_removed
        );
    END LOOP;

    -- Clone attachments
    FOR v_att IN
        SELECT * FROM public.drawing_review_attachments
        WHERE version_id = v_latest_version.id
    LOOP
        INSERT INTO public.drawing_review_attachments (
            version_id,
            file_name,
            file_path,
            file_size,
            mime_type,
            caption
        ) VALUES (
            v_new_version_id,
            v_att.file_name,
            v_att.file_path,
            v_att.file_size,
            v_att.mime_type,
            v_att.caption
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', v_new_version_id,
        'version_name', v_new_version_name,
        'version_number', v_new_version_number,
        'status', 'Reviewing'
    );
END;
$$;
