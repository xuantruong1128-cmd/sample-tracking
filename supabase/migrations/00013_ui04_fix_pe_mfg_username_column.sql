-- ============================================================================
-- Migration: 00013_ui04_fix_pe_mfg_username_column.sql
-- Description: Fix column "username" does not exist error in
-- save_production_result_with_ng and save_qa_check_result.
-- The profiles table uses full_name and phone (not username).
-- ============================================================================

-- 1. Redefine save_production_result_with_ng with correct profile columns (full_name, phone)
CREATE OR REPLACE FUNCTION public.save_production_result_with_ng(
    p_operation_id UUID,
    p_machine_id TEXT,
    p_production_date DATE,
    p_cycle_time NUMERIC,
    p_ok_qty INTEGER,
    p_kiv_qty INTEGER,
    p_ng_items JSONB,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_run_id UUID;
    v_total_ng INTEGER := 0;
    v_idx INT;
    v_item JSONB;
    v_item_qty INT;
    v_defect_name TEXT;
    v_defect_code TEXT;
    v_cause TEXT;
    v_remark TEXT;
    v_photos TEXT[];
    v_existing_run_id UUID;
    v_prod_run RECORD;
    v_arr_len INT;
BEGIN
    -- 1. Authorization Guard: PE-MFG, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'Admin System';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản PE-MFG hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền nhập kết quả sản xuất (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Kỹ thuật viên') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả sản xuất.', v_job_status;
    END IF;

    -- 3. Input Validation
    IF p_machine_id IS NULL OR length(trim(p_machine_id)) = 0 THEN
        RAISE EXCEPTION 'Mã máy (Machine) không được để trống.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK phải là số nguyên không âm (nhận được: %).', p_ok_qty;
    END IF;

    IF p_kiv_qty IS NULL OR p_kiv_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng KIV phải là số nguyên không âm (nhận được: %).', p_kiv_qty;
    END IF;

    IF p_cycle_time IS NOT NULL AND p_cycle_time <= 0 THEN
        RAISE EXCEPTION 'Cycle Time thực tế phải là số dương lớn hơn 0 (nhận được: %).', p_cycle_time;
    END IF;

    -- 4. Calculate Total NG from NG Items
    IF p_ng_items IS NOT NULL AND jsonb_typeof(p_ng_items) = 'array' THEN
        v_arr_len := jsonb_array_length(p_ng_items);
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            IF v_item_qty <= 0 THEN
                RAISE EXCEPTION 'Số lượng NG tại dòng % phải là số nguyên dương lớn hơn 0.', v_idx + 1;
            END IF;
            IF (v_item ->> 'defect_name') IS NULL OR length(trim(v_item ->> 'defect_name')) = 0 THEN
                RAISE EXCEPTION 'Vui lòng chọn loại lỗi (Type) tại dòng NG thứ %.', v_idx + 1;
            END IF;
            v_total_ng := v_total_ng + v_item_qty;
        END LOOP;
    ELSE
        v_arr_len := 0;
        v_total_ng := 0;
    END IF;

    -- 5. Find or Create Production Run for this operation (Prevent duplicate runs on repeated clicks)
    SELECT id INTO v_existing_run_id
    FROM public.production_runs
    WHERE operation_id = p_operation_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_run_id IS NOT NULL THEN
        v_run_id := v_existing_run_id;
        UPDATE public.production_runs
        SET machine_id = trim(p_machine_id),
            production_date = COALESCE(p_production_date, CURRENT_DATE),
            cycle_time_seconds = p_cycle_time,
            ok_qty = p_ok_qty,
            ng_qty = v_total_ng,
            kiv_qty = p_kiv_qty,
            remarks = NULLIF(trim(p_remarks), ''),
            operator_id = COALESCE(v_uid, operator_id),
            operator_name = COALESCE(v_user_name, operator_name),
            updated_at = NOW()
        WHERE id = v_run_id
        RETURNING * INTO v_prod_run;
    ELSE
        INSERT INTO public.production_runs (
            operation_id,
            machine_id,
            operator_id,
            operator_name,
            start_time,
            end_time,
            cycle_time_seconds,
            ok_qty,
            ng_qty,
            kiv_qty,
            production_date,
            remarks
        ) VALUES (
            p_operation_id,
            trim(p_machine_id),
            v_uid,
            COALESCE(v_user_name, 'Kỹ thuật viên'),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            p_cycle_time,
            p_ok_qty,
            v_total_ng,
            p_kiv_qty,
            COALESCE(p_production_date, CURRENT_DATE),
            NULLIF(trim(p_remarks), '')
        ) RETURNING * INTO v_prod_run;
        v_run_id := v_prod_run.id;
    END IF;

    -- 6. Atomically sync NG Details
    DELETE FROM public.ng_details WHERE production_run_id = v_run_id;

    IF v_arr_len > 0 THEN
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            v_defect_name := trim(v_item ->> 'defect_name');
            v_defect_code := NULLIF(trim(v_item ->> 'defect_code'), '');
            v_cause := NULLIF(trim(v_item ->> 'cause'), '');
            v_remark := NULLIF(trim(v_item ->> 'remark'), '');

            -- Photo URLs (max 2 per NG row)
            IF (v_item ? 'photo_urls') AND jsonb_typeof(v_item -> 'photo_urls') = 'array' THEN
                SELECT ARRAY(
                    SELECT jsonb_array_elements_text(v_item -> 'photo_urls')
                    LIMIT 2
                ) INTO v_photos;
            ELSE
                v_photos := ARRAY[]::TEXT[];
            END IF;

            INSERT INTO public.ng_details (
                production_run_id,
                defect_name,
                defect_code,
                ng_qty,
                defect_description,
                cause,
                remark,
                photo_urls
            ) VALUES (
                v_run_id,
                v_defect_name,
                v_defect_code,
                v_item_qty,
                v_cause,
                v_cause,
                v_remark,
                v_photos
            );
        END LOOP;
    END IF;

    -- 7. Update Operation Status if appropriate
    IF p_ok_qty > 0 THEN
        UPDATE public.job_operations
        SET status = CASE WHEN status = 'NOT_STARTED' THEN 'IN_PROGRESS'::public.operation_status ELSE status END,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    -- Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'production_run_id', v_run_id,
        'operation_id', p_operation_id,
        'machine_id', v_prod_run.machine_id,
        'production_date', v_prod_run.production_date,
        'cycle_time_seconds', v_prod_run.cycle_time_seconds,
        'ok_qty', v_prod_run.ok_qty,
        'ng_qty', v_prod_run.ng_qty,
        'kiv_qty', v_prod_run.kiv_qty,
        'total_ng', v_total_ng
    );
END;
$$;

-- 2. Redefine save_qa_check_result with correct profile columns (full_name, phone)
CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result,
    p_sample_size INTEGER,
    p_ok_qty INTEGER,
    p_ng_qty INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_qa_check RECORD;
    v_has_prod_ok BOOLEAN;
BEGIN
    -- 1. Authorization Guard: QA, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'QA Inspector';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản QA hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ QA hoặc Admin mới có quyền xác nhận kiểm tra (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Kỹ thuật viên QA') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả QA.', v_job_status;
    END IF;

    -- 3. Validate Inputs
    IF p_result IS NULL THEN
        RAISE EXCEPTION 'Kết quả kiểm tra QA (OK / NG / KIV) không được để trống.';
    END IF;

    IF p_sample_size IS NULL OR p_sample_size <= 0 THEN
        RAISE EXCEPTION 'Cỡ mẫu kiểm tra phải là số nguyên dương lớn hơn 0.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK kiểm tra phải là số không âm.';
    END IF;

    IF p_ng_qty IS NULL OR p_ng_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng NG kiểm tra phải là số không âm.';
    END IF;

    IF (p_ok_qty + p_ng_qty) > p_sample_size THEN
        RAISE EXCEPTION 'Tổng OK (%) và NG (%) không được vượt quá cỡ mẫu (%).', p_ok_qty, p_ng_qty, p_sample_size;
    END IF;

    -- 4. Insert QA Check (trg_qa_check_before_insert automatically assigns event_seq and synchronizes qa_event_counter)
    INSERT INTO public.qa_checks (
        operation_id,
        inspector_id,
        inspector_name,
        inspection_time,
        sample_size,
        ok_qty,
        ng_qty,
        result,
        event_seq,
        notes
    ) VALUES (
        p_operation_id,
        v_uid,
        COALESCE(v_user_name, 'Kỹ thuật viên QA'),
        NOW(),
        p_sample_size,
        p_ok_qty,
        p_ng_qty,
        p_result,
        0, -- trg_qa_check_before_insert overrides this with monotonic sequence
        NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_qa_check;

    -- 5. Operation Completion Rule:
    -- Needs Production OK > 0 AND QA confirms OK
    SELECT EXISTS (
        SELECT 1 FROM public.production_runs
        WHERE operation_id = p_operation_id AND ok_qty > 0
    ) INTO v_has_prod_ok;

    IF p_result = 'OK' AND v_has_prod_ok THEN
        UPDATE public.job_operations
        SET status = 'COMPLETED'::public.operation_status,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    RETURN to_jsonb(v_qa_check);
END;
$$;

-- 3. Preserve Permissions
REVOKE ALL ON FUNCTION public.save_production_result_with_ng FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_production_result_with_ng TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_qa_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result TO authenticated, service_role;
