-- Migration: 00029_auto_turn_cycle_time_and_cygg_fix.sql
-- Description:
--   1. FIX 01 — Workcenter CYGG Description: Update CYGG to 'Cylindrical Grinding' in public.workcenter_master
--   2. FIX 02 — Mandatory Actual Cycle Time for Auto Turn: Enforce in public.close_job_operation that
--      at least one production run has cycle_time_seconds > 0 for Auto Turn operations.
--      Preserves all existing security guards, row locks, audit logging, and immutability rules.

-- ============================================================================
-- 1. FIX 01: Workcenter CYGG Description
-- ============================================================================
UPDATE public.workcenter_master
SET description = 'Cylindrical Grinding',
    mc_type = 'Cylindrical Grinding'
WHERE code = 'CYGG';

-- ============================================================================
-- 2. FIX 02: Update close_job_operation to enforce CT Actual > 0 on Auto Turn
-- ============================================================================
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
    v_is_auto_turn BOOLEAN := FALSE;
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

    -- 4. FIX 02: Check if operation is Auto Turn based on master mapping or name/description
    IF (
        LOWER(TRIM(COALESCE(v_op.description, ''))) = 'auto turn'
        OR LOWER(TRIM(COALESCE(v_op.operation_name, ''))) = 'auto turn'
        OR EXISTS (
            SELECT 1 FROM public.workcenter_master wm
            WHERE wm.code = v_op.workcenter_code
              AND LOWER(TRIM(COALESCE(wm.description, ''))) = 'auto turn'
        )
    ) THEN
        v_is_auto_turn := TRUE;
    END IF;

    IF v_is_auto_turn THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.production_runs
            WHERE operation_id = p_operation_id
              AND cycle_time_seconds IS NOT NULL
              AND cycle_time_seconds > 0
        ) THEN
            RAISE EXCEPTION 'Không thể đóng công đoạn Auto Turn. PE-MFG phải nhập Cycle Time thực tế (CT Actual) trước khi đóng.';
        END IF;
    END IF;

    -- 5. Sum quantities across runs
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

    -- 6. Update Operation Status to CLOSED
    UPDATE public.job_operations
    SET status = 'CLOSED',
        closed_at = timezone('Asia/Ho_Chi_Minh', now()),
        closed_by = v_caller_uid,
        closed_snapshot = v_snapshot,
        updated_at = NOW()
    WHERE id = p_operation_id;

    -- 7. Record Audit Log
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
