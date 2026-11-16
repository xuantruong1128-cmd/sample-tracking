-- ============================================================================
-- MIGRATION: 00027_final_report_revision_r2.sql
-- DESCRIPTION: Final Report PDF Revision R2 - Part Avatar & Snapshot Support
-- 1. Adds 'is_avatar' column to operation_sample_photos with partial unique index.
-- 2. Grants update permissions on operation_sample_photos for Admin & PE-MFG.
-- 3. Implements secure RPC function 'set_part_avatar' for selecting avatar.
-- 4. Updates 'close_job_final' snapshot builder to include 'part_avatar' metadata.
-- ============================================================================

-- 1. Add is_avatar column to operation_sample_photos
ALTER TABLE public.operation_sample_photos
ADD COLUMN IF NOT EXISTS is_avatar BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforce at most one avatar per job
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_sample_photos_job_avatar
ON public.operation_sample_photos(job_id)
WHERE is_avatar = TRUE;

-- 2. Add UPDATE policy for operation_sample_photos
DROP POLICY IF EXISTS "sample_photos_update_pe_admin" ON public.operation_sample_photos;
CREATE POLICY "sample_photos_update_pe_admin" ON public.operation_sample_photos
FOR UPDATE TO authenticated
USING (
    public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'PE-MFG')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = operation_sample_photos.job_id
        AND j.status NOT IN ('CLOSE', 'PURGED')
    )
)
WITH CHECK (
    public.is_user_active() = TRUE
    AND public.get_current_user_role() IN ('Admin', 'PE-MFG')
    AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = operation_sample_photos.job_id
        AND j.status NOT IN ('CLOSE', 'PURGED')
    )
);

-- 3. Create RPC function: set_part_avatar
CREATE OR REPLACE FUNCTION public.set_part_avatar(
    p_job_id UUID,
    p_photo_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_job_status public.job_status;
BEGIN
    v_uid := auth.uid();
    IF auth.role() != 'service_role' THEN
        SELECT role INTO v_role FROM public.profiles WHERE id = v_uid AND is_active = TRUE;
        IF v_role IS NULL OR v_role NOT IN ('Admin', 'PE-MFG') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền chọn Ảnh đại diện sản phẩm.';
        END IF;
    END IF;

    SELECT status INTO v_job_status FROM public.jobs WHERE id = p_job_id;
    IF v_job_status IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy Lệnh sản xuất với ID %.', p_job_id;
    END IF;
    IF v_job_status IN ('CLOSE', 'PURGED') THEN
        RAISE EXCEPTION 'Không thể thay đổi ảnh đại diện khi Lệnh sản xuất đã đóng hoặc thanh lý.';
    END IF;

    -- If p_photo_id is provided, verify it belongs to this job
    IF p_photo_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.operation_sample_photos WHERE id = p_photo_id AND job_id = p_job_id) THEN
            RAISE EXCEPTION 'Ảnh mẫu được chọn không thuộc Lệnh sản xuất này.';
        END IF;
    END IF;

    -- Atomic transition: clear previous avatar, set new avatar
    UPDATE public.operation_sample_photos
    SET is_avatar = FALSE
    WHERE job_id = p_job_id AND is_avatar = TRUE;

    IF p_photo_id IS NOT NULL THEN
        UPDATE public.operation_sample_photos
        SET is_avatar = TRUE
        WHERE id = p_photo_id AND job_id = p_job_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'avatar_photo_id', p_photo_id,
        'message', CASE WHEN p_photo_id IS NOT NULL THEN 'Đã đặt ảnh đại diện cho sản phẩm thành công.' ELSE 'Đã gỡ bỏ ảnh đại diện sản phẩm.' END
    );
END;
$$;

-- 4. Update close_job_final to include part_avatar in immutable snapshot
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
    v_report_id UUID;
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

    -- 6. Build immutable final report snapshot (including qa_documents and part_avatar)
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
        'part_avatar', (
            SELECT jsonb_build_object(
                'id', sp.id,
                'file_name', sp.file_name,
                'file_path', sp.file_path,
                'file_size', sp.file_size,
                'mime_type', sp.mime_type,
                'uploader_name', sp.uploader_name
            )
            FROM public.operation_sample_photos sp
            WHERE sp.job_id = p_job_id AND sp.is_avatar = TRUE
            LIMIT 1
        ),
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
                                'id', sp.id,
                                'file_name', sp.file_name,
                                'file_path', sp.file_path,
                                'file_size', sp.file_size,
                                'mime_type', sp.mime_type,
                                'is_avatar', sp.is_avatar,
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
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    RETURNING id INTO v_report_id;

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
        'report_id', v_report_id,
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
