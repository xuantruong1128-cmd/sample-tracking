-- ==============================================================================
-- SAMPLE TRACKING V1.0 — INITIAL DATABASE SCHEMA
-- Migration: 00001_initial_schema.sql
-- Description: Core tables, relationships, constraints, and audit structure.
-- Timezone context: Asia/Ho_Chi_Minh (+07:00)
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CUSTOM TYPES & ENUMS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('Planning', 'PE-MFG', 'QA', 'Admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM ('ACTIVE', 'CLOSE', 'ARCHIVE', 'PURGED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_status') THEN
        CREATE TYPE operation_status AS ENUM (
            'NOT_STARTED',
            'IN_PROGRESS',
            'WAITING_QA',
            'QA_KIV',
            'QA_NG',
            'COMPLETED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qa_result') THEN
        CREATE TYPE qa_result AS ENUM ('OK', 'NG', 'KIV');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_type') THEN
        CREATE TYPE attachment_type AS ENUM (
            'DRAWING',
            'CHECK_SHEET',
            'SETTING_SHEET',
            'NG_PHOTO',
            'OTHER'
        );
    END IF;
END $$;

-- 3. USERS / PROFILES TABLE
-- Directly mapped to Supabase auth.users. Never stores plaintext passwords.
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    full_name TEXT NOT NULL,
    role user_role NOT NULL,
    department TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

-- Index for phone queries
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 4. JOBS TABLE
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
    status job_status NOT NULL DEFAULT 'ACTIVE',
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

-- 5. JOB OPERATIONS TABLE
CREATE TABLE IF NOT EXISTS public.job_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL CHECK (step_order >= 1),
    operation_name TEXT NOT NULL,
    planned_machine TEXT,
    planned_cycle_time_seconds NUMERIC(8, 2),
    status operation_status NOT NULL DEFAULT 'NOT_STARTED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT uq_job_step_order UNIQUE (job_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_job_operations_job_id ON public.job_operations(job_id);
CREATE INDEX IF NOT EXISTS idx_job_operations_step_order ON public.job_operations(job_id, step_order);

-- 6. DEFECT CATALOG TABLE
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

-- 7. PRODUCTION RUNS TABLE (Append-only)
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

-- 8. NG DETAILS TABLE
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

-- 9. QA CHECKS TABLE (Append-only)
CREATE TABLE IF NOT EXISTS public.qa_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    inspector_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    inspector_name TEXT NOT NULL,
    inspection_time TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    sample_size INTEGER NOT NULL CHECK (sample_size > 0),
    ok_qty INTEGER NOT NULL DEFAULT 0 CHECK (ok_qty >= 0),
    ng_qty INTEGER NOT NULL DEFAULT 0 CHECK (ng_qty >= 0),
    result qa_result NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT chk_qa_quantities CHECK (ok_qty + ng_qty <= sample_size)
);

CREATE INDEX IF NOT EXISTS idx_qa_checks_op_id ON public.qa_checks(operation_id);
CREATE INDEX IF NOT EXISTS idx_qa_checks_time ON public.qa_checks(inspection_time);

-- 10. ATTACHMENTS TABLE
CREATE TABLE IF NOT EXISTS public.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID REFERENCES public.job_operations(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    mime_type TEXT NOT NULL,
    file_type attachment_type NOT NULL,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_attachments_job_id ON public.attachments(job_id);
CREATE INDEX IF NOT EXISTS idx_attachments_operation_id ON public.attachments(operation_id);

-- 11. AUDIT LOGS TABLE (Append-only)
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON public.audit_logs(created_at);

-- 12. JOB ARCHIVES TABLE
CREATE TABLE IF NOT EXISTS public.job_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    job_no TEXT NOT NULL,
    archive_zip_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    archive_size BIGINT NOT NULL,
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ARCHIVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_job_archives_job ON public.job_archives(job_id, job_no);

-- 13. AUTOMATIC UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('Asia/Ho_Chi_Minh', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach updated_at triggers
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_updated_at
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_job_operations_updated_at ON public.job_operations;
CREATE TRIGGER trg_job_operations_updated_at
    BEFORE UPDATE ON public.job_operations
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
