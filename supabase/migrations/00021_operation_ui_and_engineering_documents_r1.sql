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
