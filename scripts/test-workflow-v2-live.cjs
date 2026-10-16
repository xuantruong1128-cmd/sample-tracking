const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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
  console.log('   SAMPLE TRACKING — WORKFLOW V2: LIVE BACKEND VERIFICATION');
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

  const runId = 'v2_' + Date.now().toString(36);
  let testAdminUser = null;
  let testPlanningUser = null;
  let testPeUser = null;
  let testPeLeaderUser = null;
  let testQaUser = null;
  let disposableJobId = null;

  try {
    // ------------------------------------------------------------------------
    // SETUP: Create isolated test users
    // ------------------------------------------------------------------------
    console.log('--- 1. PREPARING ISOLATED TEST USERS ---');
    const dummyPhoneAdmin = `8499${Math.floor(1000000 + Math.random() * 8999999)}`;
    const dummyPhonePlanning = `8499${Math.floor(1000000 + Math.random() * 8999999)}`;
    const dummyPhonePe = `8499${Math.floor(1000000 + Math.random() * 8999999)}`;
    const dummyPhonePeLeader = `8499${Math.floor(1000000 + Math.random() * 8999999)}`;
    const dummyPhoneQa = `8499${Math.floor(1000000 + Math.random() * 8999999)}`;
    const password = 'TestWorkflowV2@2026';

    const { data: uAdmin } = await adminClient.auth.admin.createUser({
      email: `${dummyPhoneAdmin}@test.local`,
      phone: dummyPhoneAdmin,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'Admin', full_name: 'Test Admin V2' },
    });
    testAdminUser = uAdmin.user;
    await adminClient.from('profiles').upsert({
      id: testAdminUser.id,
      phone: dummyPhoneAdmin,
      email: `${dummyPhoneAdmin}@test.local`,
      role: 'Admin',
      department: 'Ban Quản Trị',
      full_name: 'Test Admin V2',
      is_active: true,
      must_change_password: false,
    });

    const { data: uPlan } = await adminClient.auth.admin.createUser({
      email: `${dummyPhonePlanning}@test.local`,
      phone: dummyPhonePlanning,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'Planning', full_name: 'Test Planning Staff' },
    });
    testPlanningUser = uPlan.user;
    await adminClient.from('profiles').upsert({
      id: testPlanningUser.id,
      phone: dummyPhonePlanning,
      email: `${dummyPhonePlanning}@test.local`,
      role: 'Planning',
      department: 'Kế Hoạch',
      full_name: 'Test Planning Staff',
      is_active: true,
      must_change_password: false,
    });

    const { data: uPe } = await adminClient.auth.admin.createUser({
      email: `${dummyPhonePe}@test.local`,
      phone: dummyPhonePe,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'PE-MFG', full_name: 'Test PE Staff' },
    });
    testPeUser = uPe.user;
    await adminClient.from('profiles').upsert({
      id: testPeUser.id,
      phone: dummyPhonePe,
      email: `${dummyPhonePe}@test.local`,
      role: 'PE-MFG',
      department: 'Sản xuất',
      full_name: 'Test PE Staff',
      is_active: true,
      must_change_password: false,
      is_department_leader: false,
    });

    const { data: uPeLeader } = await adminClient.auth.admin.createUser({
      email: `${dummyPhonePeLeader}@test.local`,
      phone: dummyPhonePeLeader,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'PE-MFG', full_name: 'Test PE Leader' },
    });
    testPeLeaderUser = uPeLeader.user;
    await adminClient.from('profiles').upsert({
      id: testPeLeaderUser.id,
      phone: dummyPhonePeLeader,
      email: `${dummyPhonePeLeader}@test.local`,
      role: 'PE-MFG',
      department: 'Sản xuất',
      full_name: 'Test PE Leader',
      is_active: true,
      must_change_password: false,
      is_department_leader: true,
    });

    const { data: uQa } = await adminClient.auth.admin.createUser({
      email: `${dummyPhoneQa}@test.local`,
      phone: dummyPhoneQa,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role: 'QA', full_name: 'Test QA Staff' },
    });
    testQaUser = uQa.user;
    await adminClient.from('profiles').upsert({
      id: testQaUser.id,
      phone: dummyPhoneQa,
      email: `${dummyPhoneQa}@test.local`,
      role: 'QA',
      department: 'Chất Lượng',
      full_name: 'Test QA Staff',
      is_active: true,
      must_change_password: false,
    });

    // Create client auth instances
    const adminAuthClient = createClient(supabaseUrl, anonKey);
    await adminAuthClient.auth.signInWithPassword({ email: `${dummyPhoneAdmin}@test.local`, password });

    const peAuthClient = createClient(supabaseUrl, anonKey);
    await peAuthClient.auth.signInWithPassword({ email: `${dummyPhonePe}@test.local`, password });

    const peLeaderAuthClient = createClient(supabaseUrl, anonKey);
    await peLeaderAuthClient.auth.signInWithPassword({ email: `${dummyPhonePeLeader}@test.local`, password });

    const planningAuthClient = createClient(supabaseUrl, anonKey);
    await planningAuthClient.auth.signInWithPassword({ email: `${dummyPhonePlanning}@test.local`, password });

    const qaAuthClient = createClient(supabaseUrl, anonKey);
    await qaAuthClient.auth.signInWithPassword({ email: `${dummyPhoneQa}@test.local`, password });

    console.log('Test users created and logged in successfully.\n');

    // ------------------------------------------------------------------------
    // CHECK 1: Department Leader Appointment & Step-down
    // ------------------------------------------------------------------------
    console.log('--- 2. TESTING LEADER APPOINTMENT RPC ---');
    // Non-admin attempt to appoint leader (must fail)
    const { data: failAppoint, error: errNonAdminAppoint } = await peAuthClient.rpc('admin_set_department_leader', {
      p_user_id: testPeUser.id,
      p_is_leader: true,
    });
    assert(
      errNonAdminAppoint && errNonAdminAppoint.message.includes('Chỉ Quản trị viên'),
      'Non-Admin cannot appoint department leader',
      errNonAdminAppoint?.message
    );

    // Admin appoints testPeUser as leader (testPeLeaderUser must be automatically stepped down)
    const { data: resAppoint, error: errAppoint } = await adminAuthClient.rpc('admin_set_department_leader', {
      p_user_id: testPeUser.id,
      p_is_leader: true,
    });
    assert(!errAppoint && resAppoint?.success === true, 'Admin appoints PE Leader successfully', errAppoint?.message);

    const { data: pCheck1 } = await adminClient.from('profiles').select('is_department_leader').eq('id', testPeUser.id).single();
    const { data: pCheckPrev } = await adminClient.from('profiles').select('is_department_leader').eq('id', testPeLeaderUser.id).single();
    assert(pCheck1?.is_department_leader === true, 'Target user is now department leader');
    assert(pCheckPrev?.is_department_leader === false, 'Previous leader was stepped down (at most 1 active leader per role)');

    // Switch leader back to testPeLeaderUser
    await adminAuthClient.rpc('admin_set_department_leader', { p_user_id: testPeLeaderUser.id, p_is_leader: true });

    // ------------------------------------------------------------------------
    // CHECK 2: Setup Test Job & Operations
    // ------------------------------------------------------------------------
    console.log('\n--- 3. CREATING TEST JOB & OPERATIONS ---');
    const testJobTicket = `TEST-V2-${Date.now().toString().slice(-6)}`;
    const { data: createdJob, error: errCreateJob } = await adminClient.from('jobs').insert({
      job_no: testJobTicket,
      part_no: 'PART-TEST-V2',
      part_name: 'Workflow V2 Test Part',
      customer: 'TEST-CUST',
      order_qty: 100,
      material: 'AL6061',
      planned_start_date: '2026-10-13',
      planned_finish_date: '2026-10-14',
      status: 'ACTIVE',
      created_by: testPlanningUser.id,
    }).select().single();

    assert(!errCreateJob && createdJob?.id, 'Created isolated test job: ' + testJobTicket, errCreateJob?.message);
    disposableJobId = createdJob.id;

    // Create 2 operations: OP10, OP20
    const { data: op10, error: errOp10 } = await adminClient.from('job_operations').insert({
      job_id: disposableJobId,
      step_order: 10,
      operation_name: 'OP10 - CNC Milling',
      workcenter_code: 'MC-CNC',
      machine_no: 'AA08',
      status: 'NOT_STARTED',
    }).select().single();

    const { data: op20, error: errOp20 } = await adminClient.from('job_operations').insert({
      job_id: disposableJobId,
      step_order: 20,
      operation_name: 'OP20 - Finishing',
      workcenter_code: 'MC-FINISH',
      machine_no: 'BB02',
      status: 'NOT_STARTED',
    }).select().single();

    assert(!errOp10 && !errOp20 && op10 && op20, 'Created OP10 and OP20 in NOT_STARTED state');

    // ------------------------------------------------------------------------
    // CHECK 3: Save Production Run (OP10) with KIV
    // ------------------------------------------------------------------------
    console.log('\n--- 4. RECORDING INITIAL PRODUCTION RUN (OP10) ---');
    const { data: resProdRun, error: errProdRun } = await peAuthClient.rpc('save_production_result_with_ng', {
      p_operation_id: op10.id,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-13',
      p_cycle_time: 45,
      p_ok_qty: 15,
      p_kiv_qty: 5,
      p_ng_items: [{ defect_name: 'Sai kích thước', defect_code: 'DEF-DIM-01', ng_qty: 2, cause: 'Mòn dao', remark: 'Đã thay dao' }],
    });
    assert(!errProdRun && resProdRun?.success, 'Saved production result (15 OK, 2 NG, 5 KIV)', errProdRun?.message);

    // ------------------------------------------------------------------------
    // CHECK 4: Close Operation Permissions & Lockout
    // ------------------------------------------------------------------------
    console.log('\n--- 5. TESTING CLOSE OPERATION ---');
    // Non-leader PE staff attempt to close OP10 (must fail)
    const { data: failCloseOp, error: errFailCloseOp } = await peAuthClient.rpc('close_job_operation', {
      p_operation_id: op10.id,
    });
    assert(
      errFailCloseOp && errFailCloseOp.message.includes('Chỉ Trưởng nhóm PE-MFG'),
      'Regular PE staff cannot close operation',
      errFailCloseOp?.message
    );

    // PE Leader closes OP10
    const { data: resCloseOp, error: errCloseOp } = await peLeaderAuthClient.rpc('close_job_operation', {
      p_operation_id: op10.id,
    });
    assert(!errCloseOp && resCloseOp?.status === 'CLOSED', 'PE Leader closes OP10 successfully', errCloseOp?.message);

    // Verify snapshot recorded
    const { data: op10Check } = await adminClient.from('job_operations').select('status, closed_at, closed_snapshot').eq('id', op10.id).single();
    assert(op10Check.status === 'CLOSED' && op10Check.closed_snapshot?.ok_qty === 15, 'OP10 status is CLOSED with snapshot ok_qty=15');

    // ------------------------------------------------------------------------
    // CHECK 5: Verify Planning & Routing Lockout after OP10 Closed
    // ------------------------------------------------------------------------
    console.log('\n--- 6. VERIFYING PLANNING & ROUTING LOCKOUT (DATABASE LEVEL) ---');
    // Planning staff attempt to edit Planning order_qty (must fail)
    const { error: errEditPlanning } = await planningAuthClient.from('jobs').update({ order_qty: 200 }).eq('id', disposableJobId);
    assert(
      errEditPlanning && errEditPlanning.message.includes('Planning Lockout'),
      'Planning edit rejected: order_qty cannot be changed after OP is CLOSED',
      errEditPlanning?.message
    );

    // Admin attempt to edit Planning customer (must also fail!)
    const { error: errAdminEditPlanning } = await adminAuthClient.from('jobs').update({ customer: 'NEW-CUST' }).eq('id', disposableJobId);
    assert(
      errAdminEditPlanning && errAdminEditPlanning.message.includes('Planning Lockout'),
      'Admin cannot edit Planning fields after OP is CLOSED (strict business rule)',
      errAdminEditPlanning?.message
    );

    // Attempt to add new operation to JOB (must fail)
    const { error: errAddOp } = await adminClient.from('job_operations').insert({
      job_id: disposableJobId,
      step_order: 30,
      operation_name: 'OP30 - Blocked Insert',
      status: 'NOT_STARTED',
    });
    assert(
      errAddOp && errAddOp.message.includes('bị khóa'),
      'Routing insert rejected: cannot add new operation after OP is CLOSED',
      errAddOp?.message
    );

    // Attempt to delete OP20 (must fail)
    const { error: errDelOp } = await adminClient.from('job_operations').delete().eq('id', op20.id);
    assert(
      errDelOp && errDelOp.message.includes('bị khóa'),
      'Routing delete rejected: cannot delete operation after OP is CLOSED',
      errDelOp?.message
    );

    // Direct edit to production_runs of closed OP10 (must fail)
    const { data: run10 } = await adminClient.from('production_runs').select('id').eq('operation_id', op10.id).single();
    const { error: errDirectEditProd } = await adminClient.from('production_runs').update({ ok_qty: 999 }).eq('id', run10.id);
    assert(
      errDirectEditProd && errDirectEditProd.message.includes('Công đoạn đã chốt (CLOSED)'),
      'Direct production run edit rejected on CLOSED operation',
      errDirectEditProd?.message
    );

    // ------------------------------------------------------------------------
    // CHECK 6: Review KIV Transfer on Closed OP10
    // ------------------------------------------------------------------------
    console.log('\n--- 7. TESTING REVIEW KIV TRANSFER ---');
    // Attempt to transfer more than available KIV (5 available, attempt 10) (must fail)
    const { error: errOverKiv } = await peLeaderAuthClient.rpc('review_kiv_transfer', {
      p_operation_id: op10.id,
      p_kiv_to_ok: 6,
      p_kiv_to_ng: 4,
      p_reason: 'Over transfer test',
    });
    assert(
      errOverKiv && errOverKiv.message.includes('vượt quá số lượng KIV'),
      'Cannot transfer more KIV than remaining (rejected 10 > 5)',
      errOverKiv?.message
    );

    // Valid transfer: 5 KIV -> 3 to OK, 2 to NG
    const { data: resKivTransfer, error: errKivTransfer } = await peLeaderAuthClient.rpc('review_kiv_transfer', {
      p_operation_id: op10.id,
      p_kiv_to_ok: 3,
      p_kiv_to_ng: 2,
      p_reason: 'Kỹ thuật mài lại đạt 3 pcs, 2 pcs nứt ren xác nhận NG',
      p_ng_items: [{ ng_qty: 2, defect_name: 'Nứt ren', defect_code: 'DEF-THR-01', cause: 'Lực kẹp', remark: 'Đã lưu mẫu' }],
    });
    assert(!errKivTransfer && resKivTransfer?.success, 'Review KIV: 3 to OK, 2 to NG transferred successfully', errKivTransfer?.message);

    // Check quantities in database
    const { data: run10After } = await adminClient.from('production_runs').select('ok_qty, ng_qty, kiv_qty').eq('id', run10.id).single();
    assert(
      run10After.ok_qty === 18 && run10After.ng_qty === 4 && run10After.kiv_qty === 0,
      'Quantities verified: OK 15->18 (+3), NG 2->4 (+2), KIV 5->0 (-5), Total 22==22 unchanged'
    );

    // Check kiv_reviews audit table
    const { data: kivReviews } = await adminClient.from('kiv_reviews').select('*').eq('operation_id', op10.id);
    assert(kivReviews.length === 1 && kivReviews[0].kiv_to_ok === 3 && kivReviews[0].kiv_to_ng === 2, 'History record created in kiv_reviews table');

    // ------------------------------------------------------------------------
    // CHECK 7: QA Check on Closed Operation
    // ------------------------------------------------------------------------
    console.log('\n--- 8. TESTING QA CHECK ON CLOSED OPERATION ---');
    const { data: resQa, error: errQa } = await qaAuthClient.rpc('save_qa_check_result', {
      p_operation_id: op10.id,
      p_result: 'OK',
      p_sample_size: 5,
      p_ok_qty: 5,
      p_ng_qty: 0,
      p_notes: 'Kiểm tra kích thước sau review KIV đạt tiêu chuẩn',
    });
    assert(!errQa && resQa?.id, 'QA check successfully recorded after operation was CLOSED', errQa?.message);

    // ------------------------------------------------------------------------
    // CHECK 8: Close JOB Invariants (Option B)
    // ------------------------------------------------------------------------
    console.log('\n--- 9. TESTING CLOSE JOB (OPTION B) ---');
    // Attempt to close JOB when OP20 is still NOT_STARTED (must fail)
    const { error: errPrematureCloseJob } = await peLeaderAuthClient.rpc('close_job_final', {
      p_job_id: disposableJobId,
      p_confirm_ticket: testJobTicket,
      p_close_reason: 'Premature close test',
    });
    assert(
      errPrematureCloseJob && errPrematureCloseJob.message.includes('chưa chốt'),
      'Cannot close JOB while OP20 is not CLOSED',
      errPrematureCloseJob?.message
    );

    // Set up and close OP20
    await peAuthClient.rpc('save_production_result_with_ng', {
      p_operation_id: op20.id,
      p_machine_id: 'BB02',
      p_production_date: '2026-10-13',
      p_cycle_time: 30,
      p_ok_qty: 18,
      p_kiv_qty: 2, // Notice OP20 leaves 2 KIV to test Option B warning!
      p_ng_items: [],
    });
    await peLeaderAuthClient.rpc('close_job_operation', { p_operation_id: op20.id });

    // Attempt to close JOB without reason when warnings exist (OP20 has 2 KIV & no QA) (must fail)
    const { error: errNoReasonCloseJob } = await peLeaderAuthClient.rpc('close_job_final', {
      p_job_id: disposableJobId,
      p_confirm_ticket: testJobTicket,
      p_close_reason: '', // empty
    });
    assert(
      errNoReasonCloseJob && errNoReasonCloseJob.message.includes('Bắt buộc nhập lý do'),
      'Close JOB requires minimum 5-character reason when warnings exist (Option B)',
      errNoReasonCloseJob?.message
    );

    // Close JOB with valid ticket, reason, and warnings acknowledged
    const { data: resCloseJob, error: errCloseJob } = await peLeaderAuthClient.rpc('close_job_final', {
      p_job_id: disposableJobId,
      p_confirm_ticket: testJobTicket,
      p_close_reason: 'Chấp nhận xuất hàng đợt 1 với 18 pcs hoàn tất, 2 pcs KIV xử lý ở đơn hàng tiếp theo.',
      p_acknowledged_warnings: [{ type: 'REMAINING_KIV', count: 2 }, { type: 'MISSING_QA', count: 1 }],
    });
    assert(!errCloseJob && resCloseJob?.status === 'CLOSE', 'Close JOB succeeded under Option B with warnings and snapshot', errCloseJob?.message);

    // Verify final snapshot and status in database
    const { data: closedJobRow } = await adminClient.from('jobs').select('status, closed_at, close_reason, final_snapshot').eq('id', disposableJobId).single();
    assert(closedJobRow.status === 'CLOSE' && closedJobRow.final_snapshot?.job_no === testJobTicket, 'Job status is CLOSE with final_snapshot compiled');

    // ------------------------------------------------------------------------
    // CHECK 9: Strict Read-Only Immutability after Job Closed
    // ------------------------------------------------------------------------
    console.log('\n--- 10. VERIFYING IMMUTABILITY AFTER CLOSE JOB ---');
    // Admin attempt to edit closed job (must fail)
    const { error: errAdminEditClosedJob } = await adminAuthClient.from('jobs').update({ customer: 'HACKED' }).eq('id', disposableJobId);
    assert(
      errAdminEditClosedJob && (errAdminEditClosedJob.message.includes('READ-ONLY') || errAdminEditClosedJob.message.includes('Planning Lockout') || errAdminEditClosedJob.message.includes('immutable')),
      'Admin cannot edit Job after it is CLOSED (permanent immutability)',
      errAdminEditClosedJob?.message
    );

    // Attempt to insert new QA check on closed job (must fail)
    const { error: errAddQaOnClosedJob } = await qaAuthClient.rpc('save_qa_check_result', {
      p_operation_id: op10.id,
      p_result: 'OK',
      p_sample_size: 1,
      p_ok_qty: 1,
      p_ng_qty: 0,
    });
    assert(
      errAddQaOnClosedJob && errAddQaOnClosedJob.message.includes('Lệnh sản xuất đã đóng'),
      'Cannot add QA check on CLOSED job',
      errAddQaOnClosedJob?.message
    );

    // Attempt to Review KIV on closed job (must fail)
    const { error: errKivOnClosedJob } = await peLeaderAuthClient.rpc('review_kiv_transfer', {
      p_operation_id: op20.id,
      p_kiv_to_ok: 1,
      p_kiv_to_ng: 0,
      p_reason: 'Post-close KIV attempt',
    });
    assert(
      errKivOnClosedJob && errKivOnClosedJob.message.includes('đã ở trạng thái CLOSE'),
      'Cannot review KIV after Job is CLOSED',
      errKivOnClosedJob?.message
    );

  } catch (err) {
    console.error('Unhandled test failure:', err);
    process.exitCode = 1;
  } finally {
    // ------------------------------------------------------------------------
    // CLEANUP: Clean up test job & test users safely
    // ------------------------------------------------------------------------
    console.log('\n--- 11. CLEANING UP TEST FIXTURES ---');
    if (disposableJobId) {
      // Direct SQL delete via service_role to wipe test job
      await adminClient.from('kiv_reviews').delete().eq('job_id', disposableJobId);
      await adminClient.from('qa_checks').delete().in('operation_id', (await adminClient.from('job_operations').select('id').eq('job_id', disposableJobId)).data?.map(o => o.id) || []);
      const opIds = (await adminClient.from('job_operations').select('id').eq('job_id', disposableJobId)).data?.map(o => o.id) || [];
      const runIds = (await adminClient.from('production_runs').select('id').in('operation_id', opIds)).data?.map(r => r.id) || [];
      await adminClient.from('ng_details').delete().in('production_run_id', runIds);
      await adminClient.from('production_runs').delete().in('operation_id', opIds);
      await adminClient.from('job_operations').delete().eq('job_id', disposableJobId);
      await adminClient.from('jobs').delete().eq('id', disposableJobId);
      console.log('Cleaned up test job:', disposableJobId);
    }

    const testUsersToWipe = [testAdminUser, testPlanningUser, testPeUser, testPeLeaderUser, testQaUser].filter(Boolean);
    for (const u of testUsersToWipe) {
      await adminClient.from('profiles').delete().eq('id', u.id);
      await adminClient.auth.admin.deleteUser(u.id);
    }
    console.log(`Cleaned up ${testUsersToWipe.length} test user accounts.`);
  }

  console.log('\n================================================================================');
  console.log(`   VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
  console.log('================================================================================');
}

runLiveVerification();
