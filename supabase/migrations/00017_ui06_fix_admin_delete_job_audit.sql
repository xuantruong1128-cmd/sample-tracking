-- ============================================================================
-- Migration: 00017_ui06_fix_admin_delete_job_audit.sql
-- Description: Update admin_delete_job RPC to write to audit_logs using
-- existing schema columns (old_values, new_values) instead of details.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role public.user_role;
    v_admin_name TEXT;
    v_admin_phone TEXT;
    v_job RECORD;
    v_run_count INTEGER := 0;
    v_qa_count INTEGER := 0;
    v_att_count INTEGER := 0;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
BEGIN
    -- 1. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_admin_name := 'Admin System';
        v_admin_phone := 'System';
        v_uid := auth.uid();
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Quản trị viên (Admin).';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_caller_role := public.get_current_user_role();
        IF v_caller_role != 'Admin' THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin) mới có quyền xóa Lệnh sản xuất (vai trò hiện tại: %).', COALESCE(v_caller_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, 'Admin'), COALESCE(phone, '')
        INTO v_admin_name, v_admin_phone
        FROM public.profiles
        WHERE id = v_uid;
    END IF;

    -- 2. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập mã JOB Ticket để xác nhận xóa.';
    END IF;

    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do xóa Lệnh sản xuất (tối thiểu 3 ký tự).';
    END IF;

    -- 3. Target Job Verification
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng trong hệ thống.';
    END IF;

    -- Ticket confirmation check (case-insensitive trim)
    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    -- Status check: Closed jobs are locked and cannot be deleted
    IF v_job.status = 'CLOSE' THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất đã đóng (Trạng thái: CLOSE). Chỉ được phép lưu trữ hồ sơ theo quy trình hệ thống.';
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất ở trạng thái %.', v_job.status;
    END IF;

    -- 4. Check Manufacturing & QA Historical Data
    SELECT count(*) INTO v_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    IF v_run_count > 0 OR v_qa_count > 0 THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã có dữ liệu sản xuất (% kết quả PE-MFG, % kiểm tra QA). Không được phép xóa trực tiếp nhằm bảo toàn lịch sử và truy xuất nguồn gốc. Vui lòng chuyển trạng thái Void/Cancel.', v_run_count, v_qa_count;
    END IF;

    -- 5. Delete Related Attachments
    SELECT count(*) INTO v_att_count
    FROM public.attachments
    WHERE job_id = p_job_id;

    IF v_att_count > 0 THEN
        DELETE FROM public.attachments WHERE job_id = p_job_id;
    END IF;

    -- 6. Record Audit Log before job deletion using existing schema (old_values, new_values)
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'ADMIN_DELETE_JOB',
        'jobs',
        p_job_id,
        to_jsonb(v_job),
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'reason', v_trimmed_reason,
            'deleted_by_name', v_admin_name,
            'deleted_by_phone', v_admin_phone,
            'deleted_at', timezone('Asia/Ho_Chi_Minh', now())
        )
    );

    -- 7. Cascade Delete Operations and Job
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    -- 8. Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'message', 'Đã xóa Lệnh sản xuất thành công.'
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.admin_delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job TO authenticated, service_role;
