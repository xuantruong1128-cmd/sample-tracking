-- ============================================================================
-- Migration: 00019_workflow_v2_job_lifecycle_rules.sql
-- Description: Align enforce_job_rules with Workflow V2:
-- Allow PE-MFG Leader and Admin to transition ACTIVE -> CLOSE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_job_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_del_id UUID;
BEGIN
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        v_role := public.get_current_user_role();
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'ACTIVE' THEN
            RAISE EXCEPTION 'New jobs must be created with status ACTIVE (attempted: %).', NEW.status;
        END IF;

        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Only Planning or Admin can create new jobs.';
        END IF;

        NEW.created_by := auth.uid();
        NEW.closed_at := NULL;
        NEW.closed_by := NULL;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Assignment changes: Planning or Admin only
        IF NEW.pe_owner_id IS DISTINCT FROM OLD.pe_owner_id OR
           NEW.pe_delegates IS DISTINCT FROM OLD.pe_delegates THEN
            IF v_role NOT IN ('Planning', 'Admin') THEN
                RAISE EXCEPTION 'Only Planning or Admin can assign PE Owner or delegates for JOB %.', NEW.id;
            END IF;

            IF NEW.pe_owner_id IS NOT NULL THEN
                IF NOT EXISTS (
                    SELECT 1 FROM public.profiles
                    WHERE id = NEW.pe_owner_id AND role = 'PE-MFG' AND is_active = TRUE
                ) THEN
                    RAISE EXCEPTION 'PE Owner % must be an active user with role PE-MFG.', NEW.pe_owner_id;
                END IF;
            END IF;

            IF NEW.pe_delegates IS NOT NULL AND array_length(NEW.pe_delegates, 1) > 0 THEN
                FOREACH v_del_id IN ARRAY NEW.pe_delegates LOOP
                    IF NOT EXISTS (
                        SELECT 1 FROM public.profiles
                        WHERE id = v_del_id AND role = 'PE-MFG' AND is_active = TRUE
                    ) THEN
                        RAISE EXCEPTION 'PE delegate % must be an active user with role PE-MFG.', v_del_id;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        -- Exhaustive JOB status transition state machine
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            -- 1. Explicitly block skipping intermediate states (fail closed)
            IF OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVE' THEN
                RAISE EXCEPTION 'Invalid JOB status transition: ACTIVE cannot transition directly to ARCHIVE. Job must be closed first (ACTIVE -> CLOSE -> ARCHIVE).';
            END IF;
            IF OLD.status = 'ACTIVE' AND NEW.status = 'PURGED' THEN
                RAISE EXCEPTION 'Invalid JOB status transition: ACTIVE cannot transition directly to PURGED. Job must be closed and archived first.';
            END IF;
            IF OLD.status = 'CLOSE' AND NEW.status = 'PURGED' THEN
                RAISE EXCEPTION 'Invalid JOB status transition: CLOSE cannot transition directly to PURGED. Job must be archived first.';
            END IF;

            -- 2. Explicitly block PURGED transition
            IF NEW.status = 'PURGED' THEN
                RAISE EXCEPTION 'Transition to PURGED is blocked: verified archive confirmation process is not yet implemented (scheduled for future release)';
            END IF;

            -- 3. Closing Job: ACTIVE -> CLOSE (PE-MFG Leader or Admin)
            IF OLD.status = 'ACTIVE' AND NEW.status = 'CLOSE' THEN
                IF NOT (v_role = 'Admin' OR (v_role = 'PE-MFG' AND public.is_department_leader('PE-MFG'))) THEN
                    RAISE EXCEPTION 'Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên mới có quyền Đóng Lệnh sản xuất (Close JOB).';
                END IF;
                NEW.closed_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.closed_by := auth.uid();

            -- 4. Archiving: CLOSE -> ARCHIVE (Admin only)
            ELSIF OLD.status = 'CLOSE' AND NEW.status = 'ARCHIVE' THEN
                IF v_role != 'Admin' THEN
                    RAISE EXCEPTION 'Only Admin can transition a CLOSED job to ARCHIVE.';
                END IF;

            -- 5. Any other status transition is rejected
            ELSE
                RAISE EXCEPTION 'Invalid JOB status transition from % to %.', OLD.status, NEW.status;
            END IF;
        END IF;

        -- Immutable closed job attributes
        IF OLD.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
            IF NEW.job_no IS DISTINCT FROM OLD.job_no OR
               NEW.part_no IS DISTINCT FROM OLD.part_no OR
               NEW.order_qty IS DISTINCT FROM OLD.order_qty OR
               NEW.planned_start_date IS DISTINCT FROM OLD.planned_start_date OR
               NEW.planned_finish_date IS DISTINCT FROM OLD.planned_finish_date OR
               NEW.pe_owner_id IS DISTINCT FROM OLD.pe_owner_id OR
               NEW.pe_delegates IS DISTINCT FROM OLD.pe_delegates THEN
                RAISE EXCEPTION 'JOB % is in status % and is immutable.', OLD.id, OLD.status;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;
