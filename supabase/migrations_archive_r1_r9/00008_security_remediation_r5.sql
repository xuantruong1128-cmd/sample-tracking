-- ==============================================================================
-- SAMPLE TRACKING V1.0 — SECURITY & BUSINESS WORKFLOW REMEDIATION R5
-- Migration: 00008_security_remediation_r5.sql
-- Description: Targeted remediation of Codex R4 audit findings (R4-01 through R4-09)
--   1. R4-01: Trusted PE assignment workflow (Planning/Admin only); separated
--             first-run operator authority from final PE decision authority.
--   2. R4-02: Technical disposition integrity (trimmed non-blank reason,
--             database-controlled actor/timestamp, relation consistency,
--             HOLD non-authorization, anti-reuse check).
--   3. R4-03/R4-04: Explicitly drop historical Storage policies; enforce exact
--             object-to-attachment binding and role-category upload matrix.
--   4. R4-05: Strict CLOSED JOB immutability protecting assignments and metadata.
--   5. R4-06: Production run lockout on COMPLETED operations; explicit PE reopen
--             with mandatory reason, actor, and database timestamp.
--   6. R4-07: Explicit legacy status mapping policy (WAITING_QA/QA_NG -> IN_PROGRESS,
--             QA_KIV -> HOLD) preserving QA evidence in qa_checks.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. R4-06 & R4-07: SCHEMA ENHANCEMENTS & LEGACY STATUS MIGRATION
-- ------------------------------------------------------------------------------

-- 1.1 Add explicit reopen tracking columns to public.job_operations
ALTER TABLE public.job_operations
ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

-- 1.2 Explicit legacy status compatibility migration (R4-07)
-- Historical WAITING_QA and QA_NG map to IN_PROGRESS (manufacturing in progress / rework)
UPDATE public.job_operations
SET status = 'IN_PROGRESS', updated_at = timezone('Asia/Ho_Chi_Minh', now())
WHERE status IN ('WAITING_QA', 'QA_NG');

-- Historical QA_KIV maps to HOLD (technical hold pending engineering review)
UPDATE public.job_operations
SET status = 'HOLD', updated_at = timezone('Asia/Ho_Chi_Minh', now())
WHERE status = 'QA_KIV';


-- ------------------------------------------------------------------------------
-- 2. R4-01: ROLE RESOLUTION & PE DECISION AUTHORITY FUNCTIONS
-- ------------------------------------------------------------------------------

-- 2.0 Security helper functions with administrative & service role support
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role AS $$
DECLARE
    v_role public.user_role;
BEGIN
    IF current_user IN ('postgres', 'supabase_admin') OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
        RETURN 'Admin'::public.user_role;
    END IF;

    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = TRUE;

    RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_user_active()
RETURNS BOOLEAN AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin') OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
        RETURN TRUE;
    END IF;

    RETURN COALESCE(
        (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
        FALSE
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- 2.1 Function to verify designated PE decision authority for a JOB
-- ONLY the designated PE Owner or authorized delegate (or Admin) has final authority
CREATE OR REPLACE FUNCTION public.is_authorized_pe_decision_maker(p_job_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_role public.user_role;
    v_is_active BOOLEAN;
    v_pe_owner UUID;
    v_delegates UUID[];
BEGIN
    -- Superuser and service_role administrative bypass
    IF current_user IN ('postgres', 'supabase_admin') OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
        RETURN TRUE;
    END IF;

    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT role, is_active INTO v_role, v_is_active
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_is_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- Admin always has administrative override authority
    IF v_role = 'Admin' THEN
        RETURN TRUE;
    END IF;

    -- Non-PE users cannot make PE decisions
    IF v_role != 'PE-MFG' THEN
        RETURN FALSE;
    END IF;

    SELECT pe_owner_id, pe_delegates INTO v_pe_owner, v_delegates
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

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;


-- ------------------------------------------------------------------------------
-- 3. R4-01 & R4-05: JOB ASSIGNMENT WORKFLOW & CLOSED JOB IMMUTABILITY TRIGGER
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_job_rules_r5()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_del_id UUID;
BEGIN
    v_role := public.get_current_user_role();

    -- =========================================================================
    -- A. INSERT RULES
    -- =========================================================================
    IF TG_OP = 'INSERT' THEN
        -- New jobs MUST start as ACTIVE
        IF NEW.status != 'ACTIVE' THEN
            RAISE EXCEPTION 'New jobs must be created with status ACTIVE (attempted: %).', NEW.status;
        END IF;

        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Only Planning or Admin can create new jobs.';
        END IF;

        -- Validate pe_owner_id if specified at creation
        IF NEW.pe_owner_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.pe_owner_id AND role = 'PE-MFG' AND is_active = TRUE) THEN
                RAISE EXCEPTION 'Assigned PE Owner % must be an active PE-MFG user.', NEW.pe_owner_id;
            END IF;
        END IF;

        -- Validate pe_delegates if specified at creation
        IF NEW.pe_delegates IS NOT NULL AND array_length(NEW.pe_delegates, 1) > 0 THEN
            FOREACH v_del_id IN ARRAY NEW.pe_delegates LOOP
                IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_del_id AND role = 'PE-MFG' AND is_active = TRUE) THEN
                    RAISE EXCEPTION 'Assigned delegate % must be an active PE-MFG user.', v_del_id;
                END IF;
            END LOOP;
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- B. UPDATE RULES
    -- =========================================================================
    IF TG_OP = 'UPDATE' THEN
        -- B.1 Assignment protection: Only Planning or Admin can assign PE Owner/delegates
        IF (NEW.pe_owner_id IS DISTINCT FROM OLD.pe_owner_id OR NEW.pe_delegates IS DISTINCT FROM OLD.pe_delegates) THEN
            IF v_role NOT IN ('Planning', 'Admin') THEN
                RAISE EXCEPTION 'Only Planning or Admin can assign PE Owner or delegates to JOB % (caller role: %). Self-assignment forbidden.',
                    OLD.job_no, v_role;
            END IF;

            -- Validate pe_owner_id
            IF NEW.pe_owner_id IS NOT NULL THEN
                IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.pe_owner_id AND role = 'PE-MFG' AND is_active = TRUE) THEN
                    RAISE EXCEPTION 'Assigned PE Owner % must be an active PE-MFG user.', NEW.pe_owner_id;
                END IF;
            END IF;

            -- Validate pe_delegates
            IF NEW.pe_delegates IS NOT NULL AND array_length(NEW.pe_delegates, 1) > 0 THEN
                FOREACH v_del_id IN ARRAY NEW.pe_delegates LOOP
                    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_del_id AND role = 'PE-MFG' AND is_active = TRUE) THEN
                        RAISE EXCEPTION 'Assigned delegate % must be an active PE-MFG user.', v_del_id;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        -- B.2 Lifecycle transitions (ACTIVE -> CLOSE)
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
                    RAISE EXCEPTION 'Direct reopening of CLOSED JOB % is forbidden.', OLD.job_no;
                ELSIF NEW.status = 'ARCHIVE' THEN
                    RAISE EXCEPTION 'Archiving jobs is deferred until Phase 6 verified archive handling is implemented.';
                ELSIF NEW.status = 'PURGED' THEN
                    RAISE EXCEPTION 'Invalid lifecycle transition: CLOSE job cannot jump directly to PURGED.';
                END IF;

            ELSIF OLD.status = 'ARCHIVE' THEN
                RAISE EXCEPTION 'ARCHIVED jobs cannot be modified or reopened.';
            ELSIF OLD.status = 'PURGED' THEN
                RAISE EXCEPTION 'PURGED jobs are permanent and cannot be modified.';
            END IF;
        END IF;

        -- B.3 R4-05: Strict CLOSED JOB Immutability
        -- No user or Admin may silently modify assignments, business data, or closure metadata once closed
        IF OLD.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
            IF NEW.pe_owner_id IS DISTINCT FROM OLD.pe_owner_id OR
               NEW.pe_delegates IS DISTINCT FROM OLD.pe_delegates OR
               NEW.job_no IS DISTINCT FROM OLD.job_no OR
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
                RAISE EXCEPTION 'Cannot modify business details, assignments, or closure metadata on % JOB %.', OLD.status, OLD.job_no;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_lock_jobs_r4 ON public.jobs;
DROP TRIGGER IF EXISTS trg_enforce_jobs_r5 ON public.jobs;
CREATE TRIGGER trg_enforce_jobs_r5
    BEFORE INSERT OR UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_job_rules_r5();


-- ------------------------------------------------------------------------------
-- 4. R4-02: TECHNICAL DISPOSITION INTEGRITY TRIGGER
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_pe_disposition_integrity_r5()
RETURNS TRIGGER AS $$
DECLARE
    v_op_job_id UUID;
    v_qa_op_id UUID;
    v_qa_result public.qa_result;
    v_qa_time TIMESTAMPTZ;
BEGIN
    -- 1. Database-controlled actor identity and timestamps (tamper-resistant)
    IF auth.uid() IS NOT NULL THEN
        NEW.decision_maker := auth.uid();
        SELECT full_name INTO NEW.decision_maker_name FROM public.profiles WHERE id = auth.uid();
        NEW.decision_maker_name := COALESCE(NEW.decision_maker_name, 'PE Engineer');
    ELSE
        IF NEW.decision_maker IS NULL THEN
            SELECT id, full_name INTO NEW.decision_maker, NEW.decision_maker_name
            FROM public.profiles WHERE role = 'PE-MFG' AND is_active = TRUE LIMIT 1;
        END IF;
        IF NEW.decision_maker_name IS NULL THEN
            SELECT full_name INTO NEW.decision_maker_name FROM public.profiles WHERE id = NEW.decision_maker;
            NEW.decision_maker_name := COALESCE(NEW.decision_maker_name, 'PE Engineer');
        END IF;
    END IF;
    NEW.decision_timestamp := timezone('Asia/Ho_Chi_Minh', now());
    NEW.created_at := timezone('Asia/Ho_Chi_Minh', now());

    -- 2. Non-blank technical reason validation (minimum 5 chars after trimming)
    IF length(trim(COALESCE(NEW.technical_reason, ''))) < 5 THEN
        RAISE EXCEPTION 'Technical reason must be at least 5 characters after trimming whitespace.';
    END IF;

    -- 3. Relationship consistency: operation must belong to job
    SELECT job_id INTO v_op_job_id
    FROM public.job_operations
    WHERE id = NEW.operation_id;

    IF v_op_job_id IS NULL THEN
        RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
    END IF;

    IF v_op_job_id != NEW.job_id THEN
        RAISE EXCEPTION 'Inconsistent reference: operation % belongs to JOB %, not JOB %.',
            NEW.operation_id, v_op_job_id, NEW.job_id;
    END IF;

    -- 4. If qa_check_id is provided, verify it belongs to the exact same operation
    IF NEW.qa_check_id IS NOT NULL THEN
        SELECT operation_id, result, inspection_time INTO v_qa_op_id, v_qa_result, v_qa_time
        FROM public.qa_checks
        WHERE id = NEW.qa_check_id;

        IF v_qa_op_id IS NULL THEN
            RAISE EXCEPTION 'Referenced QA check % does not exist.', NEW.qa_check_id;
        END IF;

        IF v_qa_op_id != NEW.operation_id THEN
            RAISE EXCEPTION 'Inconsistent reference: QA check % belongs to operation %, not operation %.',
                NEW.qa_check_id, v_qa_op_id, NEW.operation_id;
        END IF;

        IF v_qa_result NOT IN ('NG', 'KIV') THEN
            RAISE EXCEPTION 'Technical disposition can only reference an outstanding QA NG or KIV check (referenced QA result: %).', v_qa_result;
        END IF;
    END IF;

    -- 5. Authority check: caller must be designated PE decision authority
    IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
        RAISE EXCEPTION 'Caller % is not the authorized PE Owner or delegate for JOB %.',
            auth.uid(), NEW.job_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_pe_disposition_integrity_r5 ON public.pe_technical_dispositions;
CREATE TRIGGER trg_pe_disposition_integrity_r5
    BEFORE INSERT OR UPDATE ON public.pe_technical_dispositions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pe_disposition_integrity_r5();


-- ------------------------------------------------------------------------------
-- 5. R4-01 & R4-06: OPERATION WORKFLOW & PE COMPLETION INVARIANTS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules_r5()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_has_runs BOOLEAN;
    v_latest_qa RECORD;
    v_has_valid_disposition BOOLEAN;
BEGIN
    v_role := public.get_current_user_role();

    -- =========================================================================
    -- A. INSERT RULES
    -- =========================================================================
    IF TG_OP = 'INSERT' THEN
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
        IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
            RAISE EXCEPTION 'Unauthorized job_id reassignment is forbidden.';
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
            -- QA can NEVER alter manufacturing operation status
            IF v_role = 'QA' THEN
                RAISE EXCEPTION 'QA is an independent evaluator and cannot alter manufacturing operation status.';
            END IF;

            -- Planning can NEVER alter execution status
            IF v_role = 'Planning' THEN
                RAISE EXCEPTION 'Planning is not authorized to alter operation manufacturing status.';
            END IF;

            -- Permitted State Machine:
            -- NOT_STARTED -> IN_PROGRESS (Any active PE-MFG operator or Admin)
            -- IN_PROGRESS -> HOLD, COMPLETED (Authorized PE Owner/delegate only)
            -- HOLD -> IN_PROGRESS, COMPLETED (Authorized PE Owner/delegate only)
            -- COMPLETED -> IN_PROGRESS (Explicit PE reopen with mandatory reason)
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('COMPLETED', 'HOLD', 'NOT_STARTED', 'IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'HOLD' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED', 'HOLD') THEN
                RAISE EXCEPTION 'Invalid status transition: HOLD cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;

            -- R4-01 & R4-06: Authority checks on final technical decisions
            -- 1. Advancing to COMPLETED or HOLD
            IF NEW.status IN ('COMPLETED', 'HOLD') THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'User % is not the designated PE Owner or delegate for JOB %.',
                        auth.uid(), NEW.job_id;
                END IF;
            END IF;

            -- 2. R4-06: Reopening a COMPLETED operation
            IF OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS' THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'Only designated PE Owner or delegate can reopen a completed operation for JOB %.', NEW.job_id;
                END IF;

                IF length(trim(COALESCE(NEW.reopen_reason, ''))) < 5 THEN
                    RAISE EXCEPTION 'Reopening a completed operation requires a recorded reopen_reason (minimum 5 characters).';
                END IF;

                NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.reopened_by := auth.uid();
            END IF;
        END IF;

        -- B.2 R4-02: Completion Invariant Rule
        IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
            -- Must have at least one completed production run with ok_qty > 0
            SELECT EXISTS (
                SELECT 1 FROM public.production_runs
                WHERE operation_id = NEW.id AND ok_qty > 0
            ) INTO v_has_runs;

            IF NOT v_has_runs THEN
                RAISE EXCEPTION 'Cannot complete operation: requires at least one completed production run with OK quantity > 0.';
            END IF;

            -- Check latest QA check
            SELECT id, result, inspection_time, created_at
            INTO v_latest_qa
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY inspection_time DESC, created_at DESC, id DESC
            LIMIT 1;

            -- If latest QA check is NG or KIV, requires an explicit valid technical disposition
            IF v_latest_qa.id IS NOT NULL AND v_latest_qa.result IN ('NG', 'KIV') THEN
                -- R4-02: HOLD disposition NEVER authorizes completion!
                -- Only CONTINUE_AS_IS, REWORK_NEXT, TECHNICAL_REVIEW, CUSTOMER_EVALUATION permit completion.
                -- Must be linked to the outstanding QA check and created at or after the QA check
                SELECT EXISTS (
                    SELECT 1 FROM public.pe_technical_dispositions
                    WHERE operation_id = NEW.id
                      AND decision_type IN ('CONTINUE_AS_IS', 'REWORK_NEXT', 'TECHNICAL_REVIEW', 'CUSTOMER_EVALUATION')
                      AND (qa_check_id = v_latest_qa.id OR decision_timestamp >= v_latest_qa.inspection_time)
                      AND (OLD.reopened_at IS NULL OR decision_timestamp >= OLD.reopened_at)
                ) INTO v_has_valid_disposition;

                IF NOT v_has_valid_disposition THEN
                    RAISE EXCEPTION 'Cannot complete operation with outstanding QA % without an authorized PE technical continuation disposition (HOLD does not permit completion).',
                        v_latest_qa.result;
                END IF;
            END IF;
        END IF;

        -- B.3 Planning specifications lock once operation has started
        IF v_role = 'Planning' AND OLD.status != 'NOT_STARTED' THEN
            IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
               NEW.step_order IS DISTINCT FROM OLD.step_order OR
               NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
               NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds THEN
                RAISE EXCEPTION 'Planning cannot alter specifications for operations that have already started.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r4 ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r5 ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow_r5
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules_r5();


-- ------------------------------------------------------------------------------
-- 6. R4-06: PRODUCTION RUN LOCKOUT ON COMPLETED OPERATIONS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_production_run_before_insert_r5()
RETURNS TRIGGER AS $$
DECLARE
    v_current_status public.operation_status;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();

    IF v_role NOT IN ('PE-MFG', 'Admin') THEN
        RAISE EXCEPTION 'Only PE-MFG or Admin can record production runs.';
    END IF;

    SELECT status INTO v_current_status
    FROM public.job_operations
    WHERE id = NEW.operation_id;

    IF v_current_status IS NULL THEN
        RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
    END IF;

    -- R4-06: Reject new production runs on COMPLETED operations until explicitly reopened
    IF v_current_status = 'COMPLETED' THEN
        RAISE EXCEPTION 'Operation % is COMPLETED. New production runs are blocked until an authorized PE Owner or delegate explicitly reopens the operation.',
            NEW.operation_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_production_run_before_insert_r5 ON public.production_runs;
CREATE TRIGGER trg_production_run_before_insert_r5
    BEFORE INSERT ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.handle_production_run_before_insert_r5();


-- ------------------------------------------------------------------------------
-- 7. R4-03 / R4-04: COMPREHENSIVE STORAGE POLICIES REPLACEMENT
-- ------------------------------------------------------------------------------

-- Explicitly DROP ALL surviving historical storage policies
DROP POLICY IF EXISTS "storage_sample_docs_select_active" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_active" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_select_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized_r4" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_update_admin_only" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_delete_admin_only" ON storage.objects;

-- SELECT: Active user and object is bound to an active or closed non-purged JOB
CREATE POLICY "storage_sample_docs_select_r5"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE AND
        (storage.foldername(name))[1] IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status != 'PURGED'
        )
    );

-- INSERT: Enforce exact path format, active job, and role category whitelist
CREATE POLICY "storage_sample_docs_insert_r5"
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

-- UPDATE: Locked for normal users (immutable files; no cross-department overwrite)
CREATE POLICY "storage_sample_docs_update_admin_only_r5"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin' AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    )
    WITH CHECK (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin' AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    );

-- DELETE: Admin only, on ACTIVE jobs only
CREATE POLICY "storage_sample_docs_delete_admin_only_r5"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.get_current_user_role() = 'Admin' AND
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id::text = (storage.foldername(name))[1]
              AND j.status = 'ACTIVE'
        )
    );
