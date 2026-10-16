const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env
const envPath = path.resolve(__dirname, '../.env');
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

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error('Missing Supabase configuration in .env');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLiveVerification() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — FIX JOB DELETE LOCK CONDITION (R1) LIVE VERIFICATION');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName, detail) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ PASS [Check ${total}]: ${testName}`);
    } else {
      console.error(`  ❌ FAIL [Check ${total}]: ${testName}${detail ? ` - ${detail}` : ''}`);
      process.exitCode = 1;
    }
  }

  const runId = 'r1_' + Date.now().toString(36);
  const usersToCleanup = [];
  const jobsToCleanup = [];

  let testAdmin = null;
  let testPlanningOwner = null;
  let testPlanningLeader = null;
  let testPlanningOther = null;
  let testPeMfg = null;
  let testQa = null;

  let adminAuth = null;
  let planningOwnerAuth = null;
  let planningLeaderAuth = null;
  let planningOtherAuth = null;
  let peMfgAuth = null;
  let qaAuth = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Provision Isolated Test Users
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Provisioning Isolated Test Users ---');

    async function createTestUser(role, isLeader, fullName) {
      const phone = `+8498${crypto.randomInt(10000000, 99999999)}`;
      const email = `${role.toLowerCase().replace(/[^a-z]/g, '')}_${runId}_${crypto.randomInt(100, 999)}@sampletracking.local`;
      const password = `TestPass_${crypto.randomBytes(6).toString('hex')}!Aa1`;

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        phone,
        password,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { role, full_name: fullName, is_department_leader: isLeader },
      });
      if (error) throw new Error(`Failed to create user ${fullName}: ${error.message}`);

      usersToCleanup.push(data.user.id);

      await adminClient.from('profiles').upsert({
        id: data.user.id,
        phone,
        role,
        full_name: fullName,
        department: role,
        is_department_leader: isLeader,
        is_active: true,
        must_change_password: false,
      });

      const client = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
      if (loginErr) throw new Error(`Login failed for ${fullName}: ${loginErr.message}`);

      return { user: data.user, client };
    }

    testAdmin = await createTestUser('Admin', false, 'R1 Test Admin');
    adminAuth = testAdmin.client;

    testPlanningOwner = await createTestUser('Planning', false, 'R1 Planning Owner');
    planningOwnerAuth = testPlanningOwner.client;

    testPlanningLeader = await createTestUser('Planning', true, 'R1 Planning Leader');
    planningLeaderAuth = testPlanningLeader.client;

    testPlanningOther = await createTestUser('Planning', false, 'R1 Planning Non-Owner');
    planningOtherAuth = testPlanningOther.client;

    testPeMfg = await createTestUser('PE-MFG', false, 'R1 PE Operator');
    peMfgAuth = testPeMfg.client;

    testQa = await createTestUser('QA', false, 'R1 QA Inspector');
    qaAuth = testQa.client;

    console.log('  Provisioned 6 test users successfully.\n');

    // Helper: Create a Job
    async function createJob(client, jobNo, partNo, createdBy) {
      const { data: job, error: jobErr } = await adminClient
        .from('jobs')
        .insert({
          job_no: jobNo,
          part_no: partNo,
          part_name: 'Test R1 Part',
          customer: 'TEST-CUST',
          order_qty: 100,
          material: 'AL6061',
          planned_start_date: '2026-10-14',
          planned_finish_date: '2026-10-20',
          status: 'ACTIVE',
          created_by: createdBy,
        })
        .select()
        .single();
      if (jobErr) throw new Error(`Failed to create job ${jobNo}: ${jobErr.message}`);
      jobsToCleanup.push(job.id);

      if (createdBy) {
        await adminClient.from('jobs').update({ created_by: createdBy }).eq('id', job.id);
      }

      // Create 2 operations
      const { data: ops, error: opsErr } = await adminClient
        .from('job_operations')
        .insert([
          { job_id: job.id, step_order: 10, operation_name: 'CNC Milling', status: 'NOT_STARTED' },
          { job_id: job.id, step_order: 20, operation_name: 'Deburring', status: 'NOT_STARTED' },
        ])
        .select();
      if (opsErr) throw new Error(`Failed to create operations for ${jobNo}: ${opsErr.message}`);

      return { job, ops };
    }

    // ------------------------------------------------------------------------
    // Scenario 1: Anonymous / Unauthenticated Delete
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 1: Anonymous / Unauthenticated Delete ---');
    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: s1Err } = await anonClient.rpc('admin_delete_job', {
      p_job_id: '00000000-0000-0000-0000-000000000000',
      p_confirm_ticket: 'TEST',
      p_reason: 'Testing anon rejection',
    });
    assert(
      s1Err && (s1Err.message.includes('Chưa đăng nhập') || s1Err.message.includes('permission denied')),
      'Anonymous call rejected by auth/role guard',
      s1Err?.message
    );

    // ------------------------------------------------------------------------
    // Scenario 2: PE-MFG User Cannot Delete JOB
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 2: PE-MFG User Cannot Delete JOB ---');
    const { job: job2 } = await createJob(adminClient, `R1-JOB-02-${runId}`, 'PART-02', testPlanningOwner.user.id);
    const { error: s2Err } = await peMfgAuth.rpc('admin_delete_job', {
      p_job_id: job2.id,
      p_confirm_ticket: job2.job_no,
      p_reason: 'PE attempting deletion',
    });
    assert(s2Err && s2Err.message.includes('Quyền hạn bị từ chối'), 'PE-MFG cannot delete job', s2Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 3: QA User Cannot Delete JOB
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 3: QA User Cannot Delete JOB ---');
    const { error: s3Err } = await qaAuth.rpc('admin_delete_job', {
      p_job_id: job2.id,
      p_confirm_ticket: job2.job_no,
      p_reason: 'QA attempting deletion',
    });
    assert(s3Err && s3Err.message.includes('Quyền hạn bị từ chối'), 'QA cannot delete job', s3Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 4: Planning Non-Owner Non-Leader Cannot Delete Other Person's JOB
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 4: Planning Non-Owner Non-Leader Cannot Delete ---');
    const { data: s4Data, error: s4Err } = await planningOtherAuth.rpc('admin_delete_job', {
      p_job_id: job2.id,
      p_confirm_ticket: job2.job_no,
      p_reason: 'Non-owner attempting deletion',
    });
    if (s4Err) {
      console.log('  Scenario 4 caught error:', s4Err.message);
    } else {
      console.log('  Scenario 4 unexpectedly succeeded with data:', s4Data);
    }
    assert(s4Err && s4Err.message.includes('Quyền hạn bị từ chối'), 'Planning non-owner non-leader cannot delete other\'s job', s4Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 5: Planning Owner (created_by) CAN Delete JOB
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 5: Planning Owner (created_by) Deletes Own JOB ---');
    const { job: job5 } = await createJob(adminClient, `R1-JOB-05-${runId}`, 'PART-05', testPlanningOwner.user.id);
    const { data: s5Data, error: s5Err } = await planningOwnerAuth.rpc('admin_delete_job', {
      p_job_id: job5.id,
      p_confirm_ticket: job5.job_no,
      p_reason: 'Planning owner deleting own job',
    });
    assert(!s5Err && s5Data?.success === true, 'Planning owner successfully deleted own job', s5Err?.message);

    // Verify row is gone from jobs
    const { data: chkJob5 } = await adminClient.from('jobs').select('id').eq('id', job5.id).maybeSingle();
    assert(!chkJob5, 'Job row is removed from public.jobs');

    // ------------------------------------------------------------------------
    // Scenario 6: Planning Leader CAN Delete JOB Created by Another User
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 6: Planning Leader Deletes Another User\'s JOB ---');
    const { job: job6 } = await createJob(adminClient, `R1-JOB-06-${runId}`, 'PART-06', testPlanningOther.user.id);
    const { data: s6Data, error: s6Err } = await planningLeaderAuth.rpc('admin_delete_job', {
      p_job_id: job6.id,
      p_confirm_ticket: job6.job_no,
      p_reason: 'Planning leader deleting subordinate job',
    });
    assert(!s6Err && s6Data?.success === true, 'Planning leader successfully deleted job created by other user', s6Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 7: Admin CAN Delete Active JOB
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 7: Admin Deletes Active JOB ---');
    const { job: job7 } = await createJob(adminClient, `R1-JOB-07-${runId}`, 'PART-07', testPlanningOwner.user.id);
    const { data: s7Data, error: s7Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job7.id,
      p_confirm_ticket: job7.job_no,
      p_reason: 'Admin cleanup test',
    });
    assert(!s7Err && s7Data?.success === true, 'Admin successfully deleted active job', s7Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 8: Wrong Ticket Confirmation String -> Rejection
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 8: Wrong Ticket Confirmation String ---');
    const { job: job8 } = await createJob(adminClient, `R1-JOB-08-${runId}`, 'PART-08', testPlanningOwner.user.id);
    const { error: s8Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job8.id,
      p_confirm_ticket: 'WRONG-TICKET-STRING',
      p_reason: 'Test wrong ticket',
    });
    assert(s8Err && s8Err.message.includes('Mã JOB Ticket xác nhận không chính xác'), 'Wrong ticket confirmation rejected', s8Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 9: Reason Too Short (< 3 characters) -> Rejection
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 9: Reason Too Short (< 3 chars) ---');
    const { error: s9Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job8.id,
      p_confirm_ticket: job8.job_no,
      p_reason: 'no',
    });
    assert(s9Err && s9Err.message.includes('tối thiểu 3 ký tự'), 'Short reason rejected (< 3 chars)', s9Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 10: Non-existent JOB ID -> Rejection
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 10: Non-existent JOB ID ---');
    const dummyId = crypto.randomUUID();
    const { error: s10Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: dummyId,
      p_confirm_ticket: 'NONEXISTENT',
      p_reason: 'Valid reason here',
    });
    assert(s10Err && s10Err.message.includes('Không tìm thấy Lệnh sản xuất'), 'Non-existent job rejected', s10Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 11 (CORE R1): Active JOB with PE-MFG Production Runs (OK/NG/KIV) CAN BE DELETED
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 11: Active JOB with PE-MFG Production Runs + NG Details CAN BE DELETED ---');
    const { job: job11, ops: ops11 } = await createJob(adminClient, `R1-JOB-11-${runId}`, 'PART-11', testPlanningOwner.user.id);

    // Add production run with OK=10, NG=2, KIV=1
    const { data: run11, error: run11Err } = await adminClient
      .from('production_runs')
      .insert({
        operation_id: ops11[0].id,
        machine_id: 'MC-CNC-01',
        production_date: '2026-10-14',
        start_time: '2026-10-14T08:00:00Z',
        end_time: '2026-10-14T08:45:00Z',
        cycle_time_seconds: 45,
        ok_qty: 10,
        ng_qty: 2,
        kiv_qty: 1,
        operator_name: 'Test PE Operator',
      })
      .select()
      .single();
    if (run11Err) throw new Error(`Failed to insert production run: ${run11Err.message}`);

    // Add NG detail
    const { error: ng11Err } = await adminClient
      .from('ng_details')
      .insert({
        production_run_id: run11.id,
        defect_code: 'DF-01',
        defect_name: 'Trầy xước bề mặt',
        ng_qty: 2,
      });
    if (ng11Err) throw new Error(`Failed to insert NG detail: ${ng11Err.message}`);

    // Call admin_delete_job
    const { data: s11Data, error: s11Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job11.id,
      p_confirm_ticket: job11.job_no,
      p_reason: 'R1 Verification: Delete job with manufacturing data before any closed op',
    });
    assert(!s11Err && s11Data?.success === true, 'R1: Successfully deleted job with PE-MFG runs and NG details', s11Err?.message);

    // Verify dependent data is cleaned up
    const { data: chkRun11 } = await adminClient.from('production_runs').select('id').eq('id', run11.id).maybeSingle();
    assert(!chkRun11, 'Production run cascaded and removed');

    // ------------------------------------------------------------------------
    // Scenario 12 (CORE R1): Active JOB with QA Check Records CAN BE DELETED
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 12: Active JOB with QA Checks CAN BE DELETED ---');
    const { job: job12, ops: ops12 } = await createJob(adminClient, `R1-JOB-12-${runId}`, 'PART-12', testPlanningOwner.user.id);

    // Add QA check
    const { data: qa12, error: qa12Err } = await adminClient
      .from('qa_checks')
      .insert({
        operation_id: ops12[0].id,
        inspection_time: new Date().toISOString(),
        inspector_name: 'Test QA Inspector',
        sample_size: 5,
        ok_qty: 5,
        ng_qty: 0,
        result: 'OK',
      })
      .select()
      .single();
    if (qa12Err) throw new Error(`Failed to insert QA check: ${qa12Err.message}`);

    // Call admin_delete_job
    const { data: s12Data, error: s12Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job12.id,
      p_confirm_ticket: job12.job_no,
      p_reason: 'R1 Verification: Delete job with QA check records before any closed op',
    });
    assert(!s12Err && s12Data?.success === true, 'R1: Successfully deleted job with QA checks (immutability bypass works)', s12Err?.message);

    const { data: chkQa12 } = await adminClient.from('qa_checks').select('id').eq('id', qa12.id).maybeSingle();
    assert(!chkQa12, 'QA check record cascaded and removed');

    // ------------------------------------------------------------------------
    // Scenario 13 (CORE R1): Active JOB with Attachments CAN BE DELETED & Returns Paths
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 13: Active JOB with Attachments CAN BE DELETED ---');
    const { job: job13 } = await createJob(adminClient, `R1-JOB-13-${runId}`, 'PART-13', testPlanningOwner.user.id);

    const dummyStoragePath = `${job13.id}/DRAWING/spec.pdf`;
    const { error: att13Err } = await adminAuth
      .from('attachments')
      .insert({
        job_id: job13.id,
        file_name: 'spec.pdf',
        file_path: dummyStoragePath,
        file_type: 'DRAWING',
        mime_type: 'application/pdf',
        file_size: 1024,
        content_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        owning_department: 'Planning',
        upload_status: 'READY',
      });
    if (att13Err) throw new Error(`Failed to insert attachment: ${att13Err.message}`);

    const { data: s13Data, error: s13Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job13.id,
      p_confirm_ticket: job13.job_no,
      p_reason: 'R1 Verification: Delete job with attachments',
    });
    assert(!s13Err && s13Data?.success === true, 'R1: Successfully deleted job with attachments', s13Err?.message);
    assert(Array.isArray(s13Data?.deleted_attachments) && s13Data.deleted_attachments.includes(dummyStoragePath),
      'Returns deleted attachment storage paths for storage cleanup');

    // ------------------------------------------------------------------------
    // Scenario 14 (CORE R1 LOCK): JOB with at least one CLOSED operation CANNOT BE DELETED
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 14: JOB with CLOSED operation CANNOT BE DELETED ---');
    const { job: job14, ops: ops14 } = await createJob(adminClient, `R1-JOB-14-${runId}`, 'PART-14', testPlanningOwner.user.id);

    // Mark op1 as CLOSED via valid state transition (NOT_STARTED -> IN_PROGRESS -> CLOSED)
    const { error: opProgErr } = await adminClient
      .from('job_operations')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', ops14[0].id);
    if (opProgErr) throw new Error(`Failed to set op IN_PROGRESS: ${opProgErr.message}`);

    const { error: opCloseErr } = await adminClient
      .from('job_operations')
      .update({
        status: 'CLOSED',
        closed_at: new Date().toISOString(),
      })
      .eq('id', ops14[0].id);
    if (opCloseErr) throw new Error(`Failed to set op CLOSED: ${opCloseErr.message}`);

    const { error: s14Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job14.id,
      p_confirm_ticket: job14.job_no,
      p_reason: 'Attempting to delete locked job with closed op',
    });
    assert(s14Err && s14Err.message.includes('Đã có ít nhất một công đoạn được Chốt (CLOSED)'),
      'R1 Lock: Rejects deletion of job when operation is CLOSED', s14Err?.message);

    // ------------------------------------------------------------------------
    // Scenario 15 (CORE R1 LOCK): JOB with status 'CLOSE' CANNOT BE DELETED
    // ------------------------------------------------------------------------
    console.log('--- Test Scenario 15: Closed JOB (status = CLOSE) CANNOT BE DELETED ---');
    const { job: job15 } = await createJob(adminClient, `R1-JOB-15-${runId}`, 'PART-15', testPlanningOwner.user.id);
    await adminClient
      .from('jobs')
      .update({ status: 'CLOSE', closed_at: new Date().toISOString() })
      .eq('id', job15.id);

    const { error: s15Err } = await adminAuth.rpc('admin_delete_job', {
      p_job_id: job15.id,
      p_confirm_ticket: job15.job_no,
      p_reason: 'Attempting to delete closed job',
    });
    assert(s15Err && s15Err.message.includes('Không thể xóa Lệnh sản xuất đã đóng hoặc lưu trữ'),
      'R1 Lock: Rejects deletion of closed job (status CLOSE)', s15Err?.message);

    // ------------------------------------------------------------------------
    // Verify Audit Logs
    // ------------------------------------------------------------------------
    console.log('\n--- Verifying Audit Logs ---');
    const { data: auditLogs, error: auditErr } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('action', 'DELETE_JOB')
      .order('created_at', { ascending: false })
      .limit(5);

    assert(!auditErr && auditLogs && auditLogs.length > 0, 'Audit logs recorded for DELETE_JOB action');
    if (auditLogs && auditLogs[0]) {
      const latest = auditLogs[0];
      assert(latest.new_values && latest.new_values.cascade_stats, 'Audit log contains cascade stats breakdown');
    }

  } finally {
    // ------------------------------------------------------------------------
    // Cleanup Isolated Test Data
    // ------------------------------------------------------------------------
    console.log('\n--- Cleaning Up Isolated Test Data ---');
    for (const jobId of jobsToCleanup) {
      try {
        await adminClient.from('attachments').delete().eq('job_id', jobId);
        await adminClient.from('job_operations').delete().eq('job_id', jobId);
        await adminClient.from('jobs').delete().eq('id', jobId);
      } catch (e) {
        // Ignore cleanup error
      }
    }

    for (const uid of usersToCleanup) {
      try {
        await adminClient.from('profiles').delete().eq('id', uid);
        await adminClient.auth.admin.deleteUser(uid);
      } catch (e) {
        // Ignore cleanup error
      }
    }
    console.log('  Cleaned up isolated test jobs and users.\n');
  }

  console.log('================================================================================');
  console.log(`   FINAL RESULT: ${passed} / ${total} CHECKS PASSED`);
  console.log('================================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runLiveVerification().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
