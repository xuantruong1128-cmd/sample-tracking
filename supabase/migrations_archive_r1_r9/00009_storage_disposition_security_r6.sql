-- R6 targeted security patch: append after 00008; requires disposable Supabase validation.
-- Strict evidence binding: register attachment metadata first, then upload the exact object.
-- Unregistered objects cannot be read or signed by authenticated clients.

CREATE OR REPLACE FUNCTION public.validate_attachment_binding_r6()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage
AS $$
DECLARE
  v_job uuid;
  v_parts text[];
BEGIN
  v_parts := string_to_array(NEW.file_path, '/');
  IF array_length(v_parts, 1) <> 3
     OR v_parts[1] <> NEW.job_id::text
     OR v_parts[2] <> NEW.file_type::text
     OR length(v_parts[3]) = 0
     OR v_parts[3] IN ('.', '..')
     OR position('\' in v_parts[3]) > 0 THEN
    RAISE EXCEPTION 'Attachment path must match job_id/file_type/filename';
  END IF;
  IF NEW.operation_id IS NOT NULL THEN
    SELECT job_id INTO v_job FROM public.job_operations WHERE id = NEW.operation_id;
    IF v_job IS DISTINCT FROM NEW.job_id THEN
      RAISE EXCEPTION 'Attachment operation belongs to another JOB';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Attachment binding is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_attachment_binding_r6 ON public.attachments;
CREATE TRIGGER trg_validate_attachment_binding_r6
BEFORE INSERT OR UPDATE ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.validate_attachment_binding_r6();

CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_file_path_r6 ON public.attachments(file_path);

-- Remove broad historical and R5 policies explicitly.
DROP POLICY IF EXISTS "storage_sample_docs_select_r5" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_r5" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_update_admin_only_r5" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_delete_admin_only_r5" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_select_active" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_select_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_active" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_insert_authorized_r4" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_update_admin_only" ON storage.objects;
DROP POLICY IF EXISTS "storage_sample_docs_delete_admin_only" ON storage.objects;

-- Direct reads and direct signing are only possible for registered objects.
-- A universally enforced 300s signing TTL is NOT guaranteed by RLS.
CREATE POLICY "storage_registered_read_r6" ON storage.objects
FOR SELECT TO authenticated
USING (
 bucket_id = 'sample-documents'
 AND public.is_user_active()
 AND EXISTS (
   SELECT 1 FROM public.attachments a
   JOIN public.jobs j ON j.id = a.job_id
   WHERE a.file_path = storage.objects.name
     AND j.status <> 'PURGED'
     AND a.job_id::text = (storage.foldername(storage.objects.name))[1]
     AND a.file_type::text = (storage.foldername(storage.objects.name))[2]
     AND public.get_current_user_role() IN ('Admin', 'Planning', 'PE-MFG', 'QA')
 )
);

-- Pre-registration: attachment row must exist and uploader/department must match.
CREATE POLICY "storage_registered_upload_r6" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
 bucket_id = 'sample-documents'
 AND public.is_user_active()
 AND EXISTS (
   SELECT 1 FROM public.attachments a
   JOIN public.jobs j ON j.id = a.job_id
   WHERE a.file_path = storage.objects.name
     AND j.status = 'ACTIVE'
     AND a.uploaded_by = auth.uid()
     AND a.owning_department = public.get_current_user_role()
     AND a.job_id::text = (storage.foldername(storage.objects.name))[1]
     AND a.file_type::text = (storage.foldername(storage.objects.name))[2]
 )
);

-- Files are immutable. Replacement requires a separately audited admin procedure.
-- No UPDATE or DELETE policies are created.


-- Future QA event ordering must use server-controlled creation time.
CREATE OR REPLACE FUNCTION public.stamp_qa_creation_r6()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_qa_creation_r6 ON public.qa_checks;
CREATE TRIGGER trg_stamp_qa_creation_r6
BEFORE INSERT ON public.qa_checks
FOR EACH ROW EXECUTE FUNCTION public.stamp_qa_creation_r6();

-- Replace the R5 operation trigger with a strict QA-linked disposition condition.
-- Preserve all other R5 rules by patching its function definition in the migration
-- (see generated R6 SQL below).

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
            ORDER BY created_at DESC, id DESC
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
                      AND qa_check_id = v_latest_qa.id
                      AND decision_timestamp >= v_latest_qa.created_at
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
