-- Migration 00043: Fix save_drawing_review_draft overload conflict (PGRST203)
-- Purpose: Drop obsolete 10-parameter signature from migration 00041 so PostgREST resolves the 11-parameter function unambiguously.

-- 1. Drop the legacy 10-parameter function signature
DROP FUNCTION IF EXISTS public.save_drawing_review_draft(
    UUID,   -- p_version_id
    TEXT,   -- p_required_material
    TEXT,   -- p_required_tooling
    TEXT,   -- p_special_measuring_equipment
    TEXT,   -- p_engineering_remarks
    TEXT,   -- p_avatar_file_path
    JSONB,  -- p_avatar_crop_box
    JSONB,  -- p_operations
    TEXT,   -- p_material_type
    TEXT    -- p_material_specification
);

-- 2. Re-create / Ensure the single authoritative 11-parameter function signature
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
    p_material_specification TEXT DEFAULT NULL,
    p_annotations JSONB DEFAULT NULL
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
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

    IF v_jwt_role <> 'service_role' AND current_user NOT IN ('service_role', 'postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
        END IF;

        SELECT role INTO v_role
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        IF v_role IS NULL OR v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Chỉ PE-MFG hoặc Admin mới có quyền cập nhật bản vẽ.';
        END IF;
    END IF;

    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Phiên bản đánh giá không tồn tại.';
    END IF;

    IF v_version.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản đã hoàn tất, không thể chỉnh sửa.';
    END IF;

    UPDATE public.drawing_review_versions
    SET
        material_type = COALESCE(p_material_type, material_type),
        material_specification = COALESCE(p_material_specification, material_specification),
        required_material = COALESCE(p_required_material, required_material),
        required_tooling = COALESCE(p_required_tooling, required_tooling),
        special_measuring_equipment = COALESCE(p_special_measuring_equipment, special_measuring_equipment),
        engineering_remarks = COALESCE(p_engineering_remarks, engineering_remarks),
        avatar_file_path = COALESCE(p_avatar_file_path, avatar_file_path),
        avatar_crop_box = COALESCE(p_avatar_crop_box, avatar_crop_box),
        annotations = CASE WHEN p_annotations IS NOT NULL THEN p_annotations ELSE annotations END,
        status = 'Reviewing',
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_version_id;

    -- Upsert Operations
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
            v_wc := TRIM(v_op.workcenter_code);
            v_op_desc := TRIM(v_op.operation_description);
            v_ct := v_op.cycle_time_seconds;
            v_remark := TRIM(v_op.remark);
            v_lineage_id := COALESCE(v_op.lineage_id, gen_random_uuid());
            v_is_removed := COALESCE(v_op.is_removed, FALSE);
            v_calc_data := v_op.calculation_data;

            IF v_op.id IS NOT NULL THEN
                UPDATE public.drawing_review_operations
                SET
                    step_order = v_step_order,
                    workcenter_code = v_wc,
                    operation_description = v_op_desc,
                    cycle_time_seconds = v_ct,
                    remark = v_remark,
                    is_removed = v_is_removed,
                    calculation_data = v_calc_data,
                    updated_at = timezone('Asia/Ho_Chi_Minh', now())
                WHERE id = v_op.id AND version_id = p_version_id;
            ELSE
                INSERT INTO public.drawing_review_operations (
                    version_id,
                    lineage_id,
                    step_order,
                    workcenter_code,
                    operation_description,
                    cycle_time_seconds,
                    remark,
                    is_removed,
                    calculation_data,
                    created_at,
                    updated_at
                ) VALUES (
                    p_version_id,
                    v_lineage_id,
                    v_step_order,
                    v_wc,
                    v_op_desc,
                    v_ct,
                    v_remark,
                    v_is_removed,
                    v_calc_data,
                    timezone('Asia/Ho_Chi_Minh', now()),
                    timezone('Asia/Ho_Chi_Minh', now())
                );
            END IF;
        END LOOP;
    END IF;

    -- Log activity
    PERFORM public.log_drawing_review_activity(
        v_version.issue_id,
        p_version_id,
        v_version.version_name,
        CASE WHEN v_version.status = 'Issued' THEN 'REVIEW_STARTED' ELSE 'REVIEW_DRAFT_SAVED' END,
        CASE WHEN v_version.status = 'Issued' THEN 'Bắt đầu đánh giá (Reviewing)' ELSE 'Lưu bản nháp kỹ thuật' END,
        COALESCE(v_uid, v_version.created_by),
        v_version.status,
        'Reviewing',
        jsonb_build_object(
            'material', COALESCE(p_material_type, v_version.material_type, '') || ' ' || COALESCE(p_material_specification, v_version.material_specification, ''),
            'active_operations_count', (
                SELECT COUNT(*) FROM public.drawing_review_operations
                WHERE version_id = p_version_id AND is_removed = FALSE
            )
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Reviewing'
    );
END;
$$;
