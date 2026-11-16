-- =============================================================================
-- MIGRATION 00028: SAMPLE TRACKING — R2 CONSOLIDATION
-- PE ENGINEERING REVIEW & QA INSPECTION REVISION
--
-- 1. PE Review:
--    - Enforce that NEW PE reviews only accept 'OK' or 'NG' (Pending removed from selection).
--    - Preserve existing historical 'Pending' records without automatically converting them.
--
-- 2. QA Inspection:
--    - Add n1_result ('OK' | 'NG'), n1_check_sheet_urls (TEXT[]), and qa_total_ng (INTEGER) to qa_checks.
--    - Relax legacy constraints on sample_size / ok_qty / chk_qa_quantities for backward-compatible active QA form.
--    - Create public.qa_ng_details for defect breakdown (Q'ty | NG Type | Remark | Image) isolated from manufacturing totals.
--    - Update save_qa_check_result RPC to support N1 check sheet attachments and atomic QA NG details persistence.
--    - Update close_job_final RPC to snapshot n1_result, n1_check_sheet_urls, qa_total_ng, and qa_ng_details.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PE ENGINEERING REVIEW: ENFORCE OK/NG ON NEW INSERTS (A1)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_check_pe_review_new_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.review_result NOT IN ('OK', 'NG') THEN
        RAISE EXCEPTION 'Kết luận đánh giá PE mới chỉ chấp nhận OK hoặc NG (Không còn hỗ trợ Pending cho đánh giá mới).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pe_review_new_status ON public.pe_engineering_reviews;
CREATE TRIGGER trg_pe_review_new_status
BEFORE INSERT ON public.pe_engineering_reviews
FOR EACH ROW
EXECUTE FUNCTION public.trg_check_pe_review_new_status();

-- -----------------------------------------------------------------------------
-- 2. QA CHECKS: ADD N1 COLUMNS & RELAX CONSTRAINTS (B1, B2, B4)
-- -----------------------------------------------------------------------------
ALTER TABLE public.qa_checks
    ADD COLUMN IF NOT EXISTS n1_result TEXT CHECK (n1_result IS NULL OR n1_result IN ('OK', 'NG')),
    ADD COLUMN IF NOT EXISTS n1_check_sheet_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS qa_total_ng INTEGER NOT NULL DEFAULT 0 CHECK (qa_total_ng >= 0);

-- Relax sample size and ok/ng sum constraint so new QA form without sample size/ok_qty works safely
ALTER TABLE public.qa_checks DROP CONSTRAINT IF EXISTS chk_qa_quantities;
ALTER TABLE public.qa_checks ALTER COLUMN sample_size DROP NOT NULL;
ALTER TABLE public.qa_checks ALTER COLUMN sample_size SET DEFAULT 1;
ALTER TABLE public.qa_checks ALTER COLUMN result SET DEFAULT 'OK'::public.qa_result;

-- -----------------------------------------------------------------------------
-- 3. QA NG DETAILS: COMPACT ONE-ROW-PER-DEFECT TABLE (B3, B4)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qa_ng_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qa_check_id UUID NOT NULL REFERENCES public.qa_checks(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL REFERENCES public.job_operations(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    defect_code TEXT,
    defect_name TEXT NOT NULL,
    ng_qty INTEGER NOT NULL CHECK (ng_qty > 0),
    remark TEXT,
    photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_qa_ng_details_check_id ON public.qa_ng_details(qa_check_id);
CREATE INDEX IF NOT EXISTS idx_qa_ng_details_op_id ON public.qa_ng_details(operation_id);
CREATE INDEX IF NOT EXISTS idx_qa_ng_details_job_id ON public.qa_ng_details(job_id);

-- RLS & Security for qa_ng_details
ALTER TABLE public.qa_ng_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qa_ng_details_select" ON public.qa_ng_details;
CREATE POLICY "qa_ng_details_select" ON public.qa_ng_details
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = qa_ng_details.job_id
        )
    );

DROP POLICY IF EXISTS "qa_ng_details_manage_qa_admin" ON public.qa_ng_details;
CREATE POLICY "qa_ng_details_manage_qa_admin" ON public.qa_ng_details
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.is_active = TRUE
              AND p.role IN ('QA', 'Admin')
        )
        AND EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = qa_ng_details.job_id
              AND j.status = 'ACTIVE'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.is_active = TRUE
              AND p.role IN ('QA', 'Admin')
        )
        AND EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = qa_ng_details.job_id
              AND j.status = 'ACTIVE'
        )
    );

-- Audit Trigger & Active Job Lock Trigger
DROP TRIGGER IF EXISTS trg_audit_qa_ng_details ON public.qa_ng_details;
CREATE TRIGGER trg_audit_qa_ng_details
AFTER INSERT OR UPDATE OR DELETE ON public.qa_ng_details
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

DROP TRIGGER IF EXISTS trg_lock_qa_ng_details_active ON public.qa_ng_details;
CREATE TRIGGER trg_lock_qa_ng_details_active
BEFORE INSERT OR UPDATE OR DELETE ON public.qa_ng_details
FOR EACH ROW EXECUTE FUNCTION public.check_job_active_status();

-- -----------------------------------------------------------------------------
-- 4. ATOMIC RPC: save_qa_check_result (B2, B3, B4)
-- Supports N1 Result, Check Sheet URLs, and atomic QA NG Detail list
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[], JSONB);

CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result DEFAULT 'OK'::public.qa_result,
    p_sample_size INTEGER DEFAULT 1,
    p_ok_qty INTEGER DEFAULT 0,
    p_ng_qty INTEGER DEFAULT 0,
    p_notes TEXT DEFAULT NULL,
    p_n1_result TEXT DEFAULT 'OK',
    p_n1_check_sheet_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_qa_ng_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_user_name TEXT;
    v_job_id UUID;
    v_job_status public.job_status;
    v_qa_check RECORD;
    v_item JSONB;
    v_computed_total_ng INTEGER := 0;
    v_final_qa_result public.qa_result;
    v_n1_clean TEXT;
BEGIN
    -- 1. Security & Role check
    v_uid := auth.uid();
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'Admin System';
    ELSE
        SELECT role, full_name INTO v_role, v_user_name
        FROM public.profiles
        WHERE id = v_uid AND is_active = TRUE;

        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Người dùng không hợp lệ hoặc đã bị vô hiệu hóa.';
        END IF;

        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Chỉ nhân viên QA hoặc Quản trị viên (Admin) mới có quyền lưu kết quả kiểm tra QA.';
        END IF;
    END IF;

    -- 2. Verify Operation & Job active status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn với ID %.', p_operation_id;
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Không thể cập nhật kết quả QA vì Lệnh sản xuất đang ở trạng thái %.', v_job_status;
    END IF;

    -- 3. Validate & sanitize N1 Result
    v_n1_clean := UPPER(trim(COALESCE(p_n1_result, 'OK')));
    IF v_n1_clean NOT IN ('OK', 'NG') THEN
        RAISE EXCEPTION 'Kết quả kiểm tra N1 không hợp lệ (chỉ chấp nhận: OK hoặc NG).';
    END IF;

    -- 4. Calculate QA Total NG = SUM(qa_ng_items.ng_qty)
    IF p_qa_ng_items IS NOT NULL AND jsonb_array_length(p_qa_ng_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_qa_ng_items)
        LOOP
            IF (v_item->>'ng_qty') IS NOT NULL AND (v_item->>'ng_qty')::INT > 0 THEN
                v_computed_total_ng := v_computed_total_ng + (v_item->>'ng_qty')::INT;
            END IF;
        END LOOP;
    ELSE
        -- Fallback to standalone p_ng_qty for legacy callers
        v_computed_total_ng := GREATEST(0, COALESCE(p_ng_qty, 0));
    END IF;

    -- 5. Determine overall QA Result: NG if N1 is NG or Total NG > 0, otherwise OK
    IF v_n1_clean = 'NG' OR v_computed_total_ng > 0 OR p_result = 'NG' THEN
        v_final_qa_result := 'NG'::public.qa_result;
    ELSE
        v_final_qa_result := 'OK'::public.qa_result;
    END IF;

    -- 6. Insert into public.qa_checks (event_seq assigned automatically by trigger)
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
        notes,
        n1_result,
        n1_check_sheet_urls,
        qa_total_ng
    ) VALUES (
        p_operation_id,
        v_uid,
        COALESCE(v_user_name, 'Kỹ thuật viên QA'),
        NOW(),
        GREATEST(1, v_computed_total_ng),
        0,
        v_computed_total_ng,
        v_final_qa_result,
        0,
        NULLIF(trim(p_notes), ''),
        v_n1_clean,
        COALESCE(p_n1_check_sheet_urls, ARRAY[]::TEXT[]),
        v_computed_total_ng
    ) RETURNING * INTO v_qa_check;

    -- 7. Persist QA NG Details
    IF p_qa_ng_items IS NOT NULL AND jsonb_array_length(p_qa_ng_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_qa_ng_items)
        LOOP
            IF (v_item->>'defect_name') IS NOT NULL AND length(trim(v_item->>'defect_name')) > 0 THEN
                INSERT INTO public.qa_ng_details (
                    qa_check_id,
                    operation_id,
                    job_id,
                    defect_code,
                    defect_name,
                    ng_qty,
                    remark,
                    photo_urls
                ) VALUES (
                    v_qa_check.id,
                    p_operation_id,
                    v_job_id,
                    NULLIF(trim(v_item->>'defect_code'), ''),
                    trim(v_item->>'defect_name'),
                    GREATEST(1, COALESCE((v_item->>'ng_qty')::INT, 1)),
                    NULLIF(trim(v_item->>'remark'), ''),
                    ARRAY(
                        SELECT jsonb_array_elements_text(COALESCE(v_item->'photo_urls', '[]'::jsonb))
                    )
                );
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'id', v_qa_check.id,
        'operation_id', v_qa_check.operation_id,
        'inspector_name', v_qa_check.inspector_name,
        'inspection_time', v_qa_check.inspection_time,
        'n1_result', v_qa_check.n1_result,
        'n1_check_sheet_urls', v_qa_check.n1_check_sheet_urls,
        'qa_total_ng', v_qa_check.qa_total_ng,
        'result', v_qa_check.result,
        'notes', v_qa_check.notes,
        'success', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[], JSONB) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. UPDATE close_job_final TO SNAPSHOT QA N1 & QA NG DETAILS (Part C)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.close_job_final(
    p_job_id UUID,
    p_confirm_ticket TEXT,
    p_close_reason TEXT,
    p_acknowledged_warnings JSONB DEFAULT '[]'::jsonb,
    p_evaluation_result TEXT DEFAULT 'PASS',
    p_overall_assessment TEXT DEFAULT '',
    p_improvements_required TEXT DEFAULT '',
    p_unresolved_issues TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Quản trị viên (Admin) hoặc Trưởng nhóm PE-MFG (PE-MFG Leader) mới có quyền Chốt đóng JOB.';
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

    -- 6. Construct Comprehensive Immutable Snapshot
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
                                'id', qc.id,
                                'sample_size', qc.sample_size,
                                'ok_qty', qc.ok_qty,
                                'ng_qty', qc.ng_qty,
                                'result', qc.result,
                                'n1_result', qc.n1_result,
                                'n1_check_sheet_urls', qc.n1_check_sheet_urls,
                                'qa_total_ng', qc.qa_total_ng,
                                'notes', qc.notes,
                                'created_at', qc.created_at
                            ) ORDER BY qc.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.qa_checks qc
                        WHERE qc.operation_id = jo.id
                    ),
                    'qa_ng_details', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'id', qnd.id,
                                'qa_check_id', qnd.qa_check_id,
                                'defect_name', qnd.defect_name,
                                'defect_code', qnd.defect_code,
                                'defect_qty', qnd.ng_qty,
                                'remark', qnd.remark,
                                'photo_urls', qnd.photo_urls
                            )
                        ), '[]'::jsonb)
                        FROM public.qa_ng_details qnd
                        WHERE qnd.operation_id = jo.id
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
        updated_at = timezone('Asia/Ho_Chi_Minh', now())
    RETURNING id INTO v_report_id;

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_no', v_job.job_no,
        'status', 'CLOSE',
        'remaining_kiv', v_remaining_kiv,
        'missing_qa_ops', v_missing_qa,
        'qa_ng_kiv_checks', v_qa_ng_kiv,
        'evaluation_result', v_eval_enum,
        'report_id', v_report_id,
        'message', 'Lệnh sản xuất ' || v_job.job_no || ' đã được đóng thành công (Chế độ chỉ đọc vĩnh viễn).'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
