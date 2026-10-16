-- ==============================================================================
-- SAMPLE TRACKING V1.0 — SECURITY & BUSINESS WORKFLOW REMEDIATION R4
-- Migration: 00007_security_business_workflow_r4.sql
-- Description:
--   1. Schema Extension: Add 'HOLD' to operation_status enum.
--   2. PE Ownership: Add pe_owner_id and pe_delegates to jobs; can_make_pe_decisions to profiles.
--   3. Technical Disposition: Create pe_technical_dispositions table for PE continuation on QA NG/KIV.
--   4. Attachments Enhancement: Add owning_department to attachments table.
--   5. Decoupled Workflow: PE owns manufacturing status (NOT_STARTED -> IN_PROGRESS -> COMPLETED).
--      QA is an independent evaluator; QA records are optional.
--   6. QA Correlation & Validation: QA can optionally link to production_run_id (must match op).
--   7. Conditional Completion: PE completion requires run with ok_qty > 0.
--      If QA NG/KIV exists, requires recorded technical disposition.
--   8. Strict Job Lifecycle: Initial status must be ACTIVE; CLOSE immutability; ARCHIVE deferred.
--   9. Storage & Attachment Security: Explicit department ownership and upload matrix.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENUM & SCHEMA EXTENSIONS
-- ------------------------------------------------------------------------------

-- 1.1 Add 'HOLD' to operation_status enum if not present
DO $$ BEGIN
    ALTER TYPE public.operation_status ADD VALUE IF NOT EXISTS 'HOLD';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1.2 Add PE decision authority columns to public.jobs
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS pe_owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS pe_delegates UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX IF NOT EXISTS idx_jobs_pe_owner_id ON public.jobs(pe_owner_id);

-- 1.3 Add can_make_pe_decisions flag to public.profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS can_make_pe_decisions BOOLEAN NOT NULL DEFAULT FALSE;

-- 1.4 Add owning_department to public.attachments
ALTER TABLE public.attachments
ADD COLUMN IF NOT EXISTS owning_department public.user_role NOT NULL DEFAULT 'PE-MFG';

-- 1.5 Create PE Technical Disposition Type & Table
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pe_disposition_type') THEN
        CREATE TYPE public.pe_disposition_type AS ENUM (
            'CONTINUE_AS_IS',
            'REWORK_NEXT',
            'TECHNICAL_REVIEW',
            'CUSTOMER_EVALUATION',
            'HOLD'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.pe_technical_dispositions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    qa_check_id UUID REFERENCES public.qa_checks(id) ON DELETE SET NULL,
    decision_type public.pe_disposition_type NOT NULL,
    technical_reason TEXT NOT NULL,
    planned_follow_up TEXT,
    decision_maker UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    decision_maker_name TEXT NOT NULL,
    decision_timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    attachments_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_pe_dispositions_job ON public.pe_technical_dispositions(job_id);
CREATE INDEX IF NOT EXISTS idx_pe_dispositions_op ON public.pe_technical_dispositions(operation_id);
CREATE INDEX IF NOT EXISTS idx_pe_dispositions_qa ON public.pe_technical_dispositions(qa_check_id);

-- Enable RLS and attach audit trigger
ALTER TABLE public.pe_technical_dispositions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_audit_pe_dispositions ON public.pe_technical_dispositions;
CREATE TRIGGER trg_audit_pe_dispositions
    AFTER INSERT OR UPDATE OR DELETE ON public.pe_technical_dispositions
    FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();


-- ------------------------------------------------------------------------------
-- 2. SECURITY & AUTHORITY HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

-- 2.1 Function to verify designated PE decision authority for a JOB
CREATE OR REPLACE FUNCTION public.is_authorized_pe_decision_maker(p_job_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_role public.user_role;
    v_is_active BOOLEAN;
    v_can_decide BOOLEAN;
    v_pe_owner UUID;
    v_delegates UUID[];
    v_created_by UUID;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT role, is_active, can_make_pe_decisions
    INTO v_role, v_is_active, v_can_decide
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_is_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- Admin always has full administrative decision rights
    IF v_role = 'Admin' THEN
        RETURN TRUE;
    END IF;

    -- Non-PE cannot make PE decisions
    IF v_role != 'PE-MFG' THEN
        RETURN FALSE;
    END IF;

    SELECT pe_owner_id, pe_delegates, created_by
    INTO v_pe_owner, v_delegates, v_created_by
    FROM public.jobs
    WHERE id = p_job_id;

    -- A. Designated PE Owner for the JOB
    IF v_pe_owner IS NOT NULL AND v_pe_owner = p_user_id THEN
        RETURN TRUE;
    END IF;

    -- B. Explicitly authorized delegate for the JOB
    IF v_delegates IS NOT NULL AND p_user_id = ANY(v_delegates) THEN
        RETURN TRUE;
    END IF;

    -- C. If no specific PE owner is assigned yet to the job:
    -- Any PE engineer with can_make_pe_decisions flag = TRUE or who created the job
    IF v_pe_owner IS NULL AND (v_can_decide = TRUE OR v_created_by = p_user_id) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;


-- ------------------------------------------------------------------------------
-- 3. CLEAN UP OBSOLETE R1 / R2 / R3 TRIGGERS
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_production_run_workflow ON public.production_runs;
DROP TRIGGER IF EXISTS trg_production_run_workflow_r2 ON public.production_runs;
DROP TRIGGER IF EXISTS trg_production_run_workflow_r3 ON public.production_runs;

DROP TRIGGER IF EXISTS trg_qa_check_workflow ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_qa_check_workflow_r2 ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_qa_check_workflow_r3 ON public.qa_checks;

DROP TRIGGER IF EXISTS trg_enforce_op_workflow ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r2 ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r3 ON public.job_operations;

DROP TRIGGER IF EXISTS trg_lock_closed_jobs ON public.jobs;
DROP TRIGGER IF EXISTS trg_lock_closed_ops ON public.job_operations;
DROP TRIGGER IF EXISTS trg_lock_closed_runs ON public.production_runs;
DROP TRIGGER IF EXISTS trg_lock_closed_qa ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_lock_closed_attachments ON public.attachments;
DROP TRIGGER IF EXISTS trg_lock_closed_ng ON public.ng_details;


-- ------------------------------------------------------------------------------
-- 4. QA EVALUATION INTEGRITY & CORRELATION (PART A2, B2)
-- ------------------------------------------------------------------------------
-- QA is an independent evaluator:
-- - Optional production_run_id linkage
-- - Strict cross-operation validation if production_run_id is provided
-- - QA checks NEVER directly modify operation manufacturing status
CREATE OR REPLACE FUNCTION public.handle_qa_check_validation_r4()
RETURNS TRIGGER AS $$
DECLARE
    v_run_op_id UUID;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();

    IF v_role NOT IN ('QA', 'Admin') THEN
        RAISE EXCEPTION 'Only QA or Admin can record QA inspection reports (caller role: %).', v_role;
    END IF;

    -- Validate production_run_id relationship if provided
    IF NEW.production_run_id IS NOT NULL THEN
        SELECT operation_id INTO v_run_op_id
        FROM public.production_runs
        WHERE id = NEW.production_run_id;

        IF v_run_op_id IS NULL THEN
            RAISE EXCEPTION 'Referenced production run % does not exist.', NEW.production_run_id;
        END IF;

        IF v_run_op_id != NEW.operation_id THEN
            RAISE EXCEPTION 'Forged cross-operation linkage: production run % belongs to operation %, not operation %.',
                NEW.production_run_id, v_run_op_id, NEW.operation_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_qa_check_validation_r4 ON public.qa_checks;
CREATE TRIGGER trg_qa_check_validation_r4
    BEFORE INSERT OR UPDATE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.handle_qa_check_validation_r4();


-- ------------------------------------------------------------------------------
-- 5. PRODUCTION RUN WORKFLOW (PART A1, B1)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_production_run_workflow_r4()
RETURNS TRIGGER AS $$
DECLARE
    v_current_status public.operation_status;
BEGIN
    SELECT status INTO v_current_status FROM public.job_operations WHERE id = NEW.operation_id;

    -- Advance NOT_STARTED to IN_PROGRESS upon initial run
    IF v_current_status = 'NOT_STARTED' THEN
        UPDATE public.job_operations
        SET status = 'IN_PROGRESS', updated_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = NEW.operation_id;
    END IF;

    -- If operation was already COMPLETED: history is preserved!
    -- Does NOT silently alter or reset status; reopening requires an explicit PE decision.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_production_run_workflow_r4 ON public.production_runs;
CREATE TRIGGER trg_production_run_workflow_r4
    AFTER INSERT OR UPDATE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.handle_production_run_workflow_r4();


-- ------------------------------------------------------------------------------
-- 6. OPERATION WORKFLOW INVARIANTS & PE COMPLETION RULE (PART B1, D1)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules_r4()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_has_runs BOOLEAN;
    v_latest_qa RECORD;
    v_has_disposition BOOLEAN;
    v_is_authorized_pe BOOLEAN;
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

        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Only Planning or Admin can create new operations.';
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

        -- B.2 Role checks on status changes
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            -- QA can NEVER alter manufacturing operation status
            IF v_role = 'QA' THEN
                RAISE EXCEPTION 'QA is an independent evaluator and cannot alter manufacturing operation status.';
            END IF;

            -- Planning can NEVER alter execution status
            IF v_role = 'Planning' THEN
                RAISE EXCEPTION 'Planning is not authorized to alter operation manufacturing status.';
            END IF;

            -- Explicit State Machine:
            -- NOT_STARTED -> IN_PROGRESS
            -- IN_PROGRESS -> HOLD, COMPLETED, NOT_STARTED (pause/reset)
            -- HOLD -> IN_PROGRESS, COMPLETED
            -- COMPLETED -> IN_PROGRESS (Explicit PE reopen)
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('COMPLETED', 'HOLD', 'NOT_STARTED', 'IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'HOLD' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED', 'HOLD') THEN
                RAISE EXCEPTION 'Invalid status transition: HOLD cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;

            -- Authority check for PE-MFG:
            -- Final decisions (COMPLETED, HOLD, reopening COMPLETED -> IN_PROGRESS)
            -- require designated PE decision authority for the JOB
            IF v_role = 'PE-MFG' AND NEW.status IN ('COMPLETED', 'HOLD', 'IN_PROGRESS') THEN
                v_is_authorized_pe := public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid());
                IF NOT v_is_authorized_pe THEN
                    RAISE EXCEPTION 'User % is not authorized as the designated PE decision authority for JOB %.',
                        auth.uid(), NEW.job_id;
                END IF;
            END IF;
        END IF;

        -- B.3 Completion Rule (COMPLETED requires production run + QA check or PE disposition)
        IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
            -- 1. Check production run with ok_qty > 0 exists
            SELECT EXISTS (
                SELECT 1 FROM public.production_runs
                WHERE operation_id = NEW.id AND ok_qty > 0
            ) INTO v_has_runs;

            IF NOT v_has_runs THEN
                RAISE EXCEPTION 'Cannot complete operation: requires at least one completed production run with OK quantity > 0.';
            END IF;

            -- 2. Find latest QA check for this operation
            SELECT id, result, inspection_time, created_at
            INTO v_latest_qa
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY inspection_time DESC, created_at DESC, id DESC
            LIMIT 1;

            -- Case A: No QA check exists -> ALLOWED (QA is optional)
            -- Case B: QA check exists and is OK -> ALLOWED
            -- Case C: QA check exists and is NG or KIV -> REQUIRES recorded PE disposition!
            IF v_latest_qa.id IS NOT NULL AND v_latest_qa.result IN ('NG', 'KIV') THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.pe_technical_dispositions
                    WHERE operation_id = NEW.id
                      AND (qa_check_id = v_latest_qa.id OR decision_timestamp >= v_latest_qa.inspection_time)
                ) INTO v_has_disposition;

                IF NOT v_has_disposition THEN
                    RAISE EXCEPTION 'Cannot complete operation with outstanding QA % without a recorded PE technical disposition.',
                        v_latest_qa.result;
                END IF;
            END IF;
        END IF;

        -- B.4 Field-level role protection
        IF v_role = 'Planning' THEN
            IF OLD.status != 'NOT_STARTED' AND (
                NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
                NEW.step_order IS DISTINCT FROM OLD.step_order OR
                NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
                NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds
            ) THEN
                RAISE EXCEPTION 'Planning cannot alter specifications for operations that have already started.';
            END IF;
        ELSIF v_role = 'PE-MFG' THEN
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds OR
               NEW.step_order IS DISTINCT FROM OLD.step_order THEN
                RAISE EXCEPTION 'PE-MFG cannot modify Planning specifications.';
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

DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r4 ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow_r4
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules_r4();


-- ------------------------------------------------------------------------------
-- 7. STRICT JOB LIFECYCLE & CLOSED JOB IMMUTABILITY (PART B5)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_job_active_status_r4()
RETURNS TRIGGER AS $$
DECLARE
    v_job_status public.job_status;
    v_target_job_id UUID;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();

    -- =========================================================================
    -- A. ON JOBS TABLE:
    -- =========================================================================
    IF TG_TABLE_NAME = 'jobs' THEN
        -- A.1 INSERT: Initial status MUST be ACTIVE
        IF TG_OP = 'INSERT' THEN
            IF NEW.status != 'ACTIVE' THEN
                RAISE EXCEPTION 'New jobs must be created with status ACTIVE (attempted: %).', NEW.status;
            END IF;
            RETURN NEW;
        END IF;

        -- A.2 UPDATE: Lifecycle Transitions ACTIVE -> CLOSE -> ARCHIVE -> PURGED
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
                ELSIF NEW.status = 'ARCHIVE' THEN
                    -- Deferred until Phase 6 per Section B5 instructions
                    RAISE EXCEPTION 'Archiving jobs is deferred until Phase 6 verified archive handling is implemented.';
                ELSIF NEW.status = 'PURGED' THEN
                    RAISE EXCEPTION 'Invalid lifecycle transition: CLOSE job cannot jump directly to PURGED.';
                END IF;

            ELSIF OLD.status = 'ARCHIVE' THEN
                IF NEW.status = 'PURGED' THEN
                    RAISE EXCEPTION 'Purging archived jobs is disabled in Phase 1 (scheduled for Phase 6 verified archive handling).';
                ELSIF NEW.status != 'ARCHIVE' THEN
                    RAISE EXCEPTION 'ARCHIVED jobs cannot be modified or reopened.';
                END IF;

            ELSIF OLD.status = 'PURGED' THEN
                RAISE EXCEPTION 'PURGED jobs are permanent and cannot be modified.';
            END IF;
        END IF;

        -- A.3 Business data immutability on non-ACTIVE jobs
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
               NEW.created_by IS DISTINCT FROM OLD.created_by OR
               NEW.closed_at IS DISTINCT FROM OLD.closed_at OR
               NEW.closed_by IS DISTINCT FROM OLD.closed_by THEN
                RAISE EXCEPTION 'Cannot modify business details or closure metadata on % JOB %.', OLD.status, OLD.job_no;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- B. ON CHILD TABLES (Lockout writes if parent JOB is not ACTIVE)
    -- =========================================================================
    IF TG_TABLE_NAME = 'job_operations' THEN
        v_target_job_id := COALESCE(NEW.job_id, OLD.job_id);
    ELSIF TG_TABLE_NAME = 'production_runs' THEN
        SELECT job_id INTO v_target_job_id FROM public.job_operations WHERE id = COALESCE(NEW.operation_id, OLD.operation_id);
    ELSIF TG_TABLE_NAME = 'qa_checks' THEN
        SELECT job_id INTO v_target_job_id FROM public.job_operations WHERE id = COALESCE(NEW.operation_id, OLD.operation_id);
    ELSIF TG_TABLE_NAME = 'attachments' THEN
        v_target_job_id := COALESCE(NEW.job_id, OLD.job_id);
    ELSIF TG_TABLE_NAME = 'pe_technical_dispositions' THEN
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

-- Attach triggers
DROP TRIGGER IF EXISTS trg_lock_jobs_r4 ON public.jobs;
CREATE TRIGGER trg_lock_jobs_r4
    BEFORE INSERT OR UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();

DROP TRIGGER IF EXISTS trg_lock_ops_r4 ON public.job_operations;
CREATE TRIGGER trg_lock_ops_r4
    BEFORE INSERT OR UPDATE OR DELETE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();

DROP TRIGGER IF EXISTS trg_lock_runs_r4 ON public.production_runs;
CREATE TRIGGER trg_lock_runs_r4
    BEFORE INSERT OR UPDATE OR DELETE ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();

DROP TRIGGER IF EXISTS trg_lock_qa_r4 ON public.qa_checks;
CREATE TRIGGER trg_lock_qa_r4
    BEFORE INSERT OR UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();

DROP TRIGGER IF EXISTS trg_lock_attachments_r4 ON public.attachments;
CREATE TRIGGER trg_lock_attachments_r4
    BEFORE INSERT OR UPDATE OR DELETE ON public.attachments
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();

DROP TRIGGER IF EXISTS trg_lock_ng_r4 ON public.ng_details;
CREATE TRIGGER trg_lock_ng_r4
    BEFORE INSERT OR UPDATE OR DELETE ON public.ng_details
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();

DROP TRIGGER IF EXISTS trg_lock_pe_dispositions_r4 ON public.pe_technical_dispositions;
CREATE TRIGGER trg_lock_pe_dispositions_r4
    BEFORE INSERT OR UPDATE OR DELETE ON public.pe_technical_dispositions
    FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status_r4();


-- ------------------------------------------------------------------------------
-- 8. RLS POLICIES FOR PE TECHNICAL DISPOSITIONS & ATTACHMENTS
-- ------------------------------------------------------------------------------

-- 8.1 PE Technical Dispositions RLS
CREATE POLICY "pe_dispositions_select_active"
    ON public.pe_technical_dispositions FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "pe_dispositions_insert_authorized"
    ON public.pe_technical_dispositions FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        decision_maker = auth.uid() AND
        public.is_authorized_pe_decision_maker(job_id, auth.uid()) = TRUE AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = pe_technical_dispositions.job_id AND j.status = 'ACTIVE'
        )
    );

-- Modifications forbidden (append-only)
REVOKE UPDATE, DELETE ON public.pe_technical_dispositions FROM authenticated, anon;


-- 8.2 Attachments RLS
DROP POLICY IF EXISTS "attachments_insert_active" ON public.attachments;
DROP POLICY IF EXISTS "attachments_insert_authorized_r4" ON public.attachments;

CREATE POLICY "attachments_insert_authorized_r4"
    ON public.attachments FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        uploaded_by = auth.uid() AND
        (
            owning_department = public.get_current_user_role() OR
            public.get_current_user_role() = 'Admin'
        ) AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = attachments.job_id AND j.status = 'ACTIVE'
        ) AND
        (
            public.get_current_user_role() = 'Admin' OR
            (public.get_current_user_role() = 'Planning' AND file_type IN ('DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER')) OR
            (public.get_current_user_role() = 'PE-MFG' AND file_type IN ('CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER')) OR
            (public.get_current_user_role() = 'QA' AND file_type IN ('CHECK_SHEET', 'NG_PHOTO', 'OTHER'))
        )
    );

-- Normal users cannot modify or delete attachments
REVOKE UPDATE, DELETE ON public.attachments FROM authenticated, anon;


-- ------------------------------------------------------------------------------
-- 9. STORAGE AUTHORIZATION MATRIX (PART A5, B4)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized_r4" ON storage.objects;

CREATE POLICY "storage_sample_docs_insert_authorized_r4"
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
            (public.get_current_user_role() = 'PE-MFG' AND (storage.foldername(name))[2] IN ('CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER')) OR
            (public.get_current_user_role() = 'QA' AND (storage.foldername(name))[2] IN ('CHECK_SHEET', 'NG_PHOTO', 'OTHER'))
        )
    );
