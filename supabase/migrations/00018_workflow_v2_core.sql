-- ============================================================================
-- Migration: 00018_workflow_v2_core.sql
-- Description: Core Database Implementation for Workflow V2
-- Pillars:
-- 1. Department Leader & Ownership Permissions (Planning, PE-MFG, QA)
-- 2. Operation Enum Expansion ('CLOSED') & Operational Lifecycle
-- 3. Database-Enforced Planning & Routing Lockout upon ANY Operation Closed
-- 4. Immutable Production Lockout after Operation Closed
-- 5. KIV Review Table, Concurrency Locking & Atomic Transfer RPC
-- 6. Final Close JOB (Option B) RPC with Warning Checklist & Snapshot
-- 7. Permanent Read-Only Immutability after Job Closed (all tables & Admin)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES ENHANCEMENT: DEPARTMENT LEADER
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_department_leader BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforce maximum 1 active leader per business department
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_department_leader
    ON public.profiles(role)
    WHERE (is_department_leader = TRUE AND is_active = TRUE AND role != 'Admin');

-- Helper function: check if caller is an active department leader for given role
CREATE OR REPLACE FUNCTION public.is_department_leader(p_role public.user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (auth.role() = 'service_role' OR session_user = 'postgres')
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role = p_role
              AND is_department_leader = TRUE
              AND is_active = TRUE
        );
$$;

-- Helper function: check if caller is PE-MFG Leader or Admin
CREATE OR REPLACE FUNCTION public.is_authorized_pe_leader_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (auth.role() = 'service_role' OR session_user = 'postgres')
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND is_active = TRUE
              AND (role = 'Admin' OR (role = 'PE-MFG' AND is_department_leader = TRUE))
        );
$$;

-- Helper function: check if caller is Planning Leader or Admin
CREATE OR REPLACE FUNCTION public.is_authorized_planning_leader_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (auth.role() = 'service_role' OR session_user = 'postgres')
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND is_active = TRUE
              AND (role = 'Admin' OR (role = 'Planning' AND is_department_leader = TRUE))
        );
$$;

-- Helper function: check if caller is QA Leader or Admin
CREATE OR REPLACE FUNCTION public.is_authorized_qa_leader_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (auth.role() = 'service_role' OR session_user = 'postgres')
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND is_active = TRUE
              AND (role = 'Admin' OR (role = 'QA' AND is_department_leader = TRUE))
        );
$$;

-- ----------------------------------------------------------------------------
-- 2. OPERATION STATUS & COLUMNS ENHANCEMENT
-- ----------------------------------------------------------------------------
-- Add 'CLOSED' to operation_status enum safely if not exists
DO $$
BEGIN
    ALTER TYPE public.operation_status ADD VALUE IF NOT EXISTS 'CLOSED';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.job_operations
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS closed_snapshot JSONB;

-- ----------------------------------------------------------------------------
-- 3. JOBS COLUMNS ENHANCEMENT FOR CLOSE JOB
-- ----------------------------------------------------------------------------
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS close_warnings JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS close_reason TEXT,
    ADD COLUMN IF NOT EXISTS final_snapshot JSONB;

-- ----------------------------------------------------------------------------
-- 4. KIV REVIEWS TABLE (IMMUTABLE AUDIT TRAIL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kiv_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    production_run_id UUID REFERENCES public.production_runs(id) ON DELETE SET NULL,
    kiv_before INTEGER NOT NULL CHECK (kiv_before >= 0),
    kiv_to_ok INTEGER NOT NULL CHECK (kiv_to_ok >= 0),
    kiv_to_ng INTEGER NOT NULL CHECK (kiv_to_ng >= 0),
    kiv_after INTEGER NOT NULL CHECK (kiv_after >= 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
    reviewed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewed_by_name TEXT NOT NULL,
    ng_details_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT chk_kiv_transfer_math CHECK (
        kiv_to_ok + kiv_to_ng > 0 AND
        kiv_to_ok + kiv_to_ng <= kiv_before AND
        kiv_after = kiv_before - (kiv_to_ok + kiv_to_ng)
    )
);

CREATE INDEX IF NOT EXISTS idx_kiv_reviews_op ON public.kiv_reviews(operation_id);
CREATE INDEX IF NOT EXISTS idx_kiv_reviews_job ON public.kiv_reviews(job_id);

-- Enable RLS on kiv_reviews
ALTER TABLE public.kiv_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kiv_reviews_select_policy" ON public.kiv_reviews;
CREATE POLICY "kiv_reviews_select_policy" ON public.kiv_reviews
    FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE);

-- Direct INSERT/UPDATE/DELETE forbidden; mutations handled via review_kiv_transfer RPC
DROP POLICY IF EXISTS "kiv_reviews_mutation_guard" ON public.kiv_reviews;

-- ----------------------------------------------------------------------------
-- 5. PLANNING & ROUTING LOCKOUT TRIGGERS
-- ----------------------------------------------------------------------------
-- Trigger function: Lock Planning info on jobs once ANY operation is CLOSED
CREATE OR REPLACE FUNCTION public.check_planning_lockout_on_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_has_closed_ops BOOLEAN;
BEGIN
    -- Allow forward status transitions (CLOSE/ARCHIVE) and internal close metadata updates
    IF OLD.status IS DISTINCT FROM NEW.status OR
       OLD.closed_at IS DISTINCT FROM NEW.closed_at OR
       OLD.closed_by IS DISTINCT FROM NEW.closed_by OR
       OLD.close_warnings IS DISTINCT FROM NEW.close_warnings OR
       OLD.close_reason IS DISTINCT FROM NEW.close_reason OR
       OLD.final_snapshot IS DISTINCT FROM NEW.final_snapshot THEN
        -- If none of the planning fields were changed, let it pass
        IF OLD.part_no IS NOT DISTINCT FROM NEW.part_no AND
           OLD.part_name IS NOT DISTINCT FROM NEW.part_name AND
           OLD.customer IS NOT DISTINCT FROM NEW.customer AND
           OLD.order_qty IS NOT DISTINCT FROM NEW.order_qty AND
           OLD.material IS NOT DISTINCT FROM NEW.material AND
           OLD.material_spec IS NOT DISTINCT FROM NEW.material_spec AND
           OLD.planned_start_date IS NOT DISTINCT FROM NEW.planned_start_date AND
           OLD.planned_finish_date IS NOT DISTINCT FROM NEW.planned_finish_date THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Check if any operation in this job is CLOSED
    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = OLD.id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        IF OLD.part_no IS DISTINCT FROM NEW.part_no OR
           OLD.part_name IS DISTINCT FROM NEW.part_name OR
           OLD.customer IS DISTINCT FROM NEW.customer OR
           OLD.order_qty IS DISTINCT FROM NEW.order_qty OR
           OLD.material IS DISTINCT FROM NEW.material OR
           OLD.material_spec IS DISTINCT FROM NEW.material_spec OR
           OLD.planned_start_date IS DISTINCT FROM NEW.planned_start_date OR
           OLD.planned_finish_date IS DISTINCT FROM NEW.planned_finish_date THEN
            RAISE EXCEPTION 'Kế hoạch sản xuất đã bị khóa (Planning Lockout): JOB % đã có công đoạn được chốt (CLOSED). Không được phép thay đổi thông tin kế hoạch.', OLD.job_no;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_planning_lockout_on_job ON public.jobs;
CREATE TRIGGER trg_enforce_planning_lockout_on_job
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.check_planning_lockout_on_job();

-- Trigger function: Lock Routing operations once ANY operation is CLOSED
CREATE OR REPLACE FUNCTION public.check_routing_lockout_on_operations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_job_id UUID;
    v_has_closed_ops BOOLEAN;
BEGIN
    v_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;

    -- Check if any operation in this job is CLOSED
    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = v_job_id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'Quy trình công đoạn đã bị khóa: Không thể thêm công đoạn mới vào JOB khi đã có công đoạn chốt (CLOSED).';
        ELSIF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Quy trình công đoạn đã bị khóa: Không thể xóa công đoạn của JOB khi đã có công đoạn chốt (CLOSED).';
        ELSIF TG_OP = 'UPDATE' THEN
            -- Block altering routing specifications (step order, operation name, workcenter, machine)
            IF OLD.step_order IS DISTINCT FROM NEW.step_order OR
               OLD.operation_name IS DISTINCT FROM NEW.operation_name OR
               OLD.workcenter_code IS DISTINCT FROM NEW.workcenter_code OR
               OLD.machine_no IS DISTINCT FROM NEW.machine_no OR
               OLD.planned_machine IS DISTINCT FROM NEW.planned_machine OR
               OLD.planned_cycle_time_seconds IS DISTINCT FROM NEW.planned_cycle_time_seconds THEN
                RAISE EXCEPTION 'Quy trình công đoạn đã bị khóa: Không thể thay đổi thứ tự, tên hoặc máy kế hoạch khi JOB đã có công đoạn chốt (CLOSED).';
            END IF;
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_routing_lockout_on_operations ON public.job_operations;
CREATE TRIGGER trg_enforce_routing_lockout_on_operations
    BEFORE INSERT OR UPDATE OR DELETE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.check_routing_lockout_on_operations();

-- ----------------------------------------------------------------------------
-- 6. CLOSED OPERATION PRODUCTION LOCKOUT TRIGGER
-- ----------------------------------------------------------------------------
-- Blocks direct edits to production_runs when operation is CLOSED (except via review_kiv_transfer)
CREATE OR REPLACE FUNCTION public.check_closed_operation_production_lockout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_op_id UUID;
    v_op_status public.operation_status;
BEGIN
    v_op_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.operation_id ELSE NEW.operation_id END;
    SELECT status INTO v_op_status FROM public.job_operations WHERE id = v_op_id;

    IF v_op_status = 'CLOSED' THEN
        -- Allow internal authorized bypass from review_kiv_transfer RPC
        IF current_setting('sample_tracking.internal_kiv_review', true) = 'true' THEN
            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END IF;

        RAISE EXCEPTION 'Công đoạn đã chốt (CLOSED): Số lượng sản xuất đã bị khóa cố định. Để chuyển đổi KIV sang OK/NG, vui lòng sử dụng chức năng Review KIV.';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_runs_on_closed_op ON public.production_runs;
CREATE TRIGGER trg_lock_runs_on_closed_op
    BEFORE INSERT OR UPDATE OR DELETE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.check_closed_operation_production_lockout();

-- ----------------------------------------------------------------------------
-- 7. REVISE OPERATION WORKFLOW RULES: SUPPORT 'CLOSED' TRANSITION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_has_runs BOOLEAN;
    v_latest_qa RECORD;
    v_has_valid_disposition BOOLEAN;
BEGIN
    -- Determine current user role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        v_role := public.get_current_user_role();
    END IF;

    -- On INSERT: must start with NOT_STARTED
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IS NOT NULL AND NEW.status != 'NOT_STARTED' THEN
            RAISE EXCEPTION 'New operations must be created in NOT_STARTED state (attempted: %).', NEW.status;
        END IF;
        NEW.status := 'NOT_STARTED';
        RETURN NEW;
    END IF;

    -- On UPDATE:
    IF TG_OP = 'UPDATE' THEN
        -- Handle Status Transitions
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF v_role = 'QA' THEN
                RAISE EXCEPTION 'QA is an independent evaluator and cannot alter manufacturing operation status.';
            END IF;

            IF v_role = 'Planning' THEN
                RAISE EXCEPTION 'Planning is not authorized to alter operation manufacturing status.';
            END IF;

            -- State Machine Invariants
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('COMPLETED', 'HOLD', 'CLOSED') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition to % (reset to NOT_STARTED is forbidden).', NEW.status;
            ELSIF OLD.status = 'HOLD' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED', 'CLOSED') THEN
                RAISE EXCEPTION 'Invalid status transition: HOLD cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS', 'CLOSED') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'CLOSED' THEN
                RAISE EXCEPTION 'Operation % đã chốt (CLOSED) và không thể chuyển đổi trạng thái.', OLD.id;
            END IF;

            -- Authority check: Advancing to CLOSED
            IF NEW.status = 'CLOSED' THEN
                IF NOT (v_role = 'Admin' OR (v_role = 'PE-MFG' AND public.is_department_leader('PE-MFG'))) THEN
                    RAISE EXCEPTION 'Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên (Admin) mới có quyền chốt công đoạn (CLOSED).';
                END IF;
            END IF;

            -- Authority checks: Advancing to COMPLETED or HOLD
            IF NEW.status IN ('COMPLETED', 'HOLD') THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'User % is not the designated PE Owner or delegate for JOB %.',
                        auth.uid(), NEW.job_id;
                END IF;
            END IF;
        END IF;

        -- Reopen invariants
        IF OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS' THEN
            NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
            NEW.reopened_by := auth.uid();
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. EXTEND CLOSED JOB IMMUTABILITY (check_job_active_status)
-- ----------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS trg_lock_ng_details_active ON public.ng_details;
CREATE TRIGGER trg_lock_ng_details_active
    BEFORE INSERT OR UPDATE OR DELETE ON public.ng_details
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_lock_kiv_reviews_active ON public.kiv_reviews;
CREATE TRIGGER trg_lock_kiv_reviews_active
    BEFORE INSERT OR UPDATE OR DELETE ON public.kiv_reviews
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

-- ----------------------------------------------------------------------------
-- 9. RPC: ADMIN_SET_DEPARTMENT_LEADER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_department_leader(
    p_user_id UUID,
    p_is_leader BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_admin_role public.user_role;
    v_target RECORD;
    v_prev_leader RECORD;
BEGIN
    -- Verify Admin caller
    IF auth.role() != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Quản trị viên (Admin).';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_admin_role := public.get_current_user_role();
        IF v_admin_role != 'Admin' THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin) mới có quyền bổ nhiệm hoặc thu hồi Trưởng nhóm.';
        END IF;
    END IF;

    -- Target user lookup
    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy người dùng với ID: %.', p_user_id;
    END IF;

    IF v_target.role = 'Admin' THEN
        RAISE EXCEPTION 'Không thể bổ nhiệm tài khoản Admin làm Trưởng nhóm phòng ban (Admin đã có toàn quyền hệ thống).';
    END IF;

    IF p_is_leader = TRUE THEN
        -- Find existing active leader of this role
        SELECT * INTO v_prev_leader
        FROM public.profiles
        WHERE role = v_target.role
          AND is_department_leader = TRUE
          AND is_active = TRUE
          AND id != p_user_id;

        -- Step down existing leader if any
        IF v_prev_leader.id IS NOT NULL THEN
            UPDATE public.profiles
            SET is_department_leader = FALSE, updated_at = NOW()
            WHERE id = v_prev_leader.id;
        END IF;

        -- Promote new leader
        UPDATE public.profiles
        SET is_department_leader = TRUE, updated_at = NOW()
        WHERE id = p_user_id;

        -- Log to audit
        INSERT INTO public.audit_logs (
            user_id, action, entity_type, entity_id, old_values, new_values
        ) VALUES (
            auth.uid(),
            'ADMIN_APPOINT_LEADER',
            'profiles',
            p_user_id,
            jsonb_build_object('user_id', p_user_id, 'is_leader', false, 'replaced_leader_id', v_prev_leader.id),
            jsonb_build_object('user_id', p_user_id, 'is_leader', true, 'role', v_target.role, 'full_name', v_target.full_name)
        );
    ELSE
        -- Revoke leader
        UPDATE public.profiles
        SET is_department_leader = FALSE, updated_at = NOW()
        WHERE id = p_user_id;

        -- Log to audit
        INSERT INTO public.audit_logs (
            user_id, action, entity_type, entity_id, old_values, new_values
        ) VALUES (
            auth.uid(),
            'ADMIN_REVOKE_LEADER',
            'profiles',
            p_user_id,
            jsonb_build_object('user_id', p_user_id, 'is_leader', true, 'role', v_target.role),
            jsonb_build_object('user_id', p_user_id, 'is_leader', false, 'role', v_target.role)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'is_department_leader', p_is_leader,
        'role', v_target.role,
        'full_name', v_target.full_name,
        'message', CASE WHEN p_is_leader THEN 'Đã bổ nhiệm Trưởng bộ phận thành công.' ELSE 'Đã thu hồi quyền Trưởng bộ phận.' END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_department_leader FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_department_leader TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. RPC: CLOSE_JOB_OPERATION
-- ----------------------------------------------------------------------------
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

    -- 2. Validate Operation & Job
    SELECT * INTO v_op FROM public.job_operations WHERE id = p_operation_id;
    IF v_op.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) với ID: %.', p_operation_id;
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = v_op.job_id;
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

-- ----------------------------------------------------------------------------
-- 11. RPC: REVIEW_KIV_TRANSFER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_kiv_transfer(
    p_operation_id UUID,
    p_kiv_to_ok INTEGER,
    p_kiv_to_ng INTEGER,
    p_reason TEXT,
    p_ng_items JSONB DEFAULT '[]'::jsonb
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
    v_curr_kiv INTEGER;
    v_new_ok INTEGER;
    v_new_ng INTEGER;
    v_new_kiv INTEGER;
    v_item JSONB;
    v_item_qty INTEGER;
    v_item_defect TEXT;
    v_item_code TEXT;
    v_item_cause TEXT;
    v_item_remark TEXT;
    v_item_photos TEXT[];
    v_sum_ng INTEGER := 0;
    v_review_id UUID;
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên mới có quyền Review chuyển đổi KIV.';
        END IF;
    END IF;

    -- 2. Input Validation
    IF p_kiv_to_ok IS NULL OR p_kiv_to_ok < 0 THEN
        RAISE EXCEPTION 'Số lượng chuyển sang OK phải là số nguyên không âm.';
    END IF;

    IF p_kiv_to_ng IS NULL OR p_kiv_to_ng < 0 THEN
        RAISE EXCEPTION 'Số lượng chuyển sang NG phải là số nguyên không âm.';
    END IF;

    IF (p_kiv_to_ok + p_kiv_to_ng) <= 0 THEN
        RAISE EXCEPTION 'Tổng số lượng chuyển đổi (OK + NG) phải lớn hơn 0.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do chuyển đổi KIV (tối thiểu 3 ký tự).';
    END IF;

    -- 3. Lock Operation & Validate State
    SELECT * INTO v_op
    FROM public.job_operations
    WHERE id = p_operation_id
    FOR UPDATE;

    IF v_op.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn tương ứng.';
    END IF;

    IF v_op.status != 'CLOSED' THEN
        RAISE EXCEPTION 'Chỉ có thể Review KIV trên công đoạn đã chốt (CLOSED). Trạng thái hiện tại: %.', v_op.status;
    END IF;

    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = v_op.job_id;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã ở trạng thái % (đã đóng/lưu trữ). Không thể chuyển đổi KIV.', v_job.status;
    END IF;

    -- 4. Lock Latest Production Run
    SELECT * INTO v_latest_run
    FROM public.production_runs
    WHERE operation_id = p_operation_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_latest_run.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy bản ghi sản xuất để chuyển đổi KIV.';
    END IF;

    v_curr_kiv := COALESCE(v_latest_run.kiv_qty, 0);
    IF (p_kiv_to_ok + p_kiv_to_ng) > v_curr_kiv THEN
        RAISE EXCEPTION 'Số lượng chuyển đổi (% pcs) vượt quá số lượng KIV còn lại hiện tại (% pcs).',
            (p_kiv_to_ok + p_kiv_to_ng), v_curr_kiv;
    END IF;

    -- 5. Validate NG Items if p_kiv_to_ng > 0
    IF p_kiv_to_ng > 0 THEN
        IF p_ng_items IS NULL OR jsonb_typeof(p_ng_items) != 'array' OR jsonb_array_length(p_ng_items) = 0 THEN
            RAISE EXCEPTION 'Chuyển % pcs sang NG bắt buộc phải khai báo chi tiết lỗi (NG Details).', p_kiv_to_ng;
        END IF;

        FOR v_item IN SELECT * FROM jsonb_array_elements(p_ng_items) LOOP
            v_item_qty := (v_item ->> 'ng_qty')::INTEGER;
            v_sum_ng := v_sum_ng + COALESCE(v_item_qty, 0);
            IF v_item_qty IS NULL OR v_item_qty <= 0 THEN
                RAISE EXCEPTION 'Mỗi dòng lỗi NG phải có số lượng lớn hơn 0.';
            END IF;
            IF (v_item ->> 'defect_name') IS NULL OR length(trim(v_item ->> 'defect_name')) = 0 THEN
                RAISE EXCEPTION 'Vui lòng chọn tên loại lỗi cho tất cả các dòng NG.';
            END IF;
        END LOOP;

        IF v_sum_ng != p_kiv_to_ng THEN
            RAISE EXCEPTION 'Tổng số lượng trong các dòng lỗi NG (% pcs) không khớp với số lượng chuyển sang NG (% pcs).',
                v_sum_ng, p_kiv_to_ng;
        END IF;
    END IF;

    -- 6. Apply Transfer atomically
    v_new_ok := v_latest_run.ok_qty + p_kiv_to_ok;
    v_new_ng := v_latest_run.ng_qty + p_kiv_to_ng;
    v_new_kiv := v_curr_kiv - (p_kiv_to_ok + p_kiv_to_ng);

    -- Set local session config to permit trigger bypass on closed run
    PERFORM set_config('sample_tracking.internal_kiv_review', 'true', true);

    UPDATE public.production_runs
    SET ok_qty = v_new_ok,
        ng_qty = v_new_ng,
        kiv_qty = v_new_kiv,
        updated_at = NOW()
    WHERE id = v_latest_run.id;

    -- Insert NG details if any
    IF p_kiv_to_ng > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_ng_items) LOOP
            v_item_qty := (v_item ->> 'ng_qty')::INTEGER;
            v_item_defect := trim(v_item ->> 'defect_name');
            v_item_code := NULLIF(trim(v_item ->> 'defect_code'), '');
            v_item_cause := NULLIF(trim(v_item ->> 'cause'), '');
            v_item_remark := NULLIF(trim(v_item ->> 'remark'), '');
            
            -- Extract photos array (max 2)
            SELECT ARRAY(
                SELECT elem::TEXT
                FROM jsonb_array_elements_text(COALESCE(v_item -> 'photo_urls', '[]'::jsonb)) AS elem
                LIMIT 2
            ) INTO v_item_photos;

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
                v_latest_run.id,
                v_item_defect,
                v_item_code,
                v_item_qty,
                v_item_cause,
                v_item_cause,
                v_item_remark,
                v_item_photos
            );
        END LOOP;
    END IF;

    -- Insert kiv_reviews audit record
    INSERT INTO public.kiv_reviews (
        operation_id,
        job_id,
        production_run_id,
        kiv_before,
        kiv_to_ok,
        kiv_to_ng,
        kiv_after,
        reason,
        reviewed_by,
        reviewed_by_name,
        ng_details_snapshot
    ) VALUES (
        p_operation_id,
        v_job.id,
        v_latest_run.id,
        v_curr_kiv,
        p_kiv_to_ok,
        p_kiv_to_ng,
        v_new_kiv,
        trim(p_reason),
        COALESCE(v_caller_uid, '00000000-0000-0000-0000-000000000000'::UUID),
        v_caller_name,
        CASE WHEN p_kiv_to_ng > 0 THEN p_ng_items ELSE '[]'::jsonb END
    ) RETURNING id INTO v_review_id;

    -- Record Audit Log
    INSERT INTO public.audit_logs (
        user_id, action, entity_type, entity_id, old_values, new_values
    ) VALUES (
        v_caller_uid,
        'REVIEW_KIV',
        'kiv_reviews',
        v_review_id,
        jsonb_build_object('kiv_before', v_curr_kiv, 'ok_before', v_latest_run.ok_qty, 'ng_before', v_latest_run.ng_qty),
        jsonb_build_object(
            'kiv_to_ok', p_kiv_to_ok,
            'kiv_to_ng', p_kiv_to_ng,
            'kiv_after', v_new_kiv,
            'ok_after', v_new_ok,
            'ng_after', v_new_ng,
            'reason', trim(p_reason)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'review_id', v_review_id,
        'operation_id', p_operation_id,
        'kiv_before', v_curr_kiv,
        'kiv_to_ok', p_kiv_to_ok,
        'kiv_to_ng', p_kiv_to_ng,
        'kiv_after', v_new_kiv,
        'ok_qty', v_new_ok,
        'ng_qty', v_new_ng,
        'message', 'Đã thực hiện Review chuyển đổi KIV thành công.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.review_kiv_transfer FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_kiv_transfer TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 12. RPC: CLOSE_JOB_FINAL (OPTION B IMPLEMENTATION)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_job_final(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_close_reason TEXT DEFAULT NULL,
    p_acknowledged_warnings JSONB DEFAULT '[]'::jsonb
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
    v_job RECORD;
    v_trimmed_ticket TEXT;
    v_total_ops INTEGER := 0;
    v_unclosed_ops INTEGER := 0;
    v_remaining_kiv INTEGER := 0;
    v_missing_qa INTEGER := 0;
    v_qa_ng_kiv INTEGER := 0;
    v_warning_count INTEGER := 0;
    v_final_snapshot JSONB;
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên mới có quyền Đóng Lệnh sản xuất (Close JOB).';
        END IF;
    END IF;

    -- 2. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập lại mã JOB Ticket để xác nhận đóng JOB.';
    END IF;

    -- 3. Lock Target Job
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) với ID: %.', p_job_id;
    END IF;

    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    IF v_job.status = 'CLOSE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất % đã được đóng (CLOSE) trước đó vào lúc %.', v_job.job_no, v_job.closed_at;
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể đóng Lệnh sản xuất ở trạng thái %.', v_job.status;
    END IF;

    -- 4. MANDATORY INVARIANT: All operations must be CLOSED
    SELECT count(*), count(*) FILTER (WHERE status != 'CLOSED')
    INTO v_total_ops, v_unclosed_ops
    FROM public.job_operations
    WHERE job_id = p_job_id;

    IF v_total_ops = 0 THEN
        RAISE EXCEPTION 'Không thể đóng JOB: Lệnh sản xuất chưa có công đoạn nào được thiết lập.';
    END IF;

    IF v_unclosed_ops > 0 THEN
        RAISE EXCEPTION 'Không thể đóng JOB: Tất cả % công đoạn phải được chốt (CLOSED) trước khi đóng JOB. Hiện còn % công đoạn chưa chốt.',
            v_total_ops, v_unclosed_ops;
    END IF;

    -- 5. Evaluate Option B Warnings
    -- Remaining KIV
    SELECT COALESCE(SUM(kiv_qty), 0) INTO v_remaining_kiv
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    -- Operations without any QA checks
    SELECT count(*) INTO v_missing_qa
    FROM public.job_operations jo
    WHERE jo.job_id = p_job_id
      AND NOT EXISTS (SELECT 1 FROM public.qa_checks qc WHERE qc.operation_id = jo.id);

    -- QA Checks that are NG or KIV
    SELECT count(*) INTO v_qa_ng_kiv
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id AND qc.result IN ('NG', 'KIV');

    v_warning_count := 0;
    IF v_remaining_kiv > 0 THEN v_warning_count := v_warning_count + 1; END IF;
    IF v_missing_qa > 0 THEN v_warning_count := v_warning_count + 1; END IF;
    IF v_qa_ng_kiv > 0 THEN v_warning_count := v_warning_count + 1; END IF;

    -- If there are warnings, reason is mandatory (minimum 5 chars)
    IF v_warning_count > 0 AND (p_close_reason IS NULL OR length(trim(p_close_reason)) < 5) THEN
        RAISE EXCEPTION 'JOB còn cảnh báo chưa hoàn tất (% pcs KIV tồn đọng, % công đoạn thiếu QA, % kiểm tra NG/KIV). Bắt buộc nhập lý do giải trình chấp nhận đóng JOB (tối thiểu 5 ký tự).',
            v_remaining_kiv, v_missing_qa, v_qa_ng_kiv;
    END IF;

    -- 6. Compile Final Immutable Snapshot
    SELECT jsonb_build_object(
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'customer', v_job.customer,
        'order_qty', v_job.order_qty,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name,
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'close_reason', trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        'operations_summary', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'step_order', jo.step_order,
                    'operation_name', jo.operation_name,
                    'workcenter_code', jo.workcenter_code,
                    'status', jo.status,
                    'closed_at', jo.closed_at,
                    'snapshot', jo.closed_snapshot
                ) ORDER BY jo.step_order
            )
            FROM public.job_operations jo
            WHERE jo.job_id = p_job_id
        )
    ) INTO v_final_snapshot;

    -- 7. Update Job Status to CLOSE
    UPDATE public.jobs
    SET status = 'CLOSE',
        closed_at = timezone('Asia/Ho_Chi_Minh', now()),
        closed_by = v_caller_uid,
        close_warnings = COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        close_reason = NULLIF(trim(p_close_reason), ''),
        final_snapshot = v_final_snapshot,
        updated_at = NOW()
    WHERE id = p_job_id;

    -- 8. Record Audit Log
    INSERT INTO public.audit_logs (
        user_id, action, entity_type, entity_id, old_values, new_values
    ) VALUES (
        v_caller_uid,
        'CLOSE_JOB',
        'jobs',
        p_job_id,
        jsonb_build_object('status', v_job.status),
        jsonb_build_object(
            'status', 'CLOSE',
            'job_no', v_job.job_no,
            'closed_by', v_caller_name,
            'warnings_count', v_warning_count,
            'close_reason', trim(p_close_reason),
            'final_snapshot', v_final_snapshot
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'status', 'CLOSE',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'message', 'Đã đóng Lệnh sản xuất thành công. Toàn bộ dữ liệu của JOB đã chuyển sang chế độ READ-ONLY vĩnh viễn.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_final FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_job_final TO authenticated, service_role;
