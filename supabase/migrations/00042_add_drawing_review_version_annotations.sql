-- Migration 00042: Add annotations JSONB to drawing_review_versions and update draft RPC
-- Purpose: Persist drawing markup, notes, and comments centrally across users and reports.

-- 1. Add annotations column to drawing_review_versions
ALTER TABLE public.drawing_review_versions
ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.drawing_review_versions.annotations IS 'List of vector annotations, notes, and markups made on the drawing viewer (DrawingAnnotation[])';

-- 2. Update save_drawing_review_draft RPC to accept optional p_annotations
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

    IF v_jwt_role <> 'service_role' THEN
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
            v_wc := UPPER(TRIM(COALESCE(v_op.workcenter_code, '')));
            v_op_desc := TRIM(COALESCE(v_op.operation_description, ''));
            v_ct := v_op.cycle_time_seconds;
            v_remark := TRIM(COALESCE(v_op.remark, ''));
            v_lineage_id := COALESCE(v_op.lineage_id, gen_random_uuid());
            v_is_removed := COALESCE(v_op.is_removed, FALSE);
            v_calc_data := v_op.calculation_data;

            IF v_op.id IS NOT NULL THEN
                UPDATE public.drawing_review_operations
                SET
                    step_order = v_step_order,
                    workcenter_code = v_wc,
                    operation_description = NULLIF(v_op_desc, ''),
                    cycle_time_seconds = v_ct,
                    remark = NULLIF(v_remark, ''),
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
                    calculation_data
                ) VALUES (
                    p_version_id,
                    v_lineage_id,
                    v_step_order,
                    v_wc,
                    NULLIF(v_op_desc, ''),
                    v_ct,
                    NULLIF(v_remark, ''),
                    v_is_removed,
                    v_calc_data
                );
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'version_id', p_version_id,
        'status', 'Reviewing'
    );
END;
$$;
