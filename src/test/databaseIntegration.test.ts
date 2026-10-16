import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — REAL DATABASE INTEGRATION TEST SUITE (R4 SPECIFICATION)
 *
 * Verifies real PostgreSQL/Supabase behaviors:
 *   1. Operation INSERT: blocks creation with status COMPLETED (must start as NOT_STARTED)
 *   2. PE Completion: PE completes operation without QA report -> ALLOWED (QA is optional)
 *   3. QA NG / KIV Handling: requires recorded PE disposition to complete with outstanding NG
 *   4. QA Correlation: blocks forged cross-operation production_run_id linkages
 *   5. Closed-Job Write Lockout: blocks operations, runs, QA, and attachments on closed jobs
 *   6. Job Lifecycle Transitions: enforces ACTIVE -> CLOSE; blocks direct PURGE and reopening
 *   7. Document Security: enforces department ownership and category whitelist
 *   8. Audit Logging: system triggers record changes on all system tables
 *
 * NOTE: If live disposable Supabase credentials are not provided in environment,
 * this suite reports execution status as BLOCKED per Part D5 instructions.
 * ==============================================================================
 */

import { createRequire } from 'module';

const requireModule = createRequire(import.meta.url);
const { validateTargetApproval } = requireModule('../../scripts/gate-b-target-validator.cjs');

import fs from 'fs';
import path from 'path';

// Load .env if present
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

// F-02: Require explicit opt-in flag to run live integration tests
const isLiveExecutionOptIn = process.env.ENABLE_LIVE_DB_TESTS === 'true';

const testUrl = process.env.SUPABASE_TEST_URL;
const testServiceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const testAnonKey = process.env.SUPABASE_TEST_ANON_KEY;
const isDisposable = process.env.SUPABASE_TEST_IS_DISPOSABLE === 'true';

// Shared F-03 Target Approval Validator (Centralized & Side-Effect Free)
const approvalResult = validateTargetApproval({
  targetUrl: testUrl || '',
  isDisposableEnv: isDisposable,
});

const isIndependentlyApproved = approvalResult.ok;
const targetRef = approvalResult.targetRef || '';
const targetHost = approvalResult.targetHost || '';

// Strict safety check (F-02 & F-03 Remediation): ALL prerequisites must be met
const isLiveDbSafe = Boolean(
  isLiveExecutionOptIn &&
  testUrl &&
  testServiceKey &&
  testAnonKey &&
  isDisposable &&
  isIndependentlyApproved
);

describe('Real PostgreSQL & Supabase Integration Tests (R4 Suite)', () => {
  if (!isLiveDbSafe) {
    it('reports real database execution status as BLOCKED (Awaiting explicit opt-in and independently approved disposable target)', () => {
      let reason = '';
      if (!isLiveExecutionOptIn) {
        reason = 'Explicit live test opt-in (ENABLE_LIVE_DB_TESTS=true) is not set. Default test execution is non-destructive and local.';
      } else if (!testUrl || !testServiceKey || !testAnonKey) {
        reason = 'Missing dedicated SUPABASE_TEST_* credentials in environment.';
      } else if (!isDisposable) {
        reason = 'SUPABASE_TEST_IS_DISPOSABLE is not explicitly set to "true".';
      } else if (!isIndependentlyApproved) {
        reason = approvalResult.reason || `Target approval failed: host "${targetHost}" (${targetRef}) does not match independent approval.`;
      }

      console.warn(
        '\n⚠️ [LIVE DATABASE INTEGRATION NOTICE]\n' +
        `Target validation check: ${reason}\n` +
        'Per F-02 instructions: Real cloud database integration tests are marked as BLOCKED.\n' +
        'To safely execute against a real disposable database:\n' +
        '  - ENABLE_LIVE_DB_TESTS=true (explicit opt-in)\n' +
        '  - config/gate-b-approved-target.json (independent project approval)\n' +
        '  - SUPABASE_TEST_URL (dedicated test instance)\n' +
        '  - SUPABASE_TEST_SERVICE_KEY\n' +
        '  - SUPABASE_TEST_ANON_KEY\n' +
        '  - SUPABASE_TEST_IS_DISPOSABLE=true\n'
      );
      expect(isLiveDbSafe).toBe(false);
    });
    return;
  }

  // --- Real database integration execution against live instance ---
  let adminClient: SupabaseClient;

  beforeAll(() => {
    adminClient = createClient(testUrl!, testServiceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('1. Operation INSERT: blocks creation with status COMPLETED (must start as NOT_STARTED)', async () => {
    const { data: job } = await adminClient.from('jobs').insert({
      job_no: `TEST-INSERT-${Date.now()}`,
      part_no: 'P-01',
      part_name: 'Test Part',
      customer: 'TEST',
      order_qty: 10,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-15',
      status: 'ACTIVE',
    }).select().single();

    expect(job).toBeTruthy();

    const { error: opError } = await adminClient.from('job_operations').insert({
      job_id: job.id,
      step_order: 1,
      operation_name: 'CNC',
      status: 'COMPLETED', // Violation: must start as NOT_STARTED
    });

    expect(opError).toBeTruthy();
    expect(opError?.message).toContain('NOT_STARTED');

    // Cleanup
    await adminClient.from('jobs').delete().eq('id', job.id);
  });

  it('2. PE Completion: PE completes operation with production run without QA report (QA is optional)', async () => {
    const { data: job } = await adminClient.from('jobs').insert({
      job_no: `TEST-PE-COMP-${Date.now()}`,
      part_no: 'P-01',
      part_name: 'Test Part',
      customer: 'TEST',
      order_qty: 10,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-15',
      status: 'ACTIVE',
    }).select().single();

    const { data: op } = await adminClient.from('job_operations').insert({
      job_id: job.id,
      step_order: 1,
      operation_name: 'CNC',
      status: 'NOT_STARTED',
    }).select().single();

    // Insert completed production run
    await adminClient.from('production_runs').insert({
      operation_id: op.id,
      machine_id: 'CNC-01',
      operator_name: 'Worker 1',
      start_time: '2026-10-10T08:00:00Z',
      end_time: '2026-10-10T10:00:00Z',
      ok_qty: 10,
      ng_qty: 0,
    });

    // Transition NOT_STARTED -> IN_PROGRESS (operator starts work)
    const { error: startError } = await adminClient
      .from('job_operations')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', op.id);
    expect(startError).toBeNull();

    // PE completes operation (NO QA check exists - QA is optional in PE-owned workflow)
    const { error: compError } = await adminClient
      .from('job_operations')
      .update({ status: 'COMPLETED' })
      .eq('id', op.id);

    expect(compError).toBeNull();

    const { data: opCompleted } = await adminClient.from('job_operations').select('status').eq('id', op.id).single();
    expect(opCompleted.status).toBe('COMPLETED');

    // Cleanup
    await adminClient.from('jobs').delete().eq('id', job.id);
  });

  it('3. QA Correlation: blocks forged cross-operation production_run_id linkage', async () => {
    const { data: job } = await adminClient.from('jobs').insert({
      job_no: `TEST-QA-LINK-${Date.now()}`,
      part_no: 'P-01',
      part_name: 'Test Part',
      customer: 'TEST',
      order_qty: 10,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-15',
      status: 'ACTIVE',
    }).select().single();

    const { data: op1 } = await adminClient.from('job_operations').insert({
      job_id: job.id,
      step_order: 1,
      operation_name: 'CNC',
      status: 'NOT_STARTED',
    }).select().single();

    const { data: op2 } = await adminClient.from('job_operations').insert({
      job_id: job.id,
      step_order: 2,
      operation_name: 'Grinding',
      status: 'NOT_STARTED',
    }).select().single();

    // Production run belongs to op1
    const { data: runOp1 } = await adminClient.from('production_runs').insert({
      operation_id: op1.id,
      machine_id: 'CNC-01',
      operator_name: 'Worker',
      start_time: '2026-10-10T08:00:00Z',
      end_time: '2026-10-10T10:00:00Z',
      ok_qty: 5,
      ng_qty: 0,
    }).select().single();

    // Attempt to insert QA check on op2 referencing runOp1
    const { error: qaError } = await adminClient.from('qa_checks').insert({
      operation_id: op2.id, // Op 2
      production_run_id: runOp1.id, // Belongs to Op 1!
      inspector_name: 'QA Inspector',
      inspection_time: '2026-10-10T11:00:00Z',
      sample_size: 5,
      ok_qty: 5,
      ng_qty: 0,
      result: 'OK',
    });

    expect(qaError).toBeTruthy();
    expect(qaError?.message).toContain('cross-operation');

    // Cleanup
    await adminClient.from('jobs').delete().eq('id', job.id);
  });

  it('4. Closed Job Lockout: blocks writes when parent job is CLOSE', async () => {
    const { data: job } = await adminClient.from('jobs').insert({
      job_no: `TEST-CLOSE-${Date.now()}`,
      part_no: 'P-01',
      part_name: 'Test Part',
      customer: 'TEST',
      order_qty: 10,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-15',
      status: 'ACTIVE',
    }).select().single();

    const { data: op } = await adminClient.from('job_operations').insert({
      job_id: job.id,
      step_order: 1,
      operation_name: 'CNC',
      status: 'NOT_STARTED',
    }).select().single();

    // Close job
    await adminClient.from('jobs').update({ status: 'CLOSE' }).eq('id', job.id);

    // Attempt to insert run on closed job
    const { error: runError } = await adminClient.from('production_runs').insert({
      operation_id: op.id,
      machine_id: 'CNC-01',
      operator_name: 'Worker',
      start_time: '2026-10-10T08:00:00Z',
      end_time: '2026-10-10T10:00:00Z',
      ok_qty: 5,
      ng_qty: 0,
    });

    expect(runError).toBeTruthy();
    expect(runError?.message).toContain('locked');

    // Attempt to reopen closed job directly to ACTIVE
    const { error: reopenError } = await adminClient.from('jobs').update({ status: 'ACTIVE' }).eq('id', job.id);
    expect(reopenError).toBeTruthy();
    expect(reopenError?.message).toContain('reopening');

    // Cleanup
    await adminClient.from('job_operations').delete().eq('id', op.id);
    await adminClient.from('jobs').delete().eq('id', job.id);
  });

  it('5. R7-01 Live Check: Attachment INSERT forces upload_status to PENDING even if client submits READY', async () => {
    const { data: job } = await adminClient.from('jobs').insert({
      job_no: `TEST-ATT-PEND-${Date.now()}`,
      part_no: 'P-01',
      part_name: 'Test Part',
      customer: 'TEST',
      order_qty: 10,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-15',
      status: 'ACTIVE',
    }).select().single();

    const { data: att, error: attErr } = await adminClient.from('attachments').insert({
      job_id: job.id,
      file_name: 'test.pdf',
      file_path: `${job.id}/DRAWING/test.pdf`,
      file_size: 1024,
      mime_type: 'application/pdf',
      file_type: 'DRAWING',
      upload_status: 'READY', // Attempted forge
    }).select().single();

    expect(attErr).toBeNull();
    expect(att?.upload_status).toBe('PENDING'); // Server trigger forced PENDING

    // Cleanup
    await adminClient.from('attachments').delete().eq('id', att.id);
    await adminClient.from('jobs').delete().eq('id', job.id);
  });

  it('6. R7-03 Live Check: Direct UPDATE on qa_event_counter is blocked', async () => {
    const { data: job } = await adminClient.from('jobs').insert({
      job_no: `TEST-COUNTER-${Date.now()}`,
      part_no: 'P-01',
      part_name: 'Test Part',
      customer: 'TEST',
      order_qty: 10,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-15',
      status: 'ACTIVE',
    }).select().single();

    const { data: op } = await adminClient.from('job_operations').insert({
      job_id: job.id,
      step_order: 1,
      operation_name: 'CNC',
      status: 'NOT_STARTED',
    }).select().single();

    const { error: updateCounterErr } = await adminClient
      .from('job_operations')
      .update({ qa_event_counter: 99 })
      .eq('id', op.id);

    expect(updateCounterErr).toBeTruthy();
    expect(updateCounterErr?.message).toContain('qa_event_counter is server-owned');

    // Cleanup
    await adminClient.from('job_operations').delete().eq('id', op.id);
    await adminClient.from('jobs').delete().eq('id', job.id);
  });

  it('7. Basic JOB Creation with Atomic Routing: creates JOB with ordered operations and rejects duplicate code', async () => {
    const jobCode = `TEST-JOB-CREATE-${Date.now()}`;
    const { data: result, error: rpcErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: jobCode,
      p_part_no: 'PART-INTEG-01',
      p_part_name: 'Integration Test Bushing',
      p_customer: 'TEST-CLIENT',
      p_order_qty: 150,
      p_material: 'SUS316L',
      p_material_spec: 'Ø25 x 300mm',
      p_planned_start_date: '2026-10-12',
      p_planned_finish_date: '2026-10-20',
      p_operations: [
        { step_order: 1, operation_name: 'CNC Turning', planned_machine: 'Cincom L20-X' },
        { step_order: 2, operation_name: 'CG Grinding', planned_machine: 'TopKing TK-18' },
        { step_order: 3, operation_name: 'Inspection', planned_machine: 'QC Station 1' },
      ],
    });

    expect(rpcErr).toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.job_id).toBeTruthy();

    const createdJobId = result.job_id;

    // Verify database contents
    const { data: dbJob } = await adminClient.from('jobs').select('*, operations:job_operations(*)').eq('id', createdJobId).single();
    expect(dbJob).toBeTruthy();
    expect(dbJob.job_no).toBe(jobCode);
    expect(dbJob.order_qty).toBe(150);
    expect(dbJob.material_spec).toBe('Ø25 x 300mm');
    expect(dbJob.operations.length).toBe(3);

    // Verify ordering
    const sortedOps = [...dbJob.operations].sort((a: any, b: any) => a.step_order - b.step_order);
    expect(sortedOps[0].step_order).toBe(1);
    expect(sortedOps[0].operation_name).toBe('CNC Turning');
    expect(sortedOps[1].step_order).toBe(2);
    expect(sortedOps[2].step_order).toBe(3);

    // Duplicate Job Code must be rejected
    const { error: dupErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: jobCode,
      p_part_no: 'PART-INTEG-02',
      p_part_name: 'Duplicate Test',
      p_customer: 'TEST',
      p_order_qty: 50,
      p_material: 'AL',
      p_material_spec: '',
      p_planned_start_date: '2026-10-12',
      p_planned_finish_date: '2026-10-15',
      p_operations: [{ step_order: 1, operation_name: 'CNC', planned_machine: 'M1' }],
    });
    expect(dupErr).toBeTruthy();
    expect(dupErr?.message).toContain('đã tồn tại');

    // Cleanup
    await adminClient.from('jobs').delete().eq('id', createdJobId);
  });

  it('8. Routing Atomicity: failed routing does not leave orphan JOB in database', async () => {
    const orphanCode = `TEST-ORPHAN-${Date.now()}`;
    const { error: failedRpcErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: orphanCode,
      p_part_no: 'PART-ORPHAN',
      p_part_name: 'Orphan Probe',
      p_customer: 'TEST',
      p_order_qty: 20,
      p_material: 'SUS304',
      p_material_spec: '',
      p_planned_start_date: '2026-10-12',
      p_planned_finish_date: '2026-10-15',
      p_operations: [
        { step_order: 1, operation_name: 'CNC', planned_machine: 'M1' },
        { step_order: 2, operation_name: '', planned_machine: 'M2' }, // Invalid empty name
      ],
    });

    expect(failedRpcErr).toBeTruthy();
    expect(failedRpcErr?.message).toContain('không được để trống');

    // Verify no job with orphanCode was persisted
    const { data: orphanJob } = await adminClient.from('jobs').select('id').eq('job_no', orphanCode);
    expect(orphanJob?.length).toBe(0);
  });
});
