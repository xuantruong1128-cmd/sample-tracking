-- ==============================================================================
-- SAMPLE TRACKING V1.0 — SECURITY REMEDIATION R2 (FORWARD-ONLY MIGRATION)
-- Migration: 00005_security_remediation_r2.sql
-- Description:
--   1. Operation workflow invariants on BOTH INSERT and UPDATE (F-02, F-10)
--   2. Deterministic correlation between production runs and QA decisions (F-10)
--   3. Invalidation of stale completion upon new production runs (F-10)
--   4. Job reassignment lockout (job_id immutability) (F-02)
--   5. Strict closed JOB immutability and reopening lockout (F-04)
--   6. Extended audit triggers across all 9 application tables (F-03)
--   7. Storage authorization bound to active jobs and attachment rules (F-05)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. OPERATION WORKFLOW INVARIANTS ON INSERT & UPDATE (F-02, F-10)
-- ------------------------------------------------------------------------------

-- Replace previous R1 trigger function with hardened R2 version
CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules_r2()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_latest_run_created_at TIMESTAMPTZ;
    v_has_ok_run BOOLEAN;
    v_latest_qa_result public.qa_result;
    v_latest_qa_time TIMESTAMPTZ;
BEGIN
    v_role := public.get_current_user_role();

    -- =========================================================================
    -- A. INSERT RULES (New operations must start in a valid initial state)
    -- =========================================================================
    IF TG_OP = 'INSERT' THEN
        -- New operations MUST start as NOT_STARTED
        IF NEW.status != 'NOT_STARTED' THEN
            RAISE EXCEPTION 'New operations must be created with status NOT_STARTED (attempted: %).', NEW.status;
        END IF;

        -- Planning cannot fabricate production or QA completion on creation
        IF NEW.mfg_completed_at IS NOT NULL OR NEW.mfg_completed_by IS NOT NULL OR
           NEW.actual_cycle_time_seconds IS NOT NULL OR
           NEW.qa_decision IS NOT NULL OR NEW.qa_checked_at IS NOT NULL OR NEW.qa_checked_by IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot insert operation with pre-filled manufacturing or QA completion fields.';
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- B. UPDATE RULES
    -- =========================================================================
    IF TG_OP = 'UPDATE' THEN
        -- Rule B.1: Prevent unauthorized job_id reassignment
        IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
            RAISE EXCEPTION 'Unauthorized job_id reassignment is forbidden.';
        END IF;

        -- Rule B.2: Explicit valid status transitions state machine
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('WAITING_QA', 'NOT_STARTED', 'IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition directly to %.', NEW.status;
            ELSIF OLD.status = 'WAITING_QA' AND NEW.status NOT IN ('COMPLETED', 'QA_KIV', 'QA_NG', 'IN_PROGRESS', 'WAITING_QA') THEN
                RAISE EXCEPTION 'Invalid status transition: WAITING_QA cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'QA_KIV' AND NEW.status NOT IN ('IN_PROGRESS', 'WAITING_QA', 'COMPLETED', 'QA_KIV') THEN
                RAISE EXCEPTION 'Invalid status transition: QA_KIV cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'QA_NG' AND NEW.status NOT IN ('IN_PROGRESS', 'WAITING_QA', 'QA_NG') THEN
                RAISE EXCEPTION 'Invalid status transition: QA_NG cannot transition to % (requires rework in IN_PROGRESS or WAITING_QA).', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS', 'WAITING_QA', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;
        END IF;

        -- Rule B.3: Deterministic production & QA correlation for COMPLETED (GREEN) status
        IF NEW.status = 'COMPLETED' THEN
            -- Check for at least one completed production run with ok_qty > 0
            SELECT EXISTS (
                SELECT 1 FROM public.production_runs
                WHERE operation_id = NEW.id AND ok_qty > 0
            ) INTO v_has_ok_run;

            IF NOT v_has_ok_run THEN
                RAISE EXCEPTION 'Cannot complete operation: requires at least one completed production run with OK quantity > 0.';
            END IF;

            -- Get latest production run timestamp
            SELECT MAX(created_at) INTO v_latest_run_created_at
            FROM public.production_runs
            WHERE operation_id = NEW.id;

            -- Get latest QA check decision and timestamp
            SELECT result, created_at INTO v_latest_qa_result, v_latest_qa_time
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1;

            IF v_latest_qa_result IS NULL THEN
                RAISE EXCEPTION 'Cannot complete operation: QA inspection has not been performed.';
            END IF;

            IF v_latest_qa_result != 'OK' THEN
                RAISE EXCEPTION 'Cannot complete operation: latest QA decision is % (must be OK).', v_latest_qa_result;
            END IF;

            -- Revision correlation: QA OK must be at or after the latest production run
            IF v_latest_run_created_at IS NOT NULL AND v_latest_qa_time < v_latest_run_created_at THEN
                RAISE EXCEPTION 'Stale QA approval: a new production run was recorded at % after the QA check at %. Re-inspection is required.',
                    v_latest_run_created_at, v_latest_qa_time;
            END IF;
        END IF;

        -- Rule B.4: Role-specific field protection
        IF v_role = 'Planning' THEN
            -- Planning cannot alter steps once started
            IF OLD.status != 'NOT_STARTED' AND (
                NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
                NEW.step_order IS DISTINCT FROM OLD.step_order
            ) THEN
                RAISE EXCEPTION 'Planning cannot rename or reorder operations that have already started.';
            END IF;

            -- Planning cannot modify status to COMPLETED, QA_KIV, or QA_NG
            IF NEW.status IN ('COMPLETED', 'QA_KIV', 'QA_NG') AND NEW.status IS DISTINCT FROM OLD.status THEN
                RAISE EXCEPTION 'Planning is not authorized to set manufacturing or QA completion status.';
            END IF;

            -- Planning cannot fabricate execution or inspection fields
            IF NEW.actual_cycle_time_seconds IS DISTINCT FROM OLD.actual_cycle_time_seconds OR
               NEW.mfg_completed_at IS DISTINCT FROM OLD.mfg_completed_at OR
               NEW.mfg_completed_by IS DISTINCT FROM OLD.mfg_completed_by OR
               NEW.qa_decision IS DISTINCT FROM OLD.qa_decision OR
               NEW.qa_checked_at IS DISTINCT FROM OLD.qa_checked_at OR
               NEW.qa_checked_by IS DISTINCT FROM OLD.qa_checked_by THEN
                RAISE EXCEPTION 'Planning cannot modify production or QA evidence fields.';
            END IF;

        ELSIF v_role = 'PE-MFG' THEN
            -- PE-MFG cannot modify planning specs
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
               NEW.step_order IS DISTINCT FROM OLD.step_order THEN
                RAISE EXCEPTION 'PE-MFG cannot modify Planning specifications.';
            END IF;

            -- PE-MFG cannot modify QA fields or self-approve COMPLETED
            IF NEW.qa_decision IS DISTINCT FROM OLD.qa_decision OR
               NEW.qa_checked_at IS DISTINCT FROM OLD.qa_checked_at OR
               NEW.qa_checked_by IS DISTINCT FROM OLD.qa_checked_by THEN
                RAISE EXCEPTION 'PE-MFG cannot modify QA inspection fields.';
            END IF;

            IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
                RAISE EXCEPTION 'PE-MFG cannot set status to COMPLETED. QA inspection approval is required.';
            END IF;

        ELSIF v_role = 'QA' THEN
            -- QA cannot modify planning specs
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
               NEW.step_order IS DISTINCT FROM OLD.step_order THEN
                RAISE EXCEPTION 'QA cannot modify Planning specifications.';
            END IF;

            -- QA cannot modify MFG execution fields
            IF NEW.actual_cycle_time_seconds IS DISTINCT FROM OLD.actual_cycle_time_seconds OR
               NEW.mfg_completed_at IS DISTINCT FROM OLD.mfg_completed_at OR
               NEW.mfg_completed_by IS DISTINCT FROM OLD.mfg_completed_by THEN
                RAISE EXCEPTION 'QA cannot modify PE-MFG execution fields.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach trigger to both INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_enforce_op_workflow ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r2 ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow_r2
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules_r2();


-- ------------------------------------------------------------------------------
-- 2. AUTOMATIC STALE COMPLETION INVALIDATION & WORKFLOW PROGRESSION TRIGGERS (F-10)
-- ------------------------------------------------------------------------------

-- Invalidate completed status or advance not_started when new production run arrives
CREATE OR REPLACE FUNCTION public.handle_production_run_workflow()
RETURNS TRIGGER AS $$
DECLARE
    v_current_status public.operation_status;
BEGIN
    SELECT status INTO v_current_status FROM public.job_operations WHERE id = NEW.operation_id;

    -- If operation was COMPLETED, new production run invalidates stale completion!
    IF v_current_status = 'COMPLETED' THEN
        UPDATE public.job_operations
        SET status = 'WAITING_QA', updated_at = now()
        WHERE id = NEW.operation_id;
    ELSIF v_current_status = 'NOT_STARTED' THEN
        UPDATE public.job_operations
        SET status = 'IN_PROGRESS', updated_at = now()
        WHERE id = NEW.operation_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_production_run_workflow ON public.production_runs;
CREATE TRIGGER trg_production_run_workflow
    AFTER INSERT OR UPDATE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.handle_production_run_workflow();

-- Synchronize operation status with QA decision
CREATE OR REPLACE FUNCTION public.handle_qa_check_workflow()
RETURNS TRIGGER AS $$
DECLARE
    v_latest_run_created_at TIMESTAMPTZ;
    v_has_ok_run BOOLEAN;
BEGIN
    IF NEW.result = 'NG' THEN
        UPDATE public.job_operations
        SET status = 'QA_NG',
            qa_decision = 'NG',
            qa_checked_at = NEW.created_at,
            qa_checked_by = NEW.inspector_id,
            updated_at = now()
        WHERE id = NEW.operation_id AND status != 'QA_NG';
    ELSIF NEW.result = 'KIV' THEN
        UPDATE public.job_operations
        SET status = 'QA_KIV',
            qa_decision = 'KIV',
            qa_checked_at = NEW.created_at,
            qa_checked_by = NEW.inspector_id,
            updated_at = now()
        WHERE id = NEW.operation_id AND status != 'QA_KIV';
    ELSIF NEW.result = 'OK' THEN
        -- Check if valid production run exists and QA is >= latest run
        SELECT EXISTS (
            SELECT 1 FROM public.production_runs
            WHERE operation_id = NEW.operation_id AND ok_qty > 0
        ) INTO v_has_ok_run;

        SELECT MAX(created_at) INTO v_latest_run_created_at
        FROM public.production_runs
        WHERE operation_id = NEW.operation_id;

        IF v_has_ok_run AND (v_latest_run_created_at IS NULL OR NEW.created_at >= v_latest_run_created_at) THEN
            UPDATE public.job_operations
            SET status = 'COMPLETED',
                qa_decision = 'OK',
                qa_checked_at = NEW.created_at,
                qa_checked_by = NEW.inspector_id,
                updated_at = now()
            WHERE id = NEW.operation_id;
        ELSE
            UPDATE public.job_operations
            SET status = 'WAITING_QA',
                qa_decision = 'OK',
                qa_checked_at = NEW.created_at,
                qa_checked_by = NEW.inspector_id,
                updated_at = now()
            WHERE id = NEW.operation_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_qa_check_workflow ON public.qa_checks;
CREATE TRIGGER trg_qa_check_workflow
    AFTER INSERT OR UPDATE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.handle_qa_check_workflow();


-- ------------------------------------------------------------------------------
-- 3. CLOSED JOB IMMUTABILITY & REOPENING LOCKOUT (F-04, F-06)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_job_active_status_r2()
RETURNS TRIGGER AS $$
DECLARE
    v_job_status public.job_status;
    v_target_job_id UUID;
BEGIN
    -- 1. On JOBS table:
    IF TG_TABLE_NAME = 'jobs' THEN
        IF OLD.status = 'CLOSE' THEN
            -- Direct reopening to ACTIVE is forbidden
            IF NEW.status = 'ACTIVE' THEN
                RAISE EXCEPTION 'Direct reopening of CLOSED JOB % is forbidden. Exceptional administrative corrections require an approved workflow.', OLD.job_no;
            END IF;

            -- Business data on CLOSED JOB is immutable
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
                RAISE EXCEPTION 'Cannot modify business details on CLOSED JOB %.', OLD.job_no;
            END IF;
        END IF;

        IF OLD.status IN ('ARCHIVE', 'PURGED') AND NEW.status != OLD.status THEN
            RAISE EXCEPTION 'JOB % is % and cannot be modified.', OLD.job_no, OLD.status;
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

-- Rebind closed job triggers with r2 function
DROP TRIGGER IF EXISTS trg_lock_closed_jobs ON public.jobs;
CREATE TRIGGER trg_lock_closed_jobs
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r2();

DROP TRIGGER IF EXISTS trg_lock_closed_ops ON public.job_operations;
CREATE TRIGGER trg_lock_closed_ops
    BEFORE INSERT OR UPDATE OR DELETE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r2();

DROP TRIGGER IF EXISTS trg_lock_closed_runs ON public.production_runs;
CREATE TRIGGER trg_lock_closed_runs
    BEFORE INSERT OR UPDATE OR DELETE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r2();

DROP TRIGGER IF EXISTS trg_lock_closed_qa ON public.qa_checks;
CREATE TRIGGER trg_lock_closed_qa
    BEFORE INSERT OR UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r2();

DROP TRIGGER IF EXISTS trg_lock_closed_attachments ON public.attachments;
CREATE TRIGGER trg_lock_closed_attachments
    BEFORE INSERT OR UPDATE OR DELETE ON public.attachments
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r2();

DROP TRIGGER IF EXISTS trg_lock_closed_ng ON public.ng_details;
CREATE TRIGGER trg_lock_closed_ng
    BEFORE INSERT OR UPDATE OR DELETE ON public.ng_details
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r2();


-- ------------------------------------------------------------------------------
-- 4. EXTENDED AUDIT LOGGING ACROSS ALL 9 TABLES (F-03)
-- ------------------------------------------------------------------------------

-- Ensure audit triggers are attached to all 9 system tables
DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
    AFTER INSERT OR UPDATE OR DELETE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_jobs ON public.jobs;
CREATE TRIGGER trg_audit_jobs
    AFTER INSERT OR UPDATE OR DELETE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_job_operations ON public.job_operations;
CREATE TRIGGER trg_audit_job_operations
    AFTER INSERT OR UPDATE OR DELETE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_production_runs ON public.production_runs;
CREATE TRIGGER trg_audit_production_runs
    AFTER INSERT OR UPDATE OR DELETE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_ng_details ON public.ng_details;
CREATE TRIGGER trg_audit_ng_details
    AFTER INSERT OR UPDATE OR DELETE ON public.ng_details
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_qa_checks ON public.qa_checks;
CREATE TRIGGER trg_audit_qa_checks
    AFTER INSERT OR UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_attachments ON public.attachments;
CREATE TRIGGER trg_audit_attachments
    AFTER INSERT OR UPDATE OR DELETE ON public.attachments
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_job_archives ON public.job_archives;
CREATE TRIGGER trg_audit_job_archives
    AFTER INSERT OR UPDATE OR DELETE ON public.job_archives
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_audit_defect_catalog ON public.defect_catalog;
CREATE TRIGGER trg_audit_defect_catalog
    AFTER INSERT OR UPDATE OR DELETE ON public.defect_catalog
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();


-- ------------------------------------------------------------------------------
-- 5. STORAGE AUTHORIZATION ENFORCEMENT (F-05)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "storage_sample_docs_select_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_update_admin_only" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_delete_admin_only" ON storage.objects;

-- SELECT: Active user and bound to an existing JOB
CREATE POLICY "storage_sample_docs_select_authorized"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE AND
        (storage.foldername(name))[1] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
        )
    );

-- INSERT: Active user, bound to an ACTIVE job, conforming to folder path <job_id>/<file_type>/<filename>
CREATE POLICY "storage_sample_docs_insert_authorized"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE AND
        (storage.foldername(name))[1] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    );

-- UPDATE (Move / Overwrite / Metadata): Admin only, and parent JOB must be ACTIVE
CREATE POLICY "storage_sample_docs_update_admin_only"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin' AND
        (storage.foldername(name))[1] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    )
    WITH CHECK (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin' AND
        (storage.foldername(name))[1] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    );

-- DELETE: Admin only, and parent JOB must be ACTIVE (Closed jobs cannot have documents deleted)
CREATE POLICY "storage_sample_docs_delete_admin_only"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin' AND
        (storage.foldername(name))[1] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    );
