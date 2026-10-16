-- ==============================================================================
-- SAMPLE TRACKING V1.0 — OPTIONAL DEMONSTRATION DATA (FOR DEV / STAGING ONLY)
-- File: supabase/seeds/demo_jobs.sql (R5 Corrected Schema & Workflow)
-- Strictly matches R5 workflow and schema:
--   - production_runs: (operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at)
--   - qa_checks: (operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at)
--   - pe_technical_dispositions: (job_id, operation_id, qa_check_id, decision_type, technical_reason, decision_maker, decision_maker_name, decision_timestamp, created_at)
-- DO NOT RUN ON PRODUCTION DATABASE.
-- ==============================================================================

DO $$
DECLARE
    v_pe_user_id UUID;
    v_job1_id UUID;
    v_job2_id UUID;
    v_job3_id UUID;
    v_job4_id UUID;

    v_op1_cnc UUID;
    v_op1_cg UUID;
    v_op1_plat UUID;
    v_op1_vmi UUID;

    v_op2_cnc UUID;
    v_op2_cg UUID;
    v_op2_heat UUID;
    v_op2_vmi UUID;

    v_op3_cnc UUID;
    v_op3_cg UUID;
    v_op3_vmi UUID;

    v_op4_cnc UUID;
    v_op4_cg UUID;

    v_run_id UUID;
    v_qa_check_id UUID;
BEGIN
    -- Only insert demo jobs if jobs table is empty
    IF NOT EXISTS (SELECT 1 FROM public.jobs LIMIT 1) THEN

        -- Look up an active PE-MFG profile if available
        SELECT id INTO v_pe_user_id
        FROM public.profiles
        WHERE role = 'PE-MFG' AND is_active = TRUE
        LIMIT 1;

        -- Fall back to any active profile if no PE-MFG profile exists yet
        IF v_pe_user_id IS NULL THEN
            SELECT id INTO v_pe_user_id
            FROM public.profiles
            WHERE is_active = TRUE
            LIMIT 1;
        END IF;

        -- =====================================================================
        -- JOB 1: In Production (Partially completed, in-progress, pending)
        -- =====================================================================
        INSERT INTO public.jobs (
            job_no, part_no, part_name, customer, order_qty, material,
            planned_start_date, planned_finish_date, status, pe_owner_id
        ) VALUES (
            'JOB-2026-001', 'E-405-06543-02', 'Idler Roll Tube', 'ENBI', 50, 'A6061-T6',
            CURRENT_DATE - 3, CURRENT_DATE + 4, 'ACTIVE', v_pe_user_id
        ) RETURNING id INTO v_job1_id;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job1_id, 1, 'CNC', 'Cincom L20-X', 120, 'NOT_STARTED') RETURNING id INTO v_op1_cnc;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job1_id, 2, 'CG (Centerless Grinding)', 'TopKing TK-18', 45, 'NOT_STARTED') RETURNING id INTO v_op1_cg;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job1_id, 3, 'Plating (Anodizing)', 'Line Anod-02', 300, 'NOT_STARTED') RETURNING id INTO v_op1_plat;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job1_id, 4, 'VMI (Visual Inspection)', 'QC Station 1', 60, 'NOT_STARTED') RETURNING id INTO v_op1_vmi;

        -- Op 1 (CNC): Run recorded -> QA OK -> Status transitions NOT_STARTED -> IN_PROGRESS -> COMPLETED
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op1_cnc;

        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op1_cnc, 'Cincom L20-X', 'Nguyễn Văn CNC', now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 118, 50, 0, now() - interval '2 days'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op1_cnc, v_run_id, 'Trần QA', now() - interval '2 days' + interval '3 hours', 5, 5, 0, 'OK', 'Kích thước OD và chiều dài đạt bản vẽ Rev A.', now() - interval '2 days' + interval '3 hours'
        );

        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op1_cnc;

        -- Op 2 (CG): Run recorded -> Status is IN_PROGRESS (R5 compliant)
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op1_cg;

        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op1_cg, 'TopKing TK-18', 'Lê Văn Mài', now() - interval '4 hours', now() - interval '2 hours', 44, 48, 2, now() - interval '4 hours'
        );

        -- =====================================================================
        -- JOB 2: All Operations Completed (Green throughout)
        -- =====================================================================
        INSERT INTO public.jobs (
            job_no, part_no, part_name, customer, order_qty, material,
            planned_start_date, planned_finish_date, status, pe_owner_id
        ) VALUES (
            'JOB-2026-002', 'DV0008AP02', 'Drive Shaft 10mm', 'SYNZTEC', 100, 'SUS303',
            CURRENT_DATE - 7, CURRENT_DATE - 1, 'ACTIVE', v_pe_user_id
        ) RETURNING id INTO v_job2_id;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job2_id, 1, 'CNC', 'Tsugami B0205', 95, 'NOT_STARTED') RETURNING id INTO v_op2_cnc;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job2_id, 2, 'CG', 'Koyo C6040', 35, 'NOT_STARTED') RETURNING id INTO v_op2_cg;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job2_id, 3, 'Heat Treatment', 'Furnace #3', 450, 'NOT_STARTED') RETURNING id INTO v_op2_heat;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job2_id, 4, 'VMI', 'QC Station 2', 40, 'NOT_STARTED') RETURNING id INTO v_op2_vmi;

        -- Op 1 Run & QA
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op2_cnc;
        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op2_cnc, 'Tsugami B0205', 'Nguyễn Văn CNC', now() - interval '6 days', now() - interval '6 days' + interval '3 hours', 93, 100, 0, now() - interval '6 days'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op2_cnc, v_run_id, 'Lê QA', now() - interval '6 days' + interval '4 hours', 10, 10, 0, 'OK', 'Gia công CNC đạt chuẩn.', now() - interval '6 days' + interval '4 hours'
        );
        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op2_cnc;

        -- Op 2 Run & QA
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op2_cg;
        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op2_cg, 'Koyo C6040', 'Lê Văn Mài', now() - interval '4 days', now() - interval '4 days' + interval '2 hours', 34, 100, 0, now() - interval '4 days'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op2_cg, v_run_id, 'Lê QA', now() - interval '4 days' + interval '3 hours', 10, 10, 0, 'OK', 'Độ nhám bề mặt Ra 0.4 đạt.', now() - interval '4 days' + interval '3 hours'
        );
        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op2_cg;

        -- Op 3 Run & QA
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op2_heat;
        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op2_heat, 'Furnace #3', 'Phạm Nhiệt Luyện', now() - interval '2 days', now() - interval '2 days' + interval '4 hours', 440, 100, 0, now() - interval '2 days'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op2_heat, v_run_id, 'Lê QA', now() - interval '2 days' + interval '5 hours', 5, 5, 0, 'OK', 'Độ cứng HRC đạt 45-48.', now() - interval '2 days' + interval '5 hours'
        );
        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op2_heat;

        -- Op 4 Run & QA
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op2_vmi;
        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op2_vmi, 'QC Station 2', 'Hoàng Kiểm Soát', now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 38, 100, 0, now() - interval '1 day'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op2_vmi, v_run_id, 'Hoàng Kiểm Soát', now() - interval '1 day' + interval '3 hours', 100, 100, 0, 'OK', 'Kiểm tra ngoại quan 100% đạt.', now() - interval '1 day' + interval '3 hours'
        );
        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op2_vmi;

        -- =====================================================================
        -- JOB 3: Quality KIV / Technical Disposition Recorded (R5 Compliant)
        -- =====================================================================
        INSERT INTO public.jobs (
            job_no, part_no, part_name, customer, order_qty, material,
            planned_start_date, planned_finish_date, status, pe_owner_id
        ) VALUES (
            'JOB-2026-003', '302LC25380', 'R/F Exit Up Roller', 'NISSEI', 30, 'SUM24L',
            CURRENT_DATE - 1, CURRENT_DATE + 5, 'ACTIVE', v_pe_user_id
        ) RETURNING id INTO v_job3_id;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job3_id, 1, 'CNC', 'Miyano BNA-42', 180, 'NOT_STARTED') RETURNING id INTO v_op3_cnc;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job3_id, 2, 'CG', 'TopKing TK-18', 50, 'NOT_STARTED') RETURNING id INTO v_op3_cg;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job3_id, 3, 'VMI', 'QC Station 1', 45, 'NOT_STARTED') RETURNING id INTO v_op3_vmi;

        -- Op 1 Run & QA KIV
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op3_cnc;

        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op3_cnc, 'Miyano BNA-42', 'Đỗ CNC', now() - interval '10 hours', now() - interval '8 hours', 175, 28, 2, now() - interval '10 hours'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op3_cnc, v_run_id, 'Phan QA', now() - interval '7 hours', 5, 4, 1, 'KIV', 'Dung sai rãnh then nằm sát cận trên (+0.015mm). Tạm giữ chờ ý kiến Kỹ thuật.', now() - interval '7 hours'
        ) RETURNING id INTO v_qa_check_id;

        -- Transition Op 1 to HOLD with PE Technical Disposition recorded
        UPDATE public.job_operations SET status = 'HOLD' WHERE id = v_op3_cnc;

        IF v_pe_user_id IS NOT NULL THEN
            INSERT INTO public.pe_technical_dispositions (
                job_id, operation_id, qa_check_id, decision_type, technical_reason, decision_maker, decision_maker_name, decision_timestamp, created_at
            ) VALUES (
                v_job3_id, v_op3_cnc, v_qa_check_id, 'HOLD',
                'Tạm dừng công đoạn để kiểm tra độ mòn dao tiện rãnh then và hiệu chuẩn đồ gá.',
                v_pe_user_id,
                'PE Engineer',
                timezone('Asia/Ho_Chi_Minh', now() - interval '6 hours'),
                timezone('Asia/Ho_Chi_Minh', now() - interval '6 hours')
            );
        END IF;

        -- =====================================================================
        -- JOB 4: Closed Job (Read-only verification)
        -- =====================================================================
        INSERT INTO public.jobs (
            job_no, part_no, part_name, customer, order_qty, material,
            planned_start_date, planned_finish_date, status, pe_owner_id
        ) VALUES (
            'JOB-2026-004', 'QC9-4703-000', 'DP Roller KT B261', 'KTC', 25, 'SUS304',
            CURRENT_DATE - 20, CURRENT_DATE - 10, 'ACTIVE', v_pe_user_id
        ) RETURNING id INTO v_job4_id;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job4_id, 1, 'CNC', 'Cincom L20-X', 140, 'NOT_STARTED') RETURNING id INTO v_op4_cnc;

        INSERT INTO public.job_operations (job_id, step_order, operation_name, planned_machine, planned_cycle_time_seconds, status)
        VALUES (v_job4_id, 2, 'CG', 'TopKing TK-18', 40, 'NOT_STARTED') RETURNING id INTO v_op4_cg;

        -- Op 1 Run & QA OK
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op4_cnc;
        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op4_cnc, 'Cincom L20-X', 'Vũ CNC', now() - interval '15 days', now() - interval '15 days' + interval '2 hours', 138, 25, 0, now() - interval '15 days'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op4_cnc, v_run_id, 'Ngô QA', now() - interval '15 days' + interval '3 hours', 5, 5, 0, 'OK', 'Đạt yêu cầu xuất xưởng.', now() - interval '15 days' + interval '3 hours'
        );
        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op4_cnc;

        -- Op 2 Run & QA OK
        UPDATE public.job_operations SET status = 'IN_PROGRESS' WHERE id = v_op4_cg;
        INSERT INTO public.production_runs (
            operation_id, machine_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, created_at
        ) VALUES (
            v_op4_cg, 'TopKing TK-18', 'Lê Mài', now() - interval '12 days', now() - interval '12 days' + interval '1 hour', 39, 25, 0, now() - interval '12 days'
        ) RETURNING id INTO v_run_id;

        INSERT INTO public.qa_checks (
            operation_id, production_run_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, notes, created_at
        ) VALUES (
            v_op4_cg, v_run_id, 'Ngô QA', now() - interval '12 days' + interval '2 hours', 5, 5, 0, 'OK', 'Hoàn tất mài tròn ngoài.', now() - interval '12 days' + interval '2 hours'
        );
        UPDATE public.job_operations SET status = 'COMPLETED' WHERE id = v_op4_cg;

        -- Transition Job 4 to CLOSE
        UPDATE public.jobs
        SET status = 'CLOSE',
            closed_at = timezone('Asia/Ho_Chi_Minh', now() - interval '5 days'),
            updated_at = now() - interval '5 days'
        WHERE id = v_job4_id;

    END IF;
END $$;
