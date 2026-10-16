-- ==============================================================================
-- SAMPLE TRACKING V1.0 — UI-03: WORKCENTER MASTER & ROUTING ENHANCEMENT
-- Migration: 00005_ui03_workcenter_and_routing_enhancement.sql
-- Description:
--   1. Create public.workcenter_master with official 37 entries from Master data.xlsx
--   2. Add additive columns to public.job_operations:
--      - workcenter_code VARCHAR(10)
--      - description TEXT
--      - machine_no TEXT
--      - remark TEXT
--   3. Enhance public.create_job_with_routing atomic procedure to persist
--      all 6 routing fields (Operation seq 10, 20..., Workcenter, Description,
--      Cycle Time Target, Machine No., Remark) with strict validation.
-- ==============================================================================

-- 1. WORKCENTER MASTER TABLE
CREATE TABLE IF NOT EXISTS public.workcenter_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stt INTEGER,
    code VARCHAR(10) NOT NULL,
    mc_type TEXT,
    description TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_workcenter_master_code ON public.workcenter_master(code);
CREATE INDEX IF NOT EXISTS idx_workcenter_master_active ON public.workcenter_master(is_active);

-- Populate official master records (37 rows from Master data.xlsx) if empty
INSERT INTO public.workcenter_master (stt, code, mc_type, description)
SELECT stt, code, mc_type, description
FROM (VALUES
    (1, 'CAMC', 'CAM', 'Auto Turn'),
    (2, 'B12C', 'Cincom B12', 'Auto Turn'),
    (3, 'A20C', 'Cincom citizent A20', 'Auto Turn'),
    (4, 'CYGG', 'Cilindrical Grinding', 'Auto Turn'),
    (5, 'D&TS', 'Drilling and Tapping', 'Drill & Tap'),
    (6, 'B26C', 'Tsugami BO265', 'Auto Turn'),
    (7, 'L32C', 'Cincom Citizent L32', 'Auto Turn'),
    (8, 'L20C', 'Tsugami L20', 'Auto Turn'),
    (9, 'L16C', 'Tsugami L16', 'Auto Turn'),
    (10, 'B18C', 'Tsugami B18', 'Auto Turn'),
    (11, 'SR2C', 'Star SR20', 'Auto Turn'),
    (12, 'SB2C', 'Star SB20R', 'Auto Turn'),
    (13, 'SR3C', 'Star SR32', 'Auto Turn'),
    (14, 'CGMG', 'Paragon RC12', 'Centerless Grinding'),
    (15, 'CGMG', 'Paragon RC20', 'Centerless Grinding'),
    (16, 'CGMG', 'DX18 CNC CG', 'Centerless Grinding'),
    (17, 'CGMG', 'DX18 CG', 'Centerless Grinding'),
    (18, 'D&TS', 'Fanuc', 'Drill & Tap'),
    (19, 'SPMS', 'SPM', 'Milling'),
    (20, 'KURS', 'Rolling/Knurling', 'Rolling/Knurling'),
    (21, 'IDHL', 'Induction Hardening', 'Induction Hardening'),
    (22, 'FINS', 'Buffing', 'Buffing'),
    (23, 'STAS', 'Stacking', 'Stacking'),
    (24, 'TMBS', 'Tumbling', 'Tumbling'),
    (25, 'TMBS', 'Magnetic polishing', 'Magnetic polishing'),
    (26, 'FINS', 'Chamfering', 'Chamfering'),
    (27, 'FINS', 'Polishing', 'Polishing'),
    (28, 'ASYS', 'Assembly', 'Assembly'),
    (29, 'MYNC', 'STS Chucker', 'STS Chucker'),
    (30, 'GCMN', 'Gear cutting', 'Gear cutting'),
    (31, 'AUTP', 'Plating', 'Plating'),
    (32, 'MANP', 'Plating', 'Plating'),
    (33, 'PLPP', 'Plating', 'Plating'),
    (34, 'WSHP', 'Washing', 'Washing'),
    (35, 'Subcon', 'Subcon', 'Subcon'),
    (36, 'VMIC', 'Inspection 100%', 'Inspection 100%'),
    (37, 'VMIQ', 'Visual check', 'Visual check')
) AS v(stt, code, mc_type, description)
WHERE NOT EXISTS (SELECT 1 FROM public.workcenter_master LIMIT 1);

-- RLS Policies on public.workcenter_master
ALTER TABLE public.workcenter_master ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'workcenter_master' AND policyname = 'p_workcenter_master_read'
    ) THEN
        CREATE POLICY p_workcenter_master_read
            ON public.workcenter_master FOR SELECT
            TO authenticated, anon
            USING (true);
    END IF;
END $$;

-- 2. ADDITIVE SCHEMA ON public.job_operations
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS workcenter_code VARCHAR(10);
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS machine_no TEXT;
ALTER TABLE public.job_operations ADD COLUMN IF NOT EXISTS remark TEXT;

-- 3. ENHANCED ATOMIC JOB & ROUTING CREATION STORED PROCEDURE
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

        -- Step order / Sequence (supports 10, 20, 30... or custom)
        v_step_order := COALESCE((v_op_item ->> 'step_order')::INTEGER, (v_idx + 1) * 10);
        IF v_step_order < 1 THEN
            RAISE EXCEPTION 'Thứ tự bước (step_order) phải >= 1 (bước % nhận được %).', v_idx + 1, v_step_order;
        END IF;

        -- Workcenter Code & Description
        v_wc_code := NULLIF(trim(COALESCE(v_op_item ->> 'workcenter_code', '')), '');
        v_desc := NULLIF(trim(COALESCE(v_op_item ->> 'description', v_op_item ->> 'operation_name', '')), '');

        -- Fallback if only one is provided
        IF v_wc_code IS NULL AND v_desc IS NOT NULL THEN
            v_wc_code := v_desc;
        END IF;

        IF v_wc_code IS NULL THEN
            RAISE EXCEPTION 'Vui lòng chọn mã Workcenter cho công đoạn tại bước thứ %.', v_idx + 1;
        END IF;

        IF v_desc IS NULL THEN
            -- Lookup description from master if available
            SELECT description INTO v_desc
            FROM public.workcenter_master
            WHERE code = v_wc_code
            LIMIT 1;
            
            IF v_desc IS NULL THEN
                v_desc := v_wc_code;
            END IF;
        END IF;

        -- Cycle Time Target (must be positive if present)
        IF (v_op_item ->> 'planned_cycle_time_seconds') IS NOT NULL AND length(trim(v_op_item ->> 'planned_cycle_time_seconds')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'planned_cycle_time_seconds')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Cycle Time Target tại bước thứ % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSIF (v_op_item ->> 'cycle_time') IS NOT NULL AND length(trim(v_op_item ->> 'cycle_time')) > 0 THEN
            v_cycle_time := (v_op_item ->> 'cycle_time')::NUMERIC;
            IF v_cycle_time <= 0 THEN
                RAISE EXCEPTION 'Cycle Time Target tại bước thứ % phải là số dương lớn hơn 0.', v_idx + 1;
            END IF;
        ELSE
            v_cycle_time := NULL;
        END IF;

        -- Machine No. & Remark
        v_machine := NULLIF(trim(COALESCE(v_op_item ->> 'machine_no', v_op_item ->> 'planned_machine', '')), '');
        v_remark := NULLIF(trim(COALESCE(v_op_item ->> 'remark', '')), '');

        INSERT INTO public.job_operations (
            job_id,
            step_order,
            operation_name,
            planned_machine,
            planned_cycle_time_seconds,
            workcenter_code,
            description,
            machine_no,
            remark,
            status
        ) VALUES (
            v_job_id,
            v_step_order,
            v_desc,
            v_machine,
            v_cycle_time,
            v_wc_code,
            v_desc,
            v_machine,
            v_remark,
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
GRANT EXECUTE ON FUNCTION public.create_job_with_routing TO service_role;
