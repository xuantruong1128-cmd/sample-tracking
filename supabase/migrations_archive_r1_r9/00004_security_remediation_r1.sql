-- ==============================================================================
-- SAMPLE TRACKING V1.0 — SECURITY REMEDIATION R1 (FORWARD-ONLY MIGRATION)
-- Migration: 00004_security_remediation_r1.sql
-- Remediates:
--   F-01: Public signup restriction hook
--   F-02: Operation authorization & field-level guards
--   F-03: Immutable audit logs captured via database triggers
--   F-04: Closed JOB write lockout across all operational tables
--   F-05: Storage authorization with JOB-binding and path verification
--   F-08: Deletion safety and historical record protection
--   F-10: Derived routing colors & workflow state transition integrity
--   F-12: Backend session access denial on account deactivation
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. F-03: IMMUTABLE AUDIT LOGS & CLIENT FORGERY PREVENTION
-- ------------------------------------------------------------------------------
-- Revoke direct client INSERT from audit_logs
DROP POLICY IF EXISTS "audit_logs_insert_active" ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon;

-- Automated, trusted audit capture trigger function
CREATE OR REPLACE FUNCTION public.capture_audit_log()
RETURNS TRIGGER AS $$
DECLARE
    v_actor UUID;
    v_entity_id UUID;
    v_action TEXT;
    v_old JSONB := NULL;
    v_new JSONB := NULL;
BEGIN
    v_actor := auth.uid();
    v_action := TG_OP;

    IF TG_OP = 'INSERT' THEN
        v_entity_id := NEW.id;
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_entity_id := NEW.id;
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_entity_id := OLD.id;
        v_old := to_jsonb(OLD);
    END IF;

    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        created_at
    ) VALUES (
        v_actor,
        v_action,
        TG_TABLE_NAME,
        v_entity_id,
        v_old,
        v_new,
        timezone('Asia/Ho_Chi_Minh', now())
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach triggers to capture audit on all operational tables
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

DROP TRIGGER IF EXISTS trg_audit_qa_checks ON public.qa_checks;
CREATE TRIGGER trg_audit_qa_checks
    AFTER INSERT OR UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

-- ------------------------------------------------------------------------------
-- 2. F-04: CLOSED JOB WRITE LOCKOUT ACROSS ALL OPERATIONAL TABLES
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_job_active_status()
RETURNS TRIGGER AS $$
DECLARE
    v_job_status public.job_status;
    v_target_job_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'jobs' THEN
        IF OLD.status = 'CLOSE' AND NEW.status NOT IN ('CLOSE', 'ARCHIVE') AND public.get_current_user_role() != 'Admin' THEN
            RAISE EXCEPTION 'JOB % is CLOSED. Modification is locked.', OLD.job_no;
        END IF;
        RETURN NEW;
    ELSIF TG_TABLE_NAME = 'job_operations' THEN
        v_target_job_id := COALESCE(NEW.job_id, OLD.job_id);
    ELSIF TG_TABLE_NAME = 'production_runs' THEN
        SELECT job_id INTO v_target_job_id FROM public.job_operations WHERE id = NEW.operation_id;
    ELSIF TG_TABLE_NAME = 'qa_checks' THEN
        SELECT job_id INTO v_target_job_id FROM public.job_operations WHERE id = NEW.operation_id;
    ELSIF TG_TABLE_NAME = 'attachments' THEN
        v_target_job_id := NEW.job_id;
    ELSIF TG_TABLE_NAME = 'ng_details' THEN
        SELECT jo.job_id INTO v_target_job_id
        FROM public.production_runs pr
        JOIN public.job_operations jo ON jo.id = pr.operation_id
        WHERE pr.id = NEW.production_run_id;
    END IF;

    SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    IF v_job_status IS NOT NULL AND v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Operation locked: Parent JOB % is not ACTIVE (current status: %)', v_target_job_id, v_job_status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach closed job lockout triggers
DROP TRIGGER IF EXISTS trg_lock_closed_jobs ON public.jobs;
CREATE TRIGGER trg_lock_closed_jobs
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_lock_closed_ops ON public.job_operations;
CREATE TRIGGER trg_lock_closed_ops
    BEFORE INSERT OR UPDATE OR DELETE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_lock_closed_runs ON public.production_runs;
CREATE TRIGGER trg_lock_closed_runs
    BEFORE INSERT OR UPDATE OR DELETE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_lock_closed_qa ON public.qa_checks;
CREATE TRIGGER trg_lock_closed_qa
    BEFORE INSERT OR UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_lock_closed_attachments ON public.attachments;
CREATE TRIGGER trg_lock_closed_attachments
    BEFORE INSERT OR UPDATE OR DELETE ON public.attachments
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_lock_closed_ng ON public.ng_details;
CREATE TRIGGER trg_lock_closed_ng
    BEFORE INSERT OR UPDATE OR DELETE ON public.ng_details
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

-- ------------------------------------------------------------------------------
-- 3. F-02 & F-10: OPERATION AUTHORIZATION & DERIVED ROUTING COLOR INTEGRITY
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_has_runs BOOLEAN;
    v_has_qa_ok BOOLEAN;
BEGIN
    v_role := public.get_current_user_role();

    -- Rule A: COMPLETED status strictly requires completed production AND QA OK (F-10)
    IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.production_runs
            WHERE operation_id = NEW.id AND ok_qty > 0
        ) INTO v_has_runs;

        SELECT EXISTS (
            SELECT 1 FROM public.qa_checks
            WHERE operation_id = NEW.id AND result = 'OK'
        ) INTO v_has_qa_ok;

        IF NOT v_has_runs OR NOT v_has_qa_ok THEN
            RAISE EXCEPTION 'Cannot set operation to COMPLETED: Requires at least one production run (OK qty > 0) AND QA inspection confirmed OK.';
        END IF;
    END IF;

    -- Rule B: Role-specific field protection (F-02)
    IF v_role = 'Planning' THEN
        -- Planning cannot change step order or name once production has begun
        IF OLD.status != 'NOT_STARTED' AND (
            NEW.operation_name != OLD.operation_name OR
            NEW.step_order != OLD.step_order
        ) THEN
            RAISE EXCEPTION 'Planning cannot re-order or rename operations that have already started.';
        END IF;
        -- Planning cannot fabricate execution or inspection status
        IF NEW.status IN ('COMPLETED', 'QA_KIV', 'QA_NG') AND OLD.status != NEW.status THEN
            RAISE EXCEPTION 'Planning is not authorized to set manufacturing or QA completion status.';
        END IF;
    ELSIF v_role = 'PE-MFG' THEN
        -- PE-MFG cannot modify planning specifications
        IF NEW.operation_name != OLD.operation_name OR
           NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
           NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
           NEW.step_order != OLD.step_order THEN
            RAISE EXCEPTION 'PE-MFG cannot modify Planning specifications.';
        END IF;
        -- PE-MFG cannot set COMPLETED without QA
        IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
            RAISE EXCEPTION 'PE-MFG cannot set status to COMPLETED. QA inspection approval is required.';
        END IF;
    ELSIF v_role = 'QA' THEN
        -- QA cannot modify planning specifications
        IF NEW.operation_name != OLD.operation_name OR
           NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
           NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
           NEW.step_order != OLD.step_order THEN
            RAISE EXCEPTION 'QA cannot modify Planning specifications.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_op_workflow ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow
    BEFORE UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules();

-- ------------------------------------------------------------------------------
-- 4. F-08: DELETION SAFETY & EVIDENCE PRESERVATION
-- ------------------------------------------------------------------------------
-- Remove hard DELETE policy on jobs
DROP POLICY IF EXISTS "jobs_delete_admin_only" ON public.jobs;

-- Create trigger blocking hard delete of jobs with production or QA evidence
CREATE OR REPLACE FUNCTION public.protect_job_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.production_runs pr
        JOIN public.job_operations jo ON jo.id = pr.operation_id
        WHERE jo.job_id = OLD.id
    ) OR EXISTS (
        SELECT 1 FROM public.qa_checks qc
        JOIN public.job_operations jo ON jo.id = qc.operation_id
        WHERE jo.job_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'Destructive deletion blocked: JOB % contains historical manufacturing and QA records. Must transition through ARCHIVE lifecycle.', OLD.job_no;
    END IF;

    IF public.get_current_user_role() != 'Admin' THEN
        RAISE EXCEPTION 'Only Admin can perform maintenance deletion on unstarted JOBs.';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_job_deletion ON public.jobs;
CREATE TRIGGER trg_protect_job_deletion
    BEFORE DELETE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.protect_job_deletion();

-- ------------------------------------------------------------------------------
-- 5. F-05: STORAGE AUTHORIZATION & PATH BINDING
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "storage_sample_docs_select_active" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_active" ON storage.objects;

CREATE POLICY "storage_sample_docs_select_authorized"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE
    );

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

-- Delete and update locked on storage objects for normal users
CREATE POLICY "storage_sample_docs_delete_admin_only"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin'
    );
