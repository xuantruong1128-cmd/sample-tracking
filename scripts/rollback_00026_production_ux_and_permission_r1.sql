-- ============================================================================
-- ROLLBACK SCRIPT: rollback_00026_production_ux_and_permission_r1.sql
-- Description: Completely rolls back changes introduced in 00026:
--   1. Drops triggers and policies on public.qa_documents
--   2. Drops public.qa_documents table
--   3. Drops storage policies for QA documents
--   4. Reverts storage.buckets allowed_mime_types
--   5. Drops public.update_job_planning_and_routing RPC
--   6. Drops public.job_operations_delete_planning_admin policy
--   7. Restores pre-00026 versions of:
--      - check_planning_lockout_on_job()
--      - check_routing_lockout_on_operations()
--      - close_job_final()
--      - admin_delete_job()
-- ============================================================================

-- 1. DROP TRIGGER & POLICIES ON qa_documents
DROP TRIGGER IF EXISTS trg_check_qa_documents_job_active ON public.qa_documents;
DROP FUNCTION IF EXISTS public.check_qa_documents_job_active();

DROP POLICY IF EXISTS "qa_documents_read_all" ON public.qa_documents;
DROP POLICY IF EXISTS "qa_documents_insert_authorized" ON public.qa_documents;
DROP POLICY IF EXISTS "qa_documents_update_authorized" ON public.qa_documents;
DROP POLICY IF EXISTS "qa_documents_delete_authorized" ON public.qa_documents;

-- 2. DROP TABLE qa_documents
DROP TABLE IF EXISTS public.qa_documents CASCADE;

-- 3. DROP STORAGE POLICIES FOR QA DOCUMENTS
DROP POLICY IF EXISTS "storage_qa_docs_upload" ON storage.objects;
DROP POLICY IF EXISTS "storage_qa_docs_select" ON storage.objects;

-- 4. REVERT STORAGE BUCKET ALLOWED MIME TYPES (REMOVE text/csv)
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

-- 5. DROP RPC update_job_planning_and_routing
DROP FUNCTION IF EXISTS public.update_job_planning_and_routing(
    UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, DATE, DATE, JSONB
);

-- 6. DROP RLS POLICY job_operations_delete_planning_admin
DROP POLICY IF EXISTS "job_operations_delete_planning_admin" ON public.job_operations;

-- 7. REVERT check_planning_lockout_on_job TO PRE-00026 VERSION (from 00018)
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

-- 8. REVERT check_routing_lockout_on_operations TO PRE-00026 VERSION (from 00018)
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

-- 9. REVERT close_job_final TO PRE-00026 VERSION (from 00025)
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
        SELECT role, is_leader, full_name
        INTO v_caller_role, v_is_leader, v_caller_name
        FROM public.profiles
        WHERE id = auth.uid() AND is_active = TRUE;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'User profile not found or inactive.';
        END IF;

        IF v_caller_role = 'Admin' THEN
            -- OK
        ELSIF v_caller_role = 'PE-MFG' AND v_is_leader = TRUE THEN
            -- OK
        ELSE
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên (Admin) mới có quyền chốt Lệnh sản xuất (Close JOB).';
        END IF;
        v_caller_uid := auth.uid();
    END IF;

    -- 2. Validate ticket confirmation
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job IS NULL THEN
        RAISE EXCEPTION 'Job with id % not found.', p_job_id;
    END IF;

    IF v_job.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất % hiện đang ở trạng thái % (không phải ACTIVE). Không thể chốt JOB.', v_job.job_no, v_job.status;
    END IF;

    v_trimmed_ticket := TRIM(COALESCE(p_confirm_ticket, ''));
    IF v_trimmed_ticket != v_job.job_no THEN
        RAISE EXCEPTION 'Mã xác nhận không khớp: Vui lòng nhập chính xác mã "%".', v_job.job_no;
    END IF;

    -- 3. Evaluation enum validation
    BEGIN
        v_eval_enum := p_evaluation_result::public.final_evaluation_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Kết quả đánh giá chung không hợp lệ: %. Chỉ chấp nhận PASS, CONDITIONAL_PASS, FAIL.', p_evaluation_result;
    END IF;

    v_trimmed_assessment := TRIM(COALESCE(p_overall_assessment, ''));
    IF length(v_trimmed_assessment) < 5 THEN
        RAISE EXCEPTION 'Nhận xét đánh giá chung phải có ít nhất 5 ký tự.';
    END IF;

    IF v_eval_enum IN ('CONDITIONAL_PASS', 'FAIL') THEN
        IF p_improvements_required IS NULL OR length(TRIM(p_improvements_required)) < 5 THEN
            RAISE EXCEPTION 'Khi kết quả đánh giá là %s, bắt buộc phải nêu rõ các điểm cần cải tiến (tối thiểu 5 ký tự).', v_eval_enum;
        END IF;
    END IF;

    -- 4. Check manufacturing completion rules & gather warnings
    SELECT count(*) INTO v_total_ops FROM public.job_operations WHERE job_id = p_job_id;
    IF v_total_ops = 0 THEN
        RAISE EXCEPTION 'Lệnh sản xuất % chưa có công đoạn nào.', v_job.job_no;
    END IF;

    SELECT count(*) INTO v_unclosed_ops
    FROM public.job_operations
    WHERE job_id = p_job_id AND status != 'CLOSED';

    IF v_unclosed_ops > 0 THEN
        RAISE EXCEPTION 'Lệnh sản xuất % còn % công đoạn chưa hoàn thành (chưa CLOSED). Tất cả công đoạn phải được chốt trước khi chốt JOB.', v_job.job_no, v_unclosed_ops;
    END IF;

    -- Warnings check
    SELECT COALESCE(SUM(pr.kiv_qty), 0) INTO v_remaining_kiv
    FROM public.production_runs pr
    JOIN public.job_operations jo ON jo.id = pr.operation_id
    WHERE jo.job_id = p_job_id AND pr.kiv_qty > 0
      AND NOT EXISTS (SELECT 1 FROM public.kiv_reviews kr WHERE kr.production_run_id = pr.id);

    SELECT count(*) INTO v_missing_qa
    FROM public.job_operations jo
    WHERE jo.job_id = p_job_id
      AND NOT EXISTS (SELECT 1 FROM public.qa_checks qc WHERE qc.operation_id = jo.id);

    SELECT count(*) INTO v_qa_ng_kiv
    FROM public.qa_checks qc
    JOIN public.job_operations jo ON jo.id = qc.operation_id
    WHERE jo.job_id = p_job_id AND qc.overall_result IN ('NG', 'KIV');

    v_warning_count := 0;
    IF v_remaining_kiv > 0 THEN v_warning_count := v_warning_count + 1; END IF;
    IF v_missing_qa > 0 THEN v_warning_count := v_warning_count + 1; END IF;
    IF v_qa_ng_kiv > 0 THEN v_warning_count := v_warning_count + 1; END IF;

    IF v_warning_count > 0 THEN
        IF jsonb_array_length(COALESCE(p_acknowledged_warnings, '[]'::jsonb)) < v_warning_count THEN
            RAISE EXCEPTION 'Lệnh sản xuất có % cảnh báo chưa được người dùng xác nhận giải trình.', v_warning_count;
        END IF;
        IF p_close_reason IS NULL OR length(TRIM(p_close_reason)) < 5 THEN
            RAISE EXCEPTION 'Khi có cảnh báo tồn tại, bắt buộc phải cung cấp lý do chốt lệnh sản xuất (tối thiểu 5 ký tự).';
        END IF;
    END IF;

    -- 5. Build immutable final snapshot
    SELECT jsonb_build_object(
        'job_header', jsonb_build_object(
            'id', v_job.id,
            'job_no', v_job.job_no,
            'part_no', v_job.part_no,
            'part_name', v_job.part_name,
            'customer', v_job.customer,
            'order_qty', v_job.order_qty,
            'material', v_job.material,
            'material_spec', v_job.material_spec,
            'planned_start_date', v_job.planned_start_date,
            'planned_finish_date', v_job.planned_finish_date,
            'created_at', v_job.created_at,
            'created_by', v_job.created_by,
            'status_before_close', v_job.status
        ),
        'closed_by_profile', jsonb_build_object(
            'id', v_caller_uid,
            'name', v_caller_name,
            'role', v_caller_role,
            'is_leader', v_is_leader
        ),
        'close_metadata', jsonb_build_object(
            'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
            'evaluation_result', v_eval_enum,
            'overall_assessment', v_trimmed_assessment,
            'improvements_required', TRIM(COALESCE(p_improvements_required, '')),
            'unresolved_issues', TRIM(COALESCE(p_unresolved_issues, '')),
            'close_reason', TRIM(COALESCE(p_close_reason, '')),
            'acknowledged_warnings', COALESCE(p_acknowledged_warnings, '[]'::jsonb)
        ),
        'operations', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', jo.id,
                    'step_order', jo.step_order,
                    'operation_name', jo.operation_name,
                    'workcenter_code', jo.workcenter_code,
                    'machine_no', jo.machine_no,
                    'status', jo.status,
                    'closed_at', jo.closed_at,
                    'closed_by', jo.closed_by,
                    'production_runs', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'id', pr.id,
                                'machine_id', pr.machine_id,
                                'operator_name', pr.operator_name,
                                'ok_qty', pr.ok_qty,
                                'ng_qty', pr.ng_qty,
                                'kiv_qty', pr.kiv_qty,
                                'start_time', pr.start_time,
                                'end_time', pr.end_time,
                                'ng_details', (
                                    SELECT COALESCE(jsonb_agg(
                                        jsonb_build_object('defect_name', defect_name, 'ng_qty', ng_qty)
                                    ), '[]'::jsonb)
                                    FROM public.ng_details ng WHERE ng.production_run_id = pr.id
                                ),
                                'kiv_review', (
                                    SELECT to_jsonb(kr.*) FROM public.kiv_reviews kr WHERE kr.production_run_id = pr.id
                                )
                            )
                        ), '[]'::jsonb)
                        FROM public.production_runs pr WHERE pr.operation_id = jo.id
                    ),
                    'qa_checks', (
                        SELECT COALESCE(jsonb_agg(to_jsonb(qc.*)), '[]'::jsonb)
                        FROM public.qa_checks qc WHERE qc.operation_id = jo.id
                    ),
                    'sample_photos', (
                        SELECT COALESCE(jsonb_agg(to_jsonb(sp.*)), '[]'::jsonb)
                        FROM public.operation_sample_photos sp WHERE sp.operation_id = jo.id
                    ),
                    'pe_reviews', (
                        SELECT COALESCE(jsonb_agg(to_jsonb(pe.*)), '[]'::jsonb)
                        FROM public.pe_engineering_reviews pe WHERE pe.operation_id = jo.id
                    )
                ) ORDER BY jo.step_order
            ), '[]'::jsonb)
            FROM public.job_operations jo WHERE jo.job_id = p_job_id
        ),
        'engineering_documents', (
            SELECT COALESCE(jsonb_agg(to_jsonb(ed.*)), '[]'::jsonb)
            FROM public.engineering_documents ed WHERE ed.job_id = p_job_id
        )
    ) INTO v_final_snapshot;

    -- 6. Insert sample_final_reports record
    INSERT INTO public.sample_final_reports (
        job_id,
        evaluation_result,
        overall_assessment,
        improvements_required,
        unresolved_issues,
        close_warnings,
        close_reason,
        final_snapshot,
        closed_by,
        closed_at
    ) VALUES (
        p_job_id,
        v_eval_enum,
        v_trimmed_assessment,
        NULLIF(TRIM(COALESCE(p_improvements_required, '')), ''),
        NULLIF(TRIM(COALESCE(p_unresolved_issues, '')), ''),
        COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        NULLIF(TRIM(COALESCE(p_close_reason, '')), ''),
        v_final_snapshot,
        v_caller_uid,
        timezone('Asia/Ho_Chi_Minh', now())
    )
    RETURNING id INTO v_report_id;

    -- 7. Update Job Status to CLOSE
    UPDATE public.jobs
    SET status = 'CLOSE',
        closed_at = timezone('Asia/Ho_Chi_Minh', now()),
        closed_by = v_caller_uid,
        close_warnings = COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        close_reason = NULLIF(TRIM(COALESCE(p_close_reason, '')), ''),
        final_snapshot = v_final_snapshot
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'report_id', v_report_id,
        'status', 'CLOSE',
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'message', format('Lệnh sản xuất %s đã được chốt thành công.', v_job.job_no)
    );
END;
$$;

-- 10. REVERT admin_delete_job TO PRE-00026 VERSION (from 00021)
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
    v_job RECORD;
    v_trimmed_ticket TEXT;
    v_trimmed_reason TEXT;
    v_has_closed_ops BOOLEAN := FALSE;
    v_op_count INTEGER := 0;
    v_prod_run_count INTEGER := 0;
    v_qa_check_count INTEGER := 0;
    v_kiv_review_count INTEGER := 0;
    v_is_planning_owner BOOLEAN := FALSE;
    v_is_authorized BOOLEAN := FALSE;
BEGIN
    v_uid := auth.uid();
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_caller_role := 'Admin'::public.user_role;
        v_caller_name := 'Admin System';
        v_is_leader := TRUE;
        v_is_authorized := TRUE;
    ELSE
        SELECT role, is_leader, full_name
        INTO v_caller_role, v_is_leader, v_caller_name
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'User profile not found or inactive.';
        END IF;
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF v_job IS NULL THEN
        RAISE EXCEPTION 'Lệnh sản xuất với ID % không tồn tại.', p_job_id;
    END IF;

    v_trimmed_ticket := TRIM(COALESCE(p_confirm_ticket, ''));
    v_trimmed_reason := TRIM(COALESCE(p_reason, ''));

    IF v_caller_role = 'Admin' THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_role = 'Planning' AND v_is_leader = TRUE THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_role = 'Planning' AND v_job.created_by = v_uid THEN
        v_is_planning_owner := TRUE;
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

    DELETE FROM public.operation_sample_photos WHERE job_id = p_job_id;
    DELETE FROM public.pe_engineering_reviews WHERE job_id = p_job_id;
    DELETE FROM public.engineering_documents WHERE job_id = p_job_id;
    DELETE FROM public.sample_final_reports WHERE job_id = p_job_id;
    DELETE FROM public.attachments WHERE job_id = p_job_id;
    DELETE FROM public.job_operations WHERE job_id = p_job_id;
    DELETE FROM public.jobs WHERE id = p_job_id;

    INSERT INTO public.audit_logs (
        user_id, action, entity_type, entity_id, old_values, new_values
    ) VALUES (
        v_uid, 'ADMIN_DELETE_JOB', 'jobs', p_job_id,
        jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status),
        jsonb_build_object('deleted_by', v_caller_name, 'reason', v_trimmed_reason)
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'deleted_operations', v_op_count,
        'message', format('Lệnh sản xuất %s đã được xóa an toàn khỏi hệ thống.', v_job.job_no)
    );
END;
$$;
