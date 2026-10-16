-- ==============================================================================
-- SAMPLE TRACKING V1.0 — PHASE 1: SECURITY REMEDIATION R8 (FORWARD-ONLY)
-- Migration: 00011_security_remediation_r8.sql
-- Description: Targeted remediation of Codex R7 audit findings (R7-01 through R7-08)
--
-- Findings addressed:
--   1. R7-01 (BLOCKER): Prevent forged READY attachments. All ordinary client inserts
--      unconditionally start PENDING. Direct client UPDATE to upload_status is blocked.
--   2. R7-02 (BLOCKER): Migration compatibility with CLOSED JOBs. Provide auditable
--      maintenance procedure for derived fields without violating CLOSED job immutability.
--   3. R7-03 (HIGH): Protect QA event counter and ensure unique, monotonic sequences.
--      Client UPDATE cannot modify qa_event_counter. Add UNIQUE(operation_id, event_seq).
--   4. R7-04 (HIGH): Protect reopen metadata (reopened_at, reopened_by, reopen_reason).
--      Block status-preserving updates, server-stamp actor and time, require reason >= 5 chars,
--      and enforce that pre-reopen dispositions cannot authorize post-reopen completion.
--   5. R7-05 (HIGH): Complete upload retry lifecycle (PENDING -> READY / FAILED; FAILED -> PENDING).
--      Detect existing storage objects, prevent hijacking, verify ACTIVE job state.
--   6. R7-06 (HIGH): Backend support for minimal working upload UI.
--   7. R7-07 (MEDIUM): Support comprehensive preflight diagnostics.
--   8. R7-08 (MEDIUM): Correct Admin uploader attribution. uploaded_by always records
--      the real authenticated actor (auth.uid()). Admin on-behalf uploads are explicitly audited.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. R7-02: CLOSED JOB COMPATIBILITY FOR DERIVED FIELD MAINTENANCE
-- ------------------------------------------------------------------------------

-- Update check_job_active_status_r4 to recognize authorized maintenance mode
CREATE OR REPLACE FUNCTION public.check_job_active_status_r4()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_target_job_id UUID;
    v_job_status public.job_status;
    v_is_maintenance BOOLEAN;
BEGIN
    -- Check if running inside authorized maintenance session
    v_is_maintenance := COALESCE(current_setting('sample_tracking.maintenance_mode', true), 'false') = 'true';
    IF v_is_maintenance THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    -- Determine target job_id depending on table
    IF TG_TABLE_NAME = 'jobs' THEN
        IF TG_OP = 'UPDATE' THEN
            -- Allow closing a job
            IF OLD.status = 'ACTIVE' AND NEW.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
                RETURN NEW;
            END IF;
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
    ELSIF TG_TABLE_NAME = 'pe_technical_dispositions' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    END IF;

    IF v_job_status IS NOT NULL AND v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Operation locked: Parent JOB % is not ACTIVE (current status: %)', v_target_job_id, v_job_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Perform maintenance reconciliation of QA event sequences on CLOSED/ACTIVE jobs safely
DO $$
DECLARE
    v_rec RECORD;
    v_seq BIGINT;
    v_prev_op UUID := NULL;
BEGIN
    PERFORM set_config('sample_tracking.maintenance_mode', 'true', true);

    -- 1. Ensure event_seq is populated for any historical QA rows
    FOR v_rec IN (
        SELECT id, operation_id
        FROM public.qa_checks
        WHERE event_seq IS NULL
        ORDER BY operation_id, created_at ASC, id ASC
    ) LOOP
        IF v_prev_op IS NULL OR v_prev_op != v_rec.operation_id THEN
            v_prev_op := v_rec.operation_id;
            SELECT COALESCE(max(event_seq), 0) + 1 INTO v_seq
            FROM public.qa_checks
            WHERE operation_id = v_rec.operation_id;
        ELSE
            v_seq := v_seq + 1;
        END IF;

        UPDATE public.qa_checks
        SET event_seq = v_seq
        WHERE id = v_rec.id;
    END LOOP;

    -- 2. Align job_operations qa_event_counter with max(event_seq)
    UPDATE public.job_operations op
    SET qa_event_counter = COALESCE(sub.max_seq, 0)
    FROM (
        SELECT operation_id, max(event_seq) AS max_seq
        FROM public.qa_checks
        GROUP BY operation_id
    ) sub
    WHERE op.id = sub.operation_id
      AND op.qa_event_counter < COALESCE(sub.max_seq, 0);

    PERFORM set_config('sample_tracking.maintenance_mode', 'false', true);
END $$;


-- ------------------------------------------------------------------------------
-- 2. R7-03: UNIQUE CONSTRAINT & SERVER-OWNED QA EVENT COUNTER
-- ------------------------------------------------------------------------------

-- Ensure uniqueness of event_seq per operation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_qa_checks_operation_event_seq'
    ) THEN
        ALTER TABLE public.qa_checks
        ADD CONSTRAINT uq_qa_checks_operation_event_seq UNIQUE (operation_id, event_seq);
    END IF;
END $$;

-- Update QA check insert trigger with session context protection
CREATE OR REPLACE FUNCTION public.handle_qa_check_before_insert_r8()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_current_counter BIGINT;
    v_op_job_id UUID;
    v_job_status public.job_status;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role NOT IN ('QA', 'Admin') THEN
        RAISE EXCEPTION 'Only QA or Admin can record quality evaluations.';
    END IF;

    -- Lock parent operation row to serialize concurrent QA checks
    SELECT qa_event_counter, job_id INTO v_current_counter, v_op_job_id
    FROM public.job_operations
    WHERE id = NEW.operation_id
    FOR UPDATE;

    IF v_op_job_id IS NULL THEN
        RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
    END IF;

    SELECT status INTO v_job_status FROM public.jobs WHERE id = v_op_job_id;
    IF v_job_status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
        RAISE EXCEPTION 'Cannot record QA checks on % JOB.', v_job_status;
    END IF;

    -- Monotonic event sequence allocation
    NEW.event_seq := COALESCE(v_current_counter, 0) + 1;
    NEW.created_at := timezone('Asia/Ho_Chi_Minh', now());

    -- Authorize internal counter update
    PERFORM set_config('sample_tracking.trusted_qa_action', 'true', true);

    UPDATE public.job_operations
    SET qa_event_counter = NEW.event_seq
    WHERE id = NEW.operation_id;

    PERFORM set_config('sample_tracking.trusted_qa_action', 'false', true);

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qa_check_before_insert_r7 ON public.qa_checks;
DROP TRIGGER IF EXISTS trg_qa_check_before_insert_r8 ON public.qa_checks;
CREATE TRIGGER trg_qa_check_before_insert_r8
BEFORE INSERT ON public.qa_checks
FOR EACH ROW EXECUTE FUNCTION public.handle_qa_check_before_insert_r8();

-- Block direct updates to qa_checks (QA evaluations are immutable records)
CREATE OR REPLACE FUNCTION public.enforce_qa_check_immutability_r8()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF COALESCE(current_setting('sample_tracking.maintenance_mode', true), 'false') = 'true' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'QA evaluation records are immutable. Direct UPDATE or DELETE is strictly forbidden.';
END $$;

DROP TRIGGER IF EXISTS trg_qa_check_immutability_r8 ON public.qa_checks;
CREATE TRIGGER trg_qa_check_immutability_r8
BEFORE UPDATE OR DELETE ON public.qa_checks
FOR EACH ROW EXECUTE FUNCTION public.enforce_qa_check_immutability_r8();


-- ------------------------------------------------------------------------------
-- 3. R7-03 & R7-04: PROTECT QA EVENT COUNTER & REOPEN METADATA
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_operation_workflow_rules_r8()
RETURNS TRIGGER AS $$
DECLARE
    v_role public.user_role;
    v_has_runs BOOLEAN;
    v_latest_qa RECORD;
    v_has_valid_disposition BOOLEAN;
    v_is_trusted_qa BOOLEAN;
BEGIN
    v_role := public.get_current_user_role();
    v_is_trusted_qa := COALESCE(current_setting('sample_tracking.trusted_qa_action', true), 'false') = 'true';

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

        NEW.qa_event_counter := 0;
        NEW.reopened_at := NULL;
        NEW.reopened_by := NULL;
        NEW.reopen_reason := NULL;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- B. UPDATE RULES
    -- =========================================================================
    IF TG_OP = 'UPDATE' THEN
        -- Allow maintenance mode
        IF COALESCE(current_setting('sample_tracking.maintenance_mode', true), 'false') = 'true' THEN
            RETURN NEW;
        END IF;

        IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
            RAISE EXCEPTION 'Unauthorized job_id reassignment is forbidden.';
        END IF;

        -- R7-03: Protect server-owned qa_event_counter from client tampering
        IF NEW.qa_event_counter IS DISTINCT FROM OLD.qa_event_counter THEN
            IF NOT v_is_trusted_qa THEN
                RAISE EXCEPTION 'qa_event_counter is server-owned and cannot be modified by client UPDATE.';
            END IF;
        END IF;

        -- R7-04: Protect reopen metadata on status-preserving updates
        IF NEW.status = OLD.status THEN
            IF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at OR
               NEW.reopened_by IS DISTINCT FROM OLD.reopened_by OR
               NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason THEN
                RAISE EXCEPTION 'Reopen metadata (reopened_at, reopened_by, reopen_reason) can only be set during authorized operation reopening from COMPLETED to IN_PROGRESS.';
            END IF;
        END IF;

        -- Status transition validations
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
            -- NOT_STARTED -> IN_PROGRESS
            -- IN_PROGRESS -> HOLD, COMPLETED
            -- HOLD -> IN_PROGRESS, COMPLETED
            -- COMPLETED -> IN_PROGRESS (Explicit authorized PE reopen only)
            IF OLD.status = 'NOT_STARTED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: NOT_STARTED cannot transition directly to % (must transition to IN_PROGRESS first).', NEW.status;
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('COMPLETED', 'HOLD') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition to % (reset to NOT_STARTED is forbidden).', NEW.status;
            ELSIF OLD.status = 'HOLD' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: HOLD cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;

            -- Authority checks:
            -- 1. Advancing to COMPLETED or HOLD
            IF NEW.status IN ('COMPLETED', 'HOLD') THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'User % is not the designated PE Owner or delegate for JOB %.',
                        auth.uid(), NEW.job_id;
                END IF;
            END IF;

            -- 2. R7-04: Reopening a COMPLETED operation
            IF OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS' THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'Only designated PE Owner or delegate can reopen a completed operation for JOB %.', NEW.job_id;
                END IF;

                IF length(trim(COALESCE(NEW.reopen_reason, ''))) < 5 THEN
                    RAISE EXCEPTION 'Reopening a completed operation requires a recorded reopen_reason (minimum 5 characters).';
                END IF;

                -- Server overrides client-provided timestamp and actor to prevent forgery
                NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.reopened_by := auth.uid();
            ELSE
                -- When not transitioning COMPLETED -> IN_PROGRESS, preserve original reopen metadata
                NEW.reopened_at := OLD.reopened_at;
                NEW.reopened_by := OLD.reopened_by;
                NEW.reopen_reason := OLD.reopen_reason;
            END IF;
        END IF;

        -- Completion Invariant Rules
        IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
            -- Must have at least one completed production run with ok_qty > 0
            SELECT EXISTS (
                SELECT 1 FROM public.production_runs
                WHERE operation_id = NEW.id AND ok_qty > 0
            ) INTO v_has_runs;

            IF NOT v_has_runs THEN
                RAISE EXCEPTION 'Cannot complete operation: requires at least one completed production run with OK quantity > 0.';
            END IF;

            -- Authoritative latest QA check ordered by event_seq DESC
            SELECT id, result, event_seq, created_at
            INTO v_latest_qa
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY event_seq DESC
            LIMIT 1;

            -- If latest QA check is NG or KIV, requires an explicit valid technical disposition
            IF v_latest_qa.id IS NOT NULL AND v_latest_qa.result IN ('NG', 'KIV') THEN
                -- Invariants:
                -- 1. HOLD disposition NEVER authorizes completion!
                -- 2. Disposition MUST be linked to the EXACT latest QA check event
                -- 3. Disposition decision_timestamp must be >= v_latest_qa.created_at
                -- 4. R7-04: If operation was previously reopened, disposition must be >= reopened_at
                SELECT EXISTS (
                    SELECT 1 FROM public.pe_technical_dispositions
                    WHERE operation_id = NEW.id
                      AND decision_type IN ('CONTINUE_AS_IS', 'REWORK_NEXT', 'TECHNICAL_REVIEW', 'CUSTOMER_EVALUATION')
                      AND qa_check_id = v_latest_qa.id
                      AND decision_timestamp >= v_latest_qa.created_at
                      AND (OLD.reopened_at IS NULL OR decision_timestamp >= OLD.reopened_at)
                ) INTO v_has_valid_disposition;

                IF NOT v_has_valid_disposition THEN
                    RAISE EXCEPTION 'Cannot complete operation with outstanding QA % (event #%) without an authorized PE technical continuation disposition issued after latest event and reopen (HOLD does not permit completion).',
                        v_latest_qa.result, v_latest_qa.event_seq;
                END IF;
            END IF;
        END IF;

        -- Planning specifications lock once operation has started
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r7 ON public.job_operations;
DROP TRIGGER IF EXISTS trg_enforce_op_workflow_r8 ON public.job_operations;
CREATE TRIGGER trg_enforce_op_workflow_r8
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules_r8();


-- ------------------------------------------------------------------------------
-- 4. R7-01 & R7-08: ATTACHMENT INTEGRITY, PENDING DEFAULT & ATTRIBUTION
-- ------------------------------------------------------------------------------

-- R7-01: Change default column value from READY to PENDING
ALTER TABLE public.attachments
ALTER COLUMN upload_status SET DEFAULT 'PENDING';

-- Additional audit & retry tracking fields
ALTER TABLE public.attachments
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admin_on_behalf BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.enforce_attachment_integrity_r8()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_caller_uid uuid;
    v_job_status public.job_status;
    v_op_job_id uuid;
    v_parts text[];
    v_is_trusted_action boolean;
BEGIN
    v_is_trusted_action := COALESCE(current_setting('sample_tracking.trusted_upload_action', true), 'false') = 'true';

    IF TG_OP = 'UPDATE' THEN
        -- Only trusted server functions (confirm, fail, retry) may update upload_status!
        IF NOT v_is_trusted_action THEN
            RAISE EXCEPTION 'Attachment records and upload_status are server-managed. Direct client UPDATE is strictly forbidden.';
        END IF;

        -- Immutable core metadata guard
        IF NEW.job_id IS DISTINCT FROM OLD.job_id OR
           NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
           NEW.file_name IS DISTINCT FROM OLD.file_name OR
           NEW.file_path IS DISTINCT FROM OLD.file_path OR
           NEW.file_size IS DISTINCT FROM OLD.file_size OR
           NEW.mime_type IS DISTINCT FROM OLD.mime_type OR
           NEW.file_type IS DISTINCT FROM OLD.file_type OR
           NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR
           NEW.owning_department IS DISTINCT FROM OLD.owning_department THEN
            RAISE EXCEPTION 'Attachment core metadata is immutable.';
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_caller_uid := auth.uid();
        v_role := public.get_current_user_role();

        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller is not an active internal user.';
        END IF;

        -- R7-08: uploaded_by ALWAYS records the real authenticated actor (auth.uid())!
        -- No user, including Admin, can forge uploaded_by.
        NEW.uploaded_by := v_caller_uid;

        -- Department ownership rules
        IF v_role IN ('Planning', 'PE-MFG', 'QA') THEN
            NEW.owning_department := v_role;
            NEW.admin_on_behalf := FALSE;
        ELSIF v_role = 'Admin' THEN
            IF NEW.owning_department IS NOT NULL AND NEW.owning_department != 'Admin' THEN
                NEW.admin_on_behalf := TRUE;
            ELSE
                NEW.owning_department := 'Admin';
                NEW.admin_on_behalf := FALSE;
            END IF;
        END IF;

        -- Verify Job exists and is ACTIVE
        SELECT status INTO v_job_status FROM public.jobs WHERE id = NEW.job_id;
        IF v_job_status IS NULL THEN
            RAISE EXCEPTION 'Referenced JOB % does not exist.', NEW.job_id;
        END IF;
        IF v_job_status != 'ACTIVE' THEN
            RAISE EXCEPTION 'Cannot attach documents to % JOB (only ACTIVE jobs permit uploads).', v_job_status;
        END IF;

        -- Verify Operation consistency
        IF NEW.operation_id IS NOT NULL THEN
            SELECT job_id INTO v_op_job_id FROM public.job_operations WHERE id = NEW.operation_id;
            IF v_op_job_id IS NULL THEN
                RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
            END IF;
            IF v_op_job_id != NEW.job_id THEN
                RAISE EXCEPTION 'Attachment operation % belongs to another JOB %, not JOB %.',
                    NEW.operation_id, v_op_job_id, NEW.job_id;
            END IF;
        END IF;

        -- Canonical storage path format validation: <job_id>/<file_type>/<filename>
        v_parts := string_to_array(NEW.file_path, '/');
        IF array_length(v_parts, 1) != 3
           OR v_parts[1] != NEW.job_id::text
           OR v_parts[2] != NEW.file_type::text
           OR length(v_parts[3]) = 0
           OR v_parts[3] IN ('.', '..')
           OR position('\' in v_parts[3]) > 0
           OR position('/' in v_parts[3]) > 0 THEN
            RAISE EXCEPTION 'Attachment path must strictly match <job_id>/<file_type>/<filename>';
        END IF;

        -- Role-category whitelist check
        IF v_role = 'Planning' AND NEW.file_type NOT IN ('DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER') THEN
            RAISE EXCEPTION 'Planning department is not permitted to upload file type %.', NEW.file_type;
        ELSIF v_role = 'PE-MFG' AND NEW.file_type NOT IN ('CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER') THEN
            RAISE EXCEPTION 'PE-MFG department is not permitted to upload file type %.', NEW.file_type;
        ELSIF v_role = 'QA' AND NEW.file_type NOT IN ('CHECK_SHEET', 'NG_PHOTO', 'OTHER') THEN
            RAISE EXCEPTION 'QA department is not permitted to upload file type %.', NEW.file_type;
        END IF;

        -- R7-01: UNCONDITIONALLY force upload_status to PENDING for all client inserts
        -- Even if client explicitly passed READY, FAILED, or NULL!
        NEW.upload_status := 'PENDING';
        NEW.last_error := NULL;
        NEW.last_retry_at := NULL;

        RETURN NEW;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_attachment_integrity_r7 ON public.attachments;
DROP TRIGGER IF EXISTS trg_enforce_attachment_integrity_r8 ON public.attachments;
CREATE TRIGGER trg_enforce_attachment_integrity_r8
BEFORE INSERT OR UPDATE ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_attachment_integrity_r8();


-- ------------------------------------------------------------------------------
-- 5. R7-01 & R7-05: TRUSTED CONFIRM, FAIL, AND RETRY RPC FUNCTIONS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_attachment_upload_r8(p_attachment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_exists boolean;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Active internal account required.';
    END IF;

    SELECT id, file_path, uploaded_by, upload_status INTO v_att
    FROM public.attachments
    WHERE id = p_attachment_id;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    -- Uploader or Admin authorization
    IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can confirm upload.';
    END IF;

    -- Must be in PENDING status
    IF v_att.upload_status != 'PENDING' THEN
        RAISE EXCEPTION 'Cannot confirm attachment in % status (must be PENDING).', v_att.upload_status;
    END IF;

    -- Verify physical existence in storage.objects
    SELECT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'sample-documents' AND name = v_att.file_path
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Storage object % does not exist in sample-documents. Cannot mark READY.', v_att.file_path;
    END IF;

    -- Execute transition under trusted session flag
    PERFORM set_config('sample_tracking.trusted_upload_action', 'true', true);

    UPDATE public.attachments
    SET upload_status = 'READY',
        last_error = NULL
    WHERE id = p_attachment_id;

    PERFORM set_config('sample_tracking.trusted_upload_action', 'false', true);

    RETURN jsonb_build_object('success', true, 'status', 'READY', 'id', p_attachment_id);
END $$;

CREATE OR REPLACE FUNCTION public.fail_attachment_upload_r8(p_attachment_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Active internal account required.';
    END IF;

    SELECT id, uploaded_by, upload_status INTO v_att
    FROM public.attachments
    WHERE id = p_attachment_id;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can mark upload failed.';
    END IF;

    PERFORM set_config('sample_tracking.trusted_upload_action', 'true', true);

    UPDATE public.attachments
    SET upload_status = 'FAILED',
        last_error = p_error
    WHERE id = p_attachment_id;

    PERFORM set_config('sample_tracking.trusted_upload_action', 'false', true);

    RETURN jsonb_build_object('success', true, 'status', 'FAILED', 'id', p_attachment_id, 'error', p_error);
END $$;

-- R7-05: Controlled Retry Function
CREATE OR REPLACE FUNCTION public.retry_attachment_upload_r8(p_attachment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_job_status public.job_status;
    v_role public.user_role;
    v_storage_exists BOOLEAN;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Active internal account required.';
    END IF;

    SELECT a.id, a.job_id, a.file_path, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    -- Uploader or Admin check
    IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can retry upload.';
    END IF;

    -- Verify Job is ACTIVE
    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot retry upload on % JOB (only ACTIVE jobs permit uploads).', v_att.job_status;
    END IF;

    -- Already READY
    IF v_att.upload_status = 'READY' THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', 'READY',
            'id', p_attachment_id,
            'message', 'Attachment is already verified as READY.'
        );
    END IF;

    -- Check if object exists in storage
    SELECT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'sample-documents' AND name = v_att.file_path
    ) INTO v_storage_exists;

    PERFORM set_config('sample_tracking.trusted_upload_action', 'true', true);

    IF v_storage_exists THEN
        -- Object already uploaded and present -> Mark READY directly
        UPDATE public.attachments
        SET upload_status = 'READY',
            last_error = NULL,
            last_retry_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = p_attachment_id;

        PERFORM set_config('sample_tracking.trusted_upload_action', 'false', true);

        RETURN jsonb_build_object(
            'success', true,
            'status', 'READY',
            'id', p_attachment_id,
            'action', 'RECOVERED_TO_READY',
            'message', 'Storage object verified and marked READY.'
        );
    ELSE
        -- Object not in storage -> Reset status to PENDING so client can re-upload binary
        UPDATE public.attachments
        SET upload_status = 'PENDING',
            last_error = NULL,
            last_retry_at = timezone('Asia/Ho_Chi_Minh', now())
        WHERE id = p_attachment_id;

        PERFORM set_config('sample_tracking.trusted_upload_action', 'false', true);

        RETURN jsonb_build_object(
            'success', true,
            'status', 'PENDING',
            'id', p_attachment_id,
            'action', 'RESET_TO_PENDING',
            'message', 'Attachment reset to PENDING. Client may upload binary object now.'
        );
    END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.confirm_attachment_upload_r8(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.confirm_attachment_upload_r8(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fail_attachment_upload_r8(UUID, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fail_attachment_upload_r8(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.retry_attachment_upload_r8(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.retry_attachment_upload_r8(UUID) FROM PUBLIC, anon;
