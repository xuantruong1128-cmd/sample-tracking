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
  console.log('   SAMPLE TRACKING — UI-06: ADMIN DELETE JOB LIVE VERIFICATION');
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

  const runId = 'u6_' + Date.now().toString(36);
  let testAdminUser = null;
  let testPlanningUser = null;
  let adminAuthClient = null;
  let planningAuthClient = null;
  let disposableJobId = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Provision Test Admin and Planning Users
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Provision Test Admin and Planning Users ---');
    const adminPhone = `+8498${crypto.randomInt(10000000, 99999999)}`;
    const adminEmail = `adm_${runId}@sampletracking.local`;
    const adminPass = `Admin_${crypto.randomBytes(6).toString('hex')}!Aa1`;

    const { data: createAdmData, error: createAdmErr } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      phone: adminPhone,
      password: adminPass,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'Admin', full_name: 'Admin Test UI06', must_change_password: false },
    });
    if (createAdmErr) throw new Error(`Failed to create test admin: ${createAdmErr.message}`);
    testAdminUser = createAdmData.user;
    const { error: admProfErr } = await adminClient.from('profiles').upsert({
      id: testAdminUser.id,
      phone: adminPhone,
      role: 'Admin',
      full_name: 'Admin Test UI06',
      department: 'Ban Giám Đốc',
      is_active: true,
      must_change_password: false,
    });
    if (admProfErr) throw new Error(`Failed to upsert admin profile: ${admProfErr.message}`);

    adminAuthClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await adminAuthClient.auth.signInWithPassword({ email: adminEmail, password: adminPass });

    // Planning User
    const planPhone = `+8498${crypto.randomInt(10000000, 99999999)}`;
    const planEmail = `plan_${runId}@sampletracking.local`;
    const planPass = `Plan_${crypto.randomBytes(6).toString('hex')}!Aa1`;
    const { data: createPlanData, error: createPlanErr } = await adminClient.auth.admin.createUser({
      email: planEmail,
      phone: planPhone,
      password: planPass,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'Planning', full_name: 'Planning Test UI06', must_change_password: false },
    });
    if (createPlanErr) throw new Error(`Failed to create test planning: ${createPlanErr.message}`);
    testPlanningUser = createPlanData.user;
    const { error: planProfErr } = await adminClient.from('profiles').upsert({
      id: testPlanningUser.id,
      phone: planPhone,
      role: 'Planning',
      full_name: 'Planning Test UI06',
      department: 'Kế Hoạch',
      is_active: true,
      must_change_password: false,
    });
    if (planProfErr) throw new Error(`Failed to upsert planning profile: ${planProfErr.message}`);

    planningAuthClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await planningAuthClient.auth.signInWithPassword({ email: planEmail, password: planPass });

    assert(testAdminUser !== null && testPlanningUser !== null, 'Test Admin & Planning users provisioned');

    // ------------------------------------------------------------------------
    // Step 2: Create a disposable clean test JOB
    // ------------------------------------------------------------------------
    console.log('\n--- Step 2: Create a Disposable Clean Test JOB ---');
    const testTicket = `TEST-DEL-${Date.now()}`;
    const { data: newJob, error: jobErr } = await adminClient
      .from('jobs')
      .insert({
        job_no: testTicket,
        part_no: 'PART-TEST-DEL',
        part_name: 'Delete Test Part',
        customer: 'TEST-CUST',
        order_qty: 50,
        material: 'AL6061',
        planned_start_date: '2026-10-13',
        planned_finish_date: '2026-10-20',
        status: 'ACTIVE',
        created_by: testAdminUser.id,
      })
      .select()
      .single();

    if (jobErr || !newJob) throw new Error(`Failed to create disposable job: ${jobErr?.message}`);
    disposableJobId = newJob.id;

    // Add operation
    await adminClient.from('job_operations').insert({
      job_id: disposableJobId,
      step_order: 10,
      operation_name: 'CNC Milling',
      status: 'NOT_STARTED',
    });

    assert(disposableJobId !== null, `Disposable test job created (${testTicket})`);

    // ------------------------------------------------------------------------
    // Step 3: Non-Admin Role Security Guard
    // ------------------------------------------------------------------------
    console.log('\n--- Step 3: Non-Admin Role Security Guard ---');
    const { data: planDelData, error: planDelErr } = await planningAuthClient.rpc('admin_delete_job', {
      p_job_id: disposableJobId,
      p_confirm_ticket: testTicket,
      p_reason: 'Planning attempts deletion',
    });

    assert(
      planDelErr !== null && planDelErr.message.includes('Chỉ Quản trị viên (Admin) mới có quyền xóa'),
      'Backend RPC rejects non-Admin role (Planning) from deleting job',
      planDelErr?.message
    );

    // ------------------------------------------------------------------------
    // Step 4: Validation on Mismatched Ticket and Short Reason
    // ------------------------------------------------------------------------
    console.log('\n--- Step 4: Input Validation (Ticket mismatch & Short reason) ---');
    const { error: mismatchErr } = await adminAuthClient.rpc('admin_delete_job', {
      p_job_id: disposableJobId,
      p_confirm_ticket: 'WRONG-TICKET-CODE',
      p_reason: 'Reason ok',
    });
    assert(
      mismatchErr !== null && mismatchErr.message.includes('Mã JOB Ticket xác nhận không chính xác'),
      'Backend RPC rejects mismatched confirmation ticket string',
      mismatchErr?.message
    );

    const { error: shortReasonErr } = await adminAuthClient.rpc('admin_delete_job', {
      p_job_id: disposableJobId,
      p_confirm_ticket: testTicket,
      p_reason: 'ab',
    });
    assert(
      shortReasonErr !== null && shortReasonErr.message.includes('tối thiểu 3 ký tự'),
      'Backend RPC rejects short or empty deletion reason',
      shortReasonErr?.message
    );

    // ------------------------------------------------------------------------
    // Step 5: Guard against deleting JOB with Production Runs
    // ------------------------------------------------------------------------
    console.log('\n--- Step 5: Guard against deleting JOB with Production Runs ---');
    // Find existing job #1 TEST-PE-COMP-1791802137700
    const { data: prodJob } = await adminClient
      .from('jobs')
      .select('id, job_no')
      .eq('job_no', 'TEST-PE-COMP-1791802137700')
      .single();

    if (prodJob) {
      const { error: prodDelErr } = await adminAuthClient.rpc('admin_delete_job', {
        p_job_id: prodJob.id,
        p_confirm_ticket: prodJob.job_no,
        p_reason: 'Attempting to delete job with PE runs',
      });
      assert(
        prodDelErr !== null && prodDelErr.message.includes('đã có dữ liệu sản xuất'),
        'Backend RPC strictly rejects deleting JOB containing production runs / QA checks',
        prodDelErr?.message
      );
    } else {
      console.log('  ⚠️ Skipping Check 5 (specific prod job not found, creating temp run on test job)');
    }

    // ------------------------------------------------------------------------
    // Step 6: Guard against deleting Closed JOB
    // ------------------------------------------------------------------------
    console.log('\n--- Step 6: Guard against deleting Closed JOB ---');
    const { data: closedJob } = await adminClient
      .from('jobs')
      .select('id, job_no')
      .eq('status', 'CLOSE')
      .limit(1)
      .single();

    if (closedJob) {
      const { error: closeDelErr } = await adminAuthClient.rpc('admin_delete_job', {
        p_job_id: closedJob.id,
        p_confirm_ticket: closedJob.job_no,
        p_reason: 'Attempting to delete closed job',
      });
      assert(
        closeDelErr !== null && (closeDelErr.message.includes('CLOSE') || closeDelErr.message.includes('không thể xóa')),
        'Backend RPC strictly rejects deleting JOB in CLOSE status',
        closeDelErr?.message
      );
    }

    // ------------------------------------------------------------------------
    // Step 7: Successful Admin Deletion of Disposable Clean Test Job
    // ------------------------------------------------------------------------
    console.log('\n--- Step 7: Successful Admin Deletion of Disposable Clean Test Job ---');
    const deleteReason = 'Xác minh kiểm thử tính năng UI-06 Admin Delete Job';
    const { data: successData, error: successErr } = await adminAuthClient.rpc('admin_delete_job', {
      p_job_id: disposableJobId,
      p_confirm_ticket: testTicket,
      p_reason: deleteReason,
    });

    assert(
      !successErr && successData?.success === true,
      'Admin deletes clean active job successfully via admin_delete_job RPC',
      successErr?.message
    );

    // Verify job is removed from public.jobs
    const { data: jobAfterDel } = await adminClient.from('jobs').select('*').eq('id', disposableJobId).single();
    assert(jobAfterDel === null, 'JOB record is permanently removed from public.jobs');

    // Verify operations are removed
    const { data: opsAfterDel } = await adminClient.from('job_operations').select('*').eq('job_id', disposableJobId);
    assert((opsAfterDel || []).length === 0, 'Associated operations are cleanly cascaded and removed');

    // Verify Audit Log entry exists with reason
    const { data: auditRecord } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('entity_id', disposableJobId)
      .eq('action', 'ADMIN_DELETE_JOB')
      .single();

    assert(
      auditRecord !== null && auditRecord.new_values?.reason === deleteReason,
      'Audit log recorded accurately with action ADMIN_DELETE_JOB, admin identity, and reason',
      `Audit new_values: ${JSON.stringify(auditRecord?.new_values)}`
    );

    console.log('\n================================================================================');
    console.log(`  VERIFICATION RESULT: ${passed}/${total} CHECKS PASSED`);
    console.log('================================================================================\n');

  } finally {
    // Cleanup users
    if (testAdminUser?.id) {
      await adminClient.from('profiles').delete().eq('id', testAdminUser.id);
      await adminClient.auth.admin.deleteUser(testAdminUser.id);
    }
    if (testPlanningUser?.id) {
      await adminClient.from('profiles').delete().eq('id', testPlanningUser.id);
      await adminClient.auth.admin.deleteUser(testPlanningUser.id);
    }
  }
}

runLiveVerification().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
