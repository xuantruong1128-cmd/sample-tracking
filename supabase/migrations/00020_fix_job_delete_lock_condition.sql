-- ============================================================================
-- Migration: 00020_fix_job_delete_lock_condition.sql
-- Description: Align Job Deletion & Planning Lock with business rules:
--   1. Close Operation is the definitive boundary for locking Job Deletion and Planning Edits.
--   2. Allow job deletion when no operations are CLOSED, even with production runs,
--      NG details, QA checks, attachments, or technical dispositions.
--   3. Block job deletion when at least one operation is CLOSED or job is CLOSE/ARCHIVE/PURGED.
--   4. Expand authorization: Admin, Planning Leader, or Planning Owner (created_by).
--   5. Row lock (FOR UPDATE) in admin_delete_job and close_job_operation to prevent race conditions.
--   6. Bypass immutability triggers on controlled cascade deletion via transaction flag.
-- ============================================================================

-- 1. Update enforce_qa_check_immutability to support internal cascade job deletion
CREATE OR REPLACE FUNCTION public.enforce_qa_check_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF auth.role() IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'QA evaluation records are immutable. Direct UPDATE or DELETE is strictly forbidden.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 2. Update enforce_pe_disposition_immutability to support internal cascade job deletion
CREATE OR REPLACE FUNCTION public.enforce_pe_disposition_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF auth.role() IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'PE technical dispositions are immutable records. Direct UPDATE or DELETE is strictly forbidden.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 3. Update check_job_active_status to support internal cascade job deletion
CREATE OR REPLACE FUNCTION public.check_job_active_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_target_job_id UUID;
    v_job_status public.job_status;
BEGIN
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'jobs' THEN
        IF TG_OP = 'UPDATE' THEN
            -- Allow valid forward lifecycle transitions to proceed
            IF (OLD.status = 'ACTIVE' AND NEW.status = 'CLOSE') OR
               (OLD.status = 'CLOSE' AND NEW.status = 'ARCHIVE') THEN
                RETURN NEW;
            END IF;
            v_job_status := OLD.status;
            v_target_job_id := OLD.id;
        ELSIF TG_OP = 'DELETE' THEN
            v_job_status := OLD.status;
            v_target_job_id := OLD.id;
        ELSE
            v_job_status := NEW.status;
            v_target_job_id := NEW.id;
        END IF;
    ELSIF TG_TABLE_NAME = 'job_operations' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    ELSIF TG_TABLE_NAME = 'production_runs' THEN
        SELECT op.job_id, j.status INTO v_target_job_id, v_job_status
        FROM public.job_operations op
        JOIN public.jobs j ON j.id = op.job_id
        WHERE op.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.operation_id ELSE NEW.operation_id END);
    ELSIF TG_TABLE_NAME = 'qa_checks' THEN
        SELECT op.job_id, j.status INTO v_target_job_id, v_job_status
        FROM public.job_operations op
        JOIN public.jobs j ON j.id = op.job_id
        WHERE op.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.operation_id ELSE NEW.operation_id END);
    ELSIF TG_TABLE_NAME = 'attachments' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    ELSIF TG_TABLE_NAME = 'ng_details' THEN
        SELECT op.job_id, j.status INTO v_target_job_id, v_job_status
        FROM public.production_runs pr
        JOIN public.job_operations op ON op.id = pr.operation_id
        JOIN public.jobs j ON j.id = op.job_id
        WHERE pr.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.production_run_id ELSE NEW.production_run_id END);
    ELSIF TG_TABLE_NAME = 'kiv_reviews' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    ELSIF TG_TABLE_NAME = 'pe_technical_dispositions' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    END IF;

    -- Strict read-only enforcement for authenticated and anon users (including Admin)
    IF auth.role() IN ('authenticated', 'anon') AND v_job_status IS NOT NULL AND v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Operation locked: Parent JOB % is not ACTIVE (current status: %). All records are READ-ONLY.', v_target_job_id, v_job_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 4. Update close_job_operation to acquire row lock FOR UPDATE on jobs
CREATE OR REPLACE FUNCTION public.close_job_operation(
    p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role public.user_role;
    v_is_leader BOOLEAN;
    v_caller_name TEXT;
    v_op RECORD;
    v_job RECORD;
    v_latest_run RECORD;
    v_total_ok INTEGER := 0;
    v_total_ng INTEGER := 0;
    v_total_kiv INTEGER := 0;
    v_snapshot JSONB;
BEGIN
    -- 1. Authorization Guard: PE-MFG Leader or Admin
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_uid := auth.uid();
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản PE-MFG Leader hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_caller_uid := auth.uid();
        SELECT role, is_department_leader, COALESCE(full_name, phone)
        INTO v_caller_role, v_is_leader, v_caller_name
        FROM public.profiles
        WHERE id = v_caller_uid;

        IF NOT (v_caller_role = 'Admin' OR (v_caller_role = 'PE-MFG' AND v_is_leader = TRUE)) THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên mới có quyền Chốt công đoạn (vai trò hiện tại: %, Leader: %).',
                v_caller_role, COALESCE(v_is_leader, false);
        END IF;
    END IF;

    -- 2. Validate Operation & Job with FOR UPDATE row lock to serialize against concurrent delete
    SELECT * INTO v_op FROM public.job_operations WHERE id = p_operation_id;
    IF v_op.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) với ID: %.', p_operation_id;
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = v_op.job_id FOR UPDATE;
    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng.';
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã ở trạng thái % (không phải ACTIVE). Không thể chốt công đoạn.', v_job.status;
    END IF;

    IF v_op.status = 'CLOSED' THEN
        RAISE EXCEPTION 'Công đoạn này đã được chốt (CLOSED) trước đó vào lúc %.', v_op.closed_at;
    END IF;

    -- 3. Validate Production Run Exists
    SELECT * INTO v_latest_run
    FROM public.production_runs
    WHERE operation_id = p_operation_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_latest_run.id IS NULL THEN
        RAISE EXCEPTION 'Không thể chốt công đoạn: Công đoạn chưa có kết quả sản xuất (PE-MFG).';
    END IF;

    -- Sum quantities across runs
    SELECT
        COALESCE(SUM(ok_qty), 0),
        COALESCE(SUM(ng_qty), 0),
        COALESCE(SUM(kiv_qty), 0)
    INTO v_total_ok, v_total_ng, v_total_kiv
    FROM public.production_runs
    WHERE operation_id = p_operation_id;

    -- Prepare closed snapshot
    v_snapshot := jsonb_build_object(
        'ok_qty', v_total_ok,
        'ng_qty', v_total_ng,
        'kiv_qty', v_total_kiv,
        'machine_id', v_latest_run.machine_id,
        'production_date', v_latest_run.production_date,
        'cycle_time_seconds', v_latest_run.cycle_time_seconds,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name
    );

    -- 4. Update Operation Status to CLOSED
    UPDATE public.job_operations
    SET status = 'CLOSED',
        closed_at = timezone('Asia/Ho_Chi_Minh', now()),
        closed_by = v_caller_uid,
        closed_snapshot = v_snapshot,
        updated_at = NOW()
    WHERE id = p_operation_id;

    -- 5. Record Audit Log
    INSERT INTO public.audit_logs (
        user_id, action, entity_type, entity_id, old_values, new_values
    ) VALUES (
        v_caller_uid,
        'CLOSE_OPERATION',
        'job_operations',
        p_operation_id,
        jsonb_build_object('status', v_op.status),
        jsonb_build_object(
            'status', 'CLOSED',
            'job_no', v_job.job_no,
            'step_order', v_op.step_order,
            'operation_name', v_op.operation_name,
            'snapshot', v_snapshot
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'operation_id', p_operation_id,
        'job_id', v_job.id,
        'status', 'CLOSED',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'snapshot', v_snapshot,
        'message', 'Đã chốt công đoạn thành công. Kế hoạch và quy trình của JOB đã được khóa an toàn.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_operation FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_job_operation TO authenticated, service_role;

-- 5. Unified admin_delete_job function with updated lock rules and authorization
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
    v_is_leader BOOLEAN := FALSE;
    v_caller_name TEXT;
    v_caller_phone TEXT;
    v_job RECORD;
    v_is_admin BOOLEAN := FALSE;
    v_is_planning_leader BOOLEAN := FALSE;
    v_is_planning_owner BOOLEAN := FALSE;
    v_has_closed_ops BOOLEAN := FALSE;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
    v_op_count INTEGER := 0;
    v_run_count INTEGER := 0;
    v_ng_count INTEGER := 0;
    v_qa_count INTEGER := 0;
    v_att_count INTEGER := 0;
    v_deleted_attachments JSONB := '[]'::jsonb;
BEGIN
    -- Set session flag for internal cascade deletion
    PERFORM set_config('sample_tracking.internal_job_deletion', 'true', true);

    -- 1. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập mã JOB Ticket để xác nhận xóa.';
    END IF;

    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do xóa Lệnh sản xuất (tối thiểu 3 ký tự).';
    END IF;

    -- 2. Target Job Verification and Row Lock (FOR UPDATE)
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng trong hệ thống.';
    END IF;

    -- Ticket confirmation check (case-insensitive trim)
    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    -- 3. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_phone := 'System';
        v_uid := auth.uid();
        v_is_admin := TRUE;
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản có thẩm quyền xóa JOB.';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_uid := auth.uid();
        SELECT role, COALESCE(is_department_leader, FALSE), COALESCE(full_name, phone), COALESCE(phone, '')
        INTO v_caller_role, v_is_leader, v_caller_name, v_caller_phone
        FROM public.profiles
        WHERE id = v_uid;

        v_is_admin := (v_caller_role = 'Admin');
        v_is_planning_leader := (v_caller_role = 'Planning' AND v_is_leader = TRUE);
        v_is_planning_owner := (v_caller_role = 'Planning' AND v_job.created_by = v_uid);

        IF NOT (v_is_admin OR v_is_planning_leader OR v_is_planning_owner) THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin), Trưởng nhóm Kế hoạch (Planning Leader), hoặc Người tạo JOB mới có quyền xóa Lệnh sản xuất (vai trò hiện tại: %).',
                COALESCE(v_caller_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 4. Status Check: Closed or Archival jobs are permanently locked
    IF v_job.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Chỉ được phép lưu trữ hồ sơ theo quy trình hệ thống.', v_job.status;
    END IF;

    -- 5. Close Operation Lockout Check:
    -- Close Operation is the definitive boundary for locking Job Deletion
    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = p_job_id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất: Đã có ít nhất một công đoạn được Chốt (CLOSED). Mọi dữ liệu đã khóa bảo đảm tính toàn vẹn kiểm toán.';
    END IF;

    -- 6. Collect Statistics and Attachments Before Deletion
    SELECT coalesce(jsonb_agg(file_path), '[]'::jsonb) INTO v_deleted_attachments
    FROM public.attachments
    WHERE job_id = p_job_id AND file_path IS NOT NULL;

    SELECT count(*) INTO v_op_count FROM public.job_operations WHERE job_id = p_job_id;
    SELECT count(*) INTO v_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_ng_count
    FROM public.ng_details ng
    JOIN public.production_runs pr ON pr.id = ng.production_run_id
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_att_count
    FROM public.attachments
    WHERE job_id = p_job_id;

    -- 7. Controlled Cascading Deletion
    DELETE FROM public.attachments WHERE job_id = p_job_id;
    DELETE FROM public.pe_technical_dispositions WHERE job_id = p_job_id;
    DELETE FROM public.kiv_reviews WHERE job_id = p_job_id;
    DELETE FROM public.ng_details
    WHERE production_run_id IN (
        SELECT pr.id FROM public.production_runs pr
        JOIN public.job_operations jo ON jo.id = pr.operation_id
        WHERE jo.job_id = p_job_id
    );
    DELETE FROM public.qa_checks
    WHERE operation_id IN (
        SELECT id FROM public.job_operations WHERE job_id = p_job_id
    );
    DELETE FROM public.production_runs
    WHERE operation_id IN (
        SELECT id FROM public.job_operations WHERE job_id = p_job_id
    );
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    -- 8. Record Audit Log before transaction commit
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'DELETE_JOB',
        'jobs',
        p_job_id,
        to_jsonb(v_job),
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'reason', v_trimmed_reason,
            'deleted_by_name', v_caller_name,
            'deleted_by_phone', v_caller_phone,
            'deleted_by_role', v_caller_role,
            'deleted_by_id', v_uid,
            'is_planning_owner', v_is_planning_owner,
            'is_planning_leader', v_is_planning_leader,
            'is_admin', v_is_admin,
            'cascade_stats', jsonb_build_object(
                'operations', v_op_count,
                'production_runs', v_run_count,
                'ng_details', v_ng_count,
                'qa_checks', v_qa_count,
                'attachments', v_att_count
            ),
            'deleted_at', timezone('Asia/Ho_Chi_Minh', now())
        )
    );

    -- 9. Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'message', 'Đã xóa Lệnh sản xuất thành công.',
        'deleted_attachments', v_deleted_attachments,
        'stats', jsonb_build_object(
            'operations', v_op_count,
            'production_runs', v_run_count,
            'ng_details', v_ng_count,
            'qa_checks', v_qa_count,
            'attachments', v_att_count
        )
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.admin_delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job TO authenticated, service_role;

-- Alias function: delete_job
CREATE OR REPLACE FUNCTION public.delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.admin_delete_job(p_job_id, p_confirm_ticket, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_job TO authenticated, service_role;
