-- ============================================================================
-- Migration: 00026_production_ux_and_permission_r1.sql
-- Description: Implement Production UX & Permission R1:
--   1. Add 'Viewer' role to public.user_role enum
--   2. Update sample-documents bucket allowed MIME types to include text/csv
--   3. Create table public.qa_documents for operation QA document uploads
--   4. Enable RLS and Storage policies for QA documents
--   5. Enforce immutable Job Ticket (job_no) at database level
--   6. Enforce safe, data-preserving routing modification rules:
--      - Disallow deleting operations that have production_runs, qa_checks,
--        sample_photos, or qa_documents
--      - Disallow modifying planning/routing after ANY operation is CLOSED
--      - Add DELETE policy on job_operations for Planning & Admin
--   7. Add atomic stored procedure update_job_planning_and_routing
--   8. Update close_job_final snapshot builder to include qa_documents
--   9. Update admin_delete_job to clean up qa_documents
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADD 'Viewer' ROLE TO user_role ENUM IF NOT ALREADY PRESENT
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'Viewer'
    ) THEN
        ALTER TYPE public.user_role ADD VALUE 'Viewer';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. UPDATE sample-documents STORAGE BUCKET ALLOWED MIME TYPES
-- ----------------------------------------------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed'
]
WHERE id = 'sample-documents';

-- ----------------------------------------------------------------------------
-- 3. CREATE TABLE public.qa_documents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qa_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN (
        'Inspection Report',
        'CPK/SPC',
        'NG Photos',
        'Measurement Results',
        'Other'
    )),
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 20971520), -- max 20MB
    mime_type TEXT NOT NULL CHECK (mime_type IN (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
    )),
    remark TEXT DEFAULT '',
    uploaded_by UUID REFERENCES public.profiles(id),
    uploader_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_qa_documents_job ON public.qa_documents(job_id);
CREATE INDEX IF NOT EXISTS idx_qa_documents_op ON public.qa_documents(operation_id);
CREATE INDEX IF NOT EXISTS idx_qa_documents_cat ON public.qa_documents(category);

-- Enable RLS
ALTER TABLE public.qa_documents ENABLE ROW LEVEL SECURITY;

-- Read: All active authenticated internal users (including Viewer)
DROP POLICY IF EXISTS "qa_documents_read_all" ON public.qa_documents;
CREATE POLICY "qa_documents_read_all" ON public.qa_documents
FOR SELECT TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
);

-- Insert: Authorized QA and Admin personnel only; strictly until JOB Close (job must be ACTIVE)
DROP POLICY IF EXISTS "qa_documents_insert_authorized" ON public.qa_documents;
CREATE POLICY "qa_documents_insert_authorized" ON public.qa_documents
FOR INSERT TO authenticated
WITH CHECK (
    public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'QA')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = qa_documents.job_id
          AND j.status = 'ACTIVE'
    )
);

-- Update: Admin or uploader, only while JOB is ACTIVE
DROP POLICY IF EXISTS "qa_documents_update_authorized" ON public.qa_documents;
CREATE POLICY "qa_documents_update_authorized" ON public.qa_documents
FOR UPDATE TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND (public.get_current_user_role() = 'Admin' OR (uploaded_by = auth.uid() AND public.get_current_user_role() = 'QA'))
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = qa_documents.job_id
          AND j.status = 'ACTIVE'
    )
)
WITH CHECK (
    public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND (public.get_current_user_role() = 'Admin' OR (uploaded_by = auth.uid() AND public.get_current_user_role() = 'QA'))
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = qa_documents.job_id
          AND j.status = 'ACTIVE'
    )
);

-- Delete: Admin or uploader, only while JOB is ACTIVE
DROP POLICY IF EXISTS "qa_documents_delete_authorized" ON public.qa_documents;
CREATE POLICY "qa_documents_delete_authorized" ON public.qa_documents
FOR DELETE TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND (public.get_current_user_role() = 'Admin' OR (uploaded_by = auth.uid() AND public.get_current_user_role() = 'QA'))
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = qa_documents.job_id
          AND j.status = 'ACTIVE'
    )
);

-- ----------------------------------------------------------------------------
-- 3b. TRIGGER: PREVENT QA DOCUMENT MODIFICATIONS ON CLOSED/PURGED JOBS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_qa_documents_job_active()
RETURNS TRIGGER AS $$
DECLARE
    v_job_status public.job_status;
BEGIN
    SELECT status INTO v_job_status
    FROM public.jobs
    WHERE id = NEW.job_id;

    IF v_job_status IS NULL OR v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể tải lên hoặc chỉnh sửa tài liệu QA khi Lệnh sản xuất không ở trạng thái ACTIVE (trạng thái hiện tại: %)', v_job_status
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_qa_documents_job_active ON public.qa_documents;
CREATE TRIGGER trg_check_qa_documents_job_active
BEFORE INSERT OR UPDATE ON public.qa_documents
FOR EACH ROW
EXECUTE FUNCTION public.check_qa_documents_job_active();

-- ----------------------------------------------------------------------------
-- 4. STORAGE POLICIES FOR QA DOCUMENTS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "storage_qa_docs_upload" ON storage.objects;
CREATE POLICY "storage_qa_docs_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'QA')
);

DROP POLICY IF EXISTS "storage_qa_docs_select" ON storage.objects;
CREATE POLICY "storage_qa_docs_select" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'sample-documents'
    AND public.is_user_active() = TRUE
    AND EXISTS (
        SELECT 1 FROM public.qa_documents d
        JOIN public.jobs j ON j.id = d.job_id
        WHERE d.file_path = storage.objects.name
          AND j.status != 'PURGED'
    )
);

-- ----------------------------------------------------------------------------
-- 5. IMMUTABLE JOB TICKET & PLANNING LOCKOUT TRIGGER ON jobs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_planning_lockout_on_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_has_closed_ops BOOLEAN;
    v_role public.user_role;
BEGIN
    -- 1. Job Ticket (job_no) is strictly immutable
    IF TG_OP = 'UPDATE' AND OLD.job_no IS DISTINCT FROM NEW.job_no THEN
        RAISE EXCEPTION 'Mã Lệnh sản xuất (Job Ticket %) là bất biến và không thể thay đổi.', OLD.job_no;
    END IF;

    -- 2. Allow forward status transitions (CLOSE/ARCHIVE) and internal close metadata updates
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

    -- 3. Check if any operation in this job is CLOSED
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

    -- 4. Role validation for planning field changes: Planning or Admin only
    IF OLD.part_no IS DISTINCT FROM NEW.part_no OR
       OLD.part_name IS DISTINCT FROM NEW.part_name OR
       OLD.customer IS DISTINCT FROM NEW.customer OR
       OLD.order_qty IS DISTINCT FROM NEW.order_qty OR
       OLD.material IS DISTINCT FROM NEW.material OR
       OLD.material_spec IS DISTINCT FROM NEW.material_spec OR
       OLD.planned_start_date IS DISTINCT FROM NEW.planned_start_date OR
       OLD.planned_finish_date IS DISTINCT FROM NEW.planned_finish_date THEN
        IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
            v_role := 'Admin'::public.user_role;
        ELSE
            v_role := public.get_current_user_role();
        END IF;

        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò Planning hoặc Admin mới có quyền sửa đổi thông tin kế hoạch sản xuất.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_planning_lockout_on_job ON public.jobs;
CREATE TRIGGER trg_enforce_planning_lockout_on_job
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.check_planning_lockout_on_job();

-- ----------------------------------------------------------------------------
-- 6. ROUTING LOCKOUT & DATA-PRESERVATION TRIGGER ON job_operations
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_routing_lockout_on_operations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_job_id UUID;
    v_has_closed_ops BOOLEAN;
    v_has_production_data BOOLEAN;
    v_role public.user_role;
BEGIN
    v_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;

    -- 1. Check if any operation in this job is CLOSED
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

    -- 2. Reject destructive routing deletion if operation has production or QA records
    IF TG_OP = 'DELETE' THEN
        SELECT (
            EXISTS (SELECT 1 FROM public.production_runs WHERE operation_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.qa_checks WHERE operation_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.operation_sample_photos WHERE operation_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.qa_documents WHERE operation_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.pe_engineering_reviews WHERE operation_id = OLD.id)
        ) INTO v_has_production_data;

        IF v_has_production_data THEN
            RAISE EXCEPTION 'Không thể xóa công đoạn % (%) do đã có dữ liệu sản xuất hoặc QA (PE-MFG / QA records). Thao tác xóa bị từ chối để bảo toàn dữ liệu.', OLD.step_order, OLD.operation_name;
        END IF;
    END IF;

    -- 3. Validate role for routing mutations (Planning or Admin only)
    IF TG_OP IN ('INSERT', 'DELETE') OR (
        TG_OP = 'UPDATE' AND (
            OLD.step_order IS DISTINCT FROM NEW.step_order OR
            OLD.operation_name IS DISTINCT FROM NEW.operation_name OR
            OLD.workcenter_code IS DISTINCT FROM NEW.workcenter_code OR
            OLD.machine_no IS DISTINCT FROM NEW.machine_no OR
            OLD.planned_machine IS DISTINCT FROM NEW.planned_machine OR
            OLD.planned_cycle_time_seconds IS DISTINCT FROM NEW.planned_cycle_time_seconds
        )
    ) THEN
        IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
            v_role := 'Admin'::public.user_role;
        ELSE
            v_role := public.get_current_user_role();
        END IF;

        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò Planning hoặc Admin mới có quyền sửa đổi quy trình công đoạn (Routing).';
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
-- 7. DELETE RLS POLICY ON job_operations
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "job_operations_delete_planning_admin" ON public.job_operations;
CREATE POLICY "job_operations_delete_planning_admin" ON public.job_operations
FOR DELETE TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.has_completed_password_change() = TRUE
    AND public.get_current_user_role() IN ('Planning', 'Admin')
    AND EXISTS (SELECT 1 FROM public.jobs WHERE id = job_operations.job_id AND status = 'ACTIVE')
);

-- ----------------------------------------------------------------------------
-- 8. ATOMIC STORED PROCEDURE: update_job_planning_and_routing
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_job_planning_and_routing(
    p_job_id UUID,
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
    v_uid UUID;
    v_caller_role public.user_role;
    v_caller_name TEXT;
    v_job RECORD;
    v_has_closed_ops BOOLEAN;
    v_op JSONB;
    v_op_id UUID;
    v_kept_op_ids UUID[] := ARRAY[]::UUID[];
    v_existing_op RECORD;
    v_step_order INTEGER;
    v_wc_code TEXT;
    v_desc TEXT;
    v_machine TEXT;
    v_cycle_time NUMERIC;
    v_remark TEXT;
    v_has_prod_data BOOLEAN;
BEGIN
    -- 1. Authenticate caller
    v_uid := auth.uid();
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
    ELSE
        SELECT role, full_name INTO v_caller_role, v_caller_name
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Tài khoản không tồn tại hoặc đã bị vô hiệu hóa.';
        END IF;

        IF v_caller_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò Planning hoặc Admin mới có quyền chỉnh sửa Kế hoạch & Quy trình.';
        END IF;
    END IF;

    -- 2. Fetch and lock Job record
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất với ID %.', p_job_id;
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất % đang ở trạng thái %, không được phép chỉnh sửa kế hoạch.', v_job.job_no, v_job.status;
    END IF;

    -- 3. Check Planning Lockout: MUST NOT have any CLOSED operation
    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = p_job_id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        RAISE EXCEPTION 'Kế hoạch sản xuất đã bị khóa (Planning Lockout): JOB % đã có công đoạn được chốt (CLOSED). Toàn bộ kế hoạch và quy trình đã chuyển sang chế độ chỉ đọc.', v_job.job_no;
    END IF;

    -- 4. Validate input parameters
    IF p_part_no IS NULL OR trim(p_part_no) = '' THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu (Quantity) phải là số nguyên dương lớn hơn 0.';
    END IF;

    IF p_material IS NULL OR trim(p_material) = '' THEN
        RAISE EXCEPTION 'Vật liệu (Material) không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày kết thúc kế hoạch (%) không được nhỏ hơn ngày bắt đầu (%).', p_planned_finish_date, p_planned_start_date;
    END IF;

    IF p_operations IS NULL OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình gia công (Routing) phải có ít nhất 1 công đoạn.';
    END IF;

    -- 5. Update Job header info (job_no remains unchanged!)
    UPDATE public.jobs
    SET
        part_no = trim(p_part_no),
        part_name = trim(COALESCE(p_part_name, p_part_no)),
        customer = trim(COALESCE(p_customer, '')),
        order_qty = p_order_qty,
        material = trim(p_material),
        material_spec = NULLIF(trim(p_material_spec), ''),
        planned_start_date = p_planned_start_date,
        planned_finish_date = p_planned_finish_date,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_job_id;

    -- 6. Upsert operations and track kept IDs
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations)
    LOOP
        v_op_id := NULL;
        IF v_op ? 'id' AND (v_op->>'id') IS NOT NULL AND (v_op->>'id') != '' THEN
            BEGIN
                v_op_id := (v_op->>'id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                v_op_id := NULL;
            END;
        END IF;

        v_step_order := (v_op->>'step_order')::INTEGER;
        v_wc_code := trim(COALESCE(v_op->>'workcenter_code', ''));
        v_desc := trim(COALESCE(v_op->>'description', v_op->>'operation_name', v_wc_code));
        v_machine := NULLIF(trim(COALESCE(v_op->>'machine_no', v_op->>'planned_machine', '')), '');
        
        v_cycle_time := NULL;
        IF v_op ? 'planned_cycle_time_seconds' AND (v_op->>'planned_cycle_time_seconds') IS NOT NULL AND (v_op->>'planned_cycle_time_seconds') != '' THEN
            v_cycle_time := (v_op->>'planned_cycle_time_seconds')::NUMERIC;
        ELSIF v_op ? 'cycle_time' AND (v_op->>'cycle_time') IS NOT NULL AND (v_op->>'cycle_time') != '' THEN
            v_cycle_time := (v_op->>'cycle_time')::NUMERIC;
        END IF;

        v_remark := NULLIF(trim(COALESCE(v_op->>'remark', '')), '');

        IF v_op_id IS NOT NULL THEN
            -- Check if this op belongs to this job
            SELECT * INTO v_existing_op
            FROM public.job_operations
            WHERE id = v_op_id AND job_id = p_job_id;

            IF FOUND THEN
                -- Update existing operation in place (preserving existing runs/checks!)
                UPDATE public.job_operations
                SET
                    step_order = v_step_order,
                    workcenter_code = v_wc_code,
                    description = v_desc,
                    operation_name = v_desc,
                    machine_no = v_machine,
                    planned_machine = v_machine,
                    planned_cycle_time_seconds = v_cycle_time,
                    remark = v_remark,
                    updated_at = timezone('Asia/Ho_Chi_Minh', now())
                WHERE id = v_op_id;

                v_kept_op_ids := array_append(v_kept_op_ids, v_op_id);
            ELSE
                -- ID not in this job; insert as new
                INSERT INTO public.job_operations (
                    job_id,
                    step_order,
                    workcenter_code,
                    description,
                    operation_name,
                    machine_no,
                    planned_machine,
                    planned_cycle_time_seconds,
                    remark,
                    status
                ) VALUES (
                    p_job_id,
                    v_step_order,
                    v_wc_code,
                    v_desc,
                    v_desc,
                    v_machine,
                    v_machine,
                    v_cycle_time,
                    v_remark,
                    'NOT_STARTED'
                ) RETURNING id INTO v_op_id;

                v_kept_op_ids := array_append(v_kept_op_ids, v_op_id);
            END IF;
        ELSE
            -- New operation
            INSERT INTO public.job_operations (
                job_id,
                step_order,
                workcenter_code,
                description,
                operation_name,
                machine_no,
                planned_machine,
                planned_cycle_time_seconds,
                remark,
                status
            ) VALUES (
                p_job_id,
                v_step_order,
                v_wc_code,
                v_desc,
                v_desc,
                v_machine,
                v_machine,
                v_cycle_time,
                v_remark,
                'NOT_STARTED'
            ) RETURNING id INTO v_op_id;

            v_kept_op_ids := array_append(v_kept_op_ids, v_op_id);
        END IF;
    END LOOP;

    -- 7. Handle removed operations:
    -- Verify no removed operation contains existing production or QA data!
    FOR v_existing_op IN
        SELECT * FROM public.job_operations
        WHERE job_id = p_job_id AND NOT (id = ANY(v_kept_op_ids))
    LOOP
        SELECT (
            EXISTS (SELECT 1 FROM public.production_runs WHERE operation_id = v_existing_op.id)
            OR EXISTS (SELECT 1 FROM public.qa_checks WHERE operation_id = v_existing_op.id)
            OR EXISTS (SELECT 1 FROM public.operation_sample_photos WHERE operation_id = v_existing_op.id)
            OR EXISTS (SELECT 1 FROM public.qa_documents WHERE operation_id = v_existing_op.id)
            OR EXISTS (SELECT 1 FROM public.pe_engineering_reviews WHERE operation_id = v_existing_op.id)
        ) INTO v_has_prod_data;

        IF v_has_prod_data THEN
            RAISE EXCEPTION 'Không thể xóa công đoạn % (%) do đã có dữ liệu sản xuất hoặc QA. Thao tác bị từ chối để bảo toàn dữ liệu.', v_existing_op.step_order, v_existing_op.operation_name;
        END IF;

        -- Safe to delete empty unstarted operation
        DELETE FROM public.job_operations WHERE id = v_existing_op.id;
    END LOOP;

    -- 8. Record audit log
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'PLANNING_ROUTING_UPDATED',
        'jobs',
        p_job_id,
        jsonb_build_object(
            'part_no', v_job.part_no,
            'part_name', v_job.part_name,
            'customer', v_job.customer,
            'order_qty', v_job.order_qty,
            'material', v_job.material,
            'material_spec', v_job.material_spec,
            'planned_start_date', v_job.planned_start_date,
            'planned_finish_date', v_job.planned_finish_date
        ),
        jsonb_build_object(
            'part_no', trim(p_part_no),
            'part_name', trim(COALESCE(p_part_name, p_part_no)),
            'customer', trim(COALESCE(p_customer, '')),
            'order_qty', p_order_qty,
            'material', trim(p_material),
            'material_spec', NULLIF(trim(p_material_spec), ''),
            'planned_start_date', p_planned_start_date,
            'planned_finish_date', p_planned_finish_date,
            'updated_by', v_caller_name,
            'updated_role', v_caller_role
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'message', 'Cập nhật Kế hoạch & Quy trình gia công thành công.'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. UPDATE close_job_final TO INCLUDE qa_documents IN REPORT SNAPSHOT
-- ----------------------------------------------------------------------------
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
    v_uid UUID;
    v_caller_role public.user_role;
    v_is_leader BOOLEAN := FALSE;
    v_caller_name TEXT := '';
    v_job RECORD;
    v_unclosed_ops INTEGER;
    v_remaining_kiv BIGINT;
    v_missing_qa BIGINT;
    v_qa_ng_kiv BIGINT;
    v_final_snapshot JSONB;
    v_trimmed_ticket TEXT;
    v_trimmed_assessment TEXT;
    v_eval_enum TEXT;
BEGIN
    -- 1. Determine caller identity and role
    v_uid := auth.uid();
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_is_leader := TRUE;
        v_caller_name := 'Admin System';
    ELSE
        SELECT role, is_department_leader, full_name
        INTO v_caller_role, v_is_leader, v_caller_name
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Tài khoản người dùng không hợp lệ hoặc đã bị vô hiệu hóa.';
        END IF;

        IF NOT (v_caller_role = 'Admin' OR (v_caller_role = 'PE-MFG' AND v_is_leader = TRUE)) THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên (Admin) mới có quyền Đóng Lệnh sản xuất (Close JOB).';
        END IF;
    END IF;

    -- 2. Fetch and lock Job record
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất với ID %.', p_job_id;
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất % đã ở trạng thái %, không thể đóng lại.', v_job.job_no, v_job.status;
    END IF;

    -- 3. Validate confirmation ticket matches job_no exactly
    v_trimmed_ticket := trim(COALESCE(p_confirm_ticket, ''));
    IF v_trimmed_ticket != v_job.job_no THEN
        RAISE EXCEPTION 'Mã xác nhận đóng JOB không khớp: Vui lòng nhập chính xác mã "%" để hoàn tất.', v_job.job_no;
    END IF;

    -- 4. Check mandatory pre-condition: ALL operations MUST be CLOSED
    SELECT count(*) INTO v_unclosed_ops
    FROM public.job_operations
    WHERE job_id = p_job_id AND (status != 'CLOSED' OR closed_at IS NULL);

    IF v_unclosed_ops > 0 THEN
        RAISE EXCEPTION 'Không thể đóng JOB: Còn % công đoạn chưa được Chốt (CLOSED). Bắt buộc phải chốt tất cả công đoạn trước khi đóng JOB.', v_unclosed_ops;
    END IF;

    -- 5. Calculate remaining KIV and QA warnings
    SELECT COALESCE(SUM(pr.kiv_qty), 0) INTO v_remaining_kiv
    FROM (
        SELECT DISTINCT ON (operation_id) kiv_qty
        FROM public.production_runs
        WHERE operation_id IN (SELECT id FROM public.job_operations WHERE job_id = p_job_id)
        ORDER BY operation_id, created_at DESC
    ) pr;

    SELECT count(*) INTO v_missing_qa
    FROM public.job_operations jo
    WHERE jo.job_id = p_job_id
      AND NOT EXISTS (SELECT 1 FROM public.qa_checks qc WHERE qc.operation_id = jo.id);

    SELECT count(*) INTO v_qa_ng_kiv
    FROM (
        SELECT DISTINCT ON (operation_id) result
        FROM public.qa_checks
        WHERE operation_id IN (SELECT id FROM public.job_operations WHERE job_id = p_job_id)
        ORDER BY operation_id, created_at DESC
    ) last_qc
    WHERE last_qc.result IN ('NG', 'KIV');

    -- If warnings exist, require acknowledgment and reason >= 5 characters
    IF (v_remaining_kiv > 0 OR v_missing_qa > 0 OR v_qa_ng_kiv > 0) THEN
        IF p_close_reason IS NULL OR length(trim(p_close_reason)) < 5 THEN
            RAISE EXCEPTION 'Cảnh báo tồn đọng: JOB còn KIV hoặc QA chưa đạt. Bắt buộc nhập lý do đóng JOB (tối thiểu 5 ký tự) và đánh dấu xác nhận.';
        END IF;
    END IF;

    -- Validate Final Evaluation
    v_eval_enum := UPPER(trim(COALESCE(p_evaluation_result, 'PASS')));
    IF v_eval_enum NOT IN ('PASS', 'CONDITIONAL', 'REJECT') THEN
        RAISE EXCEPTION 'Kết quả đánh giá nghiệm thu (%) không hợp lệ. Chấp nhận: PASS, CONDITIONAL, REJECT.', p_evaluation_result;
    END IF;

    v_trimmed_assessment := trim(COALESCE(p_overall_assessment, ''));
    IF length(v_trimmed_assessment) < 5 THEN
        RAISE EXCEPTION 'Vui lòng nhập Đánh giá kỹ thuật tổng thể (tối thiểu 5 ký tự).';
    END IF;

    IF v_eval_enum = 'CONDITIONAL' AND (p_improvements_required IS NULL OR length(trim(p_improvements_required)) < 5) THEN
        RAISE EXCEPTION 'Đối với kết quả CONDITIONAL (Đạt có điều kiện), bắt buộc nêu rõ các hạng mục cần cải tiến (tối thiểu 5 ký tự).';
    END IF;

    -- 6. Build immutable final report snapshot (including qa_documents)
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
                    ),
                    'qa_documents', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'id', qd.id,
                                'category', qd.category,
                                'file_name', qd.file_name,
                                'file_path', qd.file_path,
                                'file_size', qd.file_size,
                                'mime_type', qd.mime_type,
                                'remark', qd.remark,
                                'uploader_name', qd.uploader_name,
                                'created_at', qd.created_at
                            ) ORDER BY qd.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.qa_documents qd
                        WHERE qd.operation_id = jo.id
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

    -- 7. Transition Job to CLOSE status and record snapshot
    UPDATE public.jobs
    SET
        status = 'CLOSE',
        closed_at = timezone('Asia/Ho_Chi_Minh', now()),
        closed_by = v_uid,
        close_warnings = COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        close_reason = trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        final_snapshot = v_final_snapshot,
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    WHERE id = p_job_id;

    -- 8. Initialize sample_final_reports record (Pending state)
    INSERT INTO public.sample_final_reports (
        job_id,
        generation_status,
        evaluation_result,
        overall_assessment,
        improvements_required,
        unresolved_issues,
        snapshot_data,
        closed_by,
        closed_by_name,
        created_at,
        updated_at
    ) VALUES (
        p_job_id,
        'Pending',
        v_eval_enum::public.final_evaluation_result,
        v_trimmed_assessment,
        NULLIF(trim(p_improvements_required), ''),
        NULLIF(trim(p_unresolved_issues), ''),
        v_final_snapshot,
        v_uid,
        v_caller_name,
        timezone('Asia/Ho_Chi_Minh', now()),
        timezone('Asia/Ho_Chi_Minh', now())
    )
    ON CONFLICT (job_id) DO UPDATE SET
        generation_status = 'Pending',
        evaluation_result = EXCLUDED.evaluation_result,
        overall_assessment = EXCLUDED.overall_assessment,
        improvements_required = EXCLUDED.improvements_required,
        unresolved_issues = EXCLUDED.unresolved_issues,
        snapshot_data = EXCLUDED.snapshot_data,
        closed_by = EXCLUDED.closed_by,
        closed_by_name = EXCLUDED.closed_by_name,
        generation_error = NULL,
        updated_at = timezone('Asia/Ho_Chi_Minh', now());

    -- 9. Audit log entry
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_uid,
        'CLOSE_JOB_FINAL',
        'jobs',
        p_job_id,
        jsonb_build_object('status', 'ACTIVE'),
        jsonb_build_object(
            'status', 'CLOSE',
            'closed_by', v_caller_name,
            'role', v_caller_role,
            'is_leader', v_is_leader,
            'remaining_kiv', v_remaining_kiv,
            'missing_qa', v_missing_qa,
            'qa_ng_kiv', v_qa_ng_kiv,
            'evaluation_result', v_eval_enum
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'status', 'CLOSE',
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'evaluation_result', v_eval_enum,
        'message', format('Lệnh sản xuất %s đã được đóng thành công (Chế độ chỉ đọc vĩnh viễn).', v_job.job_no)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. UPDATE admin_delete_job TO CLEAN UP qa_documents
-- ----------------------------------------------------------------------------
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
    v_prod_run_count INTEGER := 0;
    v_qa_check_count INTEGER := 0;
    v_kiv_review_count INTEGER := 0;
    v_photo_count INTEGER := 0;
    v_pe_review_count INTEGER := 0;
    v_eng_doc_count INTEGER := 0;
    v_qa_doc_count INTEGER := 0;
    v_is_planning_owner BOOLEAN := FALSE;
    v_is_authorized BOOLEAN := FALSE;
BEGIN
    v_uid := auth.uid();
    v_trimmed_ticket := trim(COALESCE(p_confirm_ticket, ''));
    v_trimmed_reason := trim(COALESCE(p_reason, ''));

    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_is_leader := TRUE;
        v_caller_name := 'Admin System';
        v_caller_phone := 'SYSTEM';
        v_is_authorized := TRUE;
    ELSE
        SELECT role, is_department_leader, full_name, phone
        INTO v_caller_role, v_is_leader, v_caller_name, v_caller_phone
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Tài khoản người dùng không hợp lệ hoặc đã bị vô hiệu hóa.';
        END IF;
    END IF;

    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất với ID %.', p_job_id;
    END IF;

    v_is_planning_owner := (v_caller_role = 'Planning' AND v_job.created_by = v_uid);
    IF v_caller_role = 'Admin' OR (v_caller_role = 'Planning' AND v_is_leader = TRUE) OR v_is_planning_owner THEN
        v_is_authorized := TRUE;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin), Trưởng nhóm Kế hoạch (Planning Leader) hoặc Người tạo JOB (Planning Owner) mới có quyền xóa JOB.';
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể xóa: JOB % đang ở trạng thái %, chỉ được phép xóa khi ở trạng thái ACTIVE.', v_job.job_no, v_job.status;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.job_operations
        WHERE job_id = p_job_id AND (status = 'CLOSED' OR closed_at IS NOT NULL)
    ) INTO v_has_closed_ops;

    IF v_has_closed_ops THEN
        RAISE EXCEPTION 'Không thể xóa: JOB % đã có công đoạn chốt (CLOSED).', v_job.job_no;
    END IF;

    IF v_trimmed_ticket != v_job.job_no THEN
        RAISE EXCEPTION 'Mã xác nhận xóa JOB không khớp: Vui lòng nhập chính xác mã "%".', v_job.job_no;
    END IF;

    IF length(v_trimmed_reason) < 5 THEN
        RAISE EXCEPTION 'Lý do xóa JOB không được để trống và phải có ít nhất 5 ký tự.';
    END IF;

    SELECT count(*) INTO v_op_count FROM public.job_operations WHERE job_id = p_job_id;

    SELECT count(*) INTO v_prod_run_count
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_kiv_review_count
    FROM public.kiv_reviews kr
    JOIN public.job_operations jo ON jo.id = kr.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_qa_check_count
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id;

    SELECT count(*) INTO v_photo_count
    FROM public.operation_sample_photos sp
    WHERE sp.job_id = p_job_id;

    SELECT count(*) INTO v_pe_review_count
    FROM public.pe_engineering_reviews per
    WHERE per.job_id = p_job_id;

    SELECT count(*) INTO v_eng_doc_count
    FROM public.engineering_documents ed
    WHERE ed.job_id = p_job_id;

    SELECT count(*) INTO v_qa_doc_count
    FROM public.qa_documents qd
    WHERE qd.job_id = p_job_id;

    IF v_prod_run_count > 0 OR v_qa_check_count > 0 OR v_kiv_review_count > 0 THEN
        RAISE EXCEPTION 'Không thể xóa: JOB % đã phát sinh kết quả sản xuất hoặc kiểm tra chất lượng (Runs: %, QA: %, KIV: %).',
            v_job.job_no, v_prod_run_count, v_qa_check_count, v_kiv_review_count;
    END IF;

    -- Clean up related documents, reviews, photos
    DELETE FROM public.operation_sample_photos WHERE job_id = p_job_id;
    DELETE FROM public.pe_engineering_reviews WHERE job_id = p_job_id;
    DELETE FROM public.engineering_documents WHERE job_id = p_job_id;
    DELETE FROM public.qa_documents WHERE job_id = p_job_id;
    DELETE FROM public.sample_final_reports WHERE job_id = p_job_id;
    DELETE FROM public.attachments WHERE job_id = p_job_id;
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

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
        jsonb_build_object(
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'customer', v_job.customer,
            'created_by', v_job.created_by,
            'status', v_job.status,
            'operations_count', v_op_count
        ),
        jsonb_build_object(
            'deleted_by', v_caller_name,
            'deleted_role', v_caller_role,
            'is_leader', v_is_leader,
            'reason', v_trimmed_reason,
            'confirmed_ticket', v_trimmed_ticket
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'deleted_operations', v_op_count,
        'reason', v_trimmed_reason,
        'message', format('Lệnh sản xuất %s đã được xóa an toàn khỏi hệ thống.', v_job.job_no)
    );
END;
$$;
