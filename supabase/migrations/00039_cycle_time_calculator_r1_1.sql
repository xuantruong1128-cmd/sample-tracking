-- ============================================================================
-- Migration: 00039_cycle_time_calculator_r1_1.sql
-- Description: Adds calculation_data JSONB to drawing_review_operations to
--              persist Cycle Time Calculator R1.1 parameters (decimal passes,
--              bidirectional solver state, variable locks, field sources).
-- Constraints:
--   - TEST environment migration.
--   - Backward compatible: calculation_data is nullable.
--   - Does NOT affect existing records.
-- ============================================================================

-- 1. Add calculation_data JSONB column to drawing_review_operations
ALTER TABLE public.drawing_review_operations
ADD COLUMN IF NOT EXISTS calculation_data JSONB;

-- 2. Update save_drawing_review_draft RPC to accept and persist calculation_data
DROP FUNCTION IF EXISTS public.save_drawing_review_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT);

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

    IF v_version.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành (Completed) và đã bị khóa, không thể chỉnh sửa.';
    END IF;

    -- Resolve material fields
    v_mat_type := p_material_type;
    v_mat_spec := p_material_specification;

    IF v_mat_type IS NULL AND v_mat_spec IS NULL AND p_required_material IS NOT NULL THEN
        v_mat_spec := p_required_material;
    END IF;

    v_req_mat := COALESCE(
        NULLIF(trim(concat_ws(E'\n', NULLIF(trim(v_mat_type), ''), NULLIF(trim(v_mat_spec), ''))), ''),
        p_required_material
    );

    -- Update version technical fields and set status to 'Reviewing'
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
        updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
    WHERE id = p_version_id;

    -- Replace operations for this version
    DELETE FROM public.drawing_review_operations
    WHERE version_id = p_version_id;

    -- Insert updated operations with calculation_data
    IF p_operations IS NOT NULL AND jsonb_array_length(p_operations) > 0 THEN
        FOR v_op IN SELECT * FROM jsonb_to_recordset(p_operations) AS x(
            id UUID,
            lineage_id UUID,
            step_order INT,
            workcenter_code TEXT,
            operation_description TEXT,
            cycle_time_seconds NUMERIC,
            remark TEXT,
            is_removed BOOLEAN,
            calculation_data JSONB
        )
        LOOP
            v_step_order := v_op.step_order;
            v_wc := trim(COALESCE(v_op.workcenter_code, ''));
            v_op_desc := NULLIF(trim(COALESCE(v_op.operation_description, '')), '');
            v_ct := v_op.cycle_time_seconds;
            v_remark := NULLIF(trim(COALESCE(v_op.remark, '')), '');
            v_lineage_id := COALESCE(v_op.lineage_id, gen_random_uuid());
            v_is_removed := COALESCE(v_op.is_removed, false);
            v_calc_data := v_op.calculation_data;

            IF v_wc = '' THEN
                RAISE EXCEPTION 'Mã tổ máy (Work Center) không được để trống tại công đoạn thứ %.', v_step_order;
            END IF;

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
            ) VALUES (
                p_version_id,
                v_lineage_id,
                v_step_order,
                v_wc,
                v_op_desc,
                v_ct,
                v_remark,
                v_is_removed,
                v_calc_data
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
