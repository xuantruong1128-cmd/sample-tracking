-- ==============================================================================
-- SAMPLE TRACKING V1.0 — ROW LEVEL SECURITY (RLS) POLICIES
-- Migration: 00002_rls_policies.sql
-- Description: Strictly enforces role-based access, inactive account lockout,
--              append-only histories, and private storage isolation.
-- ==============================================================================

-- 1. SECURITY HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role AS $$
    SELECT role FROM public.profiles
    WHERE id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_user_active()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
        FALSE
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 2. ENABLE RLS ON ALL APPLICATION TABLES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ng_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_archives ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. PROFILES POLICIES
-- ------------------------------------------------------------------------------
-- Active authenticated users can read all profiles (to display team members and assignees)
CREATE POLICY "profiles_select_active_users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

-- Only Admin can insert/provision new user profiles
CREATE POLICY "profiles_insert_admin_only"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (public.get_current_user_role() = 'Admin');

-- Only Admin can update profile data, change roles, or deactivate accounts
CREATE POLICY "profiles_update_admin_only"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.get_current_user_role() = 'Admin')
    WITH CHECK (public.get_current_user_role() = 'Admin');

-- Only Admin can delete profiles
CREATE POLICY "profiles_delete_admin_only"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (public.get_current_user_role() = 'Admin');

-- ------------------------------------------------------------------------------
-- 4. JOBS POLICIES
-- ------------------------------------------------------------------------------
-- All active employees can view JOBs
CREATE POLICY "jobs_select_all_active"
    ON public.jobs FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

-- Planning and Admin can create new JOBs
CREATE POLICY "jobs_insert_planning_admin"
    ON public.jobs FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    );

-- Planning and Admin can update ACTIVE JOBs (or change status from ACTIVE to CLOSE)
CREATE POLICY "jobs_update_planning_admin"
    ON public.jobs FOR UPDATE
    TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin') AND
        (status = 'ACTIVE' OR public.get_current_user_role() = 'Admin')
    )
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    );

-- Hard deletes forbidden for all users (F-08 Deletion Safety)
-- Historical manufacturing jobs must follow ACTIVE -> CLOSE -> ARCHIVE -> PURGED lifecycle.

-- ------------------------------------------------------------------------------
-- 5. JOB OPERATIONS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "job_operations_select_active"
    ON public.job_operations FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "job_operations_insert_planning_admin"
    ON public.job_operations FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin') AND
        EXISTS (
            SELECT 1 FROM public.jobs
            WHERE id = job_operations.job_id AND status = 'ACTIVE'
        )
    );

CREATE POLICY "job_operations_update_authorized"
    ON public.job_operations FOR UPDATE
    TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        (
            public.get_current_user_role() IN ('Planning', 'PE-MFG', 'QA', 'Admin')
        ) AND
        EXISTS (
            SELECT 1 FROM public.jobs
            WHERE id = job_operations.job_id AND status = 'ACTIVE'
        )
    )
    WITH CHECK (
        public.is_user_active() = TRUE AND
        EXISTS (
            SELECT 1 FROM public.jobs
            WHERE id = job_operations.job_id AND status = 'ACTIVE'
        )
    );

-- ------------------------------------------------------------------------------
-- 6. PRODUCTION RUNS POLICIES (Append-only)
-- ------------------------------------------------------------------------------
CREATE POLICY "production_runs_select_active"
    ON public.production_runs FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "production_runs_insert_pe_mfg_admin"
    ON public.production_runs FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('PE-MFG', 'Admin') AND
        EXISTS (
            SELECT 1 FROM public.job_operations jo
            JOIN public.jobs j ON j.id = jo.job_id
            WHERE jo.id = production_runs.operation_id AND j.status = 'ACTIVE'
        )
    );

-- ------------------------------------------------------------------------------
-- 7. NG DETAILS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "ng_details_select_active"
    ON public.ng_details FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "ng_details_insert_pe_mfg_admin"
    ON public.ng_details FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('PE-MFG', 'Admin')
    );

-- ------------------------------------------------------------------------------
-- 8. QA CHECKS POLICIES (Append-only)
-- ------------------------------------------------------------------------------
CREATE POLICY "qa_checks_select_active"
    ON public.qa_checks FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "qa_checks_insert_qa_admin"
    ON public.qa_checks FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('QA', 'Admin') AND
        EXISTS (
            SELECT 1 FROM public.job_operations jo
            JOIN public.jobs j ON j.id = jo.job_id
            WHERE jo.id = qa_checks.operation_id AND j.status = 'ACTIVE'
        )
    );

-- ------------------------------------------------------------------------------
-- 9. DEFECT CATALOG POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "defect_catalog_select_active"
    ON public.defect_catalog FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "defect_catalog_manage_qa_admin"
    ON public.defect_catalog FOR ALL
    TO authenticated
    USING (public.get_current_user_role() IN ('QA', 'Admin'))
    WITH CHECK (public.get_current_user_role() IN ('QA', 'Admin'));

-- ------------------------------------------------------------------------------
-- 10. ATTACHMENTS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "attachments_select_active"
    ON public.attachments FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "attachments_insert_active"
    ON public.attachments FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE AND
        EXISTS (
            SELECT 1 FROM public.jobs
            WHERE id = attachments.job_id AND status = 'ACTIVE'
        )
    );

-- ------------------------------------------------------------------------------
-- 11. AUDIT LOGS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "audit_logs_select_admin"
    ON public.audit_logs FOR SELECT
    TO authenticated
    USING (public.get_current_user_role() = 'Admin');

-- Audit logs are written strictly by system triggers, never client INSERT (F-03)
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon;

-- ------------------------------------------------------------------------------
-- 12. JOB ARCHIVES POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "job_archives_select_planning_admin"
    ON public.job_archives FOR SELECT
    TO authenticated
    USING (
        public.is_user_active() = TRUE AND
        public.get_current_user_role() IN ('Planning', 'Admin')
    );

CREATE POLICY "job_archives_manage_admin"
    ON public.job_archives FOR ALL
    TO authenticated
    USING (public.get_current_user_role() = 'Admin')
    WITH CHECK (public.get_current_user_role() = 'Admin');

-- ------------------------------------------------------------------------------
-- 13. PRIVATE STORAGE BUCKET & STORAGE POLICIES
-- ------------------------------------------------------------------------------
-- Initialize private bucket 'sample-documents' (public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'sample-documents',
    'sample-documents',
    FALSE,
    52428800, -- 50MB limit per file
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];

-- Storage RLS: Active authenticated users can read/download private documents
CREATE POLICY "storage_sample_docs_select_active"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE
    );

-- Storage RLS: Active authenticated users can upload documents
CREATE POLICY "storage_sample_docs_insert_active"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'sample-documents' AND
        public.is_user_active() = TRUE
    );
