-- ============================================================================
-- Migration: 00030_standardize_ng_types.sql
-- Description: SAMPLE TRACKING R3 — FIX 04: Standardize NG Types & Backend Validation
--
-- 1. Adds 'cause' column to public.qa_ng_details to store specific descriptions.
-- 2. Standardizes public.defect_catalog with exactly 8 NG types for PE-MFG and QA:
--    1. NG Đường Kính
--    2. NG Chiều Dài
--    3. NG Kích thước
--    4. NG Ren
--    5. NG Ngoại quan
--    6. NG Xước dập
--    7. NG hình dáng
--    8. Lỗi khác
-- 3. Deactivates obsolete defect codes without deleting historical references.
-- 4. Updates save_production_result_with_ng to validate required cause/description
--    whenever 'Lỗi khác' is selected.
-- 5. Updates save_qa_check_result to validate and persist 'cause' for QA NG details,
--    enforcing non-empty cause/description when 'Lỗi khác' is selected.
-- 6. Updates close_job_final to snapshot 'cause' in qa_ng_details.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema Enhancement: Add cause column to qa_ng_details
-- -----------------------------------------------------------------------------
ALTER TABLE public.qa_ng_details
    ADD COLUMN IF NOT EXISTS cause TEXT;

-- -----------------------------------------------------------------------------
-- 2. Standardize Defect Catalog (Master List)
-- -----------------------------------------------------------------------------
-- Deactivate non-standard defect items to maintain a clean master catalog
UPDATE public.defect_catalog
SET is_active = FALSE
WHERE code NOT IN (
    'NG-DIA', 'NG-LEN', 'NG-DIM', 'NG-THR',
    'NG-APP', 'NG-SCR', 'NG-SHP', 'DEF-OTH-01'
);

-- Upsert the 8 standardized NG types
INSERT INTO public.defect_catalog (code, name_vi, name_en, category, is_active)
VALUES
    ('NG-DIA', 'NG Đường Kính', 'Diameter NG', 'DIMENSION', TRUE),
    ('NG-LEN', 'NG Chiều Dài', 'Length NG', 'DIMENSION', TRUE),
    ('NG-DIM', 'NG Kích thước', 'Dimension NG', 'DIMENSION', TRUE),
    ('NG-THR', 'NG Ren', 'Thread NG', 'MACHINING', TRUE),
    ('NG-APP', 'NG Ngoại quan', 'Appearance NG', 'SURFACE', TRUE),
    ('NG-SCR', 'NG Xước dập', 'Scratch / Dent NG', 'SURFACE', TRUE),
    ('NG-SHP', 'NG hình dáng', 'Shape NG', 'GEOMETRY', TRUE),
    ('DEF-OTH-01', 'Lỗi khác', 'Other defect', 'OTHER', TRUE)
ON CONFLICT (code) DO UPDATE SET
    name_vi = EXCLUDED.name_vi,
    name_en = EXCLUDED.name_en,
    category = EXCLUDED.category,
    is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 3. Update save_production_result_with_ng with 'Lỗi khác' description validation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_production_result_with_ng(
    p_operation_id UUID,
    p_machine_id TEXT,
    p_production_date DATE,
    p_cycle_time NUMERIC,
    p_ok_qty INTEGER,
    p_kiv_qty INTEGER,
    p_ng_items JSONB,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_status public.job_status;
    v_job_id UUID;
    v_run_id UUID;
    v_total_ng INTEGER := 0;
    v_idx INT;
    v_item JSONB;
    v_item_qty INT;
    v_defect_name TEXT;
    v_defect_code TEXT;
    v_cause TEXT;
    v_remark TEXT;
    v_photos TEXT[];
    v_existing_run_id UUID;
    v_prod_run RECORD;
    v_arr_len INT;
BEGIN
    -- 1. Authorization Guard: PE-MFG, Admin, or service_role
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'Admin System';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản PE-MFG hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền nhập kết quả sản xuất (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Kỹ thuật viên') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Validate Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn (Operation) tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả sản xuất.', v_job_status;
    END IF;

    -- 3. Input Validation
    IF p_machine_id IS NULL OR length(trim(p_machine_id)) = 0 THEN
        RAISE EXCEPTION 'Mã máy (Machine) không được để trống.';
    END IF;

    IF p_ok_qty IS NULL OR p_ok_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng OK phải là số nguyên không âm (nhận được: %).', p_ok_qty;
    END IF;

    IF p_kiv_qty IS NULL OR p_kiv_qty < 0 THEN
        RAISE EXCEPTION 'Số lượng KIV phải là số nguyên không âm (nhận được: %).', p_kiv_qty;
    END IF;

    IF p_cycle_time IS NOT NULL AND p_cycle_time <= 0 THEN
        RAISE EXCEPTION 'Cycle Time thực tế phải là số dương lớn hơn 0 (nhận được: %).', p_cycle_time;
    END IF;

    -- 4. Calculate Total NG from NG Items and Validate Row Integrity
    IF p_ng_items IS NOT NULL AND jsonb_typeof(p_ng_items) = 'array' THEN
        v_arr_len := jsonb_array_length(p_ng_items);
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            IF v_item_qty <= 0 THEN
                RAISE EXCEPTION 'Số lượng NG tại dòng % phải là số nguyên dương lớn hơn 0.', v_idx + 1;
            END IF;
            IF (v_item ->> 'defect_name') IS NULL OR length(trim(v_item ->> 'defect_name')) = 0 THEN
                RAISE EXCEPTION 'Vui lòng chọn loại lỗi (Type) tại dòng NG thứ %.', v_idx + 1;
            END IF;

            -- Validation for 'Lỗi khác': must provide specific description / cause
            IF trim(v_item ->> 'defect_name') = 'Lỗi khác' THEN
                IF NULLIF(trim(COALESCE(v_item ->> 'cause', v_item ->> 'defect_description', '')), '') IS NULL THEN
                    RAISE EXCEPTION 'Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác tại dòng NG thứ %.', v_idx + 1;
                END IF;
            END IF;

            v_total_ng := v_total_ng + v_item_qty;
        END LOOP;
    ELSE
        v_arr_len := 0;
        v_total_ng := 0;
    END IF;

    -- 5. Find or Create Production Run for this operation (Prevent duplicate runs on repeated clicks)
    SELECT id INTO v_existing_run_id
    FROM public.production_runs
    WHERE operation_id = p_operation_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_run_id IS NOT NULL THEN
        v_run_id := v_existing_run_id;
        UPDATE public.production_runs
        SET machine_id = trim(p_machine_id),
            production_date = COALESCE(p_production_date, CURRENT_DATE),
            cycle_time_seconds = p_cycle_time,
            ok_qty = p_ok_qty,
            ng_qty = v_total_ng,
            kiv_qty = p_kiv_qty,
            remarks = NULLIF(trim(p_remarks), ''),
            operator_id = COALESCE(v_uid, operator_id),
            operator_name = COALESCE(v_user_name, operator_name),
            updated_at = NOW()
        WHERE id = v_run_id
        RETURNING * INTO v_prod_run;
    ELSE
        INSERT INTO public.production_runs (
            operation_id,
            machine_id,
            operator_id,
            operator_name,
            start_time,
            end_time,
            cycle_time_seconds,
            ok_qty,
            ng_qty,
            kiv_qty,
            production_date,
            remarks
        ) VALUES (
            p_operation_id,
            trim(p_machine_id),
            v_uid,
            COALESCE(v_user_name, 'Kỹ thuật viên'),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            COALESCE(p_production_date::TIMESTAMPTZ, NOW()),
            p_cycle_time,
            p_ok_qty,
            v_total_ng,
            p_kiv_qty,
            COALESCE(p_production_date, CURRENT_DATE),
            NULLIF(trim(p_remarks), '')
        ) RETURNING * INTO v_prod_run;
        v_run_id := v_prod_run.id;
    END IF;

    -- 6. Atomically sync NG Details
    DELETE FROM public.ng_details WHERE production_run_id = v_run_id;

    IF v_arr_len > 0 THEN
        FOR v_idx IN 0 .. (v_arr_len - 1) LOOP
            v_item := p_ng_items -> v_idx;
            v_item_qty := COALESCE((v_item ->> 'ng_qty')::INTEGER, (v_item ->> 'qty')::INTEGER, 0);
            v_defect_name := trim(v_item ->> 'defect_name');
            v_defect_code := NULLIF(trim(v_item ->> 'defect_code'), '');
            v_cause := NULLIF(trim(COALESCE(v_item ->> 'cause', v_item ->> 'defect_description', '')), '');
            v_remark := NULLIF(trim(v_item ->> 'remark'), '');

            -- Photo URLs (max 2 per NG row)
            IF (v_item ? 'photo_urls') AND jsonb_typeof(v_item -> 'photo_urls') = 'array' THEN
                SELECT ARRAY(
                    SELECT jsonb_array_elements_text(v_item -> 'photo_urls')
                    LIMIT 2
                ) INTO v_photos;
            ELSE
                v_photos := ARRAY[]::TEXT[];
            END IF;

            INSERT INTO public.ng_details (
                production_run_id,
                defect_name,
                defect_code,
                ng_qty,
                defect_description,
                cause,
                remark,
                photo_urls
            ) VALUES (
                v_run_id,
                v_defect_name,
                v_defect_code,
                v_item_qty,
                v_cause,
                v_cause,
                v_remark,
                v_photos
            );
        END LOOP;
    END IF;

    -- 7. Update Operation Status if appropriate
    IF p_ok_qty > 0 THEN
        UPDATE public.job_operations
        SET status = CASE WHEN status = 'NOT_STARTED' THEN 'IN_PROGRESS'::public.operation_status ELSE status END,
            updated_at = NOW()
        WHERE id = p_operation_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'production_run_id', v_run_id,
        'total_ng', v_total_ng,
        'ng_rows_synced', v_arr_len
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Update save_qa_check_result with 'cause' column & 'Lỗi khác' validation
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[], JSONB);

CREATE OR REPLACE FUNCTION public.save_qa_check_result(
    p_operation_id UUID,
    p_result public.qa_result DEFAULT NULL,
    p_sample_size INTEGER DEFAULT NULL,
    p_ok_qty INTEGER DEFAULT NULL,
    p_ng_qty INTEGER DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_n1_result TEXT DEFAULT NULL,
    p_n1_check_sheet_urls TEXT[] DEFAULT NULL,
    p_qa_ng_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID;
    v_user_name TEXT;
    v_job_id UUID;
    v_job_status public.job_status;
    v_qa_check public.qa_checks%ROWTYPE;
    v_n1_clean TEXT;
    v_computed_total_ng INTEGER := 0;
    v_item JSONB;
    v_final_qa_result public.qa_result;
BEGIN
    -- 1. Authorization Guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_role := 'Admin'::public.user_role;
        v_user_name := 'Admin System';
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản QA hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('QA', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ QA hoặc Admin mới có quyền ghi nhận kết quả QA (vai trò: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;

        v_uid := auth.uid();
        SELECT COALESCE(full_name, phone, 'Thẩm định viên QA') INTO v_user_name
        FROM public.profiles WHERE id = v_uid;
    END IF;

    -- 2. Verify Operation & Job Status
    SELECT jo.job_id, j.status INTO v_job_id, v_job_status
    FROM public.job_operations jo
    JOIN public.jobs j ON j.id = jo.job_id
    WHERE jo.id = p_operation_id;

    IF v_job_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy công đoạn tương ứng trong hệ thống.';
    END IF;

    IF v_job_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Lệnh sản xuất đã đóng hoặc lưu trữ (Trạng thái: %). Không thể ghi nhận thêm kết quả QA.', v_job_status;
    END IF;

    -- 3. N1 Inspection Result Validation (Strictly OK or NG)
    IF p_n1_result IS NOT NULL AND length(trim(p_n1_result)) > 0 THEN
        v_n1_clean := UPPER(trim(p_n1_result));
        IF v_n1_clean NOT IN ('OK', 'NG') THEN
            RAISE EXCEPTION 'Kết quả kiểm tra N1 chỉ chấp nhận OK hoặc NG (nhận được: %).', p_n1_result;
        END IF;
    ELSE
        v_n1_clean := NULL;
    END IF;

    -- 4. Calculate QA Total NG = SUM(qa_ng_items.ng_qty) and Validate 'Lỗi khác'
    IF p_qa_ng_items IS NOT NULL AND jsonb_array_length(p_qa_ng_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_qa_ng_items)
        LOOP
            IF (v_item->>'defect_name') IS NOT NULL AND length(trim(v_item->>'defect_name')) > 0 THEN
                IF trim(v_item->>'defect_name') = 'Lỗi khác' THEN
                    IF NULLIF(trim(COALESCE(v_item->>'cause', v_item->>'defect_description', '')), '') IS NULL THEN
                        RAISE EXCEPTION 'Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác cho lỗi QA.';
                    END IF;
                END IF;
                v_computed_total_ng := v_computed_total_ng + GREATEST(1, COALESCE((v_item->>'ng_qty')::INT, 1));
            END IF;
        END LOOP;
    END IF;

    -- 5. Determine Overall QA Result
    IF v_n1_clean = 'NG' OR v_computed_total_ng > 0 OR p_result = 'NG' THEN
        v_final_qa_result := 'NG'::public.qa_result;
    ELSE
        v_final_qa_result := 'OK'::public.qa_result;
    END IF;

    -- 6. Insert new QA Check record (event_seq assigned automatically by trigger)
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

    -- 7. Persist QA NG Details (with cause column)
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
                    cause,
                    remark,
                    photo_urls
                ) VALUES (
                    v_qa_check.id,
                    p_operation_id,
                    v_job_id,
                    NULLIF(trim(v_item->>'defect_code'), ''),
                    trim(v_item->>'defect_name'),
                    GREATEST(1, COALESCE((v_item->>'ng_qty')::INT, 1)),
                    NULLIF(trim(COALESCE(v_item->>'cause', v_item->>'defect_description', '')), ''),
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
        'qa_ng_rows_synced', COALESCE(jsonb_array_length(p_qa_ng_items), 0)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Update close_job_final to snapshot 'cause' in qa_ng_details
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
        'material_spec', v_job.material_spec,
        'created_at', v_job.created_at,
        'closed_at', timezone('Asia/Ho_Chi_Minh', now()),
        'closed_by_name', v_caller_name,
        'closed_by_role', v_caller_role,
        'close_reason', trim(COALESCE(p_close_reason, 'Tất cả công đoạn hoàn tất bình thường')),
        'acknowledged_warnings', COALESCE(p_acknowledged_warnings, '[]'::jsonb),
        'warnings_summary', jsonb_build_object(
            'remaining_kiv', v_remaining_kiv,
            'missing_qa_ops', v_missing_qa,
            'qa_ng_kiv_checks', v_qa_ng_kiv
        ),
        'evaluation', jsonb_build_object(
            'evaluation_result', v_eval_enum,
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
                                'cause', qnd.cause,
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

-- Permissions
REVOKE ALL ON FUNCTION public.save_production_result_with_ng(UUID, TEXT, DATE, NUMERIC, INTEGER, INTEGER, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_production_result_with_ng(UUID, TEXT, DATE, NUMERIC, INTEGER, INTEGER, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_qa_check_result(UUID, public.qa_result, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT[], JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_job_final(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
