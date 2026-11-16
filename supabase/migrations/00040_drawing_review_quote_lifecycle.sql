-- ============================================================================
-- Migration: 00040_drawing_review_quote_lifecycle.sql
-- Description: Adds Quoted, Requote, and Requoted lifecycle statuses for BD
--              and PE handoff on Drawing Reviews.
-- Business Rules:
--   1. Completed: PE chốt đánh giá kỹ thuật (sáng dấu + nếu chưa báo giá).
--   2. Quoted: BD xác nhận đã gửi báo giá lần đầu cho khách (khóa/tối dấu +).
--   3. Requote: BD yêu cầu báo giá lại khi khách cần thay đổi (MỞ dấu +).
--   4. Requoted: BD xác nhận đã gửi báo giá lại cho các phiên bản tiếp theo (ĐÓNG dấu +).
-- ============================================================================

-- 1. Update Check Constraint on drawing_review_versions.status
ALTER TABLE public.drawing_review_versions
DROP CONSTRAINT IF EXISTS drawing_review_versions_status_check;

ALTER TABLE public.drawing_review_versions
ADD CONSTRAINT drawing_review_versions_status_check
CHECK (status IN ('Issued', 'Reviewing', 'Completed', 'Quoted', 'Requote', 'Requoted'));

-- 2. Add audit columns for quoting workflow
ALTER TABLE public.drawing_review_versions
ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS quoted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS requote_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS requote_requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Update Immutability Triggers
CREATE OR REPLACE FUNCTION public.check_drawing_review_version_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('Completed', 'Quoted', 'Requote', 'Requoted') THEN
            RAISE EXCEPTION 'Phiên bản đánh giá kỹ thuật đã hoàn thành hoặc báo giá là bất biến và không thể xóa.';
        END IF;
        RETURN OLD;
    END IF;

    -- Block non-quoting updates to completed/quoted/requote versions
    IF OLD.status IN ('Completed', 'Quoted', 'Requote', 'Requoted') THEN
        -- Allow ONLY legitimate BD quoting status transitions
        IF (OLD.status = 'Completed' AND NEW.status IN ('Quoted', 'Requoted'))
           OR (OLD.status = 'Quoted' AND NEW.status = 'Requote')
           OR (OLD.status = 'Requoted' AND NEW.status = 'Requote') THEN
            -- Verify that technical content fields DID NOT change
            IF OLD.material_type IS DISTINCT FROM NEW.material_type
               OR OLD.material_specification IS DISTINCT FROM NEW.material_specification
               OR OLD.required_material IS DISTINCT FROM NEW.required_material
               OR OLD.required_tooling IS DISTINCT FROM NEW.required_tooling
               OR OLD.special_measuring_equipment IS DISTINCT FROM NEW.special_measuring_equipment
               OR OLD.engineering_remarks IS DISTINCT FROM NEW.engineering_remarks
               OR OLD.avatar_file_path IS DISTINCT FROM NEW.avatar_file_path
               OR OLD.avatar_crop_box::TEXT IS DISTINCT FROM NEW.avatar_crop_box::TEXT
               OR OLD.version_number IS DISTINCT FROM NEW.version_number
               OR OLD.issue_id IS DISTINCT FROM NEW.issue_id
               OR OLD.closed_at IS DISTINCT FROM NEW.closed_at THEN
                RAISE EXCEPTION 'Dữ liệu kỹ thuật của phiên bản đã hoàn thành là bất biến, không được phép sửa đổi.';
            END IF;
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Phiên bản đánh giá kỹ thuật đã hoàn thành (%s) là bất biến và không thể sửa đổi.', OLD.status;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_drawing_review_operation_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ver_status VARCHAR(20);
    v_target_version_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_version_id := OLD.version_id;
    ELSE
        v_target_version_id := NEW.version_id;
    END IF;

    SELECT status INTO v_ver_status
    FROM public.drawing_review_versions
    WHERE id = v_target_version_id;

    IF v_ver_status IN ('Completed', 'Quoted', 'Requote', 'Requoted') THEN
        RAISE EXCEPTION 'Không thể thêm, sửa đổi hoặc xóa công đoạn của phiên bản đã hoàn thành (%s).', v_ver_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_drawing_review_attachment_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ver_status VARCHAR(20);
    v_target_version_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_version_id := OLD.version_id;
    ELSE
        v_target_version_id := NEW.version_id;
    END IF;

    SELECT status INTO v_ver_status
    FROM public.drawing_review_versions
    WHERE id = v_target_version_id;

    IF v_ver_status IN ('Completed', 'Quoted', 'Requote', 'Requoted') THEN
        RAISE EXCEPTION 'Không thể thêm hoặc xóa tệp đính kèm của phiên bản đã hoàn thành (%s).', v_ver_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 4. Update save_drawing_review_draft guard
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
        status = 'Reviewing',
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

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Reviewing'
    );
END;
$$;

-- 5. Update close_drawing_review_version guard
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
    SELECT COUNT(*) INTO v_active_ops_count
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

    -- Stamp closed status
    UPDATE public.drawing_review_versions
    SET
        status = 'Completed',
        closed_at = timezone('Asia/Ho_Chi_Minh', NOW()),
        closed_by = COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::UUID),
        updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
    WHERE id = p_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Completed',
        'closed_at', timezone('Asia/Ho_Chi_Minh', NOW())
    );
END;
$$;

-- 6. RPC: quote_drawing_review_version (BD marks version as Quoted or Requoted)
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
    -- If explicit target status given, validate it:
    IF p_target_status IS NOT NULL THEN
        IF p_target_status NOT IN ('Quoted', 'Requoted') THEN
            RAISE EXCEPTION 'Trạng thái báo giá không hợp lệ: %', p_target_status;
        END IF;
        v_target_status := p_target_status;
    ELSE
        -- Auto-determine: if version_number > 1 or prior versions had Requote/Requoted, it's 'Requoted'; otherwise 'Quoted'
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

    UPDATE public.drawing_review_versions
    SET
        status = v_target_status,
        quoted_at = timezone('Asia/Ho_Chi_Minh', now()),
        quoted_by = v_uid,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', v_target_status,
        'quoted_at', timezone('Asia/Ho_Chi_Minh', now())
    );
END;
$$;

-- 7. RPC: requote_drawing_review_version (BD requests re-quote, opening '+' button for PE)
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

    UPDATE public.drawing_review_versions
    SET
        status = 'Requote',
        requote_requested_at = timezone('Asia/Ho_Chi_Minh', now()),
        requote_requested_by = v_uid,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Requote',
        'requote_requested_at', timezone('Asia/Ho_Chi_Minh', now())
    );
END;
$$;

-- 8. Update create_next_drawing_review_version: Enforce that Quoted/Requoted blocks '+', Requote or Completed opens '+'
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

    -- STRICT RULE: Quoted and Requoted are CLOSED (block creating next version)
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

    -- Clone surviving active operations with stable lineage_id and calculation_data
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
    WHERE version_id = v_latest_ver.id
      AND is_removed = false
    ORDER BY step_order ASC;

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
