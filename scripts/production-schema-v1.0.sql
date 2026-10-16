-- =============================================================================
-- SAMPLE TRACKING V1.0 — COMPLETE CONSOLIDATED PRODUCTION DATABASE SCHEMA
-- Auto-generated from migrations 00001 through 00025
-- =============================================================================

-- >>> MIGRATION: 00001_v1_clean_baseline.sql <<<
-- ==============================================================================
-- SAMPLE TRACKING V1.0 — CLEAN DATABASE BASELINE
-- Migration: 00001_v1_clean_baseline.sql
-- Description: Unified V1.0 baseline schema, RLS policies, manufacturing workflow,
--              audit triggers, private storage, and trusted attachment lifecycle.
-- Timezone context: Asia/Ho_Chi_Minh (+07:00)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. CUSTOM TYPES & ENUMS
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('Planning', 'PE-MFG', 'QA', 'Admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE public.job_status AS ENUM ('ACTIVE', 'CLOSE', 'ARCHIVE', 'PURGED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_status') THEN
        -- Standard 4-state manufacturing routing status (dead QA states eliminated)
        CREATE TYPE public.operation_status AS ENUM (
            'NOT_STARTED',
            'IN_PROGRESS',
            'COMPLETED',
            'HOLD'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qa_result') THEN
        CREATE TYPE public.qa_result AS ENUM ('OK', 'NG', 'KIV');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_type') THEN
        CREATE TYPE public.attachment_type AS ENUM (
            'DRAWING',
            'CHECK_SHEET',
            'SETTING_SHEET',
            'NG_PHOTO',
            'OTHER'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pe_disposition_type') THEN
        CREATE TYPE public.pe_disposition_type AS ENUM (
            'CONTINUE_AS_IS',
            'REWORK_NEXT',
            'TECHNICAL_REVIEW',
            'CUSTOMER_EVALUATION',
            'HOLD'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_upload_status') THEN
        CREATE TYPE public.attachment_upload_status AS ENUM ('PENDING', 'READY', 'FAILED');
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. CORE APPLICATION TABLES
-- ------------------------------------------------------------------------------

-- 3.1 PROFILES TABLE (Linked 1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    full_name TEXT NOT NULL,
    role public.user_role NOT NULL,
    department TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    can_make_pe_decisions BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON public.profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_must_change_password ON public.profiles(must_change_password);

-- 3.2 JOBS TABLE
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_no TEXT NOT NULL UNIQUE,
    part_no TEXT NOT NULL,
    part_name TEXT NOT NULL,
    customer TEXT NOT NULL,
    order_qty INTEGER NOT NULL CHECK (order_qty > 0),
    material TEXT NOT NULL,
    planned_start_date DATE NOT NULL,
    planned_finish_date DATE NOT NULL,
    status public.job_status NOT NULL DEFAULT 'ACTIVE',
    pe_owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    pe_delegates UUID[] DEFAULT ARRAY[]::UUID[],
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT chk_planned_dates CHECK (planned_finish_date >= planned_start_date)
);

CREATE INDEX IF NOT EXISTS idx_jobs_job_no ON public.jobs(job_no);
CREATE INDEX IF NOT EXISTS idx_jobs_part_no ON public.jobs(part_no);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_dates ON public.jobs(planned_start_date, planned_finish_date);
CREATE INDEX IF NOT EXISTS idx_jobs_pe_owner_id ON public.jobs(pe_owner_id);

-- 3.3 JOB OPERATIONS TABLE
CREATE TABLE IF NOT EXISTS public.job_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL CHECK (step_order >= 1),
    operation_name TEXT NOT NULL,
    planned_machine TEXT,
    planned_cycle_time_seconds NUMERIC(8, 2),
    status public.operation_status NOT NULL DEFAULT 'NOT_STARTED',
    qa_event_counter BIGINT NOT NULL DEFAULT 0,
    reopened_at TIMESTAMPTZ,
    reopened_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reopen_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT uq_job_step_order UNIQUE (job_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_job_operations_job_id ON public.job_operations(job_id);
CREATE INDEX IF NOT EXISTS idx_job_operations_step_order ON public.job_operations(job_id, step_order);
CREATE INDEX IF NOT EXISTS idx_job_operations_status ON public.job_operations(status);

-- 3.4 PRODUCTION RUNS TABLE (Append-Only)
CREATE TABLE IF NOT EXISTS public.production_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    operator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    operator_name TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    cycle_time_seconds NUMERIC(8, 2),
    ok_qty INTEGER NOT NULL DEFAULT 0 CHECK (ok_qty >= 0),
    ng_qty INTEGER NOT NULL DEFAULT 0 CHECK (ng_qty >= 0),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT chk_run_times CHECK (end_time >= start_time)
);

CREATE INDEX IF NOT EXISTS idx_production_runs_op_id ON public.production_runs(operation_id);
CREATE INDEX IF NOT EXISTS idx_production_runs_time ON public.production_runs(start_time, end_time);

-- 3.5 DEFECT CATALOG TABLE
CREATE TABLE IF NOT EXISTS public.defect_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_vi TEXT NOT NULL,
    name_en TEXT NOT NULL,
    category TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_defect_catalog_code ON public.defect_catalog(code);

-- 3.6 NG DETAILS TABLE
CREATE TABLE IF NOT EXISTS public.ng_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id UUID NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
    defect_id UUID REFERENCES public.defect_catalog(id) ON DELETE SET NULL,
    defect_code TEXT,
    defect_name TEXT NOT NULL,
    ng_qty INTEGER NOT NULL CHECK (ng_qty > 0),
    defect_description TEXT,
    photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_ng_details_run_id ON public.ng_details(production_run_id);

-- 3.7 QA CHECKS TABLE (Append-Only, Immutable)
CREATE TABLE IF NOT EXISTS public.qa_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    production_run_id UUID REFERENCES public.production_runs(id) ON DELETE SET NULL,
    inspector_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    inspector_name TEXT NOT NULL,
    inspection_time TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    sample_size INTEGER NOT NULL CHECK (sample_size > 0),
    ok_qty INTEGER NOT NULL DEFAULT 0 CHECK (ok_qty >= 0),
    ng_qty INTEGER NOT NULL DEFAULT 0 CHECK (ng_qty >= 0),
    result public.qa_result NOT NULL,
    event_seq BIGINT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT chk_qa_quantities CHECK (ok_qty + ng_qty <= sample_size),
    CONSTRAINT uq_qa_checks_operation_event_seq UNIQUE (operation_id, event_seq)
);

CREATE INDEX IF NOT EXISTS idx_qa_checks_op_id ON public.qa_checks(operation_id);
CREATE INDEX IF NOT EXISTS idx_qa_checks_time ON public.qa_checks(inspection_time);
CREATE INDEX IF NOT EXISTS idx_qa_checks_run_id ON public.qa_checks(production_run_id);

-- 3.8 ATTACHMENTS TABLE (Evidence Catalog)
CREATE TABLE IF NOT EXISTS public.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID REFERENCES public.job_operations(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 52428800),
    mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    file_type public.attachment_type NOT NULL,
    upload_status public.attachment_upload_status NOT NULL DEFAULT 'PENDING',
    content_hash VARCHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-fA-F]{64}$'),
    owning_department public.user_role NOT NULL,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    admin_on_behalf BOOLEAN NOT NULL DEFAULT FALSE,
    last_error TEXT,
    last_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_attachments_job_id ON public.attachments(job_id);
CREATE INDEX IF NOT EXISTS idx_attachments_operation_id ON public.attachments(operation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON public.attachments(upload_status);

-- 3.9 PE TECHNICAL DISPOSITIONS TABLE
CREATE TABLE IF NOT EXISTS public.pe_technical_dispositions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    qa_check_id UUID REFERENCES public.qa_checks(id) ON DELETE SET NULL,
    decision_type public.pe_disposition_type NOT NULL,
    technical_reason TEXT NOT NULL CHECK (length(trim(technical_reason)) >= 5),
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

-- 3.10 AUDIT LOGS TABLE (Append-Only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

-- 3.11 JOB ARCHIVES TABLE
CREATE TABLE IF NOT EXISTS public.job_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    archive_name TEXT NOT NULL,
    archive_path TEXT NOT NULL,
    archive_size BIGINT NOT NULL,
    archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_job_archives_job_id ON public.job_archives(job_id);


-- ------------------------------------------------------------------------------
-- 4. PRIVATE STORAGE BUCKET
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'sample-documents',
    'sample-documents',
    FALSE,
    52428800, -- 50 MB
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];


-- ------------------------------------------------------------------------------
-- 5. SECURITY & AUTHORITY HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

-- 5.1 Resolves authentic user role with strict identity protection
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_jwt_role TEXT;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

    -- Direct service_role token (internal backend operations)
    IF v_jwt_role = 'service_role' THEN
        RETURN 'Admin'::public.user_role;
    END IF;

    -- Direct superuser session without JWT
    IF session_user = 'postgres' AND v_uid IS NULL AND v_jwt_role = '' THEN
        RETURN 'Admin'::public.user_role;
    END IF;

    -- Authenticated end-user: look up role from profiles table
    IF v_uid IS NOT NULL THEN
        SELECT role INTO v_role
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        RETURN v_role;
    END IF;

    -- Anonymous or inactive: fail closed
    RETURN NULL;
END;
$$;

-- 5.2 Checks if caller is an active internal account
CREATE OR REPLACE FUNCTION public.is_user_active()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_jwt_role TEXT;
    v_active BOOLEAN;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

    IF v_jwt_role = 'service_role' OR (session_user = 'postgres' AND v_uid IS NULL) THEN
        RETURN TRUE;
    END IF;

    IF v_uid IS NOT NULL THEN
        SELECT is_active INTO v_active
        FROM public.profiles
        WHERE id = v_uid;

        RETURN COALESCE(v_active, FALSE);
    END IF;

    RETURN FALSE;
END;
$$;

-- 5.3 Verifies user has completed mandatory first-login password change
CREATE OR REPLACE FUNCTION public.has_completed_password_change()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_jwt_role TEXT;
    v_must_change BOOLEAN;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

    IF v_jwt_role = 'service_role' OR (session_user = 'postgres' AND v_uid IS NULL) THEN
        RETURN TRUE;
    END IF;

    IF v_uid IS NOT NULL THEN
        SELECT must_change_password INTO v_must_change
        FROM public.profiles
        WHERE id = v_uid;

        -- If must_change_password is true, business operations are denied
        RETURN NOT COALESCE(v_must_change, TRUE);
    END IF;

    RETURN FALSE;
END;
$$;

-- 5.4 Verifies designated PE decision authority for a JOB
CREATE OR REPLACE FUNCTION public.is_authorized_pe_decision_maker(p_job_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_is_active BOOLEAN;
    v_pe_owner UUID;
    v_delegates UUID[];
    v_caller_role public.user_role;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Information disclosure guard: Caller must be an active internal user
    IF NOT public.is_user_active() THEN
        RETURN FALSE;
    END IF;

    -- Non-admin callers can only check their own decision authority unless called from trigger
    v_caller_role := public.get_current_user_role();
    IF v_caller_role != 'Admin' AND auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
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
$$;


-- ------------------------------------------------------------------------------
-- 6. SYSTEM TRIGGERS (TIMESTAMP & AUDITING)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = timezone('Asia/Ho_Chi_Minh', now());
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_timestamp
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER trg_jobs_timestamp
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER trg_job_operations_timestamp
    BEFORE UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE OR REPLACE FUNCTION public.capture_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_entity_id UUID;
    v_old JSONB := NULL;
    v_new JSONB := NULL;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_entity_id := OLD.id;
        v_old := to_jsonb(OLD);
    ELSIF TG_OP = 'UPDATE' THEN
        v_entity_id := NEW.id;
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'INSERT' THEN
        v_entity_id := NEW.id;
        v_new := to_jsonb(NEW);
    END IF;

    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        v_entity_id,
        v_old,
        v_new
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Attach audit log triggers
CREATE TRIGGER trg_audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_job_operations AFTER INSERT OR UPDATE OR DELETE ON public.job_operations FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_production_runs AFTER INSERT OR UPDATE OR DELETE ON public.production_runs FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_qa_checks AFTER INSERT OR UPDATE OR DELETE ON public.qa_checks FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_attachments AFTER INSERT OR UPDATE OR DELETE ON public.attachments FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_pe_dispositions AFTER INSERT OR UPDATE OR DELETE ON public.pe_technical_dispositions FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();
CREATE TRIGGER trg_audit_job_archives AFTER INSERT OR UPDATE OR DELETE ON public.job_archives FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

-- 6.3 Profile Privilege Escalation Guard (B2-01)
CREATE OR REPLACE FUNCTION public.enforce_profile_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_role public.user_role;
    v_is_admin BOOLEAN;
BEGIN
    v_caller_role := public.get_current_user_role();
    v_is_admin := (v_caller_role = 'Admin');

    -- Immutable primary identity and creation fields
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Field id is immutable on profiles.';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Field created_at is immutable on profiles.';
    END IF;

    -- Non-admin users cannot alter privileged authorization attributes
    IF NOT v_is_admin THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Privilege escalation rejected: only Admin can change user role.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Privilege escalation rejected: only Admin can alter is_active status.';
        END IF;
        IF NEW.can_make_pe_decisions IS DISTINCT FROM OLD.can_make_pe_decisions THEN
            RAISE EXCEPTION 'Privilege escalation rejected: only Admin can alter can_make_pe_decisions.';
        END IF;
        IF NEW.phone IS DISTINCT FROM OLD.phone THEN
            RAISE EXCEPTION 'Privilege escalation rejected: only Admin can change phone number.';
        END IF;
        IF NEW.department IS DISTINCT FROM OLD.department THEN
            RAISE EXCEPTION 'Privilege escalation rejected: only Admin can change department.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_profile_update_integrity
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_update_integrity();


-- ------------------------------------------------------------------------------
-- 7. BUSINESS WORKFLOW & IMMUTABILITY TRIGGERS
-- ------------------------------------------------------------------------------

-- 7.1 CLOSED/ARCHIVED Job Immutability Guard
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
            -- Allow valid forward lifecycle transitions to proceed to enforce_job_rules
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
    ELSIF TG_TABLE_NAME = 'pe_technical_dispositions' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    END IF;

    IF auth.role() IN ('authenticated', 'anon') AND v_job_status IS NOT NULL AND v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Operation locked: Parent JOB % is not ACTIVE (current status: %)', v_target_job_id, v_job_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_lock_jobs_active BEFORE UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();
CREATE TRIGGER trg_lock_ops_active BEFORE UPDATE OR DELETE ON public.job_operations FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();
CREATE TRIGGER trg_lock_runs_active BEFORE INSERT OR UPDATE OR DELETE ON public.production_runs FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();
CREATE TRIGGER trg_lock_qa_active BEFORE INSERT OR UPDATE OR DELETE ON public.qa_checks FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();
CREATE TRIGGER trg_lock_attachments_active BEFORE INSERT OR UPDATE OR DELETE ON public.attachments FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();
CREATE TRIGGER trg_lock_dispositions_active BEFORE INSERT OR UPDATE OR DELETE ON public.pe_technical_dispositions FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

-- 7.2 Job Lifecycle & Assignment Rules
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
    v_role := public.get_current_user_role();

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

        -- Exhaustive JOB status transition state machine (Fix 1 Remediation)
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

            -- 2. Explicitly block PURGED transition until verified archive is implemented
            IF NEW.status = 'PURGED' THEN
                RAISE EXCEPTION 'Transition to PURGED is blocked: verified archive confirmation process is not yet implemented (scheduled for future release)';
            END IF;

            -- 3. Closing Job: ACTIVE -> CLOSE
            IF OLD.status = 'ACTIVE' AND NEW.status = 'CLOSE' THEN
                IF v_role NOT IN ('Planning', 'Admin') THEN
                    RAISE EXCEPTION 'Only Planning or Admin can close an ACTIVE job.';
                END IF;
                NEW.closed_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.closed_by := auth.uid();

            -- 4. Archiving: CLOSE -> ARCHIVE (Admin only)
            ELSIF OLD.status = 'CLOSE' AND NEW.status = 'ARCHIVE' THEN
                IF v_role != 'Admin' THEN
                    RAISE EXCEPTION 'Only Admin can transition a CLOSED job to ARCHIVE.';
                END IF;

            -- 5. Any other status transition is rejected (fail closed)
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

CREATE TRIGGER trg_enforce_job_rules
    BEFORE INSERT OR UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_job_rules();

-- 7.3 Production Run Completed Operation & Role Guard (B2-03)
CREATE OR REPLACE FUNCTION public.enforce_production_run_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_op_status public.operation_status;
    v_job_status public.job_status;
    v_role public.user_role;
    v_caller_name TEXT;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role NOT IN ('PE-MFG', 'Admin') THEN
        RAISE EXCEPTION 'Only PE-MFG operators or Admin can record production runs.';
    END IF;

    -- R1-03: Concurrency serialization using operation-row lock
    SELECT jo.status, j.status INTO v_op_status, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = NEW.operation_id
    FOR UPDATE OF jo;

    IF v_op_status IS NULL THEN
        RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot record production runs on % JOB (only ACTIVE jobs permit production).', v_job_status;
    END IF;

    -- B2-03: Completed Operation Immutability
    IF v_op_status = 'COMPLETED' THEN
        RAISE EXCEPTION 'Cannot record production run: operation % is COMPLETED. Authorized PE reopen required before further production.',
            NEW.operation_id;
    END IF;

    IF v_op_status = 'HOLD' THEN
        RAISE EXCEPTION 'Cannot record production run: operation % is on HOLD.', NEW.operation_id;
    END IF;

    -- R1-03: Always stamp operator_id using the authenticated actor (reject caller-supplied forged IDs)
    NEW.operator_id := auth.uid();
    SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = auth.uid();
    NEW.operator_name := COALESCE(v_caller_name, 'Operator');

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_production_run_rules
    BEFORE INSERT ON public.production_runs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_production_run_rules();

-- 7.4 Monotonic QA Check Insertion & Sequence Synchronization (B2-04)
CREATE OR REPLACE FUNCTION public.handle_qa_check_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_current_counter BIGINT;
    v_op_job_id UUID;
    v_job_status public.job_status;
    v_role public.user_role;
    v_run_op_id UUID;
    v_caller_name TEXT;
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

    -- B2-04: QA correlation check: verify production run belongs to the exact same operation
    IF NEW.production_run_id IS NOT NULL THEN
        SELECT operation_id INTO v_run_op_id
        FROM public.production_runs
        WHERE id = NEW.production_run_id;

        IF v_run_op_id IS NULL THEN
            RAISE EXCEPTION 'Referenced production run % does not exist.', NEW.production_run_id;
        END IF;

        IF v_run_op_id != NEW.operation_id THEN
            RAISE EXCEPTION 'QA correlation violation: production run % belongs to operation %, not operation %.',
                NEW.production_run_id, v_run_op_id, NEW.operation_id;
        END IF;
    END IF;

    -- Monotonic event sequence allocation
    NEW.event_seq := COALESCE(v_current_counter, 0) + 1;
    NEW.created_at := timezone('Asia/Ho_Chi_Minh', now());

    -- Server-stamped inspector identity
    NEW.inspector_id := auth.uid();
    SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = auth.uid();
    NEW.inspector_name := COALESCE(v_caller_name, 'QA Inspector');

    -- Synchronize counter on job_operations (nested depth = 2)
    UPDATE public.job_operations
    SET qa_event_counter = NEW.event_seq
    WHERE id = NEW.operation_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_qa_check_before_insert
    BEFORE INSERT ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.handle_qa_check_before_insert();

-- 7.5 Immutable QA Check Guard
CREATE OR REPLACE FUNCTION public.enforce_qa_check_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF auth.role() IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'QA evaluation records are immutable. Direct UPDATE or DELETE is strictly forbidden.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_qa_check_immutability
    BEFORE UPDATE OR DELETE ON public.qa_checks
    FOR EACH ROW EXECUTE FUNCTION public.enforce_qa_check_immutability();

-- 7.6 PE Technical Disposition Integrity & Immutability (B2-04)
CREATE OR REPLACE FUNCTION public.enforce_pe_disposition_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_op_job_id UUID;
    v_qa_op_id UUID;
    v_job_status public.job_status;
    v_caller_name TEXT;
BEGIN
    v_role := public.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Active internal account required.';
    END IF;

    -- Verify caller authority: Admin or authorized PE decision maker
    IF v_role != 'Admin' AND NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
        RAISE EXCEPTION 'Forbidden: User % is not authorized to make PE technical decisions for JOB %.',
            auth.uid(), NEW.job_id;
    END IF;

    -- Verify operation belongs to the specified job
    SELECT jo.job_id, j.status INTO v_op_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = NEW.operation_id;

    IF v_op_job_id IS NULL THEN
        RAISE EXCEPTION 'Referenced operation % does not exist.', NEW.operation_id;
    END IF;

    IF v_op_job_id != NEW.job_id THEN
        RAISE EXCEPTION 'Hierarchy mismatch: operation % belongs to JOB %, not JOB %.',
            NEW.operation_id, v_op_job_id, NEW.job_id;
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot record technical disposition on % JOB (only ACTIVE jobs permit changes).', v_job_status;
    END IF;

    -- Verify QA evidence belongs to the specified operation if provided
    IF NEW.qa_check_id IS NOT NULL THEN
        SELECT qc.operation_id INTO v_qa_op_id
        FROM public.qa_checks qc
        WHERE qc.id = NEW.qa_check_id;

        IF v_qa_op_id IS NULL THEN
            RAISE EXCEPTION 'Referenced QA check % does not exist.', NEW.qa_check_id;
        END IF;

        IF v_qa_op_id != NEW.operation_id THEN
            RAISE EXCEPTION 'QA evidence mismatch: QA check % belongs to operation %, not operation %.',
                NEW.qa_check_id, v_qa_op_id, NEW.operation_id;
        END IF;
    END IF;

    -- Server stamps decision actor and timestamp to prevent client forgery
    NEW.decision_maker := auth.uid();
    NEW.decision_timestamp := timezone('Asia/Ho_Chi_Minh', now());
    NEW.created_at := timezone('Asia/Ho_Chi_Minh', now());

    SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = auth.uid();
    NEW.decision_maker_name := COALESCE(v_caller_name, 'PE Engineer');

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_pe_disposition_rules
    BEFORE INSERT ON public.pe_technical_dispositions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pe_disposition_rules();

CREATE OR REPLACE FUNCTION public.enforce_pe_disposition_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF auth.role() IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'PE technical dispositions are immutable records. Direct UPDATE or DELETE is strictly forbidden.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_pe_disposition_immutability
    BEFORE UPDATE OR DELETE ON public.pe_technical_dispositions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pe_disposition_immutability();

-- 7.5 Operation Workflow & PE Ownership Invariants
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
    v_role := public.get_current_user_role();

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

    IF TG_OP = 'UPDATE' THEN
        IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
            RAISE EXCEPTION 'Unauthorized job_id reassignment is forbidden.';
        END IF;

        -- Protect server-owned qa_event_counter from direct client UPDATE
        -- Only allowed when triggered internally from handle_qa_check_before_insert (depth >= 2)
        IF NEW.qa_event_counter IS DISTINCT FROM OLD.qa_event_counter THEN
            IF pg_trigger_depth() < 2 THEN
                RAISE EXCEPTION 'qa_event_counter is server-owned and cannot be modified by client UPDATE.';
            END IF;
        END IF;

        -- Protect reopen metadata on status-preserving updates
        IF NEW.status = OLD.status THEN
            IF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at OR
               NEW.reopened_by IS DISTINCT FROM OLD.reopened_by OR
               NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason THEN
                RAISE EXCEPTION 'Reopen metadata (reopened_at, reopened_by, reopen_reason) can only be set during authorized operation reopening from COMPLETED to IN_PROGRESS or releasing from HOLD to IN_PROGRESS.';
            END IF;
        END IF;

        -- Status transition validations
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
            ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status NOT IN ('COMPLETED', 'HOLD') THEN
                RAISE EXCEPTION 'Invalid status transition: IN_PROGRESS cannot transition to % (reset to NOT_STARTED is forbidden).', NEW.status;
            ELSIF OLD.status = 'HOLD' AND NEW.status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
                RAISE EXCEPTION 'Invalid status transition: HOLD cannot transition to %.', NEW.status;
            ELSIF OLD.status = 'COMPLETED' AND NEW.status NOT IN ('IN_PROGRESS') THEN
                RAISE EXCEPTION 'Invalid status transition: COMPLETED cannot transition to %.', NEW.status;
            END IF;

            -- Authority checks: Advancing to COMPLETED or HOLD
            IF NEW.status IN ('COMPLETED', 'HOLD') THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'User % is not the designated PE Owner or delegate for JOB %.',
                        auth.uid(), NEW.job_id;
                END IF;
            END IF;

            -- Releasing HOLD to IN_PROGRESS (Fix 2 Remediation)
            IF OLD.status = 'HOLD' AND NEW.status = 'IN_PROGRESS' THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'Only designated PE Owner or delegate can release operation from HOLD for JOB %.', NEW.job_id;
                END IF;

                IF length(trim(COALESCE(NEW.reopen_reason, ''))) < 5 THEN
                    RAISE EXCEPTION 'Releasing operation from HOLD requires a recorded reason (minimum 5 characters in reopen_reason).';
                END IF;

                NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.reopened_by := auth.uid();

            -- Reopening a COMPLETED operation
            ELSIF OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS' THEN
                IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
                    RAISE EXCEPTION 'Only designated PE Owner or delegate can reopen a completed operation for JOB %.', NEW.job_id;
                END IF;

                IF length(trim(COALESCE(NEW.reopen_reason, ''))) < 5 THEN
                    RAISE EXCEPTION 'Reopening a completed operation requires a recorded reopen_reason (minimum 5 characters).';
                END IF;

                NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
                NEW.reopened_by := auth.uid();
            ELSE
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

            -- Latest QA check evaluation
            SELECT id, result, event_seq, created_at
            INTO v_latest_qa
            FROM public.qa_checks
            WHERE operation_id = NEW.id
            ORDER BY event_seq DESC
            LIMIT 1;

            -- If latest QA check is NG or KIV, requires an explicit valid technical disposition
            IF v_latest_qa.id IS NOT NULL AND v_latest_qa.result IN ('NG', 'KIV') THEN
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

        -- B2-05: Operation Field Ownership (QA and PE-MFG must not edit Planning-owned fields)
        IF NEW.operation_name IS DISTINCT FROM OLD.operation_name OR
           NEW.step_order IS DISTINCT FROM OLD.step_order OR
           NEW.planned_machine IS DISTINCT FROM OLD.planned_machine OR
           NEW.planned_cycle_time_seconds IS DISTINCT FROM OLD.planned_cycle_time_seconds THEN

            IF v_role NOT IN ('Planning', 'Admin') THEN
                RAISE EXCEPTION 'Field ownership violation: Only Planning or Admin can modify operation specifications (name, step_order, machine, cycle time). Role % denied.', v_role;
            END IF;

            IF v_role = 'Planning' AND OLD.status != 'NOT_STARTED' THEN
                RAISE EXCEPTION 'Planning cannot alter specifications for operations that have already started (current status: %).', OLD.status;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_op_workflow
    BEFORE INSERT OR UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_workflow_rules();

-- 7.6 Attachment Integrity & Pre-Registration Guard
CREATE OR REPLACE FUNCTION public.enforce_attachment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_caller_uid UUID;
    v_job_status public.job_status;
    v_op_job_id UUID;
    v_parts TEXT[];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- R1-02: READY attachments are strictly immutable (cannot be downgraded, overwritten, or modified)
        IF OLD.upload_status = 'READY' THEN
            RAISE EXCEPTION 'Attachment % is already verified as READY and is strictly immutable.', OLD.id;
        END IF;

        -- Immutable core metadata guard
        IF NEW.job_id IS DISTINCT FROM OLD.job_id OR
           NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
           NEW.file_name IS DISTINCT FROM OLD.file_name OR
           NEW.file_type IS DISTINCT FROM OLD.file_type OR
           NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR
           NEW.owning_department IS DISTINCT FROM OLD.owning_department OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Attachment core metadata is immutable.';
        END IF;

        -- Status transition validation
        IF NEW.upload_status IS DISTINCT FROM OLD.upload_status THEN
            IF OLD.upload_status = 'PENDING' AND NEW.upload_status NOT IN ('READY', 'FAILED') THEN
                RAISE EXCEPTION 'Invalid upload status transition from % to %.', OLD.upload_status, NEW.upload_status;
            ELSIF OLD.upload_status = 'FAILED' AND NEW.upload_status NOT IN ('PENDING') THEN
                RAISE EXCEPTION 'Invalid upload status transition from % to % (must transition to PENDING via retry first).', OLD.upload_status, NEW.upload_status;
            END IF;
        END IF;

        -- R1-02 & F-01: Metadata modification rules without pg_trigger_depth()
        -- ONLY during authorized FAILED -> PENDING retry may file_size, mime_type, content_hash, and file_path be updated!
        IF OLD.upload_status = 'FAILED' AND NEW.upload_status = 'PENDING' THEN
            -- F-01: Retry MUST use a different storage path (reusing existing failed path is strictly forbidden)
            IF NEW.file_path IS NOT DISTINCT FROM OLD.file_path THEN
                RAISE EXCEPTION 'Retry requires a different storage path. Reusing the failed path % is forbidden.', OLD.file_path;
            END IF;

            v_parts := string_to_array(NEW.file_path, '/');
            IF array_length(v_parts, 1) != 3
               OR v_parts[1] != OLD.job_id::text
               OR v_parts[2] != OLD.file_type::text
               OR length(v_parts[3]) = 0
               OR v_parts[3] IN ('.', '..')
               OR position('\' in v_parts[3]) > 0
               OR position('/' in v_parts[3]) > 0 THEN
                RAISE EXCEPTION 'Retry attachment path must strictly match <job_id>/<file_type>/<filename>';
            END IF;

            -- Anti-collision & anti-reuse: disallow reusing storage path of any other attachment
            IF EXISTS (
                SELECT 1 FROM public.attachments
                WHERE file_path = NEW.file_path AND id != OLD.id
            ) THEN
                RAISE EXCEPTION 'Retry storage path % is already in use by another attachment.', NEW.file_path;
            END IF;

            -- Validate new content hash if modified
            IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
                IF NEW.content_hash !~ '^[0-9a-fA-F]{64}$' THEN
                    RAISE EXCEPTION 'New content_hash must be a valid 64-character hexadecimal SHA-256 hash.';
                END IF;
                NEW.content_hash := lower(NEW.content_hash);
            END IF;

            -- Validate new file size
            IF NEW.file_size <= 0 OR NEW.file_size > 52428800 THEN
                RAISE EXCEPTION 'File size must be between 1 byte and 50MB.';
            END IF;

            -- Validate new MIME type
            IF NEW.mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
                RAISE EXCEPTION 'MIME type % is not supported. Must be application/pdf, image/jpeg, or image/png.', NEW.mime_type;
            END IF;
        ELSE
            -- In all other cases (e.g. PENDING -> READY, PENDING -> FAILED, or status unchanged), file metadata and path cannot be modified!
            IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
                RAISE EXCEPTION 'Attachment file_path cannot be modified outside of a FAILED-to-PENDING retry.';
            END IF;
            IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
                RAISE EXCEPTION 'Attachment content_hash cannot be modified outside of a FAILED-to-PENDING retry.';
            END IF;
            IF NEW.file_size IS DISTINCT FROM OLD.file_size THEN
                RAISE EXCEPTION 'Attachment file_size cannot be modified outside of a FAILED-to-PENDING retry.';
            END IF;
            IF NEW.mime_type IS DISTINCT FROM OLD.mime_type THEN
                RAISE EXCEPTION 'Attachment mime_type cannot be modified outside of a FAILED-to-PENDING retry.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_caller_uid := auth.uid();
        v_role := public.get_current_user_role();

        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller is not an active internal user.';
        END IF;

        -- uploaded_by ALWAYS records the authentic actor (auth.uid())
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

        -- B2-07: Mandatory SHA-256 content_hash validation
        IF NEW.content_hash IS NULL OR NEW.content_hash !~ '^[0-9a-fA-F]{64}$' THEN
            RAISE EXCEPTION 'Attachment rejected: valid 64-character hexadecimal SHA-256 content_hash is mandatory.';
        END IF;
        NEW.content_hash := lower(NEW.content_hash);

        -- UNCONDITIONALLY force upload_status to PENDING for all client inserts
        NEW.upload_status := 'PENDING';
        NEW.last_error := NULL;
        NEW.last_retry_at := NULL;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_attachment_integrity
    BEFORE INSERT OR UPDATE ON public.attachments
    FOR EACH ROW EXECUTE FUNCTION public.enforce_attachment_integrity();


-- ------------------------------------------------------------------------------
-- 8. CANONICAL RPC FUNCTIONS FOR ATTACHMENT LIFECYCLE
-- ------------------------------------------------------------------------------

-- 8.1 Confirm Upload: transitions PENDING -> READY after physical verification (B2-02)
CREATE OR REPLACE FUNCTION public.confirm_attachment_upload(p_attachment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_jwt_role TEXT;
    v_exists BOOLEAN;
    v_obj_size BIGINT;
    v_updated_count INT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

    -- B2-02: Only service_role (invoked by verify-and-confirm-upload Edge Function) or superuser can execute this
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        RAISE EXCEPTION 'Forbidden: Only the trusted server verification authority can confirm upload.';
    END IF;

    SELECT a.id, a.job_id, a.file_path, a.file_size, a.content_hash, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot confirm upload on % JOB (only ACTIVE jobs permit attachment operations).', v_att.job_status;
    END IF;

    IF v_att.upload_status != 'PENDING' THEN
        RAISE EXCEPTION 'Cannot confirm attachment in % status (must be PENDING).', v_att.upload_status;
    END IF;

    -- B2-07: Mandatory SHA-256 digest validation
    IF v_att.content_hash IS NULL OR v_att.content_hash !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Attachment missing valid SHA-256 digest. Cannot confirm READY.';
    END IF;

    -- Verify physical existence in storage.objects
    SELECT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'sample-documents' AND name = v_att.file_path
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Storage object % does not exist in sample-documents. Cannot mark READY.', v_att.file_path;
    END IF;

    -- Verify file size if storage object metadata is accessible
    SELECT (metadata->>'size')::bigint INTO v_obj_size
    FROM storage.objects
    WHERE bucket_id = 'sample-documents' AND name = v_att.file_path
    LIMIT 1;

    IF v_obj_size IS NOT NULL AND v_obj_size > 0 AND v_obj_size != v_att.file_size THEN
        RAISE EXCEPTION 'Storage object size (%) does not match declared attachment metadata size (%).',
            v_obj_size, v_att.file_size;
    END IF;

    UPDATE public.attachments
    SET upload_status = 'READY',
        last_error = NULL
    WHERE id = p_attachment_id AND upload_status = 'PENDING';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Concurrent modification conflict while confirming attachment %.', p_attachment_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'READY', 'id', p_attachment_id);
END;
$$;

-- 8.2 Fail Upload: strictly rejects transitioning READY attachments to FAILED
CREATE OR REPLACE FUNCTION public.fail_attachment_upload(p_attachment_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_updated_count INT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        v_role := public.get_current_user_role();
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Active internal account required.';
        END IF;
    END IF;

    SELECT a.id, a.job_id, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot alter attachment on % JOB (only ACTIVE jobs permit attachment operations).', v_att.job_status;
    END IF;

    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
            RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can mark upload failed.';
        END IF;
    END IF;

    -- CRITICAL ANTI-DOWNGRADE GUARD: READY attachments can never be downgraded to FAILED!
    IF v_att.upload_status != 'PENDING' THEN
        RAISE EXCEPTION 'Cannot mark attachment as FAILED: current status is % (only PENDING attachments can fail).',
            v_att.upload_status;
    END IF;

    UPDATE public.attachments
    SET upload_status = 'FAILED',
        last_error = COALESCE(p_error, 'Client upload failed')
    WHERE id = p_attachment_id AND upload_status = 'PENDING';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Concurrent modification conflict while failing attachment %.', p_attachment_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'FAILED', 'id', p_attachment_id, 'error', p_error);
END;
$$;

-- 8.3 Retry Upload: reconciles attachment metadata and resets to PENDING (B2-02, B2-07, Fix 3)
CREATE OR REPLACE FUNCTION public.retry_attachment_upload(
    p_attachment_id UUID,
    p_new_size BIGINT DEFAULT NULL,
    p_new_mime TEXT DEFAULT NULL,
    p_new_hash VARCHAR(64) DEFAULT NULL,
    p_new_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_new_path TEXT;
    v_sanitized_name TEXT;
    v_old_path TEXT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        v_role := public.get_current_user_role();
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Active internal account required.';
        END IF;
    END IF;

    SELECT a.id, a.job_id, a.file_name, a.file_path, a.file_size, a.file_type, a.mime_type, a.content_hash, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot retry upload on % JOB (only ACTIVE jobs permit uploads).', v_att.job_status;
    END IF;

    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
            RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can retry upload.';
        END IF;
    END IF;

    -- R1-02: Strict READY immutability & retry requirements
    IF v_att.upload_status = 'READY' THEN
        RAISE EXCEPTION 'Attachment % is already verified as READY and is strictly immutable.', p_attachment_id;
    END IF;

    IF v_att.upload_status != 'FAILED' THEN
        RAISE EXCEPTION 'Cannot retry attachment % in % status (only FAILED attachments can be retried).',
            p_attachment_id, v_att.upload_status;
    END IF;

    -- Validate new hash format if provided
    IF p_new_hash IS NOT NULL AND p_new_hash !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Invalid hash format: SHA-256 must be 64 hexadecimal characters.';
    END IF;

    -- Validate new size if provided
    IF p_new_size IS NOT NULL AND (p_new_size <= 0 OR p_new_size > 52428800) THEN
        RAISE EXCEPTION 'Invalid file size: % bytes (must be between 1 byte and 50MB).', p_new_size;
    END IF;

    -- Validate new MIME if provided
    IF p_new_mime IS NOT NULL AND p_new_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
        RAISE EXCEPTION 'Invalid MIME type: %. Must be application/pdf, image/jpeg, or image/png.', p_new_mime;
    END IF;

    -- Fix 3: Resolve fresh storage path to strictly prevent collisions with prior failed upload attempts
    v_old_path := v_att.file_path;
    IF p_new_path IS NOT NULL AND length(trim(p_new_path)) > 0 THEN
        v_new_path := trim(p_new_path);
        IF v_new_path = v_old_path THEN
            RAISE EXCEPTION 'Retry requires a different storage path. Reusing the failed path % is forbidden.', v_old_path;
        END IF;
    ELSE
        v_sanitized_name := regexp_replace(v_att.file_name, '[/\\ ]+', '_', 'g');
        v_new_path := v_att.job_id::text || '/' || v_att.file_type::text || '/r' ||
                      floor(extract(epoch from now()))::text || '_' ||
                      substr(md5(random()::text), 1, 6) || '_' ||
                      v_sanitized_name;
    END IF;

    -- Always reset status from FAILED to PENDING so server verification authority can verify bytes before READY.
    UPDATE public.attachments
    SET upload_status = 'PENDING',
        file_path = v_new_path,
        file_size = COALESCE(p_new_size, file_size),
        mime_type = COALESCE(p_new_mime, mime_type),
        content_hash = COALESCE(lower(p_new_hash), content_hash),
        last_error = NULL,
        last_retry_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_attachment_id AND upload_status = 'FAILED';

    RETURN jsonb_build_object(
        'success', true,
        'status', 'PENDING',
        'id', p_attachment_id,
        'file_path', v_new_path,
        'old_file_path', v_old_path,
        'action', 'RESET_TO_PENDING',
        'message', 'Attachment reset to PENDING with collision-free storage path. Verification via verify-and-confirm-upload required before READY.'
    );
END;
$$;

-- 8.4 Complete First-Login Password Change (Mandatory temporary password replacement)
-- Cryptographically validates that the user has actually updated their credentials in Supabase Auth
-- and prevents direct client-side RPC bypass without GoTrue password update.
CREATE OR REPLACE FUNCTION public.complete_first_login_password_change(p_new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_encrypted_pwd TEXT;
    v_hash_salt TEXT;
    v_is_still_temp BOOLEAN;
    v_matches_new BOOLEAN;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_active = TRUE) THEN
        RAISE EXCEPTION 'User profile is inactive or missing.';
    END IF;

    IF trim(COALESCE(p_new_password, '')) = '123456' THEN
        RAISE EXCEPTION 'New password cannot be identical to the temporary initial password (123456).';
    END IF;

    IF p_new_password IS NULL OR length(trim(p_new_password)) < 8 THEN
        RAISE EXCEPTION 'New password must be at least 8 characters long.';
    END IF;

    -- Query current stored encrypted password from auth.users (owned by auth schema)
    SELECT encrypted_password INTO v_encrypted_pwd
    FROM auth.users
    WHERE id = v_uid;

    IF v_encrypted_pwd IS NULL OR length(trim(v_encrypted_pwd)) = 0 THEN
        RAISE EXCEPTION 'Authentication credentials not found in identity provider.';
    END IF;

    -- Standardize bcrypt prefix for pgcrypto compatibility ($2b$ -> $2a$)
    v_hash_salt := replace(v_encrypted_pwd, '$2b$', '$2a$');

    -- Server-side cryptographic verification 1:
    -- Reject if the stored password in auth.users is still the initial temporary password (123456)
    BEGIN
        v_is_still_temp := (crypt('123456', v_hash_salt) = v_hash_salt);
    EXCEPTION WHEN OTHERS THEN
        v_is_still_temp := FALSE;
    END;

    IF v_is_still_temp = TRUE THEN
        RAISE EXCEPTION 'Password has not been updated in authentication service. You must update your password via auth service before completing setup.';
    END IF;

    -- Server-side cryptographic verification 2:
    -- Verify that the stored password in auth.users actually matches p_new_password
    BEGIN
        v_matches_new := (crypt(p_new_password, v_hash_salt) = v_hash_salt);
    EXCEPTION WHEN OTHERS THEN
        v_matches_new := FALSE;
    END;

    IF v_matches_new IS NOT TRUE THEN
        RAISE EXCEPTION 'Provided password does not match current authenticated credentials in authentication service.';
    END IF;

    UPDATE public.profiles
    SET must_change_password = FALSE,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = v_uid;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_values, created_at)
    VALUES (
        v_uid,
        'PASSWORD_CHANGE_COMPLETED',
        'profiles',
        v_uid,
        jsonb_build_object('must_change_password', false),
        timezone('Asia/Ho_Chi_Minh', now())
    );

    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'message', 'Password change completed successfully.');
END;
$$;


-- ------------------------------------------------------------------------------
-- 9. POSTGRESQL PRIVILEGE ENFORCEMENT (DATABASE PERMISSIONS)
-- ------------------------------------------------------------------------------

-- 9.1 Profiles privilege restrictions (B2-01)
REVOKE UPDATE, DELETE, INSERT ON public.profiles FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, email) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO postgres, service_role;

-- 9.2 Production runs privilege restrictions (B2-03)
REVOKE UPDATE, DELETE ON public.production_runs FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT ON public.production_runs TO authenticated;
GRANT ALL ON public.production_runs TO postgres, service_role;

-- 9.3 Attachments privilege restrictions (B2-02)
REVOKE UPDATE, DELETE ON public.attachments FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT ON public.attachments TO authenticated;
GRANT ALL ON public.attachments TO postgres, service_role;

-- 9.4 QA checks privilege restrictions (B2-04)
REVOKE UPDATE, DELETE ON public.qa_checks FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT ON public.qa_checks TO authenticated;
GRANT ALL ON public.qa_checks TO postgres, service_role;

-- 9.5 PE technical dispositions privilege restrictions (B2-04)
REVOKE UPDATE, DELETE ON public.pe_technical_dispositions FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT ON public.pe_technical_dispositions TO authenticated;
GRANT ALL ON public.pe_technical_dispositions TO postgres, service_role;

-- 9.6 Audit logs privilege restrictions
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO postgres, service_role;

-- 9.7 Trigger functions execute privilege revocation (R1-06)
-- Trigger functions must NOT be callable by clients via PostgREST /rpc/
REVOKE EXECUTE ON FUNCTION public.update_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_audit_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_update_integrity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_job_active_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_job_rules() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_production_run_rules() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_qa_check_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_qa_check_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_pe_disposition_rules() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_pe_disposition_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_operation_workflow_rules() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_attachment_integrity() FROM PUBLIC, anon, authenticated;

-- 9.8 Helper functions execute privileges (R1-06)
REVOKE EXECUTE ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_user_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_user_active() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_completed_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_completed_password_change() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_authorized_pe_decision_maker(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_pe_decision_maker(UUID, UUID) TO authenticated, service_role;

-- 9.9 RPC function execute privileges
-- B2-02: confirm_attachment_upload revoked from authenticated, granted ONLY to service_role
REVOKE EXECUTE ON FUNCTION public.confirm_attachment_upload(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.confirm_attachment_upload(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fail_attachment_upload(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_attachment_upload(UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.retry_attachment_upload(UUID, BIGINT, TEXT, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_attachment_upload(UUID, BIGINT, TEXT, VARCHAR, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.complete_first_login_password_change(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_first_login_password_change(TEXT) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ng_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pe_technical_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_archives ENABLE ROW LEVEL SECURITY;

-- 10.1 PROFILES POLICIES
CREATE POLICY "profiles_select_active" ON public.profiles FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "profiles_update_self_or_admin" ON public.profiles FOR UPDATE TO authenticated
    USING (public.is_user_active() = TRUE AND (id = auth.uid() OR public.get_current_user_role() = 'Admin'))
    WITH CHECK (public.is_user_active() = TRUE AND (id = auth.uid() OR public.get_current_user_role() = 'Admin'));

-- 10.2 JOBS POLICIES
CREATE POLICY "jobs_select_active" ON public.jobs FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "jobs_insert_planning_admin" ON public.jobs FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    );

CREATE POLICY "jobs_update_planning_admin" ON public.jobs FOR UPDATE TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    )
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    );

-- 10.3 JOB OPERATIONS POLICIES
CREATE POLICY "job_operations_select_active" ON public.job_operations FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "job_operations_insert_planning_admin" ON public.job_operations FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin') AND
        EXISTS (SELECT 1 FROM public.jobs WHERE id = job_operations.job_id AND status = 'ACTIVE')
    );

CREATE POLICY "job_operations_update_authorized" ON public.job_operations FOR UPDATE TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'PE-MFG', 'QA', 'Admin') AND
        EXISTS (SELECT 1 FROM public.jobs WHERE id = job_operations.job_id AND status = 'ACTIVE')
    )
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        EXISTS (SELECT 1 FROM public.jobs WHERE id = job_operations.job_id AND status = 'ACTIVE')
    );

-- 10.4 PRODUCTION RUNS POLICIES (Append-Only)
CREATE POLICY "production_runs_select_active" ON public.production_runs FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "production_runs_insert_pe_admin" ON public.production_runs FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('PE-MFG', 'Admin') AND
        EXISTS (
            SELECT 1 FROM public.job_operations jo
            JOIN public.jobs j ON j.id = jo.job_id
            WHERE jo.id = production_runs.operation_id AND j.status = 'ACTIVE'
        )
    );

-- 10.5 DEFECT CATALOG POLICIES
CREATE POLICY "defect_catalog_select_active" ON public.defect_catalog FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "defect_catalog_manage_qa_admin" ON public.defect_catalog FOR ALL TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('QA', 'Admin')
    )
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('QA', 'Admin')
    );

-- 10.6 NG DETAILS POLICIES
CREATE POLICY "ng_details_select_active" ON public.ng_details FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "ng_details_insert_pe_admin" ON public.ng_details FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('PE-MFG', 'Admin')
    );

-- 10.7 QA CHECKS POLICIES (Append-Only)
CREATE POLICY "qa_checks_select_active" ON public.qa_checks FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "qa_checks_insert_qa_admin" ON public.qa_checks FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('QA', 'Admin') AND
        EXISTS (
            SELECT 1 FROM public.job_operations jo
            JOIN public.jobs j ON j.id = jo.job_id
            WHERE jo.id = qa_checks.operation_id AND j.status = 'ACTIVE'
        )
    );

-- 10.8 ATTACHMENTS POLICIES (Option A Universal Read)
CREATE POLICY "attachments_select_option_a" ON public.attachments FOR SELECT TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Admin', 'Planning', 'PE-MFG', 'QA') AND
        EXISTS (SELECT 1 FROM public.jobs WHERE id = attachments.job_id AND status != 'PURGED')
    );

CREATE POLICY "attachments_insert_authorized" ON public.attachments FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Admin', 'Planning', 'PE-MFG', 'QA') AND
        EXISTS (SELECT 1 FROM public.jobs WHERE id = attachments.job_id AND status = 'ACTIVE')
    );

-- 10.9 PE TECHNICAL DISPOSITIONS POLICIES
CREATE POLICY "pe_dispositions_select_active" ON public.pe_technical_dispositions FOR SELECT TO authenticated
    USING (public.is_user_active() = TRUE AND public.has_completed_password_change() = TRUE);

CREATE POLICY "pe_dispositions_insert_pe_admin" ON public.pe_technical_dispositions FOR INSERT TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        (public.get_current_user_role() = 'Admin' OR public.is_authorized_pe_decision_maker(job_id, auth.uid())) AND
        EXISTS (SELECT 1 FROM public.jobs WHERE id = pe_technical_dispositions.job_id AND status = 'ACTIVE')
    );

-- 10.10 AUDIT LOGS POLICIES
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs FOR SELECT TO authenticated
    USING (public.get_current_user_role() = 'Admin');

-- 10.11 JOB ARCHIVES POLICIES
CREATE POLICY "job_archives_select_planning_admin" ON public.job_archives FOR SELECT TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.has_completed_password_change() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    );

CREATE POLICY "job_archives_manage_admin" ON public.job_archives FOR ALL TO authenticated
    USING (public.get_current_user_role() = 'Admin')
    WITH CHECK (public.get_current_user_role() = 'Admin');


-- ------------------------------------------------------------------------------
-- 11. STORAGE ROW LEVEL SECURITY POLICIES (sample-documents)
-- ------------------------------------------------------------------------------

-- 11.1 Option A Universal Read Access for Registered READY Documents
CREATE POLICY "storage_registered_read_option_a" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.attachments a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.file_path = storage.objects.name
          AND a.upload_status = 'READY'
          AND j.status != 'PURGED'
          AND public.get_current_user_role() IN ('Admin', 'Planning', 'PE-MFG', 'QA')
    )
);

-- 11.2 Pre-Registered Upload Access
CREATE POLICY "storage_registered_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.attachments a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.file_path = storage.objects.name
          AND a.upload_status = 'PENDING'
          AND a.uploaded_by = auth.uid()
          AND j.status = 'ACTIVE'
          AND a.job_id::text = (storage.foldername(storage.objects.name))[1]
          AND a.file_type::text = (storage.foldername(storage.objects.name))[2]
    )
);


-- >>> MIGRATION: 00002_fix_attachment_service_role.sql <<<
-- Migration 00002: Enable service_role execution for fail_attachment_upload and retry_attachment_upload
-- Enables Edge Functions running under service_role to mark attachment uploads as FAILED or PENDING during verification

CREATE OR REPLACE FUNCTION public.fail_attachment_upload(p_attachment_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_updated_count INT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        v_role := public.get_current_user_role();
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Active internal account required.';
        END IF;
    END IF;

    SELECT a.id, a.job_id, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot alter attachment on % JOB (only ACTIVE jobs permit attachment operations).', v_att.job_status;
    END IF;

    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
            RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can mark upload failed.';
        END IF;
    END IF;

    -- CRITICAL ANTI-DOWNGRADE GUARD: READY attachments can never be downgraded to FAILED!
    IF v_att.upload_status != 'PENDING' THEN
        RAISE EXCEPTION 'Cannot mark attachment as FAILED: current status is % (only PENDING attachments can fail).',
            v_att.upload_status;
    END IF;

    UPDATE public.attachments
    SET upload_status = 'FAILED',
        last_error = COALESCE(p_error, 'Client upload failed')
    WHERE id = p_attachment_id AND upload_status = 'PENDING';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Concurrent modification conflict while failing attachment %.', p_attachment_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'FAILED', 'id', p_attachment_id, 'error', p_error);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_attachment_upload(
    p_attachment_id UUID,
    p_new_size BIGINT DEFAULT NULL,
    p_new_mime TEXT DEFAULT NULL,
    p_new_hash VARCHAR(64) DEFAULT NULL,
    p_new_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_new_path TEXT;
    v_sanitized_name TEXT;
    v_old_path TEXT;
BEGIN
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        v_role := public.get_current_user_role();
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Active internal account required.';
        END IF;
    END IF;

    SELECT a.id, a.job_id, a.file_name, a.file_path, a.file_size, a.file_type, a.mime_type, a.content_hash, a.uploaded_by, a.upload_status, j.status AS job_status
    INTO v_att
    FROM public.attachments a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_attachment_id
    FOR UPDATE OF a;

    IF v_att.id IS NULL THEN
        RAISE EXCEPTION 'Attachment % not found.', p_attachment_id;
    END IF;

    IF v_att.job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Cannot retry upload on % JOB (only ACTIVE jobs permit uploads).', v_att.job_status;
    END IF;

    IF v_jwt_role != 'service_role' AND current_user != 'postgres' THEN
        IF v_role != 'Admin' AND v_att.uploaded_by != auth.uid() THEN
            RAISE EXCEPTION 'Forbidden: Only the original uploader or Admin can retry upload.';
        END IF;
    END IF;

    -- R1-02: Strict READY immutability & retry requirements
    IF v_att.upload_status = 'READY' THEN
        RAISE EXCEPTION 'Attachment % is already verified as READY and is strictly immutable.', p_attachment_id;
    END IF;

    IF v_att.upload_status != 'FAILED' THEN
        RAISE EXCEPTION 'Cannot retry attachment % in % status (only FAILED attachments can be retried).',
            p_attachment_id, v_att.upload_status;
    END IF;

    -- Validate new hash format if provided
    IF p_new_hash IS NOT NULL AND p_new_hash !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Invalid hash format: SHA-256 must be 64 hexadecimal characters.';
    END IF;

    -- Validate new size if provided
    IF p_new_size IS NOT NULL AND (p_new_size <= 0 OR p_new_size > 52428800) THEN
        RAISE EXCEPTION 'Invalid file size: % bytes (must be between 1 byte and 50MB).', p_new_size;
    END IF;

    -- Validate new MIME if provided
    IF p_new_mime IS NOT NULL AND p_new_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
        RAISE EXCEPTION 'Invalid MIME type: %. Must be application/pdf, image/jpeg, or image/png.', p_new_mime;
    END IF;

    -- Fix 3: Resolve fresh storage path to strictly prevent collisions with prior failed upload attempts
    v_old_path := v_att.file_path;
    IF p_new_path IS NOT NULL AND length(trim(p_new_path)) > 0 THEN
        v_new_path := trim(p_new_path);
        IF v_new_path = v_old_path THEN
            RAISE EXCEPTION 'Retry requires a different storage path. Reusing the failed path % is forbidden.', v_old_path;
        END IF;
    ELSE
        v_sanitized_name := regexp_replace(v_att.file_name, '[/\\ ]+', '_', 'g');
        v_new_path := v_att.job_id::text || '/' || v_att.file_type::text || '/r' ||
                      floor(extract(epoch from now()))::text || '_' ||
                      substr(md5(random()::text), 1, 6) || '_' ||
                      v_sanitized_name;
    END IF;

    -- Always reset status from FAILED to PENDING so server verification authority can verify bytes before READY.
    UPDATE public.attachments
    SET upload_status = 'PENDING',
        file_path = v_new_path,
        file_size = COALESCE(p_new_size, file_size),
        mime_type = COALESCE(p_new_mime, mime_type),
        content_hash = COALESCE(lower(p_new_hash), content_hash),
        last_error = NULL,
        last_retry_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_attachment_id AND upload_status = 'FAILED';

    RETURN jsonb_build_object(
        'success', true,
        'status', 'PENDING',
        'id', p_attachment_id,
        'file_path', v_new_path,
        'old_file_path', v_old_path,
        'action', 'RESET_TO_PENDING',
        'message', 'Attachment reset to PENDING with collision-free storage path. Verification via verify-and-confirm-upload required before READY.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fail_attachment_upload(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_attachment_upload(UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.retry_attachment_upload(UUID, BIGINT, TEXT, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_attachment_upload(UUID, BIGINT, TEXT, VARCHAR, TEXT) TO authenticated, service_role;


-- >>> MIGRATION: 00003_add_job_creation_support.sql <<<
-- ==============================================================================
-- SAMPLE TRACKING V1.0 — BASIC JOB CREATION & ATOMIC ROUTING (UAT BLOCKER 01)
-- Migration: 00003_add_job_creation_support.sql
-- Description:
--   1. Additive column: material_spec on public.jobs
--   2. Atomic transaction function: public.create_job_with_routing
--   Enforces server-side permissions (Planning/Admin only), unique job_no,
--   valid quantities, date constraints, and all-or-nothing routing persistence.
-- ==============================================================================

-- 1. ADDITIVE SCHEMA: Material Specification
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS material_spec TEXT;

-- 2. ATOMIC JOB & ROUTING CREATION STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.create_job_with_routing(
    p_job_no TEXT,
    p_part_no TEXT,
    p_part_name TEXT,
    p_customer TEXT,
    p_order_qty INTEGER,
    p_material TEXT,
    p_material_spec TEXT,
    p_planned_start_date DATE,
    p_planned_finish_date DATE,
    p_operations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_job_id UUID;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_op_name TEXT;
    v_machine TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
        RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
    END IF;

    v_role := public.get_current_user_role();
    IF v_role NOT IN ('Planning', 'Admin') THEN
        RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
    END IF;

    -- 2. Input Validation
    IF p_job_no IS NULL OR length(trim(p_job_no)) = 0 THEN
        RAISE EXCEPTION 'Mã JOB không được để trống.';
    END IF;

    IF p_part_no IS NULL OR length(trim(p_part_no)) = 0 THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu phải là số nguyên dương lớn hơn 0 (nhận được: %).', p_order_qty;
    END IF;

    IF p_planned_start_date IS NULL THEN
        RAISE EXCEPTION 'Ngày bắt đầu kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date IS NULL THEN
        RAISE EXCEPTION 'Ngày hoàn thành kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày hoàn thành (%s) không được nhỏ hơn ngày bắt đầu (%s).', p_planned_finish_date, p_planned_start_date;
    END IF;

    -- Duplicate Job Code check (case-insensitive)
    IF EXISTS (SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(trim(p_job_no))) THEN
        RAISE EXCEPTION 'Mã JOB "%" đã tồn tại trong hệ thống. Vui lòng chọn mã khác.', trim(p_job_no);
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Job Insertion
    INSERT INTO public.jobs (
        job_no,
        part_no,
        part_name,
        customer,
        order_qty,
        material,
        material_spec,
        planned_start_date,
        planned_finish_date,
        status,
        created_by
    ) VALUES (
        trim(p_job_no),
        trim(p_part_no),
        COALESCE(NULLIF(trim(p_part_name), ''), trim(p_part_no)),
        COALESCE(trim(p_customer), ''),
        p_order_qty,
        COALESCE(trim(p_material), 'Chưa xác định'),
        NULLIF(trim(p_material_spec), ''),
        p_planned_start_date,
        p_planned_finish_date,
        'ACTIVE',
        auth.uid()
    ) RETURNING * INTO v_created_job;

    v_job_id := v_created_job.id;

    -- 4. Atomic Operations Insertion
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;
        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, v_idx + 1);
        v_op_name := trim(COALESCE(v_op_item ->> 'operation_name', ''));
        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'planned_machine', '')), '');

        IF v_op_name = '' THEN
            RAISE EXCEPTION 'Tên công đoạn tại bước thứ % không được để trống.', v_idx + 1;
        END IF;

        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            status
        ) VALUES (
            v_job_id,
            v_step_order,
            v_op_name,
            v_machine,
            'NOT_STARTED'
        );
    END LOOP;

    -- Return JSON payload of created job with operations
    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'job_no', v_created_job.job_no,
        'part_no', v_created_job.part_no,
        'part_name', v_created_job.part_name,
        'status', v_created_job.status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO authenticated;


-- >>> MIGRATION: 00004_job_creation_service_role.sql <<<
-- ==============================================================================
-- SAMPLE TRACKING V1.0 — SUPPORT SERVICE_ROLE FOR JOB CREATION
-- Migration: 00004_job_creation_service_role.sql
-- Description:
--   Enables service_role / backend integration runners to invoke
--   create_job_with_routing directly while preserving strict RLS & password
--   change enforcement for all authenticated end-user requests.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_job_with_routing(
    p_job_no TEXT,
    p_part_no TEXT,
    p_part_name TEXT,
    p_customer TEXT,
    p_order_qty INTEGER,
    p_material TEXT,
    p_material_spec TEXT,
    p_planned_start_date DATE,
    p_planned_finish_date DATE,
    p_operations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_job_id UUID;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_op_name TEXT;
    v_machine TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role = 'service_role' OR current_user IN ('service_role', 'postgres') THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 2. Input Validation
    IF p_job_no IS NULL OR length(trim(p_job_no)) = 0 THEN
        RAISE EXCEPTION 'Mã JOB không được để trống.';
    END IF;

    IF p_part_no IS NULL OR length(trim(p_part_no)) = 0 THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu phải là số nguyên dương lớn hơn 0 (nhận được: %).', p_order_qty;
    END IF;

    IF p_planned_start_date IS NULL THEN
        RAISE EXCEPTION 'Ngày bắt đầu kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date IS NULL THEN
        RAISE EXCEPTION 'Ngày hoàn thành kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày hoàn thành (%s) không được nhỏ hơn ngày bắt đầu (%s).', p_planned_finish_date, p_planned_start_date;
    END IF;

    -- Duplicate Job Code check (case-insensitive)
    IF EXISTS (SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(trim(p_job_no))) THEN
        RAISE EXCEPTION 'Mã JOB "%" đã tồn tại trong hệ thống. Vui lòng chọn mã khác.', trim(p_job_no);
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Job Insertion
    INSERT INTO public.jobs (
        job_no,
        part_no,
        part_name,
        customer,
        order_qty,
        material,
        material_spec,
        planned_start_date,
        planned_finish_date,
        status,
        created_by
    ) VALUES (
        trim(p_job_no),
        trim(p_part_no),
        COALESCE(NULLIF(trim(p_part_name), ''), trim(p_part_no)),
        COALESCE(trim(p_customer), ''),
        p_order_qty,
        COALESCE(trim(p_material), 'Chưa xác định'),
        NULLIF(trim(p_material_spec), ''),
        p_planned_start_date,
        p_planned_finish_date,
        'ACTIVE',
        auth.uid()
    ) RETURNING * INTO v_created_job;

    v_job_id := v_created_job.id;

    -- 4. Atomic Operations Insertion
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;
        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, v_idx + 1);
        v_op_name := trim(COALESCE(v_op_item ->> 'operation_name', ''));
        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'planned_machine', '')), '');

        IF v_op_name = '' THEN
            RAISE EXCEPTION 'Tên công đoạn tại bước thứ % không được để trống.', v_idx + 1;
        END IF;

        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            status
        ) VALUES (
            v_job_id,
            v_step_order,
            v_op_name,
            v_machine,
            'NOT_STARTED'
        );
    END LOOP;

    -- Return JSON payload of created job with operations
    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'job_no', v_created_job.job_no,
        'part_no', v_created_job.part_no,
        'part_name', v_created_job.part_name,
        'status', v_created_job.status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO service_role;


-- >>> MIGRATION: 00005_ui03_workcenter_and_routing_enhancement.sql <<<
-- ==============================================================================
-- SAMPLE TRACKING V1.0 — UI-03: WORKCENTER MASTER & ROUTING ENHANCEMENT
-- Migration: 00005_ui03_workcenter_and_routing_enhancement.sql
-- Description:
--   1. Create public.workcenter_master with official 37 entries from Master data.xlsx
--   2. Add additive columns to public.job_operations:
--      - workcenter_code VARCHAR(10)
--      - description TEXT
--      - machine_no TEXT
--      - remark TEXT
--   3. Enhance public.create_job_with_routing atomic procedure to persist
--      all 6 routing fields (Operation seq 10, 20..., Workcenter, Description,
--      Cycle Time Target, Machine No., Remark) with strict validation.
-- ==============================================================================

-- 1. WORKCENTER MASTER TABLE
CREATE TABLE IF NOT EXISTS public.workcenter_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stt INTEGER,
    code VARCHAR(10) NOT NULL,
    mc_type TEXT,
    description TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_workcenter_master_code ON public.workcenter_master(code);
CREATE INDEX IF NOT EXISTS idx_workcenter_master_active ON public.workcenter_master(is_active);

-- Populate official master records (37 rows from Master data.xlsx) if empty
INSERT INTO public.workcenter_master (stt, code, mc_type, description)
SELECT stt, code, mc_type, description
FROM (VALUES
    (1, 'CAMC', 'CAM', 'Auto Turn'),
    (2, 'B12C', 'Cincom B12', 'Auto Turn'),
    (3, 'A20C', 'Cincom citizent A20', 'Auto Turn'),
    (4, 'CYGG', 'Cilindrical Grinding', 'Auto Turn'),
    (5, 'D&TS', 'Drilling and Tapping', 'Drill & Tap'),
    (6, 'B26C', 'Tsugami BO265', 'Auto Turn'),
    (7, 'L32C', 'Cincom Citizent L32', 'Auto Turn'),
    (8, 'L20C', 'Tsugami L20', 'Auto Turn'),
    (9, 'L16C', 'Tsugami L16', 'Auto Turn'),
    (10, 'B18C', 'Tsugami B18', 'Auto Turn'),
    (11, 'SR2C', 'Star SR20', 'Auto Turn'),
    (12, 'SB2C', 'Star SB20R', 'Auto Turn'),
    (13, 'SR3C', 'Star SR32', 'Auto Turn'),
    (14, 'CGMG', 'Paragon RC12', 'Centerless Grinding'),
    (15, 'CGMG', 'Paragon RC20', 'Centerless Grinding'),
    (16, 'CGMG', 'DX18 CNC CG', 'Centerless Grinding'),
    (17, 'CGMG', 'DX18 CG', 'Centerless Grinding'),
    (18, 'D&TS', 'Fanuc', 'Drill & Tap'),
    (19, 'SPMS', 'SPM', 'Milling'),
    (20, 'KURS', 'Rolling/Knurling', 'Rolling/Knurling'),
    (21, 'IDHL', 'Induction Hardening', 'Induction Hardening'),
    (22, 'FINS', 'Buffing', 'Buffing'),
    (23, 'STAS', 'Stacking', 'Stacking'),
    (24, 'TMBS', 'Tumbling', 'Tumbling'),
    (25, 'TMBS', 'Magnetic polishing', 'Magnetic polishing'),
    (26, 'FINS', 'Chamfering', 'Chamfering'),
    (27, 'FINS', 'Polishing', 'Polishing'),
    (28, 'ASYS', 'Assembly', 'Assembly'),
    (29, 'MYNC', 'STS Chucker', 'STS Chucker'),
    (30, 'GCMN', 'Gear cutting', 'Gear cutting'),
    (31, 'AUTP', 'Plating', 'Plating'),
    (32, 'MANP', 'Plating', 'Plating'),
    (33, 'PLPP', 'Plating', 'Plating'),
    (34, 'WSHP', 'Washing', 'Washing'),
    (35, 'Subcon', 'Subcon', 'Subcon'),
    (36, 'VMIC', 'Inspection 100%', 'Inspection 100%'),
    (37, 'VMIQ', 'Visual check', 'Visual check')
) AS v(stt, code, mc_type, description)
WHERE NOT EXISTS (SELECT 1 FROM public.workcenter_master LIMIT 1);

-- RLS Policies on public.workcenter_master
ALTER TABLE public.workcenter_master ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'workcenter_master' AND policyname = 'p_workcenter_master_read'
    ) THEN
        CREATE POLICY p_workcenter_master_read
            ON public.workcenter_master FOR SELECT
            TO authenticated, anon
            USING (true);
    END IF;
END $$;

-- 2. ADDITIVE SCHEMA ON public.job_operations
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS workcenter_code VARCHAR(10);
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS machine_no TEXT;
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS remark TEXT;

-- 3. ENHANCED ATOMIC JOB & ROUTING CREATION STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.create_job_with_routing(
    p_job_no TEXT,
    p_part_no TEXT,
    p_part_name TEXT,
    p_customer TEXT,
    p_order_qty INTEGER,
    p_material TEXT,
    p_material_spec TEXT,
    p_planned_start_date DATE,
    p_planned_finish_date DATE,
    p_operations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_job_id UUID;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_wc_code TEXT;
    v_desc TEXT;
    v_cycle_time NUMERIC;
    v_machine TEXT;
    v_remark TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role = 'service_role' OR current_user IN ('service_role', 'postgres') THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 2. Input Validation
    IF p_job_no IS NULL OR length(trim(p_job_no)) = 0 THEN
        RAISE EXCEPTION 'Mã JOB không được để trống.';
    END IF;

    IF p_part_no IS NULL OR length(trim(p_part_no)) = 0 THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu phải là số nguyên dương lớn hơn 0 (nhận được: %).', p_order_qty;
    END IF;

    IF p_planned_start_date IS NULL THEN
        RAISE EXCEPTION 'Ngày bắt đầu kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date IS NULL THEN
        RAISE EXCEPTION 'Ngày hoàn thành kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày hoàn thành (%s) không được nhỏ hơn ngày bắt đầu (%s).', p_planned_finish_date, p_planned_start_date;
    END IF;

    -- Duplicate Job Code check (case-insensitive)
    IF EXISTS (SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(trim(p_job_no))) THEN
        RAISE EXCEPTION 'Mã JOB "%" đã tồn tại trong hệ thống. Vui lòng chọn mã khác.', trim(p_job_no);
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Job Insertion
    INSERT INTO public.jobs (
        job_no,
        part_no,
        part_name,
        customer,
        order_qty,
        material,
        material_spec,
        planned_start_date,
        planned_finish_date,
        status,
        created_by
    ) VALUES (
        trim(p_job_no),
        trim(p_part_no),
        COALESCE(NULLIF(trim(p_part_name), ''), trim(p_part_no)),
        COALESCE(trim(p_customer), ''),
        p_order_qty,
        COALESCE(trim(p_material), 'Chưa xác định'),
        NULLIF(trim(p_material_spec), ''),
        p_planned_start_date,
        p_planned_finish_date,
        'ACTIVE',
        auth.uid()
    ) RETURNING * INTO v_created_job;

    v_job_id := v_created_job.id;

    -- 4. Atomic Operations Insertion
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;

        -- Step order / Sequence (supports 10, 20, 30... or custom)
        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, (v_idx + 1) * 10);
        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        -- Workcenter Code & Description
        v_wc_code := NULLIF(trim(COALESCE(v_op_item ->> 'workcenter_code', '')), '');
        v_desc := NULLIF(trim(COALESCE(v_op_item ->> 'description', v_op_item ->> 'operation_name', '')), '');

        -- Fallback if only one is provided
        IF v_wc_code IS NULL AND v_desc IS NOT NULL THEN
            v_wc_code := v_desc;
        END IF;

        IF v_wc_code IS NULL THEN
            RAISE EXCEPTION 'Vui lòng chọn mã Workcenter cho công đoạn tại bước thứ %.', v_idx + 1;
        END IF;

        IF v_desc IS NULL THEN
            -- Lookup description from master if available
            SELECT description INTO v_desc
            FROM public.workcenter_master
            WHERE code = v_wc_code
            LIMIT 1;
            
            IF v_desc IS NULL THEN
                v_desc := v_wc_code;
            END IF;
        END IF;

        -- Cycle Time Target (must be positive if present)
        IF (v_op_item ->> 'planned_cycle_time_seconds') IS NOT NULL AND length(trim(v_op_item ->> 'planned_cycle_time_seconds')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'planned_cycle_time_seconds')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Cycle Time Target tại bước thứ % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSIF (v_op_item ->> 'cycle_time') IS NOT NULL AND length(trim(v_op_item ->> 'cycle_time')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'cycle_time')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Cycle Time Target tại bước thứ % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSE
            v_cycle_time := NULL;
        END IF;

        -- Machine No. & Remark
        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'machine_no', v_op_item ->> 'planned_machine', '')), '');
        v_remark := NULLIF(trim(COALESCE(v_op_item ->> 'remark', '')), '');

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            planned_cycle_time_seconds,
            workcenter_code,
            description,
            machine_no,
            remark,
            status
        ) VALUES (
            v_job_id,
            v_step_order,
            v_desc,
            v_machine,
            v_cycle_time,
            v_wc_code,
            v_desc,
            v_machine,
            v_remark,
            'NOT_STARTED'
        );
    END LOOP;

    -- Return JSON payload of created job with operations
    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'job_no', v_created_job.job_no,
        'part_no', v_created_job.part_no,
        'part_name', v_created_job.part_name,
        'status', v_created_job.status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO service_role;


-- >>> MIGRATION: 00006_ui03_r3_auto_job_code_generation.sql <<<
-- ============================================================================
-- Migration: 00006_ui03_r3_auto_job_code_generation.sql
-- Description: Implement concurrency-safe, monthly auto-generation for JOB Codes
-- Format: YYYYMM-NNN (Vietnam timezone Asia/Ho_Chi_Minh, reset each month to 001,
-- monotonic increment, unbounded beyond 999 to 1000+, transaction-atomic allocation)
-- ============================================================================

-- 1. MONTHLY JOB CODE COUNTER TABLE
CREATE TABLE IF NOT EXISTS public.job_code_sequences (
    year_month VARCHAR(6) PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.job_code_sequences ENABLE ROW LEVEL SECURITY;

-- Read policy: Authenticated and Anon can read counter metadata (for preview check)
DROP POLICY IF EXISTS "job_code_sequences_read" ON public.job_code_sequences;
CREATE POLICY "job_code_sequences_read" ON public.job_code_sequences
    FOR SELECT TO authenticated, anon
    USING (true);

-- Ensure Unique Index on jobs(job_no) (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_job_no_case_insensitive ON public.jobs (lower(trim(job_no)));

-- Synchronize counter with any pre-existing historical jobs in public.jobs
INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
SELECT
    substring(trim(job_no) from '^([0-9]{6})-') AS ym,
    MAX(substring(trim(job_no) from '^[0-9]{6}-([0-9]+)$')::INTEGER) AS max_seq,
    NOW()
FROM public.jobs
WHERE trim(job_no) ~ '^[0-9]{6}-[0-9]+$'
GROUP BY substring(trim(job_no) from '^([0-9]{6})-')
ON CONFLICT (year_month) DO UPDATE
SET last_seq = GREATEST(public.job_code_sequences.last_seq, EXCLUDED.last_seq),
    updated_at = NOW();

-- 2. ATOMIC CODE ALLOCATION FUNCTION (Transactional, Monotonic, Concurrency-Safe)
CREATE OR REPLACE FUNCTION public.allocate_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_year_month VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Authorization Guard: Only Planning, Admin, or service_role can allocate JOB codes
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user NOT IN ('service_role', 'postgres') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Planning hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền cấp mã JOB (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- Determine year_month in Vietnam timezone Asia/Ho_Chi_Minh (+07)
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');

    -- Concurrency-Safe Atomic Upsert with row-lock & monotonic sequence allocation
    LOOP
        INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
        VALUES (v_year_month, 1, NOW())
        ON CONFLICT (year_month)
        DO UPDATE SET
            last_seq = public.job_code_sequences.last_seq + 1,
            updated_at = NOW()
        RETURNING last_seq INTO v_allocated_seq;

        -- Format: YYYYMM-NNN (Pads to at least 3 digits when < 1000; for >= 1000 formats as YYYYMM-1000 without capping)
        IF v_allocated_seq < 1000 THEN
            v_seq_str := LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        -- Guarantee that allocated code never collides with any existing job (historical or closed)
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- Revoke public access, allow authenticated execution (role guard inside)
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO authenticated;

-- 3. PREVIEW JOB CODE FUNCTION (Read-Only, Non-Mutating)
CREATE OR REPLACE FUNCTION public.preview_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year_month VARCHAR(6);
    v_curr_seq INTEGER;
    v_next_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');
    SELECT last_seq INTO v_curr_seq FROM public.job_code_sequences WHERE year_month = v_year_month;
    v_next_seq := COALESCE(v_curr_seq, 0) + 1;

    LOOP
        IF v_next_seq < 1000 THEN
            v_seq_str := LPAD(v_next_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_next_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
        v_next_seq := v_next_seq + 1;
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO authenticated, anon;

-- 4. ENHANCE CREATE_JOB_WITH_ROUTING TO USE SERVER-SIDE AUTO-GENERATION
-- Prevents frontend from passing arbitrary codes to bypass server generation.
-- Allocates code and creates job in the exact same transaction.
CREATE OR REPLACE FUNCTION public.create_job_with_routing(
    p_job_no TEXT,
    p_part_no TEXT,
    p_part_name TEXT,
    p_customer TEXT,
    p_order_qty INTEGER,
    p_material TEXT,
    p_material_spec TEXT,
    p_planned_start_date DATE,
    p_planned_finish_date DATE,
    p_operations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_job_id UUID;
    v_final_job_no TEXT;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_wc_code TEXT;
    v_desc TEXT;
    v_cycle_time NUMERIC;
    v_machine TEXT;
    v_remark TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role = 'service_role' OR current_user IN ('service_role', 'postgres') THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 2. Input Validation (Excluding job_no because it is strictly auto-generated by server)
    IF p_part_no IS NULL OR length(trim(p_part_no)) = 0 THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu phải là số nguyên dương lớn hơn 0 (nhận được: %).', p_order_qty;
    END IF;

    IF p_planned_start_date IS NULL THEN
        RAISE EXCEPTION 'Ngày bắt đầu kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date IS NULL THEN
        RAISE EXCEPTION 'Ngày hoàn thành kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày hoàn thành (%s) không được nhỏ hơn ngày bắt đầu (%s).', p_planned_finish_date, p_planned_start_date;
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Server-Side Allocation of JOB Code inside Transaction
    -- Ignores client-provided p_job_no to enforce strict server allocation
    v_final_job_no := public.allocate_next_job_code(NOW());

    -- 4. Atomic Job Insertion
    INSERT INTO public.jobs (
        job_no,
        part_no,
        part_name,
        customer,
        order_qty,
        material,
        material_spec,
        planned_start_date,
        planned_finish_date,
        status,
        created_by
    ) VALUES (
        v_final_job_no,
        trim(p_part_no),
        COALESCE(NULLIF(trim(p_part_name), ''), trim(p_part_no)),
        COALESCE(trim(p_customer), ''),
        p_order_qty,
        COALESCE(trim(p_material), 'Chưa xác định'),
        NULLIF(trim(p_material_spec), ''),
        p_planned_start_date,
        p_planned_finish_date,
        'ACTIVE',
        auth.uid()
    ) RETURNING * INTO v_created_job;

    v_job_id := v_created_job.id;

    -- 5. Atomic Operations Insertion
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;

        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, (v_idx + 1) * 10);
        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        v_wc_code := NULLIF(trim(COALESCE(v_op_item ->> 'workcenter_code', '')), '');
        v_desc := NULLIF(trim(COALESCE(v_op_item ->> 'description', v_op_item ->> 'operation_name', '')), '');

        IF v_wc_code IS NULL AND v_desc IS NOT NULL THEN
            v_wc_code := v_desc;
        END IF;

        IF v_wc_code IS NULL THEN
            RAISE EXCEPTION 'Vui lòng chọn mã Workcenter cho công đoạn tại bước thứ %.', v_idx + 1;
        END IF;

        IF v_desc IS NULL THEN
            v_desc := v_wc_code;
        END IF;

        IF (v_op_item ? 'planned_cycle_time_seconds') AND (v_op_item ->> 'planned_cycle_time_seconds') IS NOT NULL AND length(trim(v_op_item ->> 'planned_cycle_time_seconds')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'planned_cycle_time_seconds')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Thời gian chu kỳ (Cycle Time Target) tại bước % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSE
            v_cycle_time := NULL;
        END IF;

        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'machine_no', v_op_item ->> 'planned_machine', '')), '');
        v_remark := NULLIF(trim(COALESCE(v_op_item ->> 'remark', '')), '');

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            planned_cycle_time_seconds,
            status,
            workcenter_code,
            description,
            machine_no,
            remark
        ) VALUES (
            v_job_id,
            v_step_order,
            v_desc,
            v_machine,
            v_cycle_time,
            'NOT_STARTED',
            v_wc_code,
            v_desc,
            v_machine,
            v_remark
        );
    END LOOP;

    RETURN to_jsonb(v_created_job);
END;
$$;

-- Grant execution to authenticated role (internal guards enforce Planning/Admin)
GRANT EXECUTE ON FUNCTION public.create_job_with_routing(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, DATE, DATE, JSONB) TO authenticated;


-- >>> MIGRATION: 00007_ui03_r3_auto_job_code_fix.sql <<<
-- ============================================================================
-- Migration: 00007_ui03_r3_auto_job_code_fix.sql
-- Description: Fix sequence formatting (> 999 unpadded), operation enum status (NOT_STARTED),
-- and authentication check in allocate_next_job_code.
-- ============================================================================

-- 1. ATOMIC CODE ALLOCATION FUNCTION (Corrected LPAD & Auth Guard)
CREATE OR REPLACE FUNCTION public.allocate_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_year_month VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Authorization Guard: Only Planning, Admin, or service_role can allocate JOB codes
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user NOT IN ('service_role', 'postgres') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Planning hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền cấp mã JOB (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- Determine year_month in Vietnam timezone Asia/Ho_Chi_Minh (+07)
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');

    -- Concurrency-Safe Atomic Upsert with row-lock & monotonic sequence allocation
    LOOP
        INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
        VALUES (v_year_month, 1, NOW())
        ON CONFLICT (year_month)
        DO UPDATE SET
            last_seq = public.job_code_sequences.last_seq + 1,
            updated_at = NOW()
        RETURNING last_seq INTO v_allocated_seq;

        -- Format: YYYYMM-NNN (Pads to at least 3 digits when < 1000; for >= 1000 formats as YYYYMM-1000 without capping)
        IF v_allocated_seq < 1000 THEN
            v_seq_str := LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        -- Guarantee that allocated code never collides with any existing job (historical or closed)
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 2. PREVIEW JOB CODE FUNCTION (Corrected LPAD)
CREATE OR REPLACE FUNCTION public.preview_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year_month VARCHAR(6);
    v_curr_seq INTEGER;
    v_next_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');
    SELECT last_seq INTO v_curr_seq FROM public.job_code_sequences WHERE year_month = v_year_month;
    v_next_seq := COALESCE(v_curr_seq, 0) + 1;

    LOOP
        IF v_next_seq < 1000 THEN
            v_seq_str := LPAD(v_next_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_next_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
        v_next_seq := v_next_seq + 1;
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 3. CREATE_JOB_WITH_ROUTING (Corrected NOT_STARTED enum status)
CREATE OR REPLACE FUNCTION public.create_job_with_routing(
    p_job_no TEXT,
    p_part_no TEXT,
    p_part_name TEXT,
    p_customer TEXT,
    p_order_qty INTEGER,
    p_material TEXT,
    p_material_spec TEXT,
    p_planned_start_date DATE,
    p_planned_finish_date DATE,
    p_operations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_job_id UUID;
    v_final_job_no TEXT;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_wc_code TEXT;
    v_desc TEXT;
    v_cycle_time NUMERIC;
    v_machine TEXT;
    v_remark TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role = 'service_role' OR current_user IN ('service_role', 'postgres') THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 2. Input Validation (Excluding job_no because it is strictly auto-generated by server)
    IF p_part_no IS NULL OR length(trim(p_part_no)) = 0 THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu phải là số nguyên dương lớn hơn 0 (nhận được: %).', p_order_qty;
    END IF;

    IF p_planned_start_date IS NULL THEN
        RAISE EXCEPTION 'Ngày bắt đầu kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date IS NULL THEN
        RAISE EXCEPTION 'Ngày hoàn thành kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày hoàn thành (%s) không được nhỏ hơn ngày bắt đầu (%s).', p_planned_finish_date, p_planned_start_date;
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Server-Side Allocation of JOB Code inside Transaction
    v_final_job_no := public.allocate_next_job_code(NOW());

    -- 4. Atomic Job Insertion
    INSERT INTO public.jobs (
        job_no,
        part_no,
        part_name,
        customer,
        order_qty,
        material,
        material_spec,
        planned_start_date,
        planned_finish_date,
        status,
        created_by
    ) VALUES (
        v_final_job_no,
        trim(p_part_no),
        COALESCE(NULLIF(trim(p_part_name), ''), trim(p_part_no)),
        COALESCE(trim(p_customer), ''),
        p_order_qty,
        COALESCE(trim(p_material), 'Chưa xác định'),
        NULLIF(trim(p_material_spec), ''),
        p_planned_start_date,
        p_planned_finish_date,
        'ACTIVE',
        auth.uid()
    ) RETURNING * INTO v_created_job;

    v_job_id := v_created_job.id;

    -- 5. Atomic Operations Insertion (Using NOT_STARTED enum status)
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;

        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, (v_idx + 1) * 10);
        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        v_wc_code := NULLIF(trim(COALESCE(v_op_item ->> 'workcenter_code', '')), '');
        v_desc := NULLIF(trim(COALESCE(v_op_item ->> 'description', v_op_item ->> 'operation_name', '')), '');

        IF v_wc_code IS NULL AND v_desc IS NOT NULL THEN
            v_wc_code := v_desc;
        END IF;

        IF v_wc_code IS NULL THEN
            RAISE EXCEPTION 'Vui lòng chọn mã Workcenter cho công đoạn tại bước thứ %.', v_idx + 1;
        END IF;

        IF v_desc IS NULL THEN
            v_desc := v_wc_code;
        END IF;

        IF (v_op_item ? 'planned_cycle_time_seconds') AND (v_op_item ->> 'planned_cycle_time_seconds') IS NOT NULL AND length(trim(v_op_item ->> 'planned_cycle_time_seconds')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'planned_cycle_time_seconds')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Thời gian chu kỳ (Cycle Time Target) tại bước % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSE
            v_cycle_time := NULL;
        END IF;

        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'machine_no', v_op_item ->> 'planned_machine', '')), '');
        v_remark := NULLIF(trim(COALESCE(v_op_item ->> 'remark', '')), '');

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            planned_cycle_time_seconds,
            status,
            workcenter_code,
            description,
            machine_no,
            remark
        ) VALUES (
            v_job_id,
            v_step_order,
            v_desc,
            v_machine,
            v_cycle_time,
            'NOT_STARTED',
            v_wc_code,
            v_desc,
            v_machine,
            v_remark
        );
    END LOOP;

    RETURN to_jsonb(v_created_job);
END;
$$;


-- >>> MIGRATION: 00008_ui03_r3_auth_guard_fix.sql <<<
-- ============================================================================
-- Migration: 00008_ui03_r3_auth_guard_fix.sql
-- Description: Enforce strict auth and role checking for allocate_next_job_code
-- using auth.role(), session_user, and revoking permissions from anon.
-- ============================================================================

-- 1. Redefine allocate_next_job_code with auth.role() aware authorization guard
CREATE OR REPLACE FUNCTION public.allocate_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_year_month VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Authorization Guard: Only Planning, Admin, or service_role can allocate JOB codes
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        -- Authorized internal backend service_role or direct superuser
    ELSE
        -- Must be an active, authenticated account
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Planning hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền cấp mã JOB (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- Determine year_month in Vietnam timezone Asia/Ho_Chi_Minh (+07)
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');

    -- Concurrency-Safe Atomic Upsert with row-lock & monotonic sequence allocation
    LOOP
        INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
        VALUES (v_year_month, 1, NOW())
        ON CONFLICT (year_month)
        DO UPDATE SET
            last_seq = public.job_code_sequences.last_seq + 1,
            updated_at = NOW()
        RETURNING last_seq INTO v_allocated_seq;

        -- Format: YYYYMM-NNN (Pads to at least 3 digits when < 1000; for >= 1000 formats as YYYYMM-1000 without capping)
        IF v_allocated_seq < 1000 THEN
            v_seq_str := LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        -- Guarantee that allocated code never collides with any existing job (historical or closed)
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 2. Revoke execute on allocate_next_job_code from anon and public; grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO service_role;

-- 3. Grant preview_next_job_code to authenticated, anon, and service_role (read-only preview calculation)
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO service_role;


-- >>> MIGRATION: 00009_ui03_r3_auth_role_guard.sql <<<
-- ============================================================================
-- Migration: 00009_ui03_r3_auth_role_guard.sql
-- Description: Enforce strict auth and role checking for allocate_next_job_code
-- using auth.role(), session_user, and revoking permissions from anon.
-- ============================================================================

-- 1. Redefine allocate_next_job_code with auth.role() aware authorization guard
CREATE OR REPLACE FUNCTION public.allocate_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_year_month VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Authorization Guard: Only Planning, Admin, or service_role can allocate JOB codes
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        -- Authorized internal backend service_role or direct superuser
    ELSE
        -- Must be an active, authenticated account
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Planning hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền cấp mã JOB (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- Determine year_month in Vietnam timezone Asia/Ho_Chi_Minh (+07)
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');

    -- Concurrency-Safe Atomic Upsert with row-lock & monotonic sequence allocation
    LOOP
        INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
        VALUES (v_year_month, 1, NOW())
        ON CONFLICT (year_month)
        DO UPDATE SET
            last_seq = public.job_code_sequences.last_seq + 1,
            updated_at = NOW()
        RETURNING last_seq INTO v_allocated_seq;

        -- Format: YYYYMM-NNN (Pads to at least 3 digits when < 1000; for >= 1000 formats as YYYYMM-1000 without capping)
        IF v_allocated_seq < 1000 THEN
            v_seq_str := LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        -- Guarantee that allocated code never collides with any existing job (historical or closed)
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 2. Revoke execute on allocate_next_job_code from anon and public; grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO service_role;

-- 3. Grant preview_next_job_code to authenticated, anon, and service_role (read-only preview calculation)
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO service_role;


-- >>> MIGRATION: 00010_ui04_production_and_ng_enhancement.sql <<<
-- ============================================================================
-- Migration: 00010_ui04_production_and_ng_enhancement.sql
-- Description: Supports UI-04 Job Detail & Production Result Redesign:
-- 1. Adds kiv_qty, production_date, updated_at to production_runs.
-- 2. Adds cause, remark, updated_at to ng_details.
-- 3. Seeds manufacturing defect catalog with standard defect items.
-- 4. Adds RLS update/delete policies for production_runs and ng_details.
-- 5. Implements atomic RPC save_production_result_with_ng.
-- 6. Implements atomic RPC save_qa_check_result.
-- ============================================================================

-- 1. Schema Enhancements on production_runs
ALTER TABLE public.production_runs
    ADD COLUMN IF NOT EXISTS kiv_qty INTEGER NOT NULL DEFAULT 0 CHECK (kiv_qty >= 0),
    ADD COLUMN IF NOT EXISTS production_date DATE DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('Asia/Ho_Chi_Minh', now());

-- 2. Schema Enhancements on ng_details
ALTER TABLE public.ng_details
    ADD COLUMN IF NOT EXISTS cause TEXT,
    ADD COLUMN IF NOT EXISTS remark TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('Asia/Ho_Chi_Minh', now());

-- 3. Seed Standard Manufacturing Defect Catalog
INSERT INTO public.defect_catalog (code, name_vi, name_en, category, is_active)
VALUES
    ('DEF-DIM-01', 'Sai đường kính', 'Outer Diameter out of spec', 'DIMENSION', TRUE),
    ('DEF-DIM-02', 'Sai chiều dài', 'Length out of spec', 'DIMENSION', TRUE),
    ('DEF-SRF-01', 'Bavia', 'Burr / Flash', 'SURFACE', TRUE),
    ('DEF-SRF-02', 'Xước bề mặt', 'Surface scratch', 'SURFACE', TRUE),
    ('DEF-DEF-01', 'Móp méo / Biến dạng', 'Deformation', 'GEOMETRY', TRUE),
    ('DEF-CRK-01', 'Nứt vỡ', 'Crack', 'MATERIAL', TRUE),
    ('DEF-THR-01', 'Lỗi ren', 'Thread defect', 'MACHINING', TRUE),
    ('DEF-OTH-01', 'Lỗi khác', 'Other defect', 'OTHER', TRUE)
ON CONFLICT (code) DO UPDATE SET
    name_vi = EXCLUDED.name_vi,
    name_en = EXCLUDED.name_en,
    category = EXCLUDED.category,
    is_active = TRUE;

-- 4. RLS Update & Delete Policies for production_runs and ng_details
DROP POLICY IF EXISTS "production_runs_update_pe_admin" ON public.production_runs;
CREATE POLICY "production_runs_update_pe_admin" ON public.production_runs
FOR UPDATE TO authenticated
USING (
    public.is_user_active() = TRUE AND
    public.has_completed_password_change() = TRUE AND
    public.get_current_user_role() IN ('PE-MFG', 'Admin') AND
    EXISTS (
        SELECT 1 FROM public.job_operations jo
        JOIN public.jobs j ON j.id = jo.job_id
        WHERE jo.id = production_runs.operation_id AND j.status = 'ACTIVE'
    )
)
WITH CHECK (
    public.is_user_active() = TRUE AND
    public.has_completed_password_change() = TRUE AND
    public.get_current_user_role() IN ('PE-MFG', 'Admin') AND
    EXISTS (
        SELECT 1 FROM public.job_operations jo
        JOIN public.jobs j ON j.id = jo.job_id
        WHERE jo.id = production_runs.operation_id AND j.status = 'ACTIVE'
    )
);

DROP POLICY IF EXISTS "ng_details_update_pe_admin" ON public.ng_details;
CREATE POLICY "ng_details_update_pe_admin" ON public.ng_details
FOR UPDATE TO authenticated
USING (
    public.is_user_active() = TRUE AND
    public.has_completed_password_change() = TRUE AND
    public.get_current_user_role() IN ('PE-MFG', 'Admin')
)
WITH CHECK (
    public.is_user_active() = TRUE AND
    public.has_completed_password_change() = TRUE AND
    public.get_current_user_role() IN ('PE-MFG', 'Admin')
);

DROP POLICY IF EXISTS "ng_details_delete_pe_admin" ON public.ng_details;
CREATE POLICY "ng_details_delete_pe_admin" ON public.ng_details
FOR DELETE TO authenticated
USING (
    public.is_user_active() = TRUE AND
    public.has_completed_password_change() = TRUE AND
    public.get_current_user_role() IN ('PE-MFG', 'Admin')
);

-- 5. Atomic RPC: save_production_result_with_ng
CREATE OR REPLACE FUNCTION public.save_production_result_with_ng(
    p_operation_id UUID,
    p_machine_id TEXT,
    p_production_date DATE,
    p_cycle_time NUMERIC,
    p_ok_qty INTEGER,
    p_kiv_qty INTEGER,
    p_ng_items JSONB,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_run_id UUID;
    v_total_ng INTEGER := 0;
    v_idx INT;
    v_item JSONB;
    v_item_qty INT;
    v_defect_name TEXT;
    v_defect_code TEXT;
    v_cause TEXT;
    v_remark TEXT;
    v_photos TEXT[];
    v_existing_run_id UUID;
    v_prod_run RECORD;
    v_arr_len INT;
BEGIN
    -- 1. Authorization Guard: PE-MFG, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'Admin System';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản PE-MFG hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền nhập kết quả sản xuất (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, username, 'Kỹ thuật viên') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả sản xuất.', v_job_status;
    END IF;

    -- 3. Input Validation
    IF p_machine_id IS NULL OR length(trim(p_machine_id)) = 0 THEN
        RAISE EXCEPTION 'Mã máy (Machine) không được để trống.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK phải là số nguyên không âm (nhận được: %).', p_ok_qty;
    END IF;

    IF p_kiv_qty IS NULL OR p_kiv_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng KIV phải là số nguyên không âm (nhận được: %).', p_kiv_qty;
    END IF;

    IF p_cycle_time IS NOT NULL AND p_cycle_time <= 0 THEN
        RAISE EXCEPTION 'Cycle Time thực tế phải là số dương lớn hơn 0 (nhận được: %).', p_cycle_time;
    END IF;

    -- 4. Calculate Total NG from NG Items
    IF p_ng_items IS NOT NULL AND jsonb_typeof(p_ng_items) = 'array' THEN
        v_arr_len := jsonb_array_length(p_ng_items);
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            IF v_item_qty <= 0 THEN
                RAISE EXCEPTION 'Số lượng NG tại dòng % phải là số nguyên dương lớn hơn 0.', v_idx + 1;
            END IF;
            IF (v_item ->> 'defect_name') IS NULL OR length(trim(v_item ->> 'defect_name')) = 0 THEN
                RAISE EXCEPTION 'Vui lòng chọn loại lỗi (Type) tại dòng NG thứ %.', v_idx + 1;
            END IF;
            v_total_ng := v_total_ng + v_item_qty;
        END LOOP;
    ELSE
        v_arr_len := 0;
        v_total_ng := 0;
    END IF;

    -- 5. Find or Create Production Run for this operation (Prevent duplicate runs on repeated clicks)
    SELECT id INTO v_existing_run_id
    FROM public.production_runs
    WHERE operation_id = p_operation_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_run_id IS NOT NULL THEN
        v_run_id := v_existing_run_id;
        UPDATE public.production_runs
        SET machine_id = trim(p_machine_id),
            production_date = COALESCE(p_production_date, CURRENT_DATE),
            cycle_time_seconds = p_cycle_time,
            ok_qty = p_ok_qty,
            ng_qty = v_total_ng,
            kiv_qty = p_kiv_qty,
            remarks = NULLIF(trim(p_remarks), ''),
            operator_id = COALESCE(v_uid, operator_id),
            operator_name = COALESCE(v_user_name, operator_name),
            updated_at = NOW()
        WHERE id = v_run_id
        RETURNING * INTO v_prod_run;
    ELSE
        INSERT INTO public.production_runs (
            operation_id,
            machine_id,
            operator_id,
            operator_name,
            start_time,
            end_time,
            cycle_time_seconds,
            ok_qty,
            ng_qty,
            kiv_qty,
            production_date,
            remarks
        ) VALUES (
            p_operation_id,
            trim(p_machine_id),
            v_uid,
            COALESCE(v_user_name, 'Kỹ thuật viên'),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            p_cycle_time,
            p_ok_qty,
            v_total_ng,
            p_kiv_qty,
            COALESCE(p_production_date, CURRENT_DATE),
            NULLIF(trim(p_remarks), '')
        ) RETURNING * INTO v_prod_run;
        v_run_id := v_prod_run.id;
    END IF;

    -- 6. Atomically sync NG Details
    DELETE FROM public.ng_details WHERE production_run_id = v_run_id;

    IF v_arr_len > 0 THEN
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            v_defect_name := trim(v_item ->> 'defect_name');
            v_defect_code := NULLIF(trim(v_item ->> 'defect_code'), '');
            v_cause := NULLIF(trim(v_item ->> 'cause'), '');
            v_remark := NULLIF(trim(v_item ->> 'remark'), '');

            -- Photo URLs (max 2 per NG row)
            IF (v_item ? 'photo_urls') AND jsonb_typeof(v_item -> 'photo_urls') = 'array' THEN
                SELECT ARRAY(
                    SELECT jsonb_array_elements_text(v_item -> 'photo_urls')
                    LIMIT 2
                ) INTO v_photos;
            ELSE
                v_photos := ARRAY[]::TEXT[];
            END IF;

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
                v_run_id,
                v_defect_name,
                v_defect_code,
                v_item_qty,
                v_cause,
                v_cause,
                v_remark,
                v_photos
            );
        END LOOP;
    END IF;

    -- 7. Update Operation Status if appropriate
    IF p_ok_qty > 0 THEN
        UPDATE public.job_operations
        SET status = CASE WHEN status = 'NOT_STARTED' THEN 'IN_PROGRESS'::public.operation_status ELSE status END,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    -- Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'production_run_id', v_run_id,
        'operation_id', p_operation_id,
        'machine_id', v_prod_run.machine_id,
        'production_date', v_prod_run.production_date,
        'cycle_time_seconds', v_prod_run.cycle_time_seconds,
        'ok_qty', v_prod_run.ok_qty,
        'ng_qty', v_prod_run.ng_qty,
        'kiv_qty', v_prod_run.kiv_qty,
        'total_ng', v_total_ng
    );
END;
$$;

-- 6. Atomic RPC: save_qa_check_result
CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result,
    p_sample_size INTEGER,
    p_ok_qty INTEGER,
    p_ng_qty INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_next_seq BIGINT;
    v_qa_check RECORD;
    v_has_prod_ok BOOLEAN;
BEGIN
    -- 1. Authorization Guard: QA, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'QA Inspector';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản QA hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ QA hoặc Admin mới có quyền xác nhận kiểm tra (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, username, 'Kỹ thuật viên QA') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả QA.', v_job_status;
    END IF;

    -- 3. Validate Inputs
    IF p_result IS NULL THEN
        RAISE EXCEPTION 'Kết quả kiểm tra QA (OK / NG / KIV) không được để trống.';
    END IF;

    IF p_sample_size IS NULL OR p_sample_size <= 0 THEN
        RAISE EXCEPTION 'Cỡ mẫu kiểm tra phải là số nguyên dương lớn hơn 0.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK kiểm tra phải là số không âm.';
    END IF;

    IF p_ng_qty IS NULL OR p_ng_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng NG kiểm tra phải là số không âm.';
    END IF;

    IF (p_ok_qty + p_ng_qty) > p_sample_size THEN
        RAISE EXCEPTION 'Tổng OK (%) và NG (%) không được vượt quá cỡ mẫu (%).', p_ok_qty, p_ng_qty, p_sample_size;
    END IF;

    -- 4. Increment Operation Event Counter
    UPDATE public.job_operations
    SET qa_event_counter = qa_event_counter + 1
    WHERE id = p_operation_id
    RETURNING qa_event_counter INTO v_next_seq;

    -- 5. Insert QA Check
    INSERT INTO public.qa_checks (
        operation_id,
        inspector_id,
        inspector_name,
        inspection_time,
        sample_size,
        ok_qty,
        ng_qty,
        result,
        event_seq,
        notes
    ) VALUES (
        p_operation_id,
        v_uid,
        COALESCE(v_user_name, 'Kỹ thuật viên QA'),
        NOW(),
        p_sample_size,
        p_ok_qty,
        p_ng_qty,
        p_result,
        v_next_seq,
        NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_qa_check;

    -- 6. Operation Completion Rule:
    -- Needs Production OK > 0 AND QA confirms OK
    SELECT EXISTS (
        SELECT 1 FROM public.production_runs
        WHERE operation_id = p_operation_id AND ok_qty > 0
    ) INTO v_has_prod_ok;

    IF p_result = 'OK' AND v_has_prod_ok THEN
        UPDATE public.job_operations
        SET status = 'COMPLETED'::public.operation_status,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    RETURN to_jsonb(v_qa_check);
END;
$$;

-- 7. Permissions
REVOKE ALL ON FUNCTION public.save_production_result_with_ng FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_production_result_with_ng TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_qa_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result TO authenticated, service_role;


-- >>> MIGRATION: 00011_ui04_qa_check_fix.sql <<<
-- ============================================================================
-- Migration: 00011_ui04_qa_check_fix.sql
-- Description: Fix save_qa_check_result to let trg_qa_check_before_insert
-- manage qa_event_counter automatically.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result,
    p_sample_size INTEGER,
    p_ok_qty INTEGER,
    p_ng_qty INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_qa_check RECORD;
    v_has_prod_ok BOOLEAN;
BEGIN
    -- 1. Authorization Guard: QA, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'QA Inspector';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản QA hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ QA hoặc Admin mới có quyền xác nhận kiểm tra (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, username, 'Kỹ thuật viên QA') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả QA.', v_job_status;
    END IF;

    -- 3. Validate Inputs
    IF p_result IS NULL THEN
        RAISE EXCEPTION 'Kết quả kiểm tra QA (OK / NG / KIV) không được để trống.';
    END IF;

    IF p_sample_size IS NULL OR p_sample_size <= 0 THEN
        RAISE EXCEPTION 'Cỡ mẫu kiểm tra phải là số nguyên dương lớn hơn 0.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK kiểm tra phải là số không âm.';
    END IF;

    IF p_ng_qty IS NULL OR p_ng_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng NG kiểm tra phải là số không âm.';
    END IF;

    IF (p_ok_qty + p_ng_qty) > p_sample_size THEN
        RAISE EXCEPTION 'Tổng OK (%) và NG (%) không được vượt quá cỡ mẫu (%).', p_ok_qty, p_ng_qty, p_sample_size;
    END IF;

    -- 4. Insert QA Check (trg_qa_check_before_insert automatically assigns event_seq and synchronizes qa_event_counter)
    INSERT INTO public.qa_checks (
        operation_id,
        inspector_id,
        inspector_name,
        inspection_time,
        sample_size,
        ok_qty,
        ng_qty,
        result,
        event_seq,
        notes
    ) VALUES (
        p_operation_id,
        v_uid,
        COALESCE(v_user_name, 'Kỹ thuật viên QA'),
        NOW(),
        p_sample_size,
        p_ok_qty,
        p_ng_qty,
        p_result,
        0, -- trg_qa_check_before_insert overrides this with monotonic sequence
        NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_qa_check;

    -- 5. Operation Completion Rule:
    -- Needs Production OK > 0 AND QA confirms OK
    SELECT EXISTS (
        SELECT 1 FROM public.production_runs
        WHERE operation_id = p_operation_id AND ok_qty > 0
    ) INTO v_has_prod_ok;

    IF p_result = 'OK' AND v_has_prod_ok THEN
        UPDATE public.job_operations
        SET status = 'COMPLETED'::public.operation_status,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    RETURN to_jsonb(v_qa_check);
END;
$$;

REVOKE ALL ON FUNCTION public.save_qa_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result TO authenticated, service_role;


-- >>> MIGRATION: 00012_ui04_admin_decision_maker_fix.sql <<<
-- ============================================================================
-- Migration: 00012_ui04_admin_decision_maker_fix.sql
-- Description: Allow Admin and service_role to have authorized PE decision maker
-- authority when updating operation status to COMPLETED or HOLD.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_authorized_pe_decision_maker(p_job_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_is_active BOOLEAN;
    v_pe_owner UUID;
    v_delegates UUID[];
    v_caller_role public.user_role;
BEGIN
    -- Admin or service_role always has administrative override authority
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        RETURN TRUE;
    END IF;

    v_caller_role := public.get_current_user_role();
    IF v_caller_role = 'Admin' THEN
        RETURN TRUE;
    END IF;

    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Information disclosure guard: Caller must be an active internal user
    IF NOT public.is_user_active() THEN
        RETURN FALSE;
    END IF;

    -- Non-admin callers can only check their own decision authority unless called from trigger
    IF v_caller_role != 'Admin' AND auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
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
$$;


-- >>> MIGRATION: 00013_ui04_fix_pe_mfg_username_column.sql <<<
-- ============================================================================
-- Migration: 00013_ui04_fix_pe_mfg_username_column.sql
-- Description: Fix column "username" does not exist error in
-- save_production_result_with_ng and save_qa_check_result.
-- The profiles table uses full_name and phone (not username).
-- ============================================================================

-- 1. Redefine save_production_result_with_ng with correct profile columns (full_name, phone)
CREATE OR REPLACE FUNCTION public.save_production_result_with_ng(
    p_operation_id UUID,
    p_machine_id TEXT,
    p_production_date DATE,
    p_cycle_time NUMERIC,
    p_ok_qty INTEGER,
    p_kiv_qty INTEGER,
    p_ng_items JSONB,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_run_id UUID;
    v_total_ng INTEGER := 0;
    v_idx INT;
    v_item JSONB;
    v_item_qty INT;
    v_defect_name TEXT;
    v_defect_code TEXT;
    v_cause TEXT;
    v_remark TEXT;
    v_photos TEXT[];
    v_existing_run_id UUID;
    v_prod_run RECORD;
    v_arr_len INT;
BEGIN
    -- 1. Authorization Guard: PE-MFG, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'Admin System';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản PE-MFG hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền nhập kết quả sản xuất (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Kỹ thuật viên') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả sản xuất.', v_job_status;
    END IF;

    -- 3. Input Validation
    IF p_machine_id IS NULL OR length(trim(p_machine_id)) = 0 THEN
        RAISE EXCEPTION 'Mã máy (Machine) không được để trống.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK phải là số nguyên không âm (nhận được: %).', p_ok_qty;
    END IF;

    IF p_kiv_qty IS NULL OR p_kiv_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng KIV phải là số nguyên không âm (nhận được: %).', p_kiv_qty;
    END IF;

    IF p_cycle_time IS NOT NULL AND p_cycle_time <= 0 THEN
        RAISE EXCEPTION 'Cycle Time thực tế phải là số dương lớn hơn 0 (nhận được: %).', p_cycle_time;
    END IF;

    -- 4. Calculate Total NG from NG Items
    IF p_ng_items IS NOT NULL AND jsonb_typeof(p_ng_items) = 'array' THEN
        v_arr_len := jsonb_array_length(p_ng_items);
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            IF v_item_qty <= 0 THEN
                RAISE EXCEPTION 'Số lượng NG tại dòng % phải là số nguyên dương lớn hơn 0.', v_idx + 1;
            END IF;
            IF (v_item ->> 'defect_name') IS NULL OR length(trim(v_item ->> 'defect_name')) = 0 THEN
                RAISE EXCEPTION 'Vui lòng chọn loại lỗi (Type) tại dòng NG thứ %.', v_idx + 1;
            END IF;
            v_total_ng := v_total_ng + v_item_qty;
        END LOOP;
    ELSE
        v_arr_len := 0;
        v_total_ng := 0;
    END IF;

    -- 5. Find or Create Production Run for this operation (Prevent duplicate runs on repeated clicks)
    SELECT id INTO v_existing_run_id
    FROM public.production_runs
    WHERE operation_id = p_operation_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_run_id IS NOT NULL THEN
        v_run_id := v_existing_run_id;
        UPDATE public.production_runs
        SET machine_id = trim(p_machine_id),
            production_date = COALESCE(p_production_date, CURRENT_DATE),
            cycle_time_seconds = p_cycle_time,
            ok_qty = p_ok_qty,
            ng_qty = v_total_ng,
            kiv_qty = p_kiv_qty,
            remarks = NULLIF(trim(p_remarks), ''),
            operator_id = COALESCE(v_uid, operator_id),
            operator_name = COALESCE(v_user_name, operator_name),
            updated_at = NOW()
        WHERE id = v_run_id
        RETURNING * INTO v_prod_run;
    ELSE
        INSERT INTO public.production_runs (
            operation_id,
            machine_id,
            operator_id,
            operator_name,
            start_time,
            end_time,
            cycle_time_seconds,
            ok_qty,
            ng_qty,
            kiv_qty,
            production_date,
            remarks
        ) VALUES (
            p_operation_id,
            trim(p_machine_id),
            v_uid,
            COALESCE(v_user_name, 'Kỹ thuật viên'),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            p_cycle_time,
            p_ok_qty,
            v_total_ng,
            p_kiv_qty,
            COALESCE(p_production_date, CURRENT_DATE),
            NULLIF(trim(p_remarks), '')
        ) RETURNING * INTO v_prod_run;
        v_run_id := v_prod_run.id;
    END IF;

    -- 6. Atomically sync NG Details
    DELETE FROM public.ng_details WHERE production_run_id = v_run_id;

    IF v_arr_len > 0 THEN
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            v_defect_name := trim(v_item ->> 'defect_name');
            v_defect_code := NULLIF(trim(v_item ->> 'defect_code'), '');
            v_cause := NULLIF(trim(v_item ->> 'cause'), '');
            v_remark := NULLIF(trim(v_item ->> 'remark'), '');

            -- Photo URLs (max 2 per NG row)
            IF (v_item ? 'photo_urls') AND jsonb_typeof(v_item -> 'photo_urls') = 'array' THEN
                SELECT ARRAY(
                    SELECT jsonb_array_elements_text(v_item -> 'photo_urls')
                    LIMIT 2
                ) INTO v_photos;
            ELSE
                v_photos := ARRAY[]::TEXT[];
            END IF;

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
                v_run_id,
                v_defect_name,
                v_defect_code,
                v_item_qty,
                v_cause,
                v_cause,
                v_remark,
                v_photos
            );
        END LOOP;
    END IF;

    -- 7. Update Operation Status if appropriate
    IF p_ok_qty > 0 THEN
        UPDATE public.job_operations
        SET status = CASE WHEN status = 'NOT_STARTED' THEN 'IN_PROGRESS'::public.operation_status ELSE status END,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    -- Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'production_run_id', v_run_id,
        'operation_id', p_operation_id,
        'machine_id', v_prod_run.machine_id,
        'production_date', v_prod_run.production_date,
        'cycle_time_seconds', v_prod_run.cycle_time_seconds,
        'ok_qty', v_prod_run.ok_qty,
        'ng_qty', v_prod_run.ng_qty,
        'kiv_qty', v_prod_run.kiv_qty,
        'total_ng', v_total_ng
    );
END;
$$;

-- 2. Redefine save_qa_check_result with correct profile columns (full_name, phone)
CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result,
    p_sample_size INTEGER,
    p_ok_qty INTEGER,
    p_ng_qty INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_qa_check RECORD;
    v_has_prod_ok BOOLEAN;
BEGIN
    -- 1. Authorization Guard: QA, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'QA Inspector';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản QA hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ QA hoặc Admin mới có quyền xác nhận kiểm tra (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Kỹ thuật viên QA') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả QA.', v_job_status;
    END IF;

    -- 3. Validate Inputs
    IF p_result IS NULL THEN
        RAISE EXCEPTION 'Kết quả kiểm tra QA (OK / NG / KIV) không được để trống.';
    END IF;

    IF p_sample_size IS NULL OR p_sample_size <= 0 THEN
        RAISE EXCEPTION 'Cỡ mẫu kiểm tra phải là số nguyên dương lớn hơn 0.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK kiểm tra phải là số không âm.';
    END IF;

    IF p_ng_qty IS NULL OR p_ng_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng NG kiểm tra phải là số không âm.';
    END IF;

    IF (p_ok_qty + p_ng_qty) > p_sample_size THEN
        RAISE EXCEPTION 'Tổng OK (%) và NG (%) không được vượt quá cỡ mẫu (%).', p_ok_qty, p_ng_qty, p_sample_size;
    END IF;

    -- 4. Insert QA Check (trg_qa_check_before_insert automatically assigns event_seq and synchronizes qa_event_counter)
    INSERT INTO public.qa_checks (
        operation_id,
        inspector_id,
        inspector_name,
        inspection_time,
        sample_size,
        ok_qty,
        ng_qty,
        result,
        event_seq,
        notes
    ) VALUES (
        p_operation_id,
        v_uid,
        COALESCE(v_user_name, 'Kỹ thuật viên QA'),
        NOW(),
        p_sample_size,
        p_ok_qty,
        p_ng_qty,
        p_result,
        0, -- trg_qa_check_before_insert overrides this with monotonic sequence
        NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_qa_check;

    -- 5. Operation Completion Rule:
    -- Needs Production OK > 0 AND QA confirms OK
    SELECT EXISTS (
        SELECT 1 FROM public.production_runs
        WHERE operation_id = p_operation_id AND ok_qty > 0
    ) INTO v_has_prod_ok;

    IF p_result = 'OK' AND v_has_prod_ok THEN
        UPDATE public.job_operations
        SET status = 'COMPLETED'::public.operation_status,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    RETURN to_jsonb(v_qa_check);
END;
$$;

-- 3. Preserve Permissions
REVOKE ALL ON FUNCTION public.save_production_result_with_ng FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_production_result_with_ng TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_qa_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result TO authenticated, service_role;


-- >>> MIGRATION: 00014_ui04_fix_qa_check_trigger_guard.sql <<<
-- ============================================================================
-- Migration: 00014_ui04_fix_qa_check_trigger_guard.sql
-- Description: In Gate B security architecture, trg_validate_job_operation_transition
-- strictly enforces: "QA is an independent evaluator and cannot alter manufacturing operation status."
-- Therefore, save_qa_check_result must only update job_operations.status if v_role != 'QA' (e.g. Admin).
-- When called by QA, it records the immutable QA check without violating the operation transition trigger.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result,
    p_sample_size INTEGER,
    p_ok_qty INTEGER,
    p_ng_qty INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_qa_check RECORD;
    v_has_prod_ok BOOLEAN;
BEGIN
    -- 1. Authorization Guard: QA, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'QA Inspector';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản QA hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ QA hoặc Admin mới có quyền xác nhận kiểm tra (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Kỹ thuật viên QA') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả QA.', v_job_status;
    END IF;

    -- 3. Validate Inputs
    IF p_result IS NULL THEN
        RAISE EXCEPTION 'Kết quả kiểm tra QA (OK / NG / KIV) không được để trống.';
    END IF;

    IF p_sample_size IS NULL OR p_sample_size <= 0 THEN
        RAISE EXCEPTION 'Cỡ mẫu kiểm tra phải là số nguyên dương lớn hơn 0.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK kiểm tra phải là số không âm.';
    END IF;

    IF p_ng_qty IS NULL OR p_ng_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng NG kiểm tra phải là số không âm.';
    END IF;

    IF (p_ok_qty + p_ng_qty) > p_sample_size THEN
        RAISE EXCEPTION 'Tổng OK (%) và NG (%) không được vượt quá cỡ mẫu (%).', p_ok_qty, p_ng_qty, p_sample_size;
    END IF;

    -- 4. Insert QA Check (trg_qa_check_before_insert automatically assigns event_seq and synchronizes qa_event_counter)
    INSERT INTO public.qa_checks (
        operation_id,
        inspector_id,
        inspector_name,
        inspection_time,
        sample_size,
        ok_qty,
        ng_qty,
        result,
        event_seq,
        notes
    ) VALUES (
        p_operation_id,
        v_uid,
        COALESCE(v_user_name, 'Kỹ thuật viên QA'),
        NOW(),
        p_sample_size,
        p_ok_qty,
        p_ng_qty,
        p_result,
        0, -- trg_qa_check_before_insert overrides this with monotonic sequence
        NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_qa_check;

    -- 5. Operation Completion Rule:
    -- In Gate B architecture, QA is an independent evaluator and cannot alter manufacturing status.
    -- Updating operation status to COMPLETED is strictly reserved for Admin or authorized PE roles.
    SELECT EXISTS (
        SELECT 1 FROM public.production_runs
        WHERE operation_id = p_operation_id AND ok_qty > 0
    ) INTO v_has_prod_ok;

    IF p_result = 'OK' AND v_has_prod_ok AND v_role != 'QA' THEN
        UPDATE public.job_operations
        SET status = 'COMPLETED'::public.operation_status,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    RETURN to_jsonb(v_qa_check);
END;
$$;

REVOKE ALL ON FUNCTION public.save_qa_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result TO authenticated, service_role;


-- >>> MIGRATION: 00015_ui05_update_profile_name_rpc.sql <<<
-- ============================================================================
-- Migration: 00015_ui05_update_profile_name_rpc.sql
-- Description: Provide dedicated authenticated RPC to update user's display name
-- (full_name) safely in public.profiles.
-- Resolves UI-05 issue where client update of public.profiles previously included
-- updated_at, which violated column-level GRANT UPDATE (full_name, email).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_my_profile_name(
    p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_trimmed TEXT;
    v_updated_name TEXT;
BEGIN
    -- 1. Authentication guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_uid := auth.uid();
        -- If called by service role with null uid, cannot determine target profile without explicit ID
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Service role must execute in authenticated user context or pass user ID.';
        END IF;
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập để cập nhật hồ sơ cá nhân.';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_uid := auth.uid();
    END IF;

    -- 2. Validate input
    v_trimmed := trim(p_full_name);
    IF v_trimmed IS NULL OR length(v_trimmed) = 0 THEN
        RAISE EXCEPTION 'Họ và tên không được để trống.';
    END IF;

    IF length(v_trimmed) > 255 THEN
        RAISE EXCEPTION 'Họ và tên không được vượt quá 255 ký tự.';
    END IF;

    -- 3. Update public.profiles
    UPDATE public.profiles
    SET full_name = v_trimmed,
        updated_at = NOW()
    WHERE id = v_uid
    RETURNING full_name INTO v_updated_name;

    IF v_updated_name IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy hồ sơ người dùng trong hệ thống (ID: %).', v_uid;
    END IF;

    -- 4. Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'id', v_uid,
        'full_name', v_updated_name
    );
END;
$$;

-- Revoke from public & anon, grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.update_my_profile_name(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile_name(TEXT) TO authenticated, service_role;


-- >>> MIGRATION: 00016_ui06_admin_delete_job.sql <<<
-- ============================================================================
-- Migration: 00016_ui06_admin_delete_job.sql
-- Description: Implement backend-enforced admin_delete_job RPC
-- Security rules:
-- 1. Strictly Admin only (rejected for Planning, PE-MFG, QA, anon, etc.)
-- 2. JOB with production runs or QA checks: REJECTED (preserves trace history)
-- 3. JOB in CLOSE status: REJECTED (cannot delete closed jobs)
-- 4. Requires exact job_no confirmation and non-empty deletion reason
-- 5. Atomically writes to audit_logs before cascading delete
-- 6. Does NOT alter job_code_sequences (job numbers are monotonic and never reused)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role public.user_role;
    v_admin_name TEXT;
    v_admin_phone TEXT;
    v_job RECORD;
    v_run_count INTEGER := 0;
    v_qa_count INTEGER := 0;
    v_att_count INTEGER := 0;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
BEGIN
    -- 1. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_admin_name := 'Admin System';
        v_admin_phone := 'System';
        v_uid := auth.uid();
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Quản trị viên (Admin).';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_caller_role := public.get_current_user_role();
        IF v_caller_role != 'Admin' THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin) mới có quyền xóa Lệnh sản xuất (vai trò hiện tại: %).', COALESCE(v_caller_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, 'Admin'), COALESCE(phone, '')
        INTO v_admin_name, v_admin_phone
        FROM public.profiles
        WHERE id = v_uid;
    END IF;

    -- 2. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập mã JOB Ticket để xác nhận xóa.';
    END IF;

    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do xóa Lệnh sản xuất (tối thiểu 3 ký tự).';
    END IF;

    -- 3. Target Job Verification
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng trong hệ thống.';
    END IF;

    -- Ticket confirmation check (case-insensitive trim)
    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    -- Status check: Closed jobs are locked and cannot be deleted
    IF v_job.status = 'CLOSE' THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất đã đóng (Trạng thái: CLOSE). Chỉ được phép lưu trữ hồ sơ theo quy trình hệ thống.';
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất ở trạng thái %.', v_job.status;
    END IF;

    -- 4. Check Manufacturing & QA Historical Data
    SELECT count(*) INTO v_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    IF v_run_count > 0 OR v_qa_count > 0 THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã có dữ liệu sản xuất (% kết quả PE-MFG, % kiểm tra QA). Không được phép xóa trực tiếp nhằm bảo toàn lịch sử và truy xuất nguồn gốc. Vui lòng chuyển trạng thái Void/Cancel.', v_run_count, v_qa_count;
    END IF;

    -- 5. Delete Related Attachments
    SELECT count(*) INTO v_att_count
    FROM public.attachments
    WHERE job_id = p_job_id;

    IF v_att_count > 0 THEN
        DELETE FROM public.attachments WHERE job_id = p_job_id;
    END IF;

    -- 6. Record Audit Log before job deletion
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'ADMIN_DELETE_JOB',
        'jobs',
        p_job_id,
        to_jsonb(v_job),
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'reason', v_trimmed_reason,
            'deleted_by_name', v_admin_name,
            'deleted_by_phone', v_admin_phone,
            'deleted_at', timezone('Asia/Ho_Chi_Minh', now())
        )
    );

    -- 7. Cascade Delete Operations and Job
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    -- 8. Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'message', 'Đã xóa Lệnh sản xuất thành công.'
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.admin_delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job TO authenticated, service_role;


-- >>> MIGRATION: 00017_ui06_fix_admin_delete_job_audit.sql <<<
-- ============================================================================
-- Migration: 00017_ui06_fix_admin_delete_job_audit.sql
-- Description: Update admin_delete_job RPC to write to audit_logs using
-- existing schema columns (old_values, new_values) instead of details.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role public.user_role;
    v_admin_name TEXT;
    v_admin_phone TEXT;
    v_job RECORD;
    v_run_count INTEGER := 0;
    v_qa_count INTEGER := 0;
    v_att_count INTEGER := 0;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
BEGIN
    -- 1. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_admin_name := 'Admin System';
        v_admin_phone := 'System';
        v_uid := auth.uid();
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Quản trị viên (Admin).';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_caller_role := public.get_current_user_role();
        IF v_caller_role != 'Admin' THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin) mới có quyền xóa Lệnh sản xuất (vai trò hiện tại: %).', COALESCE(v_caller_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, 'Admin'), COALESCE(phone, '')
        INTO v_admin_name, v_admin_phone
        FROM public.profiles
        WHERE id = v_uid;
    END IF;

    -- 2. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập mã JOB Ticket để xác nhận xóa.';
    END IF;

    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do xóa Lệnh sản xuất (tối thiểu 3 ký tự).';
    END IF;

    -- 3. Target Job Verification
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng trong hệ thống.';
    END IF;

    -- Ticket confirmation check (case-insensitive trim)
    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    -- Status check: Closed jobs are locked and cannot be deleted
    IF v_job.status = 'CLOSE' THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất đã đóng (Trạng thái: CLOSE). Chỉ được phép lưu trữ hồ sơ theo quy trình hệ thống.';
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất ở trạng thái %.', v_job.status;
    END IF;

    -- 4. Check Manufacturing & QA Historical Data
    SELECT count(*) INTO v_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    IF v_run_count > 0 OR v_qa_count > 0 THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã có dữ liệu sản xuất (% kết quả PE-MFG, % kiểm tra QA). Không được phép xóa trực tiếp nhằm bảo toàn lịch sử và truy xuất nguồn gốc. Vui lòng chuyển trạng thái Void/Cancel.', v_run_count, v_qa_count;
    END IF;

    -- 5. Delete Related Attachments
    SELECT count(*) INTO v_att_count
    FROM public.attachments
    WHERE job_id = p_job_id;

    IF v_att_count > 0 THEN
        DELETE FROM public.attachments WHERE job_id = p_job_id;
    END IF;

    -- 6. Record Audit Log before job deletion using existing schema (old_values, new_values)
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'ADMIN_DELETE_JOB',
        'jobs',
        p_job_id,
        to_jsonb(v_job),
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'reason', v_trimmed_reason,
            'deleted_by_name', v_admin_name,
            'deleted_by_phone', v_admin_phone,
            'deleted_at', timezone('Asia/Ho_Chi_Minh', now())
        )
    );

    -- 7. Cascade Delete Operations and Job
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    -- 8. Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'message', 'Đã xóa Lệnh sản xuất thành công.'
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.admin_delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job TO authenticated, service_role;


-- >>> MIGRATION: 00018_workflow_v2_core.sql <<<
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


-- >>> MIGRATION: 00019_workflow_v2_job_lifecycle_rules.sql <<<
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


-- >>> MIGRATION: 00020_fix_job_delete_lock_condition.sql <<<
-- ============================================================================
-- Migration: 00020_fix_job_delete_lock_condition.sql
-- Description: Align Job Deletion & Planning Lock with business rules:
--   1. Close Operation is the definitive boundary for locking Job Deletion and Planning Edits.
--   2. Allow job deletion when no operations are CLOSED, even with production runs,
--      NG details, QA checks, attachments, or technical dispositions.
--   3. Block job deletion when at least one operation is CLOSED or job is CLOSE/ARCHIVE/PURGED.
--   4. Expand authorization: Admin, Planning Leader, or Planning Owner (created_by).
--   5. Row lock (FOR UPDATE) in admin_delete_job and close_job_operation to prevent race conditions.
--   6. Bypass immutability triggers on controlled cascade deletion via transaction flag.
-- ============================================================================

-- 1. Update enforce_qa_check_immutability to support internal cascade job deletion
CREATE OR REPLACE FUNCTION public.enforce_qa_check_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF auth.role() IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'QA evaluation records are immutable. Direct UPDATE or DELETE is strictly forbidden.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 2. Update enforce_pe_disposition_immutability to support internal cascade job deletion
CREATE OR REPLACE FUNCTION public.enforce_pe_disposition_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF auth.role() IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'PE technical dispositions are immutable records. Direct UPDATE or DELETE is strictly forbidden.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 3. Update check_job_active_status to support internal cascade job deletion
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
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

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

-- 4. Update close_job_operation to acquire row lock FOR UPDATE on jobs
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

    -- 2. Validate Operation & Job with FOR UPDATE row lock to serialize against concurrent delete
    SELECT * INTO v_op FROM public.job_operations WHERE id = p_operation_id;
    IF v_op.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) với ID: %.', p_operation_id;
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = v_op.job_id FOR UPDATE;
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

-- 5. Unified admin_delete_job function with updated lock rules and authorization
CREATE OR REPLACE FUNCTION public.admin_delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role public.user_role;
    v_is_leader BOOLEAN := FALSE;
    v_caller_name TEXT;
    v_caller_phone TEXT;
    v_job RECORD;
    v_is_admin BOOLEAN := FALSE;
    v_is_planning_leader BOOLEAN := FALSE;
    v_is_planning_owner BOOLEAN := FALSE;
    v_has_closed_ops BOOLEAN := FALSE;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
    v_op_count INTEGER := 0;
    v_run_count INTEGER := 0;
    v_ng_count INTEGER := 0;
    v_qa_count INTEGER := 0;
    v_att_count INTEGER := 0;
    v_deleted_attachments JSONB := '[]'::jsonb;
BEGIN
    -- Set session flag for internal cascade deletion
    PERFORM set_config('sample_tracking.internal_job_deletion', 'true', true);

    -- 1. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập mã JOB Ticket để xác nhận xóa.';
    END IF;

    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do xóa Lệnh sản xuất (tối thiểu 3 ký tự).';
    END IF;

    -- 2. Target Job Verification and Row Lock (FOR UPDATE)
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng trong hệ thống.';
    END IF;

    -- Ticket confirmation check (case-insensitive trim)
    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    -- 3. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_phone := 'System';
        v_uid := auth.uid();
        v_is_admin := TRUE;
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản có thẩm quyền xóa JOB.';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_uid := auth.uid();
        SELECT role, COALESCE(is_department_leader, FALSE), COALESCE(full_name, phone), COALESCE(phone, '')
        INTO v_caller_role, v_is_leader, v_caller_name, v_caller_phone
        FROM public.profiles
        WHERE id = v_uid;

        v_is_admin := (v_caller_role = 'Admin');
        v_is_planning_leader := (v_caller_role = 'Planning' AND v_is_leader = TRUE);
        v_is_planning_owner := (v_caller_role = 'Planning' AND v_job.created_by = v_uid);

        IF NOT (v_is_admin OR v_is_planning_leader OR v_is_planning_owner) THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin), Trưởng nhóm Kế hoạch (Planning Leader), hoặc Người tạo JOB mới có quyền xóa Lệnh sản xuất (vai trò hiện tại: %).',
                COALESCE(v_caller_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 4. Status Check: Closed or Archival jobs are permanently locked
    IF v_job.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Chỉ được phép lưu trữ hồ sơ theo quy trình hệ thống.', v_job.status;
    END IF;

    -- 5. Close Operation Lockout Check:
    -- Close Operation is the definitive boundary for locking Job Deletion
    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = p_job_id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất: Đã có ít nhất một công đoạn được Chốt (CLOSED). Mọi dữ liệu đã khóa bảo đảm tính toàn vẹn kiểm toán.';
    END IF;

    -- 6. Collect Statistics and Attachments Before Deletion
    SELECT coalesce(jsonb_agg(file_path), '[]'::jsonb) INTO v_deleted_attachments
    FROM public.attachments
    WHERE job_id = p_job_id AND file_path IS NOT NULL;

    SELECT count(*) INTO v_op_count FROM public.job_operations WHERE job_id = p_job_id;
    SELECT count(*) INTO v_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_ng_count
    FROM public.ng_details ng
    JOIN public.production_runs pr ON pr.id = ng.production_run_id
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_att_count
    FROM public.attachments
    WHERE job_id = p_job_id;

    -- 7. Controlled Cascading Deletion
    DELETE FROM public.attachments WHERE job_id = p_job_id;
    DELETE FROM public.pe_technical_dispositions WHERE job_id = p_job_id;
    DELETE FROM public.kiv_reviews WHERE job_id = p_job_id;
    DELETE FROM public.ng_details
    WHERE production_run_id IN (
        SELECT pr.id FROM public.production_runs pr
        JOIN public.job_operations jo ON jo.id = pr.operation_id
        WHERE jo.job_id = p_job_id
    );
    DELETE FROM public.qa_checks
    WHERE operation_id IN (
        SELECT id FROM public.job_operations WHERE job_id = p_job_id
    );
    DELETE FROM public.production_runs
    WHERE operation_id IN (
        SELECT id FROM public.job_operations WHERE job_id = p_job_id
    );
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    -- 8. Record Audit Log before transaction commit
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'DELETE_JOB',
        'jobs',
        p_job_id,
        to_jsonb(v_job),
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'reason', v_trimmed_reason,
            'deleted_by_name', v_caller_name,
            'deleted_by_phone', v_caller_phone,
            'deleted_by_role', v_caller_role,
            'deleted_by_id', v_uid,
            'is_planning_owner', v_is_planning_owner,
            'is_planning_leader', v_is_planning_leader,
            'is_admin', v_is_admin,
            'cascade_stats', jsonb_build_object(
                'operations', v_op_count,
                'production_runs', v_run_count,
                'ng_details', v_ng_count,
                'qa_checks', v_qa_count,
                'attachments', v_att_count
            ),
            'deleted_at', timezone('Asia/Ho_Chi_Minh', now())
        )
    );

    -- 9. Return structured JSON
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'message', 'Đã xóa Lệnh sản xuất thành công.',
        'deleted_attachments', v_deleted_attachments,
        'stats', jsonb_build_object(
            'operations', v_op_count,
            'production_runs', v_run_count,
            'ng_details', v_ng_count,
            'qa_checks', v_qa_count,
            'attachments', v_att_count
        )
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.admin_delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job TO authenticated, service_role;

-- Alias function: delete_job
CREATE OR REPLACE FUNCTION public.delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.admin_delete_job(p_job_id, p_confirm_ticket, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_job TO authenticated, service_role;


-- >>> MIGRATION: 00021_operation_ui_and_engineering_documents_r1.sql <<<
-- ============================================================================
-- Migration: 00021_operation_ui_and_engineering_documents_r1.sql
-- Description:
--   1. Add 'Drawing' role to user_role enum.
--   2. Expand storage.buckets allowed_mime_types on 'sample-documents' (WebP, XLS, XLSX).
--   3. Create public.operation_sample_photos for good/sample parts gallery.
--   4. Create public.pe_engineering_reviews for PE evaluation history.
--   5. Create public.engineering_documents for technical drawings, check sheets, settings.
--   6. Setup RLS policies for the three tables and storage objects.
--   7. Update check_job_active_status and admin_delete_job for cascade deletion.
-- ============================================================================

-- 1. Add 'Drawing' to user_role enum if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'Drawing'
    ) THEN
        ALTER TYPE public.user_role ADD VALUE 'Drawing';
    END IF;
END $$;

-- 2. Expand allowed MIME types on sample-documents bucket
UPDATE storage.buckets
SET allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
WHERE id = 'sample-documents';

-- 3. Table: operation_sample_photos
CREATE TABLE IF NOT EXISTS public.operation_sample_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760), -- max 10MB
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    uploaded_by UUID REFERENCES public.profiles(id),
    uploader_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_operation_sample_photos_op ON public.operation_sample_photos(operation_id);
CREATE INDEX IF NOT EXISTS idx_operation_sample_photos_job ON public.operation_sample_photos(job_id);

-- 4. Table: pe_engineering_reviews
CREATE TABLE IF NOT EXISTS public.pe_engineering_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    review_result TEXT NOT NULL CHECK (review_result IN ('Pending', 'OK', 'NG')),
    engineering_comment TEXT NOT NULL,
    improvement_required TEXT DEFAULT '',
    reviewed_by UUID REFERENCES public.profiles(id),
    reviewer_name TEXT NOT NULL,
    reviewer_role public.user_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_pe_engineering_reviews_op ON public.pe_engineering_reviews(operation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pe_engineering_reviews_job ON public.pe_engineering_reviews(job_id);

-- 5. Table: engineering_documents
CREATE TABLE IF NOT EXISTS public.engineering_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID REFERENCES public.job_operations(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN ('Drawing', 'Check Sheet', 'Setting', 'Other')),
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 15728640), -- max 15MB
    mime_type TEXT NOT NULL CHECK (mime_type IN (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )),
    version TEXT NOT NULL DEFAULT 'v1',
    parent_document_id UUID REFERENCES public.engineering_documents(id) ON DELETE SET NULL,
    remark TEXT DEFAULT '',
    uploaded_by UUID REFERENCES public.profiles(id),
    uploader_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_engineering_docs_job ON public.engineering_documents(job_id);
CREATE INDEX IF NOT EXISTS idx_engineering_docs_op ON public.engineering_documents(operation_id);
CREATE INDEX IF NOT EXISTS idx_engineering_docs_cat ON public.engineering_documents(category);

-- 6. Enable RLS
ALTER TABLE public.operation_sample_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pe_engineering_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineering_documents ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies: operation_sample_photos
-- Read: All active internal roles
CREATE POLICY "sample_photos_read_all" ON public.operation_sample_photos
FOR SELECT TO authenticated
USING (
    public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = operation_sample_photos.job_id
        AND j.status != 'PURGED'
    )
);

-- Insert: PE-MFG and Admin when parent JOB is not CLOSE or PURGED (allowed even after Close Operation)
CREATE POLICY "sample_photos_insert_pe_admin" ON public.operation_sample_photos
FOR INSERT TO authenticated
WITH CHECK (
    public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'PE-MFG')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = operation_sample_photos.job_id
        AND j.status NOT IN ('CLOSE', 'PURGED')
    )
);

-- Delete: PE-MFG and Admin when parent JOB is not CLOSE or PURGED
CREATE POLICY "sample_photos_delete_pe_admin" ON public.operation_sample_photos
FOR DELETE TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'PE-MFG')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = operation_sample_photos.job_id
        AND j.status NOT IN ('CLOSE', 'PURGED')
    )
);

-- 8. RLS Policies: pe_engineering_reviews
-- Read: All active internal roles
CREATE POLICY "pe_reviews_read_all" ON public.pe_engineering_reviews
FOR SELECT TO authenticated
USING (
    public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = pe_engineering_reviews.job_id
        AND j.status != 'PURGED'
    )
);

-- Insert: PE-MFG and Admin when parent JOB is not CLOSE or PURGED (allowed even after Close Operation)
CREATE POLICY "pe_reviews_insert_pe_admin" ON public.pe_engineering_reviews
FOR INSERT TO authenticated
WITH CHECK (
    public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'PE-MFG')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = pe_engineering_reviews.job_id
        AND j.status NOT IN ('CLOSE', 'PURGED')
    )
);

-- Reviews are append-only: No UPDATE allowed
-- Direct DELETE forbidden except service_role or cascade
CREATE POLICY "pe_reviews_delete_guard" ON public.pe_engineering_reviews
FOR DELETE TO authenticated
USING (
    auth.role() = 'service_role'
    OR current_setting('sample_tracking.internal_job_deletion', true) = 'true'
);

-- 9. RLS Policies: engineering_documents
-- Read: All active internal roles (including Drawing)
CREATE POLICY "engineering_docs_read_all" ON public.engineering_documents
FOR SELECT TO authenticated
USING (
    public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = engineering_documents.job_id
        AND j.status != 'PURGED'
    )
);

-- Insert: Admin, Drawing, Planning, PE-MFG when parent JOB is not CLOSE or PURGED
CREATE POLICY "engineering_docs_insert_authorized" ON public.engineering_documents
FOR INSERT TO authenticated
WITH CHECK (
    public.is_user_active() = TRUE
    AND (public.get_current_user_role())::text IN ('Admin', 'Drawing', 'Planning', 'PE-MFG')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = engineering_documents.job_id
        AND j.status NOT IN ('CLOSE', 'PURGED')
    )
);

-- Delete: Admin or Uploader when parent JOB is ACTIVE
CREATE POLICY "engineering_docs_delete_authorized" ON public.engineering_documents
FOR DELETE TO authenticated
USING (
    public.is_user_active() = TRUE
    AND (
        (public.get_current_user_role())::text = 'Admin'
        OR (uploaded_by = auth.uid() AND (public.get_current_user_role())::text IN ('Drawing', 'Planning', 'PE-MFG'))
    )
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = engineering_documents.job_id
        AND j.status = 'ACTIVE'
    )
);

-- 10. Update check_job_active_status trigger function to include new tables
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
    -- Allow cascade deletion when triggered within authorized job deletion transaction
    IF current_setting('sample_tracking.internal_job_deletion', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'jobs' THEN
        IF TG_OP = 'UPDATE' THEN
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
    ELSIF TG_TABLE_NAME = 'operation_sample_photos' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    ELSIF TG_TABLE_NAME = 'pe_engineering_reviews' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    ELSIF TG_TABLE_NAME = 'engineering_documents' THEN
        v_target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
        SELECT status INTO v_job_status FROM public.jobs WHERE id = v_target_job_id;
    END IF;

    -- Strict read-only enforcement for authenticated and anon users when parent JOB is CLOSE or PURGED
    IF auth.role() IN ('authenticated', 'anon') AND v_job_status IS NOT NULL AND v_job_status IN ('CLOSE', 'PURGED') THEN
        RAISE EXCEPTION 'Operation locked: Parent JOB % is % (not ACTIVE). Record cannot be modified.', v_target_job_id, v_job_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Apply triggers to new tables
DROP TRIGGER IF EXISTS trg_sample_photos_job_active ON public.operation_sample_photos;
CREATE TRIGGER trg_sample_photos_job_active
BEFORE INSERT OR UPDATE OR DELETE ON public.operation_sample_photos
FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_pe_reviews_job_active ON public.pe_engineering_reviews;
CREATE TRIGGER trg_pe_reviews_job_active
BEFORE INSERT OR UPDATE OR DELETE ON public.pe_engineering_reviews
FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

DROP TRIGGER IF EXISTS trg_engineering_docs_job_active ON public.engineering_documents;
CREATE TRIGGER trg_engineering_docs_job_active
BEFORE INSERT OR UPDATE OR DELETE ON public.engineering_documents
FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

-- 11. Update Storage RLS policies for sample-documents
-- Allow universal read for registered sample photos & engineering documents
CREATE POLICY "storage_sample_photos_read" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.operation_sample_photos p
        JOIN public.jobs j ON j.id = p.job_id
        WHERE p.file_path = storage.objects.name
          AND j.status != 'PURGED'
    )
);

CREATE POLICY "storage_engineering_docs_read" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.engineering_documents d
        JOIN public.jobs j ON j.id = d.job_id
        WHERE d.file_path = storage.objects.name
          AND j.status != 'PURGED'
    )
);

-- Allow uploads to sample photos & documents folders for authorized roles
CREATE POLICY "storage_sample_photos_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'PE-MFG')
);

CREATE POLICY "storage_engineering_docs_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND (public.get_current_user_role())::text IN ('Admin', 'Drawing', 'Planning', 'PE-MFG')
);

-- 12. Update admin_delete_job to cascade delete from the 3 new tables
CREATE OR REPLACE FUNCTION public.admin_delete_job(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role public.user_role;
    v_is_leader BOOLEAN;
    v_caller_name TEXT;
    v_caller_phone TEXT;
    v_job RECORD;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
    v_has_closed_ops BOOLEAN := FALSE;
    v_op_count INTEGER := 0;
    v_run_count INTEGER := 0;
    v_ng_count INTEGER := 0;
    v_qa_count INTEGER := 0;
    v_att_count INTEGER := 0;
    v_sample_photo_count INTEGER := 0;
    v_pe_review_count INTEGER := 0;
    v_doc_count INTEGER := 0;
    v_deleted_attachments JSONB;
    v_is_admin BOOLEAN := FALSE;
    v_is_planning_leader BOOLEAN := FALSE;
    v_is_planning_owner BOOLEAN := FALSE;
BEGIN
    -- 1. Input Validation
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập mã JOB Ticket để xác nhận xóa.';
    END IF;

    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) < 3 THEN
        RAISE EXCEPTION 'Vui lòng cung cấp lý do xóa Lệnh sản xuất (tối thiểu 3 ký tự).';
    END IF;

    -- 2. Target Job Verification with FOR UPDATE row lock to serialize against concurrent close
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất (JOB) tương ứng trong hệ thống.';
    END IF;

    -- Ticket confirmation check (case-insensitive trim)
    IF lower(v_trimmed_ticket) != lower(trim(v_job.job_no)) THEN
        RAISE EXCEPTION 'Mã JOB Ticket xác nhận không chính xác. Yêu cầu nhập đúng "%" (nhận được: "%").', v_job.job_no, v_trimmed_ticket;
    END IF;

    -- 3. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_phone := 'System';
        v_uid := auth.uid();
        v_is_admin := TRUE;
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản có thẩm quyền xóa JOB.';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_uid := auth.uid();
        SELECT role, COALESCE(is_department_leader, FALSE), COALESCE(full_name, phone), COALESCE(phone, '')
        INTO v_caller_role, v_is_leader, v_caller_name, v_caller_phone
        FROM public.profiles
        WHERE id = v_uid;

        v_is_admin := (v_caller_role = 'Admin');
        v_is_planning_leader := (v_caller_role = 'Planning' AND v_is_leader = TRUE);
        v_is_planning_owner := (v_caller_role = 'Planning' AND v_job.created_by = v_uid);

        IF NOT (v_is_admin OR v_is_planning_leader OR v_is_planning_owner) THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin), Trưởng nhóm Kế hoạch (Planning Leader), hoặc Người tạo JOB mới có quyền xóa Lệnh sản xuất (vai trò hiện tại: %).',
                COALESCE(v_caller_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 4. Status Check: Closed or Archival jobs are permanently locked
    IF v_job.status IN ('CLOSE', 'ARCHIVE', 'PURGED') THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Chỉ được phép lưu trữ hồ sơ theo quy trình hệ thống.', v_job.status;
    END IF;

    -- 5. Close Operation Lockout Check:
    -- Close Operation is the definitive boundary for locking Job Deletion
    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = p_job_id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        RAISE EXCEPTION 'Không thể xóa Lệnh sản xuất: Đã có ít nhất một công đoạn được Chốt (CLOSED). Mọi dữ liệu đã khóa bảo đảm tính toàn vẹn kiểm toán.';
    END IF;

    -- 6. Collect Statistics and Attachments Before Deletion
    SELECT coalesce(jsonb_agg(file_path), '[]'::jsonb) INTO v_deleted_attachments
    FROM public.attachments
    WHERE job_id = p_job_id AND file_path IS NOT NULL;

    SELECT count(*) INTO v_op_count FROM public.job_operations WHERE job_id = p_job_id;
    SELECT count(*) INTO v_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_ng_count
    FROM public.ng_details ng
    JOIN public.production_runs pr ON pr.id = ng.production_run_id
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_att_count
    FROM public.attachments
    WHERE job_id = p_job_id;

    SELECT count(*) INTO v_sample_photo_count FROM public.operation_sample_photos WHERE job_id = p_job_id;
    SELECT count(*) INTO v_pe_review_count FROM public.pe_engineering_reviews WHERE job_id = p_job_id;
    SELECT count(*) INTO v_doc_count FROM public.engineering_documents WHERE job_id = p_job_id;

    -- Set transaction-level flag to permit cascade deletion through immutability triggers
    PERFORM set_config('sample_tracking.internal_job_deletion', 'true', true);

    -- 7. Controlled Cascading Deletion
    DELETE FROM public.operation_sample_photos WHERE job_id = p_job_id;
    DELETE FROM public.pe_engineering_reviews WHERE job_id = p_job_id;
    DELETE FROM public.engineering_documents WHERE job_id = p_job_id;
    DELETE FROM public.attachments WHERE job_id = p_job_id;
    DELETE FROM public.pe_technical_dispositions WHERE job_id = p_job_id;
    DELETE FROM public.kiv_reviews WHERE job_id = p_job_id;
    DELETE FROM public.ng_details
    WHERE production_run_id IN (
        SELECT pr.id FROM public.production_runs pr
        JOIN public.job_operations jo ON jo.id = pr.operation_id
        WHERE jo.job_id = p_job_id
    );
    DELETE FROM public.qa_checks
    WHERE operation_id IN (
        SELECT id FROM public.job_operations WHERE job_id = p_job_id
    );
    DELETE FROM public.production_runs
    WHERE operation_id IN (
        SELECT id FROM public.job_operations WHERE job_id = p_job_id
    );
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    -- 8. Record Audit Log before transaction commit
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'ADMIN_DELETE_JOB',
        'jobs',
        p_job_id,
        to_jsonb(v_job),
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'reason', v_trimmed_reason,
            'deleted_by_name', v_caller_name,
            'deleted_by_phone', v_caller_phone,
            'deleted_by_role', v_caller_role,
            'cascaded_operations_count', v_op_count,
            'cascaded_production_runs_count', v_run_count,
            'cascaded_ng_details_count', v_ng_count,
            'cascaded_qa_checks_count', v_qa_count,
            'cascaded_attachments_count', v_att_count,
            'cascaded_sample_photos_count', v_sample_photo_count,
            'cascaded_pe_reviews_count', v_pe_review_count,
            'cascaded_engineering_docs_count', v_doc_count,
            'deleted_attachment_paths', v_deleted_attachments,
            'deleted_at', timezone('Asia/Ho_Chi_Minh', now())
        )
    );

    -- 9. Return structured confirmation JSON
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'deleted_counts', jsonb_build_object(
            'operations', v_op_count,
            'production_runs', v_run_count,
            'ng_details', v_ng_count,
            'qa_checks', v_qa_count,
            'attachments', v_att_count,
            'sample_photos', v_sample_photo_count,
            'pe_reviews', v_pe_review_count,
            'engineering_documents', v_doc_count
        ),
        'message', 'Đã xóa Lệnh sản xuất và dọn sạch dữ liệu liên quan thành công.'
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.admin_delete_job FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job TO authenticated, service_role;


-- >>> MIGRATION: 00022_sample_final_report_module.sql <<<
-- ============================================================================
-- Migration: 00022_sample_final_report_module.sql
-- Description:
--   1. Create final_evaluation_result & report_generation_status enums.
--   2. Expand storage.buckets allowed_mime_types on 'sample-documents' (ZIP).
--   3. Create public.sample_final_reports table for immutable closure snapshots,
--      evaluation results, and PDF/ZIP generation artifacts.
--   4. Enable RLS on sample_final_reports with authenticated read access and
--      service_role / leader update permissions.
--   5. Update close_job_final RPC to collect final evaluation and generate
--      the initial Pending report record atomically.
-- ============================================================================

-- 1. Create Enums if not exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'final_evaluation_result' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.final_evaluation_result AS ENUM ('PASS', 'CONDITIONAL', 'FAIL');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'report_generation_status' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.report_generation_status AS ENUM ('Pending', 'Generating', 'Ready', 'Failed');
    END IF;
END $$;

-- 2. Expand allowed MIME types on sample-documents bucket for ZIP archives
UPDATE storage.buckets
SET allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-zip-compressed'
]
WHERE id = 'sample-documents';

-- 3. Create Table: sample_final_reports
CREATE TABLE IF NOT EXISTS public.sample_final_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
    
    -- Final Evaluation (Completed by PE-MFG Leader upon Close Job)
    evaluation_result public.final_evaluation_result NOT NULL DEFAULT 'PASS',
    overall_assessment TEXT NOT NULL CHECK (char_length(trim(overall_assessment)) >= 5),
    improvements_required TEXT DEFAULT NULL,
    unresolved_issues TEXT DEFAULT NULL,
    
    -- Evaluator & Closure Metadata
    closed_by UUID NOT NULL REFERENCES public.profiles(id),
    closed_by_name TEXT NOT NULL,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    close_reason TEXT DEFAULT NULL,
    close_warnings JSONB DEFAULT '[]'::jsonb,
    
    -- Deep Immutable Snapshot of entire Job at closure
    snapshot_data JSONB NOT NULL,
    
    -- Generation State Machine
    generation_status public.report_generation_status NOT NULL DEFAULT 'Pending',
    generation_error TEXT DEFAULT NULL,
    generation_attempts INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT NULL,
    
    -- Generated Artifacts in sample-documents
    pdf_file_name TEXT DEFAULT NULL,
    pdf_file_path TEXT DEFAULT NULL,
    pdf_file_size BIGINT DEFAULT NULL,
    pdf_sha256 TEXT DEFAULT NULL,
    
    zip_file_name TEXT DEFAULT NULL,
    zip_file_path TEXT DEFAULT NULL,
    zip_file_size BIGINT DEFAULT NULL,
    zip_sha256 TEXT DEFAULT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_sample_final_reports_job ON public.sample_final_reports(job_id);
CREATE INDEX IF NOT EXISTS idx_sample_final_reports_status ON public.sample_final_reports(generation_status);

-- 4. Enable RLS on sample_final_reports
ALTER TABLE public.sample_final_reports ENABLE ROW LEVEL SECURITY;

-- 4.1 Read Access: All active authenticated internal users may view final report metadata and snapshots
DROP POLICY IF EXISTS "sample_final_reports_select_authorized" ON public.sample_final_reports;
CREATE POLICY "sample_final_reports_select_authorized" ON public.sample_final_reports
FOR SELECT TO authenticated
USING (
    public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = sample_final_reports.job_id
        AND j.status != 'PURGED'
    )
);

-- 4.2 Insert / Update / Delete strictly guarded
-- Insert is performed inside SECURITY DEFINER close_job_final RPC or service_role
DROP POLICY IF EXISTS "sample_final_reports_modify_service" ON public.sample_final_reports;
CREATE POLICY "sample_final_reports_modify_service" ON public.sample_final_reports
FOR ALL TO authenticated
USING (
    auth.role() = 'service_role'
    OR (
        public.is_user_active() = TRUE
        AND (
            public.get_current_user_role() = 'Admin'
            OR (
                public.get_current_user_role() = 'PE-MFG'
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.is_department_leader = TRUE
                )
            )
        )
    )
)
WITH CHECK (
    auth.role() = 'service_role'
    OR (
        public.is_user_active() = TRUE
        AND (
            public.get_current_user_role() = 'Admin'
            OR (
                public.get_current_user_role() = 'PE-MFG'
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.is_department_leader = TRUE
                )
            )
        )
    )
);

-- 5. Updated close_job_final RPC (Option B + Final Evaluation + Snapshot Initialization)
CREATE OR REPLACE FUNCTION public.close_job_final(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_close_reason TEXT DEFAULT NULL,
    p_acknowledged_warnings JSONB DEFAULT '[]'::jsonb,
    p_evaluation_result TEXT DEFAULT 'PASS',
    p_overall_assessment TEXT DEFAULT '',
    p_improvements_required TEXT DEFAULT NULL,
    p_unresolved_issues TEXT DEFAULT NULL
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
    v_eval_enum public.final_evaluation_result;
    v_trimmed_assessment TEXT;
    v_final_snapshot JSONB;
    v_report_id UUID;
BEGIN
    -- 1. Authorization Guard: PE-MFG Leader or Admin
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_uid := auth.uid();
        v_is_leader := TRUE;
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

    -- 2. Input Validation: Confirmation Ticket
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập lại mã JOB Ticket để xác nhận đóng JOB.';
    END IF;

    -- 2.1 Validate Final Evaluation fields
    BEGIN
        v_eval_enum := p_evaluation_result::public.final_evaluation_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Kết quả đánh giá mẫu không hợp lệ: %. Yêu cầu chọn PASS, CONDITIONAL hoặc FAIL.', p_evaluation_result;
    END;

    v_trimmed_assessment := trim(COALESCE(p_overall_assessment, ''));
    IF length(v_trimmed_assessment) < 5 THEN
        RAISE EXCEPTION 'Vui lòng nhập Đánh giá kỹ thuật tổng thể cho đợt sản xuất mẫu (tối thiểu 5 ký tự).';
    END IF;

    IF v_eval_enum = 'CONDITIONAL' AND (p_improvements_required IS NULL OR length(trim(p_improvements_required)) < 5) THEN
        RAISE EXCEPTION 'Đối với kết quả CONDITIONAL (Đạt có điều kiện), bắt buộc nêu rõ các hạng mục cần cải tiến (tối thiểu 5 ký tự).';
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

    -- If there are warnings, close reason is mandatory (minimum 5 chars)
    IF v_warning_count > 0 AND (p_close_reason IS NULL OR length(trim(p_close_reason)) < 5) THEN
        RAISE EXCEPTION 'JOB còn cảnh báo chưa hoàn tất (% pcs KIV tồn đọng, % công đoạn thiếu QA, % kiểm tra NG/KIV). Bắt buộc nhập lý do giải trình chấp nhận đóng JOB (tối thiểu 5 ký tự).',
            v_remaining_kiv, v_missing_qa, v_qa_ng_kiv;
    END IF;

    -- 6. Compile Deep Final Immutable Snapshot
    -- IMPORTANT: OK/NG quantities are compiled strictly PER OPERATION; never summed across serial operations.
    SELECT jsonb_build_object(
        'job_id', v_job.id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'part_name', v_job.part_name,
        'customer', v_job.customer,
        'order_qty', v_job.order_qty,
        'material', v_job.material,
        'planned_start_date', v_job.planned_start_date,
        'planned_finish_date', v_job.planned_finish_date,
        'delivery_date', v_job.planned_finish_date,
        'material_spec', v_job.material_spec,
        'created_at', v_job.created_at,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name,
        'close_reason', trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        'close_warnings', COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'evaluation', jsonb_build_object(
            'result', v_eval_enum,
            'overall_assessment', v_trimmed_assessment,
            'improvements_required', NULLIF(trim(p_improvements_required), ''),
            'unresolved_issues', NULLIF(trim(p_unresolved_issues), ''),
            'evaluator_name', v_caller_name,
            'evaluator_role', v_caller_role,
            'evaluated_at', timezone('Asia/Ho_Chi_Minh', now())
        ),
        'operations', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'operation_id', jo.id,
                    'step_order', jo.step_order,
                    'operation_name', jo.operation_name,
                    'workcenter_code', jo.workcenter_code,
                    'machine_no', jo.machine_no,
                    'status', jo.status,
                    'closed_at', jo.closed_at,
                    'production_run', (
                        SELECT jsonb_build_object(
                            'machine_id', pr.machine_id,
                            'production_date', pr.production_date,
                            'cycle_time_seconds', pr.cycle_time_seconds,
                            'ok_qty', pr.ok_qty,
                            'ng_qty', pr.ng_qty,
                            'kiv_qty', pr.kiv_qty,
                            'notes', pr.notes
                        )
                        FROM public.production_runs pr
                        WHERE pr.operation_id = jo.id
                        ORDER BY pr.created_at DESC
                        LIMIT 1
                    ),
                    'ng_details', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'defect_name', ng.defect_name,
                                'defect_code', ng.defect_code,
                                'defect_qty', ng.defect_qty,
                                'cause', ng.cause,
                                'remark', ng.remark,
                                'photo_urls', ng.photo_urls
                            )
                        ), '[]'::jsonb)
                        FROM public.ng_details ng
                        WHERE ng.operation_id = jo.id
                    ),
                    'qa_checks', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'sample_size', qc.sample_size,
                                'ok_qty', qc.ok_qty,
                                'ng_qty', qc.ng_qty,
                                'result', qc.result,
                                'notes', qc.notes,
                                'created_at', qc.created_at
                            ) ORDER BY qc.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.qa_checks qc
                        WHERE qc.operation_id = jo.id
                    ),
                    'pe_reviews', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'review_result', pe.review_result,
                                'engineering_comment', pe.engineering_comment,
                                'improvement_required', pe.improvement_required,
                                'reviewer_name', pe.reviewer_name,
                                'reviewer_role', pe.reviewer_role,
                                'created_at', pe.created_at
                            ) ORDER BY pe.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.pe_engineering_reviews pe
                        WHERE pe.operation_id = jo.id
                    ),
                    'sample_photos', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'file_name', sp.file_name,
                                'file_path', sp.file_path,
                                'file_size', sp.file_size,
                                'mime_type', sp.mime_type,
                                'uploader_name', sp.uploader_name
                            )
                        ), '[]'::jsonb)
                        FROM public.operation_sample_photos sp
                        WHERE sp.operation_id = jo.id
                    )
                ) ORDER BY jo.step_order ASC
            )
            FROM public.job_operations jo
            WHERE jo.job_id = p_job_id
        ),
        'engineering_documents', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'category', ed.category,
                    'file_name', ed.file_name,
                    'file_path', ed.file_path,
                    'file_size', ed.file_size,
                    'version', ed.version,
                    'remark', ed.remark,
                    'operation_id', ed.operation_id,
                    'uploader_name', ed.uploader_name
                )
            ), '[]'::jsonb)
            FROM public.engineering_documents ed
            WHERE ed.job_id = p_job_id
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

    -- 8. Initialize sample_final_reports record (Pending state)
    INSERT INTO public.sample_final_reports (
        job_id,
        evaluation_result,
        overall_assessment,
        improvements_required,
        unresolved_issues,
        closed_by,
        closed_by_name,
        closed_at,
        close_reason,
        close_warnings,
        snapshot_data,
        generation_status,
        created_at,
        updated_at
    ) VALUES (
        p_job_id,
        v_eval_enum,
        v_trimmed_assessment,
        NULLIF(trim(p_improvements_required), ''),
        NULLIF(trim(p_unresolved_issues), ''),
        v_caller_uid,
        v_caller_name,
        timezone('Asia/Ho_Chi_Minh', now()),
        NULLIF(trim(p_close_reason), ''),
        COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        v_final_snapshot,
        'Pending',
        timezone('Asia/Ho_Chi_Minh', now()),
        timezone('Asia/Ho_Chi_Minh', now())
    )
    ON CONFLICT (job_id) DO UPDATE
    SET evaluation_result = EXCLUDED.evaluation_result,
        overall_assessment = EXCLUDED.overall_assessment,
        improvements_required = EXCLUDED.improvements_required,
        unresolved_issues = EXCLUDED.unresolved_issues,
        closed_by = EXCLUDED.closed_by,
        closed_by_name = EXCLUDED.closed_by_name,
        closed_at = EXCLUDED.closed_at,
        close_reason = EXCLUDED.close_reason,
        close_warnings = EXCLUDED.close_warnings,
        snapshot_data = EXCLUDED.snapshot_data,
        generation_status = 'Pending',
        generation_error = NULL,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    RETURNING id INTO v_report_id;

    -- 9. Record Audit Log
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
            'evaluation_result', v_eval_enum,
            'report_id', v_report_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'report_id', v_report_id,
        'status', 'CLOSE',
        'generation_status', 'Pending',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'message', 'Đã đóng Lệnh sản xuất thành công. Toàn bộ dữ liệu của JOB đã chuyển sang chế độ READ-ONLY vĩnh viễn và tiến trình sinh Báo cáo Mẫu đã được kích hoạt.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- >>> MIGRATION: 00023_fix_report_snapshot_columns.sql <<<
-- ============================================================================
-- Migration: 00023_fix_report_snapshot_columns.sql
-- Description:
--   Update close_job_final to use valid jobs table columns
--   (planned_start_date, planned_finish_date, material_spec).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_job_final(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_close_reason TEXT DEFAULT NULL,
    p_acknowledged_warnings JSONB DEFAULT '[]'::jsonb,
    p_evaluation_result TEXT DEFAULT 'PASS',
    p_overall_assessment TEXT DEFAULT '',
    p_improvements_required TEXT DEFAULT NULL,
    p_unresolved_issues TEXT DEFAULT NULL
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
    v_eval_enum public.final_evaluation_result;
    v_trimmed_assessment TEXT;
    v_final_snapshot JSONB;
    v_report_id UUID;
BEGIN
    -- 1. Authorization Guard: PE-MFG Leader or Admin
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_uid := auth.uid();
        v_is_leader := TRUE;
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

    -- 2. Input Validation: Confirmation Ticket
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập lại mã JOB Ticket để xác nhận đóng JOB.';
    END IF;

    -- 2.1 Validate Final Evaluation fields
    BEGIN
        v_eval_enum := p_evaluation_result::public.final_evaluation_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Kết quả đánh giá mẫu không hợp lệ: %. Yêu cầu chọn PASS, CONDITIONAL hoặc FAIL.', p_evaluation_result;
    END;

    v_trimmed_assessment := trim(COALESCE(p_overall_assessment, ''));
    IF length(v_trimmed_assessment) < 5 THEN
        RAISE EXCEPTION 'Vui lòng nhập Đánh giá kỹ thuật tổng thể cho đợt sản xuất mẫu (tối thiểu 5 ký tự).';
    END IF;

    IF v_eval_enum = 'CONDITIONAL' AND (p_improvements_required IS NULL OR length(trim(p_improvements_required)) < 5) THEN
        RAISE EXCEPTION 'Đối với kết quả CONDITIONAL (Đạt có điều kiện), bắt buộc nêu rõ các hạng mục cần cải tiến (tối thiểu 5 ký tự).';
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

    -- If there are warnings, close reason is mandatory (minimum 5 chars)
    IF v_warning_count > 0 AND (p_close_reason IS NULL OR length(trim(p_close_reason)) < 5) THEN
        RAISE EXCEPTION 'JOB còn cảnh báo chưa hoàn tất (% pcs KIV tồn đọng, % công đoạn thiếu QA, % kiểm tra NG/KIV). Bắt buộc nhập lý do giải trình chấp nhận đóng JOB (tối thiểu 5 ký tự).',
            v_remaining_kiv, v_missing_qa, v_qa_ng_kiv;
    END IF;

    -- 6. Compile Deep Final Immutable Snapshot
    -- IMPORTANT: OK/NG quantities are compiled strictly PER OPERATION; never summed across serial operations.
    SELECT jsonb_build_object(
        'job_id', v_job.id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'part_name', v_job.part_name,
        'customer', v_job.customer,
        'order_qty', v_job.order_qty,
        'material', v_job.material,
        'planned_start_date', v_job.planned_start_date,
        'planned_finish_date', v_job.planned_finish_date,
        'delivery_date', v_job.planned_finish_date,
        'material_spec', v_job.material_spec,
        'created_at', v_job.created_at,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name,
        'close_reason', trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        'close_warnings', COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'evaluation', jsonb_build_object(
            'result', v_eval_enum,
            'overall_assessment', v_trimmed_assessment,
            'improvements_required', NULLIF(trim(p_improvements_required), ''),
            'unresolved_issues', NULLIF(trim(p_unresolved_issues), ''),
            'evaluator_name', v_caller_name,
            'evaluator_role', v_caller_role,
            'evaluated_at', timezone('Asia/Ho_Chi_Minh', now())
        ),
        'operations', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'operation_id', jo.id,
                    'step_order', jo.step_order,
                    'operation_name', jo.operation_name,
                    'workcenter_code', jo.workcenter_code,
                    'machine_no', jo.machine_no,
                    'status', jo.status,
                    'closed_at', jo.closed_at,
                    'production_run', (
                        SELECT jsonb_build_object(
                            'machine_id', pr.machine_id,
                            'production_date', pr.production_date,
                            'cycle_time_seconds', pr.cycle_time_seconds,
                            'ok_qty', pr.ok_qty,
                            'ng_qty', pr.ng_qty,
                            'kiv_qty', pr.kiv_qty,
                            'notes', pr.notes
                        )
                        FROM public.production_runs pr
                        WHERE pr.operation_id = jo.id
                        ORDER BY pr.created_at DESC
                        LIMIT 1
                    ),
                    'ng_details', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'defect_name', ng.defect_name,
                                'defect_code', ng.defect_code,
                                'defect_qty', ng.defect_qty,
                                'cause', ng.cause,
                                'remark', ng.remark,
                                'photo_urls', ng.photo_urls
                            )
                        ), '[]'::jsonb)
                        FROM public.ng_details ng
                        WHERE ng.operation_id = jo.id
                    ),
                    'qa_checks', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'sample_size', qc.sample_size,
                                'ok_qty', qc.ok_qty,
                                'ng_qty', qc.ng_qty,
                                'result', qc.result,
                                'notes', qc.notes,
                                'created_at', qc.created_at
                            ) ORDER BY qc.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.qa_checks qc
                        WHERE qc.operation_id = jo.id
                    ),
                    'pe_reviews', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'review_result', pe.review_result,
                                'engineering_comment', pe.engineering_comment,
                                'improvement_required', pe.improvement_required,
                                'reviewer_name', pe.reviewer_name,
                                'reviewer_role', pe.reviewer_role,
                                'created_at', pe.created_at
                            ) ORDER BY pe.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.pe_engineering_reviews pe
                        WHERE pe.operation_id = jo.id
                    ),
                    'sample_photos', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'file_name', sp.file_name,
                                'file_path', sp.file_path,
                                'file_size', sp.file_size,
                                'mime_type', sp.mime_type,
                                'uploader_name', sp.uploader_name
                            )
                        ), '[]'::jsonb)
                        FROM public.operation_sample_photos sp
                        WHERE sp.operation_id = jo.id
                    )
                ) ORDER BY jo.step_order ASC
            )
            FROM public.job_operations jo
            WHERE jo.job_id = p_job_id
        ),
        'engineering_documents', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'category', ed.category,
                    'file_name', ed.file_name,
                    'file_path', ed.file_path,
                    'file_size', ed.file_size,
                    'version', ed.version,
                    'remark', ed.remark,
                    'operation_id', ed.operation_id,
                    'uploader_name', ed.uploader_name
                )
            ), '[]'::jsonb)
            FROM public.engineering_documents ed
            WHERE ed.job_id = p_job_id
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

    -- 8. Initialize sample_final_reports record (Pending state)
    INSERT INTO public.sample_final_reports (
        job_id,
        evaluation_result,
        overall_assessment,
        improvements_required,
        unresolved_issues,
        closed_by,
        closed_by_name,
        closed_at,
        close_reason,
        close_warnings,
        snapshot_data,
        generation_status,
        created_at,
        updated_at
    ) VALUES (
        p_job_id,
        v_eval_enum,
        v_trimmed_assessment,
        NULLIF(trim(p_improvements_required), ''),
        NULLIF(trim(p_unresolved_issues), ''),
        v_caller_uid,
        v_caller_name,
        timezone('Asia/Ho_Chi_Minh', now()),
        NULLIF(trim(p_close_reason), ''),
        COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        v_final_snapshot,
        'Pending',
        timezone('Asia/Ho_Chi_Minh', now()),
        timezone('Asia/Ho_Chi_Minh', now())
    )
    ON CONFLICT (job_id) DO UPDATE
    SET evaluation_result = EXCLUDED.evaluation_result,
        overall_assessment = EXCLUDED.overall_assessment,
        improvements_required = EXCLUDED.improvements_required,
        unresolved_issues = EXCLUDED.unresolved_issues,
        closed_by = EXCLUDED.closed_by,
        closed_by_name = EXCLUDED.closed_by_name,
        closed_at = EXCLUDED.closed_at,
        close_reason = EXCLUDED.close_reason,
        close_warnings = EXCLUDED.close_warnings,
        snapshot_data = EXCLUDED.snapshot_data,
        generation_status = 'Pending',
        generation_error = NULL,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    RETURNING id INTO v_report_id;

    -- 9. Record Audit Log
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
            'evaluation_result', v_eval_enum,
            'report_id', v_report_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'report_id', v_report_id,
        'status', 'CLOSE',
        'generation_status', 'Pending',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'message', 'Đã đóng Lệnh sản xuất thành công. Toàn bộ dữ liệu của JOB đã chuyển sang chế độ READ-ONLY vĩnh viễn và tiến trình sinh Báo cáo Mẫu đã được kích hoạt.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- >>> MIGRATION: 00024_fix_report_snapshot_join.sql <<<
-- ============================================================================
-- Migration: 00024_fix_report_snapshot_join.sql
-- Description:
--   Fix close_job_final snapshot compilation:
--   1. Change pr.notes -> pr.remarks in production_run object.
--   2. Fix ng_details query: join production_runs on production_run_id and use ng_qty.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_job_final(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_close_reason TEXT DEFAULT NULL,
    p_acknowledged_warnings JSONB DEFAULT '[]'::jsonb,
    p_evaluation_result TEXT DEFAULT 'PASS',
    p_overall_assessment TEXT DEFAULT '',
    p_improvements_required TEXT DEFAULT NULL,
    p_unresolved_issues TEXT DEFAULT NULL
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
    v_eval_enum public.final_evaluation_result;
    v_trimmed_assessment TEXT;
    v_final_snapshot JSONB;
    v_report_id UUID;
BEGIN
    -- 1. Authorization Guard: PE-MFG Leader or Admin
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_uid := auth.uid();
        v_is_leader := TRUE;
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

    -- 2. Input Validation: Confirmation Ticket
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập lại mã JOB Ticket để xác nhận đóng JOB.';
    END IF;

    -- 2.1 Validate Final Evaluation fields
    BEGIN
        v_eval_enum := p_evaluation_result::public.final_evaluation_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Kết quả đánh giá mẫu không hợp lệ: %. Yêu cầu chọn PASS, CONDITIONAL hoặc FAIL.', p_evaluation_result;
    END;

    v_trimmed_assessment := trim(COALESCE(p_overall_assessment, ''));
    IF length(v_trimmed_assessment) < 5 THEN
        RAISE EXCEPTION 'Vui lòng nhập Đánh giá kỹ thuật tổng thể cho đợt sản xuất mẫu (tối thiểu 5 ký tự).';
    END IF;

    IF v_eval_enum = 'CONDITIONAL' AND (p_improvements_required IS NULL OR length(trim(p_improvements_required)) < 5) THEN
        RAISE EXCEPTION 'Đối với kết quả CONDITIONAL (Đạt có điều kiện), bắt buộc nêu rõ các hạng mục cần cải tiến (tối thiểu 5 ký tự).';
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

    -- If there are warnings, close reason is mandatory (minimum 5 chars)
    IF v_warning_count > 0 AND (p_close_reason IS NULL OR length(trim(p_close_reason)) < 5) THEN
        RAISE EXCEPTION 'JOB còn cảnh báo chưa hoàn tất (% pcs KIV tồn đọng, % công đoạn thiếu QA, % kiểm tra NG/KIV). Bắt buộc nhập lý do giải trình chấp nhận đóng JOB (tối thiểu 5 ký tự).',
            v_remaining_kiv, v_missing_qa, v_qa_ng_kiv;
    END IF;

    -- 6. Compile Deep Final Immutable Snapshot
    -- IMPORTANT: OK/NG quantities are compiled strictly PER OPERATION; never summed across serial operations.
    SELECT jsonb_build_object(
        'job_id', v_job.id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'part_name', v_job.part_name,
        'customer', v_job.customer,
        'order_qty', v_job.order_qty,
        'material', v_job.material,
        'planned_start_date', v_job.planned_start_date,
        'planned_finish_date', v_job.planned_finish_date,
        'delivery_date', v_job.planned_finish_date,
        'material_spec', v_job.material_spec,
        'created_at', v_job.created_at,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name,
        'close_reason', trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        'close_warnings', COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'evaluation', jsonb_build_object(
            'result', v_eval_enum,
            'overall_assessment', v_trimmed_assessment,
            'improvements_required', NULLIF(trim(p_improvements_required), ''),
            'unresolved_issues', NULLIF(trim(p_unresolved_issues), ''),
            'evaluator_name', v_caller_name,
            'evaluator_role', v_caller_role,
            'evaluated_at', timezone('Asia/Ho_Chi_Minh', now())
        ),
        'operations', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'operation_id', jo.id,
                    'step_order', jo.step_order,
                    'operation_name', jo.operation_name,
                    'workcenter_code', jo.workcenter_code,
                    'machine_no', jo.machine_no,
                    'status', jo.status,
                    'closed_at', jo.closed_at,
                    'production_run', (
                        SELECT jsonb_build_object(
                            'machine_id', pr.machine_id,
                            'production_date', pr.production_date,
                            'cycle_time_seconds', pr.cycle_time_seconds,
                            'ok_qty', pr.ok_qty,
                            'ng_qty', pr.ng_qty,
                            'kiv_qty', pr.kiv_qty,
                            'remarks', pr.remarks
                        )
                        FROM public.production_runs pr
                        WHERE pr.operation_id = jo.id
                        ORDER BY pr.created_at DESC
                        LIMIT 1
                    ),
                    'ng_details', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'defect_name', ng.defect_name,
                                'defect_code', ng.defect_code,
                                'defect_qty', ng.ng_qty,
                                'cause', ng.cause,
                                'remark', ng.remark,
                                'photo_urls', ng.photo_urls
                            )
                        ), '[]'::jsonb)
                        FROM public.ng_details ng
                        JOIN public.production_runs pr_ng ON pr_ng.id = ng.production_run_id
                        WHERE pr_ng.operation_id = jo.id
                    ),
                    'qa_checks', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'sample_size', qc.sample_size,
                                'ok_qty', qc.ok_qty,
                                'ng_qty', qc.ng_qty,
                                'result', qc.result,
                                'notes', qc.notes,
                                'created_at', qc.created_at
                            ) ORDER BY qc.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.qa_checks qc
                        WHERE qc.operation_id = jo.id
                    ),
                    'pe_reviews', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'review_result', pe.review_result,
                                'engineering_comment', pe.engineering_comment,
                                'improvement_required', pe.improvement_required,
                                'reviewer_name', pe.reviewer_name,
                                'reviewer_role', pe.reviewer_role,
                                'created_at', pe.created_at
                            ) ORDER BY pe.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.pe_engineering_reviews pe
                        WHERE pe.operation_id = jo.id
                    ),
                    'sample_photos', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'file_name', sp.file_name,
                                'file_path', sp.file_path,
                                'file_size', sp.file_size,
                                'mime_type', sp.mime_type,
                                'uploader_name', sp.uploader_name
                            )
                        ), '[]'::jsonb)
                        FROM public.operation_sample_photos sp
                        WHERE sp.operation_id = jo.id
                    )
                ) ORDER BY jo.step_order ASC
            )
            FROM public.job_operations jo
            WHERE jo.job_id = p_job_id
        ),
        'engineering_documents', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'category', ed.category,
                    'file_name', ed.file_name,
                    'file_path', ed.file_path,
                    'file_size', ed.file_size,
                    'version', ed.version,
                    'remark', ed.remark,
                    'operation_id', ed.operation_id,
                    'uploader_name', ed.uploader_name
                )
            ), '[]'::jsonb)
            FROM public.engineering_documents ed
            WHERE ed.job_id = p_job_id
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

    -- 8. Initialize sample_final_reports record (Pending state)
    INSERT INTO public.sample_final_reports (
        job_id,
        evaluation_result,
        overall_assessment,
        improvements_required,
        unresolved_issues,
        closed_by,
        closed_by_name,
        closed_at,
        close_reason,
        close_warnings,
        snapshot_data,
        generation_status,
        created_at,
        updated_at
    ) VALUES (
        p_job_id,
        v_eval_enum,
        v_trimmed_assessment,
        NULLIF(trim(p_improvements_required), ''),
        NULLIF(trim(p_unresolved_issues), ''),
        v_caller_uid,
        v_caller_name,
        timezone('Asia/Ho_Chi_Minh', now()),
        NULLIF(trim(p_close_reason), ''),
        COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        v_final_snapshot,
        'Pending',
        timezone('Asia/Ho_Chi_Minh', now()),
        timezone('Asia/Ho_Chi_Minh', now())
    )
    ON CONFLICT (job_id) DO UPDATE
    SET evaluation_result = EXCLUDED.evaluation_result,
        overall_assessment = EXCLUDED.overall_assessment,
        improvements_required = EXCLUDED.improvements_required,
        unresolved_issues = EXCLUDED.unresolved_issues,
        closed_by = EXCLUDED.closed_by,
        closed_by_name = EXCLUDED.closed_by_name,
        closed_at = EXCLUDED.closed_at,
        close_reason = EXCLUDED.close_reason,
        close_warnings = EXCLUDED.close_warnings,
        snapshot_data = EXCLUDED.snapshot_data,
        generation_status = 'Pending',
        generation_error = NULL,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    RETURNING id INTO v_report_id;

    -- 9. Record Audit Log
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
            'evaluation_result', v_eval_enum,
            'report_id', v_report_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'report_id', v_report_id,
        'status', 'CLOSE',
        'generation_status', 'Pending',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'message', 'Đã đóng Lệnh sản xuất thành công. Toàn bộ dữ liệu của JOB đã chuyển sang chế độ READ-ONLY vĩnh viễn và tiến trình sinh Báo cáo Mẫu đã được kích hoạt.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- >>> MIGRATION: 00025_fix_service_role_caller_uid.sql <<<
-- ============================================================================
-- Migration: 00025_fix_service_role_caller_uid.sql
-- Description:
--   1. Allow closed_by to be NULLABLE on sample_final_reports for service_role/system callers.
--   2. In close_job_final, if auth.uid() is null for service_role, fall back to active Admin profile id.
-- ============================================================================

ALTER TABLE public.sample_final_reports 
    ALTER COLUMN closed_by DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.close_job_final(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_close_reason TEXT DEFAULT NULL,
    p_acknowledged_warnings JSONB DEFAULT '[]'::jsonb,
    p_evaluation_result TEXT DEFAULT 'PASS',
    p_overall_assessment TEXT DEFAULT '',
    p_improvements_required TEXT DEFAULT NULL,
    p_unresolved_issues TEXT DEFAULT NULL
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
    v_eval_enum public.final_evaluation_result;
    v_trimmed_assessment TEXT;
    v_final_snapshot JSONB;
    v_report_id UUID;
BEGIN
    -- 1. Authorization Guard: PE-MFG Leader or Admin
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_caller_uid := auth.uid();
        IF v_caller_uid IS NULL THEN
            SELECT id INTO v_caller_uid FROM public.profiles WHERE role = 'Admin' AND is_active = TRUE LIMIT 1;
        END IF;
        v_is_leader := TRUE;
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

    -- 2. Input Validation: Confirmation Ticket
    v_trimmed_ticket := trim(p_confirm_ticket);
    IF v_trimmed_ticket IS NULL OR length(v_trimmed_ticket) = 0 THEN
        RAISE EXCEPTION 'Vui lòng nhập lại mã JOB Ticket để xác nhận đóng JOB.';
    END IF;

    -- 2.1 Validate Final Evaluation fields
    BEGIN
        v_eval_enum := p_evaluation_result::public.final_evaluation_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Kết quả đánh giá mẫu không hợp lệ: %. Yêu cầu chọn PASS, CONDITIONAL hoặc FAIL.', p_evaluation_result;
    END;

    v_trimmed_assessment := trim(COALESCE(p_overall_assessment, ''));
    IF length(v_trimmed_assessment) < 5 THEN
        RAISE EXCEPTION 'Vui lòng nhập Đánh giá kỹ thuật tổng thể cho đợt sản xuất mẫu (tối thiểu 5 ký tự).';
    END IF;

    IF v_eval_enum = 'CONDITIONAL' AND (p_improvements_required IS NULL OR length(trim(p_improvements_required)) < 5) THEN
        RAISE EXCEPTION 'Đối với kết quả CONDITIONAL (Đạt có điều kiện), bắt buộc nêu rõ các hạng mục cần cải tiến (tối thiểu 5 ký tự).';
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

    -- If there are warnings, close reason is mandatory (minimum 5 chars)
    IF v_warning_count > 0 AND (p_close_reason IS NULL OR length(trim(p_close_reason)) < 5) THEN
        RAISE EXCEPTION 'JOB còn cảnh báo chưa hoàn tất (% pcs KIV tồn đọng, % công đoạn thiếu QA, % kiểm tra NG/KIV). Bắt buộc nhập lý do giải trình chấp nhận đóng JOB (tối thiểu 5 ký tự).',
            v_remaining_kiv, v_missing_qa, v_qa_ng_kiv;
    END IF;

    -- 6. Compile Deep Final Immutable Snapshot
    -- IMPORTANT: OK/NG quantities are compiled strictly PER OPERATION; never summed across serial operations.
    SELECT jsonb_build_object(
        'job_id', v_job.id,
        'job_no', v_job.job_no,
        'part_no', v_job.part_no,
        'part_name', v_job.part_name,
        'customer', v_job.customer,
        'order_qty', v_job.order_qty,
        'material', v_job.material,
        'planned_start_date', v_job.planned_start_date,
        'planned_finish_date', v_job.planned_finish_date,
        'delivery_date', v_job.planned_finish_date,
        'material_spec', v_job.material_spec,
        'created_at', v_job.created_at,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name,
        'close_reason', trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        'close_warnings', COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'evaluation', jsonb_build_object(
            'result', v_eval_enum,
            'overall_assessment', v_trimmed_assessment,
            'improvements_required', NULLIF(trim(p_improvements_required), ''),
            'unresolved_issues', NULLIF(trim(p_unresolved_issues), ''),
            'evaluator_name', v_caller_name,
            'evaluator_role', v_caller_role,
            'evaluated_at', timezone('Asia/Ho_Chi_Minh', now())
        ),
        'operations', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'operation_id', jo.id,
                    'step_order', jo.step_order,
                    'operation_name', jo.operation_name,
                    'workcenter_code', jo.workcenter_code,
                    'machine_no', jo.machine_no,
                    'status', jo.status,
                    'closed_at', jo.closed_at,
                    'production_run', (
                        SELECT jsonb_build_object(
                            'machine_id', pr.machine_id,
                            'production_date', pr.production_date,
                            'cycle_time_seconds', pr.cycle_time_seconds,
                            'ok_qty', pr.ok_qty,
                            'ng_qty', pr.ng_qty,
                            'kiv_qty', pr.kiv_qty,
                            'remarks', pr.remarks
                        )
                        FROM public.production_runs pr
                        WHERE pr.operation_id = jo.id
                        ORDER BY pr.created_at DESC
                        LIMIT 1
                    ),
                    'ng_details', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'defect_name', ng.defect_name,
                                'defect_code', ng.defect_code,
                                'defect_qty', ng.ng_qty,
                                'cause', ng.cause,
                                'remark', ng.remark,
                                'photo_urls', ng.photo_urls
                            )
                        ), '[]'::jsonb)
                        FROM public.ng_details ng
                        JOIN public.production_runs pr_ng ON pr_ng.id = ng.production_run_id
                        WHERE pr_ng.operation_id = jo.id
                    ),
                    'qa_checks', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'sample_size', qc.sample_size,
                                'ok_qty', qc.ok_qty,
                                'ng_qty', qc.ng_qty,
                                'result', qc.result,
                                'notes', qc.notes,
                                'created_at', qc.created_at
                            ) ORDER BY qc.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.qa_checks qc
                        WHERE qc.operation_id = jo.id
                    ),
                    'pe_reviews', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'review_result', pe.review_result,
                                'engineering_comment', pe.engineering_comment,
                                'improvement_required', pe.improvement_required,
                                'reviewer_name', pe.reviewer_name,
                                'reviewer_role', pe.reviewer_role,
                                'created_at', pe.created_at
                            ) ORDER BY pe.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.pe_engineering_reviews pe
                        WHERE pe.operation_id = jo.id
                    ),
                    'sample_photos', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'file_name', sp.file_name,
                                'file_path', sp.file_path,
                                'file_size', sp.file_size,
                                'mime_type', sp.mime_type,
                                'uploader_name', sp.uploader_name
                            )
                        ), '[]'::jsonb)
                        FROM public.operation_sample_photos sp
                        WHERE sp.operation_id = jo.id
                    )
                ) ORDER BY jo.step_order ASC
            )
            FROM public.job_operations jo
            WHERE jo.job_id = p_job_id
        ),
        'engineering_documents', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'category', ed.category,
                    'file_name', ed.file_name,
                    'file_path', ed.file_path,
                    'file_size', ed.file_size,
                    'version', ed.version,
                    'remark', ed.remark,
                    'operation_id', ed.operation_id,
                    'uploader_name', ed.uploader_name
                )
            ), '[]'::jsonb)
            FROM public.engineering_documents ed
            WHERE ed.job_id = p_job_id
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

    -- 8. Initialize sample_final_reports record (Pending state)
    INSERT INTO public.sample_final_reports (
        job_id,
        evaluation_result,
        overall_assessment,
        improvements_required,
        unresolved_issues,
        closed_by,
        closed_by_name,
        closed_at,
        close_reason,
        close_warnings,
        snapshot_data,
        generation_status,
        created_at,
        updated_at
    ) VALUES (
        p_job_id,
        v_eval_enum,
        v_trimmed_assessment,
        NULLIF(trim(p_improvements_required), ''),
        NULLIF(trim(p_unresolved_issues), ''),
        v_caller_uid,
        v_caller_name,
        timezone('Asia/Ho_Chi_Minh', now()),
        NULLIF(trim(p_close_reason), ''),
        COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        v_final_snapshot,
        'Pending',
        timezone('Asia/Ho_Chi_Minh', now()),
        timezone('Asia/Ho_Chi_Minh', now())
    )
    ON CONFLICT (job_id) DO UPDATE
    SET evaluation_result = EXCLUDED.evaluation_result,
        overall_assessment = EXCLUDED.overall_assessment,
        improvements_required = EXCLUDED.improvements_required,
        unresolved_issues = EXCLUDED.unresolved_issues,
        closed_by = EXCLUDED.closed_by,
        closed_by_name = EXCLUDED.closed_by_name,
        closed_at = EXCLUDED.closed_at,
        close_reason = EXCLUDED.close_reason,
        close_warnings = EXCLUDED.close_warnings,
        snapshot_data = EXCLUDED.snapshot_data,
        generation_status = 'Pending',
        generation_error = NULL,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    RETURNING id INTO v_report_id;

    -- 9. Record Audit Log
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
            'evaluation_result', v_eval_enum,
            'report_id', v_report_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'report_id', v_report_id,
        'status', 'CLOSE',
        'generation_status', 'Pending',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'message', 'Đã đóng Lệnh sản xuất thành công. Toàn bộ dữ liệu của JOB đã chuyển sang chế độ READ-ONLY vĩnh viễn và tiến trình sinh Báo cáo Mẫu đã được kích hoạt.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


