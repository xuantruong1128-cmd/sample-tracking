-- ============================================================================
-- Migration: 00041_drawing_review_activity_history.sql
-- Description: Audit and Activity History Log for Drawing Review lifecycle.
-- Records every status change, review, quote, requote, and version event:
--   - Who did it (performer full name, role, phone, user id)
--   - When it was done (timestamp in Asia/Ho_Chi_Minh)
--   - What action was performed (Issue, Review draft, Completed, Quoted, Requote, Requoted, Next Version)
--   - Old status -> New status transition & metadata details
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ACTIVITY LOGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drawing_review_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES public.drawing_review_issues(id) ON DELETE CASCADE,
    version_id UUID REFERENCES public.drawing_review_versions(id) ON DELETE CASCADE,
    version_name VARCHAR(10),
    action VARCHAR(50) NOT NULL,
    action_label TEXT NOT NULL,
    performed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    performer_name TEXT NOT NULL,
    performer_role TEXT,
    performer_phone TEXT,
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_dr_activity_logs_issue_id ON public.drawing_review_activity_logs(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_activity_logs_version_id ON public.drawing_review_activity_logs(version_id);
CREATE INDEX IF NOT EXISTS idx_dr_activity_logs_created_at ON public.drawing_review_activity_logs(created_at DESC);

-- RLS & Grants
ALTER TABLE public.drawing_review_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drawing_review_activity_logs_select"
ON public.drawing_review_activity_logs FOR SELECT
TO authenticated
USING (true);

GRANT SELECT ON public.drawing_review_activity_logs TO authenticated;
GRANT ALL ON public.drawing_review_activity_logs TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTION: log_drawing_review_activity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_drawing_review_activity(
    p_issue_id UUID,
    p_version_id UUID,
    p_version_name VARCHAR(10),
    p_action VARCHAR(50),
    p_action_label TEXT,
    p_performed_by UUID,
    p_old_status VARCHAR(20) DEFAULT NULL,
    p_new_status VARCHAR(20) DEFAULT NULL,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_profile RECORD;
    v_performer_name TEXT := 'Hệ thống';
    v_performer_role TEXT := NULL;
    v_performer_phone TEXT := NULL;
    v_log_id UUID;
BEGIN
    IF p_performed_by IS NOT NULL THEN
        SELECT full_name, role::TEXT, phone
        INTO v_profile
        FROM public.profiles
        WHERE id = p_performed_by;

        IF FOUND THEN
            v_performer_name := COALESCE(v_profile.full_name, 'Người dùng');
            v_performer_role := v_profile.role;
            v_performer_phone := v_profile.phone;
        END IF;
    END IF;

    INSERT INTO public.drawing_review_activity_logs (
        issue_id,
        version_id,
        version_name,
        action,
        action_label,
        performed_by,
        performer_name,
        performer_role,
        performer_phone,
        old_status,
        new_status,
        details,
        created_at
    ) VALUES (
        p_issue_id,
        p_version_id,
        p_version_name,
        p_action,
        p_action_label,
        p_performed_by,
        v_performer_name,
        v_performer_role,
        v_performer_phone,
        p_old_status,
        p_new_status,
        COALESCE(p_details, '{}'::jsonb),
        timezone('Asia/Ho_Chi_Minh', now())
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. UPDATE RPCS TO ATOMICALLY LOG ACTIVITIES
-- ----------------------------------------------------------------------------

-- 3.1 create_drawing_review_issue (BD creates issue and initial V1)
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

    -- Audit log activity
    PERFORM public.log_drawing_review_activity(
        v_issue_id,
        v_version_id,
        'V1',
        'ISSUE_CREATED',
        'Phát hành bản vẽ',
        v_uid,
        NULL,
        'Issued',
        jsonb_build_object(
            'issue_no', v_issue_no,
            'item_no', trim(p_item_no),
            'item_name', trim(p_item_name),
            'customer', trim(p_customer),
            'drawing_file_name', trim(p_drawing_file_name)
        )
    );

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

-- 3.2 save_drawing_review_draft (PE saves draft, changes to Reviewing if Issued)
CREATE OR REPLACE FUNCTION public.save_drawing_review_draft(
    p_version_id UUID,
    p_required_material TEXT DEFAULT NULL,
    p_required_tooling TEXT DEFAULT NULL,
    p_special_measuring_equipment TEXT DEFAULT NULL,
    p_engineering_remarks TEXT DEFAULT NULL,
    p_avatar_file_path TEXT DEFAULT NULL,
    p_avatar_crop_box JSONB DEFAULT NULL,
    p_operations JSONB DEFAULT '[]'::jsonb,
    p_material_type TEXT DEFAULT NULL,
    p_material_specification TEXT DEFAULT NULL
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
    v_calc_data JSONB;
    v_mat_type TEXT;
    v_mat_spec TEXT;
    v_req_mat TEXT;
    v_old_status VARCHAR(20);
    v_new_status VARCHAR(20);
    v_op_count INT := 0;
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

    IF v_version.status IN ('Completed', 'Quoted', 'Requote', 'Requoted') THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành (%s) và đã bị khóa, không thể chỉnh sửa.', v_version.status;
    END IF;

    v_old_status := v_version.status;
    v_new_status := 'Reviewing';

    -- Resolve material fields
    v_mat_type := p_material_type;
    v_mat_spec := p_material_specification;

    IF v_mat_type IS NULL AND v_mat_spec IS NULL AND p_required_material IS NOT NULL THEN
        v_mat_spec := p_required_material;
    END IF;

    v_req_mat := COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', COALESCE(v_mat_type, ''), COALESCE(v_mat_spec, ''))), ''),
        p_required_material
    );

    UPDATE public.drawing_review_versions
    SET
        material_type = v_mat_type,
        material_specification = v_mat_spec,
        required_material = v_req_mat,
        required_tooling = p_required_tooling,
        special_measuring_equipment = p_special_measuring_equipment,
        engineering_remarks = p_engineering_remarks,
        avatar_file_path = COALESCE(p_avatar_file_path, avatar_file_path),
        avatar_crop_box = COALESCE(p_avatar_crop_box, avatar_crop_box),
        status = v_new_status,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_version_id;

    -- Upsert Operations
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations)
    LOOP
        v_step_order := (v_op.value->>'step_order')::INT;
        v_wc := TRIM(v_op.value->>'workcenter_code');
        v_op_desc := v_op.value->>'operation_description';
        v_ct := (v_op.value->>'cycle_time_seconds')::NUMERIC;
        v_remark := v_op.value->>'remark';
        v_is_removed := COALESCE((v_op.value->>'is_removed')::BOOLEAN, FALSE);
        v_lineage_id := NULLIF(v_op.value->>'lineage_id', '')::UUID;
        v_calc_data := v_op.value->'calculation_data';

        IF NOT v_is_removed THEN
            v_op_count := v_op_count + 1;
        END IF;

        IF v_wc IS NULL OR v_wc = '' THEN
            RAISE EXCEPTION 'Mã tổ máy (workcenter_code) không được để trống cho công đoạn %', v_step_order;
        END IF;

        IF UPPER(v_wc) = 'SUBCON' AND (v_op_desc IS NULL OR TRIM(v_op_desc) = '') THEN
            RAISE EXCEPTION 'Mô tả công đoạn là bắt buộc đối với tổ máy SUBCON (công đoạn %)', v_step_order;
        END IF;

        IF v_lineage_id IS NOT NULL THEN
            UPDATE public.drawing_review_operations
            SET
                step_order = v_step_order,
                workcenter_code = v_wc,
                operation_description = v_op_desc,
                cycle_time_seconds = v_ct,
                remark = v_remark,
                is_removed = v_is_removed,
                calculation_data = v_calc_data
            WHERE version_id = p_version_id AND lineage_id = v_lineage_id;

            IF NOT FOUND THEN
                INSERT INTO public.drawing_review_operations (
                    version_id, lineage_id, step_order, workcenter_code,
                    operation_description, cycle_time_seconds, remark, is_removed,
                    calculation_data
                ) VALUES (
                    p_version_id, v_lineage_id, v_step_order, v_wc,
                    v_op_desc, v_ct, v_remark, v_is_removed,
                    v_calc_data
                );
            END IF;
        ELSE
            INSERT INTO public.drawing_review_operations (
                version_id, step_order, workcenter_code,
                operation_description, cycle_time_seconds, remark, is_removed,
                calculation_data
            ) VALUES (
                p_version_id, v_step_order, v_wc,
                v_op_desc, v_ct, v_remark, v_is_removed,
                v_calc_data
            );
        END IF;
    END LOOP;

    -- Audit log activity: Record review start or draft update
    IF v_old_status = 'Issued' THEN
        PERFORM public.log_drawing_review_activity(
            v_version.issue_id,
            p_version_id,
            v_version.version_name,
            'REVIEW_STARTED',
            'Bắt đầu đánh giá kỹ thuật (Reviewing)',
            v_uid,
            v_old_status,
            v_new_status,
            jsonb_build_object('active_operations_count', v_op_count, 'material', v_req_mat)
        );
    ELSE
        PERFORM public.log_drawing_review_activity(
            v_version.issue_id,
            p_version_id,
            v_version.version_name,
            'REVIEW_DRAFT_SAVED',
            'Lưu nháp quy trình kỹ thuật',
            v_uid,
            v_old_status,
            v_new_status,
            jsonb_build_object('active_operations_count', v_op_count, 'material', v_req_mat)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Reviewing'
    );
END;
$$;

-- 3.3 close_drawing_review_version (PE completes technical review)
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
    v_invalid_subcon_count INT;
    v_total_ct NUMERIC;
    v_now TIMESTAMPTZ;
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

    IF v_version.status IN ('Completed', 'Quoted', 'Requote', 'Requoted') THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành trước đó (%s) và đã bị khóa.', v_version.status;
    END IF;

    -- Validation 1: Must have at least 1 active routing operation
    SELECT COUNT(*), COALESCE(SUM(cycle_time_seconds), 0)
    INTO v_active_ops_count, v_total_ct
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id AND is_removed = FALSE;

    IF v_active_ops_count = 0 THEN
        RAISE EXCEPTION 'Yêu cầu có ít nhất 1 công đoạn routing đang hoạt động để hoàn thành đánh giá.';
    END IF;

    -- Validation 2: Every active operation must have a non-empty workcenter_code
    SELECT COUNT(*) INTO v_invalid_wc_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id AND is_removed = FALSE
      AND (workcenter_code IS NULL OR TRIM(workcenter_code) = '');

    IF v_invalid_wc_count > 0 THEN
        RAISE EXCEPTION 'Tất cả công đoạn đang hoạt động phải có mã tổ máy hợp lệ.';
    END IF;

    -- Validation 3: cycle_time_seconds must be >= 0 when provided
    SELECT COUNT(*) INTO v_invalid_ct_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id AND is_removed = FALSE
      AND cycle_time_seconds IS NOT NULL AND cycle_time_seconds < 0;

    IF v_invalid_ct_count > 0 THEN
        RAISE EXCEPTION 'Thời gian chu kỳ (cycle time) không được là số âm.';
    END IF;

    -- Validation 4: Subcon operations must have operation_description
    SELECT COUNT(*) INTO v_invalid_subcon_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id AND is_removed = FALSE
      AND UPPER(workcenter_code) = 'SUBCON'
      AND (operation_description IS NULL OR TRIM(operation_description) = '');

    IF v_invalid_subcon_count > 0 THEN
        RAISE EXCEPTION 'Công đoạn gia công ngoài (SUBCON) bắt buộc phải có nội dung mô tả công đoạn.';
    END IF;

    v_now := timezone('Asia/Ho_Chi_Minh', NOW());

    -- Stamp closed status
    UPDATE public.drawing_review_versions
    SET
        status = 'Completed',
        closed_at = v_now,
        closed_by = COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::UUID),
        updated_at = v_now
    WHERE id = p_version_id;

    -- Audit log activity
    PERFORM public.log_drawing_review_activity(
        v_version.issue_id,
        p_version_id,
        v_version.version_name,
        'REVIEW_COMPLETED',
        'Chốt hoàn thành đánh giá (Completed)',
        v_uid,
        v_version.status,
        'Completed',
        jsonb_build_object(
            'active_operations_count', v_active_ops_count,
            'total_cycle_time_seconds', v_total_ct,
            'closed_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Completed',
        'closed_at', v_now
    );
END;
$$;

-- 3.4 quote_drawing_review_version (BD marks version as Quoted or Requoted)
CREATE OR REPLACE FUNCTION public.quote_drawing_review_version(
    p_version_id UUID,
    p_target_status TEXT DEFAULT NULL
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
    v_target_status VARCHAR(20);
    v_has_prior_quote BOOLEAN;
    v_action_key VARCHAR(50);
    v_action_label TEXT;
    v_now TIMESTAMPTZ;
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ bộ phận Kinh doanh (BD) hoặc Quản trị viên (Admin) mới có quyền báo giá.';
        END IF;
    END IF;

    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đánh giá kỹ thuật.';
    END IF;

    IF v_version.status != 'Completed' THEN
        RAISE EXCEPTION 'Chỉ có thể xác nhận báo giá khi phiên bản đang ở trạng thái Hoàn thành (Completed). Trạng thái hiện tại: %.', v_version.status;
    END IF;

    -- Determine target status:
    IF p_target_status IS NOT NULL THEN
        IF p_target_status NOT IN ('Quoted', 'Requoted') THEN
            RAISE EXCEPTION 'Trạng thái báo giá không hợp lệ: %', p_target_status;
        END IF;
        v_target_status := p_target_status;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.drawing_review_versions
            WHERE issue_id = v_version.issue_id
              AND (status IN ('Quoted', 'Requote', 'Requoted') OR version_number < v_version.version_number)
        ) INTO v_has_prior_quote;

        IF v_version.version_number > 1 OR v_has_prior_quote THEN
            v_target_status := 'Requoted';
        ELSE
            v_target_status := 'Quoted';
        END IF;
    END IF;

    v_now := timezone('Asia/Ho_Chi_Minh', now());

    UPDATE public.drawing_review_versions
    SET
        status = v_target_status,
        quoted_at = v_now,
        quoted_by = v_uid,
        updated_at = v_now
    WHERE id = p_version_id;

    IF v_target_status = 'Requoted' THEN
        v_action_key := 'VERSION_REQUOTED';
        v_action_label := 'Báo giá lại khách hàng (Requoted)';
    ELSE
        v_action_key := 'VERSION_QUOTED';
        v_action_label := 'Báo giá khách hàng (Quoted)';
    END IF;

    PERFORM public.log_drawing_review_activity(
        v_version.issue_id,
        p_version_id,
        v_version.version_name,
        v_action_key,
        v_action_label,
        v_uid,
        'Completed',
        v_target_status,
        jsonb_build_object(
            'target_status', v_target_status,
            'quoted_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', v_target_status,
        'quoted_at', v_now
    );
END;
$$;

-- 3.5 requote_drawing_review_version (BD requests re-quote, opening '+' for PE)
CREATE OR REPLACE FUNCTION public.requote_drawing_review_version(
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
    v_now TIMESTAMPTZ;
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ bộ phận Kinh doanh (BD) hoặc Quản trị viên (Admin) mới có quyền yêu cầu báo giá lại.';
        END IF;
    END IF;

    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đánh giá kỹ thuật.';
    END IF;

    IF v_version.status NOT IN ('Quoted', 'Requoted') THEN
        RAISE EXCEPTION 'Chỉ có thể yêu cầu báo giá lại (Requote) khi phiên bản đang ở trạng thái đã báo giá (Quoted hoặc Requoted). Trạng thái hiện tại: %.', v_version.status;
    END IF;

    v_now := timezone('Asia/Ho_Chi_Minh', now());

    UPDATE public.drawing_review_versions
    SET
        status = 'Requote',
        requote_requested_at = v_now,
        requote_requested_by = v_uid,
        updated_at = v_now
    WHERE id = p_version_id;

    PERFORM public.log_drawing_review_activity(
        v_version.issue_id,
        p_version_id,
        v_version.version_name,
        'REQUOTE_REQUESTED',
        'Yêu cầu báo giá lại (Requote)',
        v_uid,
        v_version.status,
        'Requote',
        jsonb_build_object(
            'requote_requested_at', v_now,
            'note', 'Mở khóa nút tạo phiên bản mới cho bộ phận PE-MFG'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Requote',
        'requote_requested_at', v_now
    );
END;
$$;

-- 3.6 create_next_drawing_review_version (PE creates next version V2, V3...)
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

    -- Check if an uncompleted version is still open (Issued/Reviewing)
    SELECT EXISTS (
        SELECT 1 FROM public.drawing_review_versions
        WHERE issue_id = p_issue_id AND status IN ('Issued', 'Reviewing')
    ) INTO v_has_open_ver;

    IF v_has_open_ver THEN
        RAISE EXCEPTION 'Đã có một phiên bản đang chỉnh sửa cho yêu cầu này. Chỉ cho phép duy nhất một phiên bản mở tại một thời điểm.';
    END IF;

    -- Fetch the absolute latest version of this issue
    SELECT * INTO v_latest_ver
    FROM public.drawing_review_versions
    WHERE issue_id = p_issue_id
    ORDER BY version_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản trước đó để nhân bản.';
    END IF;

    -- STRICT RULE: Quoted and Requoted are CLOSED
    IF v_latest_ver.status IN ('Quoted', 'Requoted') THEN
        RAISE EXCEPTION 'Không thể tạo phiên bản mới: Bản vẽ đã được báo giá (%s). Cần bộ phận BD nhấn Requote để mở khóa trước khi tạo phiên bản mới.', v_latest_ver.status;
    END IF;

    -- STRICT RULE: Only Completed or Requote are OPEN
    IF v_latest_ver.status NOT IN ('Completed', 'Requote') THEN
        RAISE EXCEPTION 'Chỉ có thể tạo phiên bản tiếp theo khi phiên bản gần nhất đã hoàn thành (Completed) hoặc được yêu cầu báo giá lại (Requote). Trạng thái hiện tại: %s.', v_latest_ver.status;
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
        material_type,
        material_specification,
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
        v_latest_ver.material_type,
        v_latest_ver.material_specification,
        v_latest_ver.required_material,
        v_latest_ver.required_tooling,
        v_latest_ver.special_measuring_equipment,
        v_latest_ver.engineering_remarks,
        v_latest_ver.avatar_file_path,
        v_latest_ver.avatar_crop_box,
        v_uid
    )
    RETURNING id INTO v_new_ver_id;

    -- Deep copy operations preserving lineage_id
    INSERT INTO public.drawing_review_operations (
        version_id,
        lineage_id,
        step_order,
        workcenter_code,
        operation_description,
        cycle_time_seconds,
        remark,
        is_removed,
        calculation_data
    )
    SELECT
        v_new_ver_id,
        lineage_id,
        step_order,
        workcenter_code,
        operation_description,
        cycle_time_seconds,
        remark,
        is_removed,
        calculation_data
    FROM public.drawing_review_operations
    WHERE version_id = v_latest_ver.id;

    -- Deep copy attachments
    FOR v_att IN
        SELECT file_path, file_name, file_size, mime_type, caption
        FROM public.drawing_review_attachments
        WHERE version_id = v_latest_ver.id
    LOOP
        INSERT INTO public.drawing_review_attachments (
            version_id,
            file_path,
            file_name,
            file_size,
            mime_type,
            caption
        ) VALUES (
            v_new_ver_id,
            v_att.file_path,
            v_att.file_name,
            v_att.file_size,
            v_att.mime_type,
            v_att.caption
        );
    END LOOP;

    -- Audit log activity
    PERFORM public.log_drawing_review_activity(
        p_issue_id,
        v_new_ver_id,
        v_next_name,
        'VERSION_CREATED',
        'Tạo phiên bản mới (' || v_next_name || ')',
        v_uid,
        v_latest_ver.status,
        'Reviewing',
        jsonb_build_object(
            'parent_version', v_latest_ver.version_name,
            'version_number', v_next_num,
            'version_name', v_next_name
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'issue_id', p_issue_id,
        'version_id', v_new_ver_id,
        'version_number', v_next_num,
        'version_name', v_next_name,
        'status', 'Reviewing'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. BACKFILL HISTORICAL ACTIVITIES FOR EXISTING PRODUCTION RECORDS
-- ----------------------------------------------------------------------------

-- 4.1 Backfill ISSUE_CREATED
INSERT INTO public.drawing_review_activity_logs (
    issue_id, version_id, version_name, action, action_label,
    performed_by, performer_name, performer_role, performer_phone,
    old_status, new_status, details, created_at
)
SELECT
    i.id,
    v.id,
    'V1',
    'ISSUE_CREATED',
    'Phát hành bản vẽ',
    i.created_by,
    COALESCE(p.full_name, 'Bộ phận Kinh doanh (BD)'),
    COALESCE(p.role::TEXT, 'BD'),
    p.phone,
    NULL,
    'Issued',
    jsonb_build_object(
        'issue_no', i.issue_no,
        'item_no', i.item_no,
        'item_name', i.item_name,
        'customer', i.customer,
        'drawing_file_name', i.drawing_file_name
    ),
    i.created_at
FROM public.drawing_review_issues i
LEFT JOIN public.drawing_review_versions v ON v.issue_id = i.id AND v.version_number = 1
LEFT JOIN public.profiles p ON p.id = i.created_by;

-- 4.2 Backfill VERSION_CREATED for versions > 1
INSERT INTO public.drawing_review_activity_logs (
    issue_id, version_id, version_name, action, action_label,
    performed_by, performer_name, performer_role, performer_phone,
    old_status, new_status, details, created_at
)
SELECT
    v.issue_id,
    v.id,
    v.version_name,
    'VERSION_CREATED',
    'Tạo phiên bản mới (' || v.version_name || ')',
    v.created_by,
    COALESCE(p.full_name, 'Kỹ sư PE-MFG'),
    COALESCE(p.role::TEXT, 'PE-MFG'),
    p.phone,
    'Completed',
    'Reviewing',
    jsonb_build_object('version_number', v.version_number, 'version_name', v.version_name),
    v.created_at
FROM public.drawing_review_versions v
LEFT JOIN public.profiles p ON p.id = v.created_by
WHERE v.version_number > 1;

-- 4.3 Backfill REVIEW_COMPLETED
INSERT INTO public.drawing_review_activity_logs (
    issue_id, version_id, version_name, action, action_label,
    performed_by, performer_name, performer_role, performer_phone,
    old_status, new_status, details, created_at
)
SELECT
    v.issue_id,
    v.id,
    v.version_name,
    'REVIEW_COMPLETED',
    'Chốt hoàn thành đánh giá (Completed)',
    v.closed_by,
    COALESCE(p.full_name, 'Kỹ sư PE-MFG'),
    COALESCE(p.role::TEXT, 'PE-MFG'),
    p.phone,
    'Reviewing',
    'Completed',
    jsonb_build_object('version_name', v.version_name),
    COALESCE(v.closed_at, v.updated_at)
FROM public.drawing_review_versions v
LEFT JOIN public.profiles p ON p.id = v.closed_by
WHERE v.closed_at IS NOT NULL;

-- 4.4 Backfill QUOTED / REQUOTED
INSERT INTO public.drawing_review_activity_logs (
    issue_id, version_id, version_name, action, action_label,
    performed_by, performer_name, performer_role, performer_phone,
    old_status, new_status, details, created_at
)
SELECT
    v.issue_id,
    v.id,
    v.version_name,
    CASE WHEN v.status = 'Requoted' THEN 'VERSION_REQUOTED' ELSE 'VERSION_QUOTED' END,
    CASE WHEN v.status = 'Requoted' THEN 'Báo giá lại khách hàng (Requoted)' ELSE 'Báo giá khách hàng (Quoted)' END,
    v.quoted_by,
    COALESCE(p.full_name, 'Bộ phận Kinh doanh (BD)'),
    COALESCE(p.role::TEXT, 'BD'),
    p.phone,
    'Completed',
    v.status,
    jsonb_build_object('version_name', v.version_name, 'target_status', v.status),
    v.quoted_at
FROM public.drawing_review_versions v
LEFT JOIN public.profiles p ON p.id = v.quoted_by
WHERE v.quoted_at IS NOT NULL;

-- 4.5 Backfill REQUOTE_REQUESTED
INSERT INTO public.drawing_review_activity_logs (
    issue_id, version_id, version_name, action, action_label,
    performed_by, performer_name, performer_role, performer_phone,
    old_status, new_status, details, created_at
)
SELECT
    v.issue_id,
    v.id,
    v.version_name,
    'REQUOTE_REQUESTED',
    'Yêu cầu báo giá lại (Requote)',
    v.requote_requested_by,
    COALESCE(p.full_name, 'Bộ phận Kinh doanh (BD)'),
    COALESCE(p.role::TEXT, 'BD'),
    p.phone,
    'Quoted',
    'Requote',
    jsonb_build_object('version_name', v.version_name),
    v.requote_requested_at
FROM public.drawing_review_versions v
LEFT JOIN public.profiles p ON p.id = v.requote_requested_by
WHERE v.requote_requested_at IS NOT NULL;
