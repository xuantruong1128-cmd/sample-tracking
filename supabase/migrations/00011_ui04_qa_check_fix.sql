-- ============================================================================
-- Migration: 00011_ui04_qa_check_fix.sql
-- Description: Fix save_qa_check_result to let trg_qa_check_before_insert
-- manage qa_event_counter automatically.
-- ============================================================================

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
        SELECT COALESCE(full_name, username, 'Kỹ thuật viên QA') INTO v_user_name
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

REVOKE ALL ON FUNCTION public.save_qa_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result TO authenticated, service_role;
