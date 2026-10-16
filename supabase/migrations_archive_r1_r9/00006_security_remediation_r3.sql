-- ==============================================================================
-- SAMPLE TRACKING V1.0 — SECURITY REMEDIATION R3 (FORWARD-ONLY MIGRATION)
-- Migration: 00006_security_remediation_r3.sql
-- Description:
--   1. Schema Fix: Add explicit production_run_id foreign key to qa_checks.
--   2. Schema Alignment: Drop/recreate triggers to remove all non-existent column
--      references (mfg_completed_at/by, actual_cycle_time_seconds, qa_decision, etc.)
--   3. Production & QA Correlation Engine: QA explicitly links to production_run_id.
--      Latest production run must have a corresponding approved QA check (result = 'OK').
--      New production runs or newer QA NG/KIV invalidate completion immediately.
--   4. Workflow State Machine: Supports NOT_STARTED -> IN_PROGRESS -> WAITING_QA -> COMPLETED,
--      as well as transitions from COMPLETED to QA_NG or QA_KIV upon inspection updates.
--   5. Strict Job Lifecycle: Enforces ACTIVE -> CLOSE -> ARCHIVE -> PURGED.
--      Blocks direct jumps to PURGED and blocks Phase 1 purge entirely.
--   6. Storage Authorization: Explicit role-based upload matrix by file_type,
--      locking all mutations on non-active jobs.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA EXTENSION ON QA_CHECKS (EXPLICIT PRODUCTION RUN LINKAGE)
-- ------------------------------------------------------------------------------
ALTER TABLE public.qa_checks
ADD COLUMN IF NOT EXISTS production_run_id UUID REFERENCES public.production_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_qa_checks_production_run_id ON public.qa_checks(production_run_id);


-- ------------------------------------------------------------------------------
-- 2. PRODUCTION RUN WORKFLOW TRIGGER (STALE COMPLETION INVALIDATION)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_production_run_workflow_r3()
RETURNS TRIGGER AS $$
DECLARE
    v_current_status public.operation_status;
BEGIN
    SELECT status INTO v_current_status FROM public.job_operations WHERE id = NEW.operation_id;

    -- If operation was COMPLETED, new production run arrival immediately invalidates completion
    IF v_current_status = 'COMPLETED' THEN
        UPDATE public.job_operations
        SET status = 'WAITING_QA', updated_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = NEW.operation_id;
    ELSIF v_current_status IN ('NOT_STARTED', 'QA_NG', 'QA_KIV') THEN
        UPDATE public.job_operations
        SET status = 'IN_PROGRESS', updated_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = NEW.operation_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_production_run_workflow ON public.production_runs;
DROP TRIGGER IF EXISTS trg_production_run_workflow_r2 ON public.production_runs;
DROP TRIGGER IF EXISTS trg_production_run_workflow_r3 ON public.production_runs;
CREATE TRIGGER trg_production_run_workflow_r3
    AFTER INSERT OR UPDATE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.handle_production_run_workflow_r3();


-- ------------------------------------------------------------------------------
-- 3. QA CHECK WORKFLOW TRIGGER (DETERMINISTIC EVALUATION & REVISION CORRELATION)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_qa_check_workflow_r3()
RETURNS TRIGGER AS $$
DECLARE
    v_target_run_id UUID;
    v_latest_run RECORD;
BEGIN
    -- 1. Identify the evaluated production run
    v_target_run_id := NEW.production_run_id;

    IF v_target_run_id IS NULL THEN
        SELECT id, ok_qty, end_time, created_at
        INTO v_latest_run
        FROM public.production_runs
        WHERE operation_id = NEW.operation_id
        ORDER BY end_time DESC, created_at DESC, id DESC
        LIMIT 1;
        v_target_run_id := v_latest_run.id;
    ELSE
        SELECT id, ok_qty, end_time, created_at
        INTO v_latest_run
        FROM public.production_runs
        WHERE id = v_target_run_id;
    END IF;

    -- 2. State transition based on QA result
    IF NEW.result = 'NG' THEN
        -- Even if previous state was COMPLETED, new QA NG updates status to QA_NG
        UPDATE public.job_operations
        SET status = 'QA_NG', updated_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = NEW.operation_id;
    ELSIF NEW.result = 'KIV' THEN
        -- Even if previous state was COMPLETED, new QA KIV updates status to QA_KIV
        UPDATE public.job_operations
        SET status = 'QA_KIV', updated_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = NEW.operation_id;
    ELSIF NEW.result = 'OK' THEN
        -- Verify that evaluated run is the latest production run and has ok_qty > 0
        IF v_latest_run.id IS NOT NULL AND v_latest_run.ok_qty > 0 THEN
            -- Check if any NEWER production run exists that has not been evaluated
            IF NOT EXISTS (
                SELECT 1 FROM public.production_runs pr
                WHERE pr.operation_id = NEW.operation_id
                  AND pr.id != v_latest_run.id
                  AND (pr.end_time > v_latest_run.end_time OR (pr.end_time = v_latest_run.end_time AND pr.created_at > v_latest_run.created_at))
            ) THEN
                UPDATE public.job_operations
                SET status = 'COMPLETED', updated_at = timezone('Asia/Ho_Chi_Minh', now())
                WHERE id = NEW.operation_id;
            ELSE
                UPDATE public.job_operations
                SET status = 'WAITING_QA', updated_at = timezone('Asia/Ho_Chi_Minh', now())
                WHERE id = NEW.operation_id;
            END IF;
        ELSE
            UPDATE public.job_operations
            SET status = 'WAITING_QA', updated_at = timezone('Asia/Ho_Chi_Minh', now())
            WHERE id = NEW.operation_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_qa_check_workflow ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_qa_check_workflow_r2 ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_qa_check_workflow_r3 ON public.qa_checks;
CREATE TRIGGER trg_qa_check_workflow_r3
    AFTER INSERT OR UPDATE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.handle_qa_check_workflow_r3();


-- ------------------------------------------------------------------------------
-- 4. OPERATION WORKFLOW INVARIANTS (CLEANED UP COLUMN REFERENCES)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules_r3()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_latest_run RECORD;
    v_latest_qa RECORD;
BEGIN
    v_role := public.get_current_user_role();

    -- =========================================================================
    -- A. INSERT RULES
    -- =========================================================================
    IF TG_OP = 'INSERT' THEN
        -- New operation MUST start as NOT_STARTED
        IF NEW.status != 'NOT_STARTED' THEN
            RAISE EXCEPTION 'New operations must be created with status NOT_STARTED (attempted: %).', NEW.status;
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- B. UPDATE RULES
    -- =========================================================================
    IF TG_OP = 'UPDATE' THEN
        -- B.1 Prevent unauthorized job_id reassignment
        IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
            RAISE EXCEPTION 'Unauthorized job_id reassignment is forbidden.';
        END IF;

        -- B.2 Explicit valid status transitions state machine
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('WAITING_QA', 'NOT_STARTED', 'IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition directly to %.', NEW.status;
            ELSIF OLD.status = 'WAITING_QA' AND NEW.status NOT IN ('COMPLETED', 'QA_KIV', 'QA_NG', 'IN_PROGRESS', 'WAITING_QA') THEN
                RAISE EXCEPTION 'Invalid status transition: WAITING_QA cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'QA_KIV' AND NEW.status NOT IN ('IN_PROGRESS', 'WAITING_QA', 'COMPLETED', 'QA_KIV') THEN
                RAISE EXCEPTION 'Invalid status transition: QA_KIV cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'QA_NG' AND NEW.status NOT IN ('IN_PROGRESS', 'WAITING_QA', 'QA_KIV', 'QA_NG') THEN
                RAISE EXCEPTION 'Invalid status transition: QA_NG cannot transition directly to % (requires rework in IN_PROGRESS or WAITING_QA).', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS', 'WAITING_QA', 'QA_NG', 'QA_KIV', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;
        END IF;

        -- B.3 Correlation rule for COMPLETED
        IF NEW.status = 'COMPLETED' THEN
            -- Find latest production run
            SELECT id, ok_qty, end_time, created_at
            INTO v_latest_run
            FROM public.production_runs
            WHERE operation_id = NEW.id
            ORDER BY end_time DESC, created_at DESC, id DESC
            LIMIT 1;

            IF v_latest_run.id IS NULL OR v_latest_run.ok_qty <= 0 THEN
                RAISE EXCEPTION 'Cannot complete operation: requires at least one completed production run with OK quantity > 0.';
            END IF;

            -- Find latest QA check for this operation or specific run
            SELECT id, result, production_run_id, inspection_time, created_at
            INTO v_latest_qa
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY inspection_time DESC, created_at DESC, id DESC
            LIMIT 1;

            IF v_latest_qa.id IS NULL THEN
                RAISE EXCEPTION 'Cannot complete operation: QA inspection has not been performed.';
            END IF;

            IF v_latest_qa.result != 'OK' THEN
                RAISE EXCEPTION 'Cannot complete operation: latest QA decision is % (must be OK).', v_latest_qa.result;
            END IF;

            -- If QA explicitly references a run, it must match the latest run
            IF v_latest_qa.production_run_id IS NOT NULL AND v_latest_qa.production_run_id != v_latest_run.id THEN
                RAISE EXCEPTION 'Stale QA approval: latest QA check evaluated historical run %, but a newer production run % exists.',
                    v_latest_qa.production_run_id, v_latest_run.id;
            END IF;
        END IF;

        -- B.4 Role field ownership
        IF v_role = 'Planning' THEN
            IF OLD.status != 'NOT_STARTED' AND (
                NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
                NEW.step_order IS DISTINCT FROM OLD.step_order OR
                NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
                NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds
            ) THEN
                RAISE EXCEPTION 'Planning cannot alter specifications for operations that have already started.';
            END IF;

            IF NEW.status IS DISTINCT FROM OLD.status THEN
                RAISE EXCEPTION 'Planning is not authorized to alter operation execution status.';
            END IF;

        ELSIF v_role = 'PE-MFG' THEN
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
               NEW.step_order IS DISTINCT FROM OLD.step_order THEN
                RAISE EXCEPTION 'PE-MFG cannot modify Planning specifications.';
            END IF;

            IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
                RAISE EXCEPTION 'PE-MFG cannot set status to COMPLETED. QA inspection approval is required.';
            END IF;

        ELSIF v_role = 'QA' THEN
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
               NEW.step_order IS DISTINCT FROM OLD.step_order THEN
                RAISE EXCEPTION 'QA cannot modify Planning specifications.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_op_workflow ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r2 ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r3 ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow_r3
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules_r3();


-- ------------------------------------------------------------------------------
-- 5. STRICT JOB LIFECYCLE & CLOSED JOB IMMUTABILITY (STEP 5)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_job_active_status_r3()
RETURNS TRIGGER AS $$
DECLARE
    v_job_status public.job_status;
    v_target_job_id UUID;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();

    -- 1. On JOBS table:
    IF TG_TABLE_NAME = 'jobs' THEN
        -- Strict Lifecycle Transitions: ACTIVE -> CLOSE -> ARCHIVE -> PURGED
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF OLD.status = 'ACTIVE' THEN
                IF NEW.status != 'CLOSE' THEN
                    RAISE EXCEPTION 'Invalid lifecycle transition: ACTIVE job cannot jump directly to % (must transition to CLOSE first).', NEW.status;
                END IF;
                IF v_role NOT IN ('Planning', 'Admin') THEN
                    RAISE EXCEPTION 'Only Planning or Admin can transition a job to CLOSE.';
                END IF;
                NEW.closed_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.closed_by := auth.uid();

            ELSIF OLD.status = 'CLOSE' THEN
                IF NEW.status = 'ACTIVE' THEN
                    RAISE EXCEPTION 'Direct reopening of CLOSED JOB % is forbidden. Exceptional administrative corrections require an approved workflow.', OLD.job_no;
                ELSIF NEW.status = 'PURGED' THEN
                    RAISE EXCEPTION 'Invalid lifecycle transition: CLOSE job cannot jump directly to PURGED (must transition to ARCHIVE first).';
                ELSIF NEW.status = 'ARCHIVE' THEN
                    IF v_role NOT IN ('Planning', 'Admin') THEN
                        RAISE EXCEPTION 'Only Planning or Admin can transition a job to ARCHIVE.';
                    END IF;
                END IF;

            ELSIF OLD.status = 'ARCHIVE' THEN
                IF NEW.status = 'PURGED' THEN
                    -- For Phase 1, block purge entirely until Phase 6 verified archive handling
                    RAISE EXCEPTION 'Purging archived jobs is disabled in Phase 1 (scheduled for Phase 6 verified archive handling).';
                ELSIF NEW.status != 'ARCHIVE' THEN
                    RAISE EXCEPTION 'ARCHIVED jobs cannot be modified or reopened.';
                END IF;

            ELSIF OLD.status = 'PURGED' THEN
                RAISE EXCEPTION 'PURGED jobs are permanent and cannot be modified.';
            END IF;
        END IF;

        -- Business metadata immutability on non-ACTIVE jobs
        IF OLD.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
            IF NEW.job_no IS DISTINCT FROM OLD.job_no OR
               NEW.part_no IS DISTINCT FROM OLD.part_no OR
               NEW.part_name IS DISTINCT FROM OLD.part_name OR
               NEW.customer IS DISTINCT FROM OLD.customer OR
               NEW.order_qty IS DISTINCT FROM OLD.order_qty OR
               NEW.material IS DISTINCT FROM OLD.material OR
               NEW.planned_start_date IS DISTINCT FROM OLD.planned_start_date OR
               NEW.planned_finish_date IS DISTINCT FROM OLD.planned_finish_date OR
               NEW.created_at IS DISTINCT FROM OLD.created_at OR
               NEW.created_by IS DISTINCT FROM OLD.created_by THEN
                RAISE EXCEPTION 'Cannot modify business details on % JOB %.', OLD.status, OLD.job_no;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- 2. On Child tables:
    IF TG_TABLE_NAME = 'job_operations' THEN
        v_target_job_id := COALESCE(NEW.job_id, OLD.job_id);
    ELSIF TG_TABLE_NAME = 'production_runs' THEN
        SELECT job_id INTO v_target_job_id FROM public.job_operations WHERE id = COALESCE(NEW.operation_id, OLD.operation_id);
    ELSIF TG_TABLE_NAME = 'qa_checks' THEN
        SELECT job_id INTO v_target_job_id FROM public.job_operations WHERE id = COALESCE(NEW.operation_id, OLD.operation_id);
    ELSIF TG_TABLE_NAME = 'attachments' THEN
        v_target_job_id := COALESCE(NEW.job_id, OLD.job_id);
    ELSIF TG_TABLE_NAME = 'ng_details' THEN
        SELECT jo.job_id INTO v_target_job_id
        FROM public.production_runs pr
        JOIN public.job_operations jo ON jo.id = pr.operation_id
        WHERE pr.id = COALESCE(NEW.production_run_id, OLD.production_run_id);
    END IF;

    SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    IF v_job_status IS NOT NULL AND v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Operation locked: Parent JOB % is not ACTIVE (current status: %)', v_target_job_id, v_job_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_lock_closed_jobs ON public.jobs;
CREATE TRIGGER trg_lock_closed_jobs
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r3();

DROP TRIGGER IF EXISTS trg_lock_closed_ops ON public.job_operations;
CREATE TRIGGER trg_lock_closed_ops
    BEFORE INSERT OR UPDATE OR DELETE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r3();

DROP TRIGGER IF EXISTS trg_lock_closed_runs ON public.production_runs;
CREATE TRIGGER trg_lock_closed_runs
    BEFORE INSERT OR UPDATE OR DELETE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r3();

DROP TRIGGER IF EXISTS trg_lock_closed_qa ON public.qa_checks;
CREATE TRIGGER trg_lock_closed_qa
    BEFORE INSERT OR UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r3();

DROP TRIGGER IF EXISTS trg_lock_closed_attachments ON public.attachments;
CREATE TRIGGER trg_lock_closed_attachments
    BEFORE INSERT OR UPDATE OR DELETE ON public.attachments
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r3();

DROP TRIGGER IF EXISTS trg_lock_closed_ng ON public.ng_details;
CREATE TRIGGER trg_lock_closed_ng
    BEFORE INSERT OR UPDATE OR DELETE ON public.ng_details
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r3();


-- ------------------------------------------------------------------------------
-- 6. STORAGE AUTHORIZATION MATRIX (STEP 6)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized" ON storage.objects;
CREATE POLICY "storage_sample_docs_insert_authorized"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE AND
        (storage.foldername(name))[1] IS NOT NULL AND
        (storage.foldername(name))[2] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        ) AND
        (
            public.get_current_user_role() = 'Admin' OR
            (public.get_current_user_role() = 'Planning' AND (storage.foldername(name))[2] IN ('DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER')) OR
            (public.get_current_user_role() = 'PE-MFG' AND (storage.foldername(name))[2] IN ('SETTING_SHEET', 'NG_PHOTO', 'OTHER')) OR
            (public.get_current_user_role() = 'QA' AND (storage.foldername(name))[2] IN ('CHECK_SHEET', 'NG_PHOTO', 'OTHER'))
        )
    );
