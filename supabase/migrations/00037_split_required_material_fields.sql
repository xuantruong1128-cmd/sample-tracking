-- ============================================================================
-- Migration: 00037_split_required_material_fields.sql
-- Description: Splits required_material into Material Type (material_type)
--              and Material Specification (material_specification) in
--              drawing_review_versions. Preserves legacy required_material.
-- ============================================================================

-- 1. Add material_type and material_specification columns
ALTER TABLE public.drawing_review_versions
ADD COLUMN IF NOT EXISTS material_type TEXT;

ALTER TABLE public.drawing_review_versions
ADD COLUMN IF NOT EXISTS material_specification TEXT;

-- 2. Non-destructive migration: copy existing required_material into material_specification
-- Temporarily disable immutability trigger to allow schema migration backfill on historical versions
ALTER TABLE public.drawing_review_versions DISABLE TRIGGER trg_drawing_review_version_immutability;

UPDATE public.drawing_review_versions
SET material_specification = required_material
WHERE material_specification IS NULL
  AND material_type IS NULL
  AND required_material IS NOT NULL;

ALTER TABLE public.drawing_review_versions ENABLE TRIGGER trg_drawing_review_version_immutability;

-- 3. Update save_drawing_review_draft RPC to support both fields with backward compatibility
DROP FUNCTION IF EXISTS public.save_drawing_review_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB);

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

    -- If legacy call passes only p_required_material:
    IF v_mat_type IS NULL AND v_mat_spec IS NULL AND p_required_material IS NOT NULL THEN
        v_mat_spec := p_required_material;
    END IF;

    -- Consolidated legacy required_material string
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
            v_step_order := v_op.step_order;
            v_wc := trim(COALESCE(v_op.workcenter_code, ''));
            v_op_desc := NULLIF(trim(COALESCE(v_op.operation_description, '')), '');
            v_ct := v_op.cycle_time_seconds;
            v_remark := NULLIF(trim(COALESCE(v_op.remark, '')), '');
            v_lineage_id := COALESCE(v_op.lineage_id, gen_random_uuid());
            v_is_removed := COALESCE(v_op.is_removed, false);

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
                is_removed
            ) VALUES (
                p_version_id,
                v_lineage_id,
                v_step_order,
                v_wc,
                v_op_desc,
                v_ct,
                v_remark,
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

-- 4. Update create_next_drawing_review_version to clone both material fields
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

    -- Create new version with status 'Reviewing', copying material_type & material_specification
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
