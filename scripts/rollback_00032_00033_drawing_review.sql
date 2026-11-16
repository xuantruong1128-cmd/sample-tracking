-- ============================================================================
-- Rollback Script: rollback_00032_00033_drawing_review.sql
-- Description: Safely rolls back migrations 00032 and 00033
-- ============================================================================

-- 1. Drop Storage Policies & Bucket
DROP POLICY IF EXISTS "p_storage_drawing_reviews_insert" ON storage.objects;
DROP POLICY IF EXISTS "p_storage_drawing_reviews_select" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'drawing-reviews';

-- 2. Drop RLS Policies
DROP POLICY IF EXISTS "p_drawing_review_attachments_delete" ON public.drawing_review_attachments;
DROP POLICY IF EXISTS "p_drawing_review_attachments_insert" ON public.drawing_review_attachments;
DROP POLICY IF EXISTS "p_drawing_review_attachments_select" ON public.drawing_review_attachments;
DROP POLICY IF EXISTS "p_drawing_review_operations_all" ON public.drawing_review_operations;
DROP POLICY IF EXISTS "p_drawing_review_operations_select" ON public.drawing_review_operations;
DROP POLICY IF EXISTS "p_drawing_review_versions_update" ON public.drawing_review_versions;
DROP POLICY IF EXISTS "p_drawing_review_versions_insert" ON public.drawing_review_versions;
DROP POLICY IF EXISTS "p_drawing_review_versions_select" ON public.drawing_review_versions;
DROP POLICY IF EXISTS "p_drawing_review_issues_update" ON public.drawing_review_issues;
DROP POLICY IF EXISTS "p_drawing_review_issues_insert" ON public.drawing_review_issues;
DROP POLICY IF EXISTS "p_drawing_review_issues_select" ON public.drawing_review_issues;
DROP POLICY IF EXISTS "p_drawing_review_seq_select" ON public.drawing_review_issue_sequences;

-- 3. Drop RPC Functions
DROP FUNCTION IF EXISTS public.create_next_drawing_review_version(UUID);
DROP FUNCTION IF EXISTS public.close_drawing_review_version(UUID);
DROP FUNCTION IF EXISTS public.save_drawing_review_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.create_drawing_review_issue(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.allocate_next_drawing_review_issue_no(TIMESTAMPTZ);

-- 4. Drop Triggers & Trigger Functions
DROP TRIGGER IF EXISTS trg_drawing_review_attachment_immutability ON public.drawing_review_attachments;
DROP FUNCTION IF EXISTS public.check_drawing_review_attachment_immutability();
DROP TRIGGER IF EXISTS trg_drawing_review_operation_immutability ON public.drawing_review_operations;
DROP FUNCTION IF EXISTS public.check_drawing_review_operation_immutability();
DROP TRIGGER IF EXISTS trg_drawing_review_version_immutability ON public.drawing_review_versions;
DROP FUNCTION IF EXISTS public.check_drawing_review_version_immutability();

-- 5. Drop Tables in dependency order
DROP TABLE IF EXISTS public.drawing_review_attachments CASCADE;
DROP TABLE IF EXISTS public.drawing_review_operations CASCADE;
DROP TABLE IF EXISTS public.drawing_review_versions CASCADE;
DROP TABLE IF EXISTS public.drawing_review_issues CASCADE;
DROP TABLE IF EXISTS public.drawing_review_issue_sequences CASCADE;

-- Note on enum: PostgreSQL does not support removing values from an enum type directly
-- (ALTER TYPE ... DROP VALUE is not supported in PostgreSQL). 'BD' can remain unused or
-- user_role can be recreated if full enum purge is required.
