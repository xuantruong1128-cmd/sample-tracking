-- ============================================================================
-- Migration: 00007_ui03_r3_auto_job_code_fix.sql
-- Description: Fix sequence formatting (> 999 unpadded), operation enum status (NOT_STARTED),
-- and authentication check in allocate_next_job_code.
-- ============================================================================

-- 1. ATOMIC CODE ALLOCATION FUNCTION (Corrected LPAD & Auth Guard)
CREATE OR REPLACE FUNCTION public.allocate_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_year_month VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Authorization Guard: Only Planning, Admin, or service_role can allocate JOB codes
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND current_user NOT IN ('service_role', 'postgres') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Planning hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền cấp mã JOB (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- Determine year_month in Vietnam timezone Asia/Ho_Chi_Minh (+07)
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');

    -- Concurrency-Safe Atomic Upsert with row-lock & monotonic sequence allocation
    LOOP
        INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
        VALUES (v_year_month, 1, NOW())
        ON CONFLICT (year_month)
        DO UPDATE SET
            last_seq = public.job_code_sequences.last_seq + 1,
            updated_at = NOW()
        RETURNING last_seq INTO v_allocated_seq;

        -- Format: YYYYMM-NNN (Pads to at least 3 digits when < 1000; for >= 1000 formats as YYYYMM-1000 without capping)
        IF v_allocated_seq < 1000 THEN
            v_seq_str := LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        -- Guarantee that allocated code never collides with any existing job (historical or closed)
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 2. PREVIEW JOB CODE FUNCTION (Corrected LPAD)
CREATE OR REPLACE FUNCTION public.preview_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year_month VARCHAR(6);
    v_curr_seq INTEGER;
    v_next_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');
    SELECT last_seq INTO v_curr_seq FROM public.job_code_sequences WHERE year_month = v_year_month;
    v_next_seq := COALESCE(v_curr_seq, 0) + 1;

    LOOP
        IF v_next_seq < 1000 THEN
            v_seq_str := LPAD(v_next_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_next_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
        v_next_seq := v_next_seq + 1;
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 3. CREATE_JOB_WITH_ROUTING (Corrected NOT_STARTED enum status)
CREATE OR REPLACE FUNCTION public.create_job_with_routing(
    p_job_no TEXT,
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
    v_role public.user_role;
    v_jwt_role TEXT;
    v_job_id UUID;
    v_final_job_no TEXT;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_wc_code TEXT;
    v_desc TEXT;
    v_cycle_time NUMERIC;
    v_machine TEXT;
    v_remark TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role = 'service_role' OR current_user IN ('service_role', 'postgres') THEN
        v_role := 'Admin'::public.user_role;
    ELSE
        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- 2. Input Validation (Excluding job_no because it is strictly auto-generated by server)
    IF p_part_no IS NULL OR length(trim(p_part_no)) = 0 THEN
        RAISE EXCEPTION 'Mã chi tiết (Part Number) không được để trống.';
    END IF;

    IF p_order_qty IS NULL OR p_order_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng yêu cầu phải là số nguyên dương lớn hơn 0 (nhận được: %).', p_order_qty;
    END IF;

    IF p_planned_start_date IS NULL THEN
        RAISE EXCEPTION 'Ngày bắt đầu kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date IS NULL THEN
        RAISE EXCEPTION 'Ngày hoàn thành kế hoạch không được để trống.';
    END IF;

    IF p_planned_finish_date < p_planned_start_date THEN
        RAISE EXCEPTION 'Ngày hoàn thành (%s) không được nhỏ hơn ngày bắt đầu (%s).', p_planned_finish_date, p_planned_start_date;
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Server-Side Allocation of JOB Code inside Transaction
    v_final_job_no := public.allocate_next_job_code(NOW());

    -- 4. Atomic Job Insertion
    INSERT INTO public.jobs (
        job_no,
        part_no,
        part_name,
        customer,
        order_qty,
        material,
        material_spec,
        planned_start_date,
        planned_finish_date,
        status,
        created_by
    ) VALUES (
        v_final_job_no,
        trim(p_part_no),
        COALESCE(NULLIF(trim(p_part_name), ''), trim(p_part_no)),
        COALESCE(trim(p_customer), ''),
        p_order_qty,
        COALESCE(trim(p_material), 'Chưa xác định'),
        NULLIF(trim(p_material_spec), ''),
        p_planned_start_date,
        p_planned_finish_date,
        'ACTIVE',
        auth.uid()
    ) RETURNING * INTO v_created_job;

    v_job_id := v_created_job.id;

    -- 5. Atomic Operations Insertion (Using NOT_STARTED enum status)
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;

        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, (v_idx + 1) * 10);
        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        v_wc_code := NULLIF(trim(COALESCE(v_op_item ->> 'workcenter_code', '')), '');
        v_desc := NULLIF(trim(COALESCE(v_op_item ->> 'description', v_op_item ->> 'operation_name', '')), '');

        IF v_wc_code IS NULL AND v_desc IS NOT NULL THEN
            v_wc_code := v_desc;
        END IF;

        IF v_wc_code IS NULL THEN
            RAISE EXCEPTION 'Vui lòng chọn mã Workcenter cho công đoạn tại bước thứ %.', v_idx + 1;
        END IF;

        IF v_desc IS NULL THEN
            v_desc := v_wc_code;
        END IF;

        IF (v_op_item ? 'planned_cycle_time_seconds') AND (v_op_item ->> 'planned_cycle_time_seconds') IS NOT NULL AND length(trim(v_op_item ->> 'planned_cycle_time_seconds')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'planned_cycle_time_seconds')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Thời gian chu kỳ (Cycle Time Target) tại bước % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSE
            v_cycle_time := NULL;
        END IF;

        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'machine_no', v_op_item ->> 'planned_machine', '')), '');
        v_remark := NULLIF(trim(COALESCE(v_op_item ->> 'remark', '')), '');

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            planned_cycle_time_seconds,
            status,
            workcenter_code,
            description,
            machine_no,
            remark
        ) VALUES (
            v_job_id,
            v_step_order,
            v_desc,
            v_machine,
            v_cycle_time,
            'NOT_STARTED',
            v_wc_code,
            v_desc,
            v_machine,
            v_remark
        );
    END LOOP;

    RETURN to_jsonb(v_created_job);
END;
$$;
