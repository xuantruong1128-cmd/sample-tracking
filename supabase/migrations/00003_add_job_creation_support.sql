-- ==============================================================================
-- SAMPLE TRACKING V1.0 — BASIC JOB CREATION & ATOMIC ROUTING (UAT BLOCKER 01)
-- Migration: 00003_add_job_creation_support.sql
-- Description:
--   1. Additive column: material_spec on public.jobs
--   2. Atomic transaction function: public.create_job_with_routing
--   Enforces server-side permissions (Planning/Admin only), unique job_no,
--   valid quantities, date constraints, and all-or-nothing routing persistence.
-- ==============================================================================

-- 1. ADDITIVE SCHEMA: Material Specification
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS material_spec TEXT;

-- 2. ATOMIC JOB & ROUTING CREATION STORED PROCEDURE
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
    v_job_id UUID;
    v_idx INT;
    v_op_item JSONB;
    v_step_order INT;
    v_op_name TEXT;
    v_machine TEXT;
    v_created_job RECORD;
    v_ops_count INT;
BEGIN
    -- 1. Security & Authentication Checks
    IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
        RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
    END IF;

    v_role := public.get_current_user_role();
    IF v_role NOT IN ('Planning', 'Admin') THEN
        RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền tạo JOB mới (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
    END IF;

    -- 2. Input Validation
    IF p_job_no IS NULL OR length(trim(p_job_no)) = 0 THEN
        RAISE EXCEPTION 'Mã JOB không được để trống.';
    END IF;

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

    -- Duplicate Job Code check (case-insensitive)
    IF EXISTS (SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(trim(p_job_no))) THEN
        RAISE EXCEPTION 'Mã JOB "%" đã tồn tại trong hệ thống. Vui lòng chọn mã khác.', trim(p_job_no);
    END IF;

    -- Routing operations check
    IF p_operations IS NULL OR jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
        RAISE EXCEPTION 'Quy trình công đoạn (Routing) phải có ít nhất một công đoạn.';
    END IF;

    v_ops_count := jsonb_array_length(p_operations);

    -- 3. Atomic Job Insertion
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
        trim(p_job_no),
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

    -- 4. Atomic Operations Insertion
    FOR v_idx IN 0 .. (v_ops_count - 1) LOOP
        v_op_item := p_operations -> v_idx;
        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, v_idx + 1);
        v_op_name := trim(COALESCE(v_op_item ->> 'operation_name', ''));
        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'planned_machine', '')), '');

        IF v_op_name = '' THEN
            RAISE EXCEPTION 'Tên công đoạn tại bước thứ % không được để trống.', v_idx + 1;
        END IF;

        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            status
        ) VALUES (
            v_job_id,
            v_step_order,
            v_op_name,
            v_machine,
            'NOT_STARTED'
        );
    END LOOP;

    -- Return JSON payload of created job with operations
    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'job_no', v_created_job.job_no,
        'part_no', v_created_job.part_no,
        'part_name', v_created_job.part_name,
        'status', v_created_job.status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO authenticated;
