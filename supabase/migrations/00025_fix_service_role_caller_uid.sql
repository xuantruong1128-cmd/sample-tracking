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
