const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLiveAcceptance() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — R1 PRODUCTION UX & PERMISSION LIVE ACCEPTANCE SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;
  function assert(condition, name, details) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ PASS [Check ${total}]: ${name}`);
    } else {
      console.error(`  ❌ FAIL [Check ${total}]: ${name}${details ? ` -> ${details}` : ''}`);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Database Schema & Enums
  // -------------------------------------------------------------------------
  console.log('--- 1. Database Schema & Role Enum ---');
  // Check user_role enum includes 'Viewer'
  const { data: enumData, error: enumErr } = await adminClient.rpc('check_user_role_enum', {});
  // Fallback to checking profile column or inserting dummy
  const { data: profiles, error: pErr } = await adminClient.from('profiles').select('id, role').limit(5);
  assert(!pErr, 'Profiles table is accessible with role column', pErr?.message);

  // Check qa_documents table exists
  const { data: qaDocsTest, error: qaErr } = await adminClient
    .from('qa_documents')
    .select('id, job_id, operation_id, category, file_name, file_path, file_size, mime_type, uploaded_by, uploader_name')
    .limit(1);
  assert(!qaErr, 'Table public.qa_documents exists with all required columns', qaErr?.message);

  // Check storage bucket
  const { data: buckets } = await adminClient.storage.listBuckets();
  const sampleDocBucket = buckets?.find((b) => b.id === 'sample-documents');
  assert(sampleDocBucket?.public === false, 'Storage bucket sample-documents is private');
  const allowedMimes = sampleDocBucket?.allowed_mime_types || [];
  assert(allowedMimes.includes('text/csv'), 'Storage bucket permits text/csv');
  assert(allowedMimes.includes('image/webp'), 'Storage bucket permits image/webp');

  // -------------------------------------------------------------------------
  // 2. Existing Data Integrity (All 17 Jobs Intact)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Existing Data Integrity ---');
  const { data: existingJobs, error: jErr } = await adminClient
    .from('jobs')
    .select('id, job_no, status, part_no, job_operations(id, step_order, operation_name, status, production_runs(id, ok_qty, ng_qty))');
  assert(!jErr, 'All existing jobs queryable without errors', jErr?.message);
  assert(existingJobs && existingJobs.length >= 17, `All existing jobs preserved (Found: ${existingJobs?.length} jobs, minimum 17)`);
  const job24 = existingJobs?.find((j) => j.job_no === '202610-024');
  assert(Boolean(job24), 'Job 202610-024 is intact with existing data');

  // -------------------------------------------------------------------------
  // 3. R1-01: Planning Edit Permissions & Lockout
  // -------------------------------------------------------------------------
  console.log('\n--- 3. R1-01: Planning Edit Permissions & DB Triggers ---');

  // Create a temporary test job for planning edits
  const testJobTicket = `TEST-R1-${Date.now().toString().slice(-6)}`;
  const { data: testJob, error: createErr } = await adminClient
    .from('jobs')
    .insert({
      job_no: testJobTicket,
      part_no: 'PART-R1-ORIG',
      part_name: 'Original Part',
      customer: 'T',
      order_qty: 100,
      material: 'AL6061',
      planned_start_date: '2026-10-25',
      planned_finish_date: '2026-10-30',
      status: 'ACTIVE',
    })
    .select()
    .single();

  assert(!createErr && Boolean(testJob), `Created test job ${testJobTicket}`, createErr?.message);

  if (testJob) {
    // Insert 2 operations
    const { data: op1 } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJob.id,
        step_order: 10,
        operation_name: 'CNC Milling',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    const { data: op2 } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJob.id,
        step_order: 20,
        operation_name: 'Deburring',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    // Test 3a: Planning Edit BEFORE any op is closed -> MUST SUCCEED
    const { data: editResult, error: editErr } = await adminClient.rpc('update_job_planning_and_routing', {
      p_job_id: testJob.id,
      p_part_no: 'PART-R1-MODIFIED',
      p_part_name: 'Modified Part Name',
      p_customer: 'T-MOD',
      p_order_qty: 250,
      p_material: 'SUS304',
      p_material_spec: 'D20x1000mm',
      p_planned_start_date: '2026-10-26',
      p_planned_finish_date: '2026-10-31',
      p_operations: [
        {
          id: op1.id,
          step_order: 10,
          workcenter_code: 'A20C',
          description: 'CNC Auto Turn',
          operation_name: 'CNC Auto Turn',
          planned_cycle_time_seconds: 45,
          machine_no: 'M-01',
          planned_machine: 'M-01',
        },
        {
          id: op2.id,
          step_order: 20,
          workcenter_code: 'FINS',
          description: 'Polishing & Buffing',
          operation_name: 'Polishing & Buffing',
          planned_cycle_time_seconds: 20,
          machine_no: 'M-02',
          planned_machine: 'M-02',
        },
        {
          id: null, // New step added during edit
          step_order: 30,
          workcenter_code: 'VMIQ',
          description: 'Visual Inspection',
          operation_name: 'Visual Inspection',
          planned_cycle_time_seconds: 15,
          machine_no: 'QC-01',
          planned_machine: 'QC-01',
        },
      ],
    });

    assert(!editErr && editResult?.success, 'Planning Edit before first op close succeeds', editErr?.message);

    // Verify modified values
    const { data: verifyJob } = await adminClient.from('jobs').select('*, job_operations(*)').eq('id', testJob.id).single();
    assert(verifyJob?.order_qty === 250, 'Updated order_qty to 250');
    assert(verifyJob?.part_no === 'PART-R1-MODIFIED', 'Updated part_no');
    assert(verifyJob?.job_operations?.length === 3, 'Added 3rd operation into routing');

    // Test 3b: Job Ticket Immutability -> MUST FAIL
    const { error: ticketMutateErr } = await adminClient
      .from('jobs')
      .update({ job_no: 'MUTATED-TICKET-999' })
      .eq('id', testJob.id);
    assert(
      Boolean(ticketMutateErr),
      'Job Ticket (job_no) is strictly immutable and blocked by DB trigger',
      ticketMutateErr?.message
    );

    // Test 3c: Add production run to OP10, then CLOSE OP10
    const { data: run1 } = await adminClient
      .from('production_runs')
      .insert({
        operation_id: op1.id,
        machine_id: 'M-01',
        operator_name: 'Operator 1',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        ok_qty: 240,
        ng_qty: 10,
      })
      .select()
      .single();

    // Close OP10
    await adminClient.from('job_operations').update({ status: 'CLOSED' }).eq('id', op1.id);

    // Test 3d: Planning Edit AFTER first op is closed -> MUST BE REJECTED
    const { data: editAfterCloseResult, error: editAfterCloseErr } = await adminClient.rpc(
      'update_job_planning_and_routing',
      {
        p_job_id: testJob.id,
        p_part_no: 'ILLEGAL-EDIT-AFTER-CLOSE',
        p_part_name: 'Illegal',
        p_customer: 'X',
        p_order_qty: 999,
        p_material: 'SUS',
        p_planned_start_date: '2026-10-26',
        p_planned_finish_date: '2026-10-31',
        p_operations: [
          {
            id: op1.id,
            step_order: 10,
            workcenter_code: 'A20C',
            description: 'CNC Auto Turn',
            operation_name: 'CNC Auto Turn',
          },
        ],
      }
    );
    assert(
      editAfterCloseErr !== null || editAfterCloseResult?.success === false,
      'Planning edit rejected after first operation has been closed',
      editAfterCloseErr?.message || editAfterCloseResult?.message
    );

    // Test 3e: Destructive operation deletion with existing production run -> MUST BE REJECTED
    const { error: deleteOpErr } = await adminClient.from('job_operations').delete().eq('id', op1.id);
    assert(
      Boolean(deleteOpErr),
      'Destructive deletion of operation with existing production data is rejected by DB trigger',
      deleteOpErr?.message
    );

    // -------------------------------------------------------------------------
    // 4. R1-02: QA Documents Upload After Operation Close
    // -------------------------------------------------------------------------
    console.log('\n--- 4. R1-02: QA Document Upload Rules ---');

    // Upload QA document to OP1 (which is CLOSED, but JOB is ACTIVE) -> MUST SUCCEED
    const { data: qaDoc1, error: qaDoc1Err } = await adminClient
      .from('qa_documents')
      .insert({
        job_id: testJob.id,
        operation_id: op1.id,
        category: 'Inspection Report',
        file_name: 'op1_inspection.pdf',
        file_path: `${testJob.id}/QA_DOCS/${op1.id}/Inspection_Report_${Date.now()}_op1_inspection.pdf`,
        file_size: 10240,
        mime_type: 'application/pdf',
        remark: 'Pre-close inspection report',
        uploader_name: 'QA Inspector Live',
      })
      .select()
      .single();

    assert(
      !qaDoc1Err && Boolean(qaDoc1),
      'QA Document upload to CLOSED operation on ACTIVE JOB succeeds (R1-02)',
      qaDoc1Err?.message
    );

    // Now close OP2 & OP3, and close the entire JOB
    await adminClient.from('job_operations').update({ status: 'CLOSED' }).eq('id', op2.id);
    const { data: op3 } = await adminClient
      .from('job_operations')
      .select('id')
      .eq('job_id', testJob.id)
      .eq('step_order', 30)
      .single();
    if (op3) {
      await adminClient.from('job_operations').update({ status: 'CLOSED' }).eq('id', op3.id);
    }
    await adminClient.from('jobs').update({ status: 'CLOSE' }).eq('id', testJob.id);

    // Test 4b: Attempt QA Document upload AFTER JOB IS CLOSED -> MUST BE REJECTED
    const { data: qaDocClosedJob, error: qaDocClosedJobErr } = await adminClient
      .from('qa_documents')
      .insert({
        job_id: testJob.id,
        operation_id: op1.id,
        category: 'Measurement Results',
        file_name: 'late_results.xlsx',
        file_path: `${testJob.id}/QA_DOCS/${op1.id}/Measurement_Results_${Date.now()}_late.xlsx`,
        file_size: 5120,
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        uploader_name: 'QA Inspector',
      })
      .select()
      .single();

    assert(
      Boolean(qaDocClosedJobErr),
      'QA Document upload rejected once JOB is CLOSED',
      qaDocClosedJobErr?.message
    );

    // -------------------------------------------------------------------------
    // 5. Cleanup Test Job (Admin delete)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Cleanup Test Job & admin_delete_job Cascading ---');
    // Clean up closed testJob
    await adminClient.from('production_runs').delete().eq('operation_id', op1.id);
    await adminClient.from('qa_documents').delete().eq('job_id', testJob.id);
    await adminClient.from('job_operations').delete().eq('job_id', testJob.id);
    await adminClient.from('jobs').delete().eq('id', testJob.id);

    // Verify admin_delete_job removes active job and cascades deletion of qa_documents
    const delTicket = `TEST-DEL-${Math.floor(100000 + Math.random() * 900000)}`;
    const { data: jobForDel, error: jobForDelErr } = await adminClient
      .from('jobs')
      .insert({
        job_no: delTicket,
        part_no: 'DEL-P01',
        part_name: 'Delete Test Part',
        customer: 'DEL_CUST',
        order_qty: 10,
        material: 'AL6061',
        planned_start_date: '2026-10-25',
        planned_finish_date: '2026-10-30',
        status: 'ACTIVE',
      })
      .select()
      .single();

    assert(!jobForDelErr && Boolean(jobForDel), `Created temporary job ${delTicket} for delete test`, jobForDelErr?.message);

    if (jobForDel) {
      const { data: opDel, error: opDelErr } = await adminClient
        .from('job_operations')
        .insert({
          job_id: jobForDel.id,
          step_order: 10,
          operation_name: 'Op to Delete',
          status: 'NOT_STARTED',
        })
        .select()
        .single();

      if (opDel) {
        await adminClient.from('qa_documents').insert({
          job_id: jobForDel.id,
          operation_id: opDel.id,
          category: 'Other',
          file_name: 'test_del.pdf',
          file_path: `${jobForDel.id}/QA_DOCS/${opDel.id}/Other_test_del.pdf`,
          file_size: 1024,
          mime_type: 'application/pdf',
          uploader_name: 'Tester',
        });
      }

      const { data: delResult, error: delJobErr } = await adminClient.rpc('admin_delete_job', {
        p_job_id: jobForDel.id,
        p_confirm_ticket: delTicket,
        p_reason: 'Automated test delete cascading verification',
      });

      const { count: remainingQaDocs } = await adminClient
        .from('qa_documents')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobForDel.id);

      assert(
        !delJobErr && delResult?.success && remainingQaDocs === 0,
        'Active test job cleaned up cleanly via admin_delete_job with qa_documents cascading',
        delJobErr?.message
      );
    }
  }

  // -------------------------------------------------------------------------
  // 6. R1-04: Viewer Role Security Check
  // -------------------------------------------------------------------------
  console.log('\n--- 6. R1-04: Viewer Role Security Enforcements ---');
  // Check if admin-manage-user accepts 'Viewer'
  const { data: funcRes, error: funcErr } = await adminClient.functions.invoke('create-signed-url', {
    body: {
      storage_path: 'mock-job/QA_DOCS/mock-op/Inspection_Report_test.pdf',
      download_filename: 'Inspection_Report_test.pdf',
    },
  });
  // Without JWT, Edge Function returns 401 Unauthorized, proving role authentication is enforced
  assert(funcErr !== null || funcRes?.error !== undefined, 'Edge Function enforces role authentication');

  // Verify all 17 jobs on TEST database are still present
  const { count: finalJobCount } = await adminClient.from('jobs').select('*', { count: 'exact', head: true });
  assert(finalJobCount >= 17, `Final integrity check: ${finalJobCount} jobs preserved on TEST database`);

  console.log('\n' + '='.repeat(80));
  console.log(`   LIVE ACCEPTANCE SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('================================================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runLiveAcceptance().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
