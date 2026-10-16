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
