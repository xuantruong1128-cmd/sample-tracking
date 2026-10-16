-- ==============================================================================
-- SAMPLE TRACKING V1.0 — BACKUP OF 7 EXISTING JOBS BEFORE CLEANUP
-- Exported at: 2026-10-13T08:44:15.810Z
-- Database: Supabase TEST (hosppagbopdghlupnhlr)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- JOB: TEST-PE-COMP-1791802137700 (ID: 83869ab3-9095-44f5-8736-cad070359632)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('83869ab3-9095-44f5-8736-cad070359632', 'TEST-PE-COMP-1791802137700', 'P-01', 'Test Part', 'TEST', NULL, 'ACTIVE', NULL, '2026-10-12T17:48:07.965081+00:00', '2026-10-12T17:48:07.965081+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('df15880d-c38c-4392-97b2-a87a99e2a89e', '83869ab3-9095-44f5-8736-cad070359632', 1, 'CNC', NULL, NULL, NULL, NULL, NULL, 'IN_PROGRESS', '2026-10-12T17:48:08.148997+00:00', '2026-10-12T17:48:08.626653+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.production_runs (id, operation_id, machine_id, operator_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, kiv_qty, production_date, remarks, created_at, updated_at)
VALUES ('2b0dadb0-d2b9-4cd6-a652-eff2ca10559f', 'df15880d-c38c-4392-97b2-a87a99e2a89e', 'CNC-01', NULL, 'Operator', '2026-10-10T08:00:00+00:00', '2026-10-10T10:00:00+00:00', NULL, 10, 0, 0, '2026-10-12', NULL, '2026-10-12T17:48:08.300003+00:00', '2026-10-12T23:39:22.109727+00:00')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- JOB: TEST-QA-LINK-1791802138943 (ID: 4401c9ff-bb9a-4385-90be-d3cd8638c284)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('4401c9ff-bb9a-4385-90be-d3cd8638c284', 'TEST-QA-LINK-1791802138943', 'P-01', 'Test Part', 'TEST', NULL, 'ACTIVE', NULL, '2026-10-12T17:48:08.949398+00:00', '2026-10-12T17:48:08.949398+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('b41927b2-c1d0-4393-92ff-2db3575bcc55', '4401c9ff-bb9a-4385-90be-d3cd8638c284', 1, 'CNC', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:48:09.082083+00:00', '2026-10-12T17:48:09.082083+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('c883b565-f7e2-4765-b12d-3afdc56d70cf', '4401c9ff-bb9a-4385-90be-d3cd8638c284', 2, 'Grinding', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:48:09.212852+00:00', '2026-10-12T17:48:09.212852+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.production_runs (id, operation_id, machine_id, operator_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, kiv_qty, production_date, remarks, created_at, updated_at)
VALUES ('dc88bd3d-7f2a-4266-ad8b-1a219ef599e4', 'b41927b2-c1d0-4393-92ff-2db3575bcc55', 'CNC-01', NULL, 'Operator', '2026-10-10T08:00:00+00:00', '2026-10-10T10:00:00+00:00', NULL, 5, 0, 0, '2026-10-12', NULL, '2026-10-12T17:48:09.343085+00:00', '2026-10-12T23:39:22.109727+00:00')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- JOB: TEST-CLOSE-1791802139646 (ID: d30134c0-3cb8-4b19-a8e2-03290d99b699)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('d30134c0-3cb8-4b19-a8e2-03290d99b699', 'TEST-CLOSE-1791802139646', 'P-01', 'Test Part', 'TEST', NULL, 'CLOSE', NULL, '2026-10-12T17:48:09.648319+00:00', '2026-10-12T17:48:09.940266+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('64b911cc-7715-4a6c-a957-7dc4d3e74d39', 'd30134c0-3cb8-4b19-a8e2-03290d99b699', 1, 'CNC', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:48:09.794584+00:00', '2026-10-12T17:48:09.794584+00:00')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- JOB: TEST-ATT-PEND-1791802140243 (ID: 1870a621-e339-44c7-9370-205e8079e352)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('1870a621-e339-44c7-9370-205e8079e352', 'TEST-ATT-PEND-1791802140243', 'P-01', 'Test Part', 'TEST', NULL, 'ACTIVE', NULL, '2026-10-12T17:48:10.229357+00:00', '2026-10-12T17:48:10.229357+00:00')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- JOB: 2026-10-12-001 (ID: 98f655f2-666f-4894-84fb-c1e5eb3356c9)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('98f655f2-666f-4894-84fb-c1e5eb3356c9', '2026-10-12-001', 'ABC-DEF', 'ABC-DEF', 'A', NULL, 'ACTIVE', '084f0e73-5679-42cf-9ec8-54df2a03ad9a', '2026-10-12T17:58:50.873306+00:00', '2026-10-12T17:58:50.873306+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('1b0cbf39-73cc-433c-b48a-00f6fee4e165', '98f655f2-666f-4894-84fb-c1e5eb3356c9', 1, 'CNC', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:58:50.873306+00:00', '2026-10-12T17:58:50.873306+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('f85309d5-9c28-4843-b799-c11657094553', '98f655f2-666f-4894-84fb-c1e5eb3356c9', 2, 'Mài vô tâm (CG)', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:58:50.873306+00:00', '2026-10-12T17:58:50.873306+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('5c1e8c6b-1ebe-4847-8e55-5f00dfb8a99a', '98f655f2-666f-4894-84fb-c1e5eb3356c9', 3, 'Xi mạ (Plating / Anodizing)', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:58:50.873306+00:00', '2026-10-12T17:58:50.873306+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('241fda96-2bb0-470d-9775-4432c26344b2', '98f655f2-666f-4894-84fb-c1e5eb3356c9', 4, 'VMI', NULL, NULL, NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T17:58:50.873306+00:00', '2026-10-12T17:58:50.873306+00:00')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- JOB: 202610-016 (ID: 35bafa41-bd45-4ef8-a977-bd0456e136c5)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('35bafa41-bd45-4ef8-a977-bd0456e136c5', '202610-016', 'ACX457', 'Dummy test', 'A', NULL, 'ACTIVE', '084f0e73-5679-42cf-9ec8-54df2a03ad9a', '2026-10-12T23:33:39.96536+00:00', '2026-10-12T23:33:39.96536+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('3853397d-4f6a-48a2-b8bc-5d2200c2fe7b', '35bafa41-bd45-4ef8-a977-bd0456e136c5', 10, 'Auto Turn', 'A20C', 'Auto Turn', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T23:33:39.96536+00:00', '2026-10-12T23:33:39.96536+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('41a059a1-3382-456a-816b-f2f9b8f9754a', '35bafa41-bd45-4ef8-a977-bd0456e136c5', 20, 'Centerless Grinding', 'CGMG', 'Centerless Grinding', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T23:33:39.96536+00:00', '2026-10-12T23:33:39.96536+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('e187f731-09c2-4ddb-80f6-47c35ec49b74', '35bafa41-bd45-4ef8-a977-bd0456e136c5', 30, 'Plating', 'AUTP', 'Plating', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T23:33:39.96536+00:00', '2026-10-12T23:33:39.96536+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('c7b85790-2efc-42fc-9e98-9549936dd574', '35bafa41-bd45-4ef8-a977-bd0456e136c5', 40, 'Visual check', 'VMIQ', 'Visual check', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-12T23:33:39.96536+00:00', '2026-10-12T23:33:39.96536+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.attachments (id, job_id, operation_id, file_name, file_size, mime_type, file_path, upload_status, content_hash, owning_department, uploaded_by, created_at)
VALUES ('9618866f-fea4-4350-812b-db79b2feb0ca', '35bafa41-bd45-4ef8-a977-bd0456e136c5', '3853397d-4f6a-48a2-b8bc-5d2200c2fe7b', 'Maintenance_Daily_Report.png', 353094, 'image/png', '35bafa41-bd45-4ef8-a977-bd0456e136c5/DRAWING/Maintenance_Daily_Report.png', 'READY', 'ad23a7dc9fc265f66d345678b72fe32b465959c5e3faefc17dff14e5abaa65df', 'Admin', '084f0e73-5679-42cf-9ec8-54df2a03ad9a', '2026-10-12T23:46:03.741409+00:00')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- JOB: 202610-024 (ID: ac84d2d0-b6af-48fc-8f21-a82ba0d967c6)
-- ------------------------------------------------------------------------------
INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)
VALUES ('ac84d2d0-b6af-48fc-8f21-a82ba0d967c6', '202610-024', 'IVC-TX-SJ-005-001', 'IVC-TX-SJ-005-001', 'C', NULL, 'ACTIVE', 'ebfe7095-d0f3-4f2b-aa8d-7f5b01f8ec5d', '2026-10-13T12:12:55.614728+00:00', '2026-10-13T12:12:55.614728+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('1f098b35-2b56-41bc-9321-d45b53ab834b', 'ac84d2d0-b6af-48fc-8f21-a82ba0d967c6', 10, 'Auto Turn', 'SB2C', 'Auto Turn', NULL, NULL, NULL, 'IN_PROGRESS', '2026-10-13T12:12:55.614728+00:00', '2026-10-13T15:39:24.549089+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('e6ed3429-a838-4c24-a0b8-70e5921014b6', 'ac84d2d0-b6af-48fc-8f21-a82ba0d967c6', 20, 'Centerless Grinding', 'CGMG', 'Centerless Grinding', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-13T12:12:55.614728+00:00', '2026-10-13T12:12:55.614728+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('8837a996-694a-4501-9bb6-a89e7ba05c68', 'ac84d2d0-b6af-48fc-8f21-a82ba0d967c6', 30, 'Plating', 'AUTP', 'Plating', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-13T12:12:55.614728+00:00', '2026-10-13T12:12:55.614728+00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)
VALUES ('e10da949-6fc7-4872-a58e-b579fda4cca5', 'ac84d2d0-b6af-48fc-8f21-a82ba0d967c6', 40, 'Visual check', 'VMIQ', 'Visual check', NULL, NULL, NULL, 'NOT_STARTED', '2026-10-13T12:12:55.614728+00:00', '2026-10-13T12:12:55.614728+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.production_runs (id, operation_id, machine_id, operator_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, kiv_qty, production_date, remarks, created_at, updated_at)
VALUES ('360c8561-2a49-461a-82d7-9ebf94f57986', '1f098b35-2b56-41bc-9321-d45b53ab834b', 'D28', 'da53958c-c394-4a99-afe8-d1c20d5de0bd', 'Nguyễn Thắm', '2026-10-13T00:00:00+00:00', '2026-10-13T00:00:00+00:00', 62, 10, 1, 0, '2026-10-13', NULL, '2026-10-13T15:36:47.148135+00:00', '2026-10-13T08:39:24.549089+00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ng_details (id, production_run_id, defect_name, defect_code, ng_qty, defect_description, cause, remark, photo_urls, created_at)
VALUES ('92b91764-9ed0-46a6-9138-1202aea2324e', '360c8561-2a49-461a-82d7-9ebf94f57986', 'Lỗi khác', 'DEF-OTH-01', 1, 'setting', 'setting', NULL, ''::TEXT[], '2026-10-13T15:39:24.549089+00:00')
ON CONFLICT (id) DO NOTHING;


COMMIT;
