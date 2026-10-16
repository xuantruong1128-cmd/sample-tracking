-- ==============================================================================
-- SAMPLE TRACKING V1.0 — MIGRATION REPAIR & BASELINE RESTORATION SCRIPT
-- Script: scripts/migration-repair-baseline.sql
--
-- TARGET STATES:
--   State B: Databases stopped before 00009/00010 with existing CLOSED jobs.
--   State C: Databases that failed while applying 00010 because lines 97-115 fired
--            trg_lock_ops_r4 / trg_lock_qa_r4, throwing:
--            "Operation locked: Parent JOB ... is not ACTIVE"
--   State D: Fresh databases or test databases needing verified historical baseline.
--
-- PURPOSE:
--   Allow sequential migration 00010 to run without being blocked by closed job locks,
--   preserving all historical evidence, closed job immutability, and without modifying
--   historical migration files 00001 through 00011.
-- ==============================================================================

BEGIN;

-- 1. Create maintenance context schema if not present yet
CREATE SCHEMA IF NOT EXISTS sample_tracking_internal;
REVOKE ALL ON SCHEMA sample_tracking_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA sample_tracking_internal TO postgres, service_role;

CREATE TABLE IF NOT EXISTS sample_tracking_internal.execution_context (
    txid BIGINT NOT NULL,
    context_name TEXT NOT NULL,
    token UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (txid, context_name)
);

REVOKE ALL ON TABLE sample_tracking_internal.execution_context FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE sample_tracking_internal.execution_context TO postgres, service_role;

-- 2. Define or patch check_job_active_status_r4 with maintenance awareness
CREATE OR REPLACE FUNCTION public.check_job_active_status_r4()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_target_job_id UUID;
    v_job_status public.job_status;
    v_is_maintenance BOOLEAN := FALSE;
BEGIN
    -- Check if maintenance mode is active in internal context or session
    SELECT EXISTS (
        SELECT 1 FROM sample_tracking_internal.execution_context
        WHERE txid = txid_current() AND context_name = 'MAINTENANCE'
    ) INTO v_is_maintenance;

    IF v_is_maintenance THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    -- Standard active status validation
    IF TG_TABLE_NAME = 'jobs' THEN
        IF TG_OP = 'UPDATE' THEN
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

-- 3. Enter maintenance mode for backfill
INSERT INTO sample_tracking_internal.execution_context (txid, context_name)
VALUES (txid_current(), 'MAINTENANCE')
ON CONFLICT (txid, context_name) DO NOTHING;

-- 4. Safely backfill event_seq if column exists on qa_checks
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'qa_checks' AND column_name = 'event_seq'
    ) THEN
        WITH ordered_qa AS (
            SELECT id, operation_id,
                   row_number() OVER (PARTITION BY operation_id ORDER BY created_at ASC, id ASC) AS seq
            FROM public.qa_checks
            WHERE event_seq IS NULL
        )
        UPDATE public.qa_checks q
        SET event_seq = o.seq
        FROM ordered_qa o
        WHERE q.id = o.id;

        UPDATE public.qa_checks SET event_seq = 1 WHERE event_seq IS NULL;
    END IF;
END $$;

-- 5. Safely align qa_event_counter if column exists on job_operations
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'job_operations' AND column_name = 'qa_event_counter'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'qa_checks' AND column_name = 'event_seq'
    ) THEN
        UPDATE public.job_operations op
        SET qa_event_counter = COALESCE((
            SELECT max(event_seq) FROM public.qa_checks WHERE operation_id = op.id
        ), 0);
    END IF;
END $$;

-- 6. Exit maintenance mode
DELETE FROM sample_tracking_internal.execution_context
WHERE txid = txid_current() AND context_name = 'MAINTENANCE';

COMMIT;

-- ==============================================================================
-- INSTRUCTIONS FOR STATE C RECOVERY:
-- 1. Execute this script in Supabase SQL Editor:
--    \i scripts/migration-repair-baseline.sql
-- 2. Resume migrations:
--    supabase migration up
--    (00010, 00011, and 00012 will now apply cleanly without lock violation)
-- ==============================================================================
