const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables
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
  console.log('  SAMPLE TRACKING — FIX PE-MFG SAVE ERROR VERIFICATION');
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

  const runTag = 'fix_' + Date.now().toString(36);
  let testUserId = null;
  let testJobId = null;
  let testOpId = null;
  let peClient = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Provision an Authenticated PE-MFG Test User
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Provision authentic PE-MFG user for session authentication ---');
    const peEmail = `pe_mfg_${runTag}@sample-test.vn`;
    const pePhone = `+8497${crypto.randomInt(10000000, 99999999)}`;
    const pePassword = `PeTest_${crypto.randomBytes(6).toString('hex')}!Aa1`;
    const peFullName = 'Nguyễn Văn Kỹ Thuật (PE)';

    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email: peEmail,
      password: pePassword,
      email_confirm: true,
      user_metadata: { full_name: peFullName },
    });

    if (authErr || !authUser?.user) {
      throw new Error(`Failed to create test user: ${authErr?.message}`);
    }
    testUserId = authUser.user.id;

    const { error: profileErr } = await adminClient.from('profiles').insert({
      id: testUserId,
      phone: pePhone,
      email: peEmail,
      full_name: peFullName,
      role: 'PE-MFG',
      department: 'PE',
      is_active: true,
      must_change_password: false,
      can_make_pe_decisions: true,
    });

    if (profileErr) {
      throw new Error(`Failed to create profile: ${profileErr.message}`);
    }

    assert(testUserId !== null, `Provisioned PE-MFG user ${peEmail} with profile (full_name: "${peFullName}")`);

    // Authenticate with anonClient using credentials to get authentic 'authenticated' JWT
    peClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: sessionData, error: loginErr } = await peClient.auth.signInWithPassword({
      email: peEmail,
      password: pePassword,
    });

    if (loginErr || !sessionData?.session) {
      throw new Error(`Failed to log in as test user: ${loginErr?.message}`);
    }

    assert(sessionData?.user?.id === testUserId, `Successfully signed in as authenticated user (Role: authenticated)`);

    // ------------------------------------------------------------------------
    // Step 2: Create a Test Job with Operations
    // ------------------------------------------------------------------------
    console.log('\n--- Step 2: Create test JOB with OP10 & OP20 ---');
    const { data: jobRes, error: jobErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: '',
      p_part_no: `PART-PEMFG-${Date.now()}`,
      p_part_name: 'Chi tiết kiểm thử lỗi username',
      p_customer: 'CUSTOMER-TEST',
      p_order_qty: 200,
      p_material: 'SUS304',
      p_material_spec: 'Ø20 x 80mm',
      p_planned_start_date: '2026-10-12',
      p_planned_finish_date: '2026-10-20',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'A20C',
          description: 'Auto Turn Tiện ngoài',
          planned_cycle_time_seconds: 45,
          machine_no: 'AA08',
          remark: 'Tiện ngoài kích thước',
        },
        {
          step_order: 20,
          workcenter_code: 'CGMG',
          description: 'Centerless Grinding',
          planned_cycle_time_seconds: 30,
          machine_no: 'MC-01',
          remark: 'Mài tròn',
        },
      ],
    });

    if (jobErr) {
      throw new Error(`Failed to create test job: ${jobErr.message}`);
    }
    testJobId = jobRes.id;

    const { data: ops } = await adminClient
      .from('job_operations')
      .select('*')
      .eq('job_id', testJobId)
      .order('step_order', { ascending: true });

    testOpId = ops[0].id;
    assert(Boolean(testOpId), `Created test job ${jobRes.job_no} with OP10 (${ops[0].workcenter_code})`);

    // ------------------------------------------------------------------------
    // Step 3: Test Scenario 1 — Lưu lần đầu với dữ liệu thử thực tế
    // Machine: AA08, Date: 2026-10-12, CT Actual: 47, OK: 16, NG: 2, KIV: 0
    // ------------------------------------------------------------------------
    console.log('\n--- Step 3: Test Scenario 1 — Lưu lần đầu với dữ liệu thử thực tế ---');
    console.log('Payload: Machine=AA08, Date=2026-10-12, CT=47, OK=16, NG=2 (2 dòng), KIV=0');

    const ngRowsInitial = [
      {
        defect_name: 'Sai đường kính',
        defect_code: 'DEF-DIM-01',
        ng_qty: 1,
        cause: 'Mòn dao tiện mép',
        remark: 'Đã bù dao 0.02mm',
        photo_urls: [],
      },
      {
        defect_name: 'Bavia',
        defect_code: 'DEF-BURR-01',
        ng_qty: 1,
        cause: 'Góc cắt chưa chuẩn',
        remark: 'Đã mài lại góc thoát',
        photo_urls: [],
      },
    ];

    const { data: saveRes1, error: errSave1 } = await peClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-12',
      p_cycle_time: 47,
      p_ok_qty: 16,
      p_kiv_qty: 0,
      p_ng_items: ngRowsInitial,
      p_remarks: 'Chạy thử lô đầu ca ngày 2026-10-12',
    });

    assert(
      !errSave1 && saveRes1?.success === true,
      'Lưu lần đầu thành công qua authenticated user (NO "column username does not exist" error)',
      errSave1 ? errSave1.message : ''
    );
    assert(saveRes1?.ok_qty === 16, 'OK qty = 16 chính xác');
    assert(saveRes1?.kiv_qty === 0, 'KIV qty = 0 chính xác');
    assert(saveRes1?.total_ng === 2, 'Tổng NG tính tự động = 2 (1 + 1)');
    assert(saveRes1?.ng_qty === 2, 'ng_qty trong production_runs = 2');

    // ------------------------------------------------------------------------
    // Step 4: Verify Reload & Persistence in DB
    // ------------------------------------------------------------------------
    console.log('\n--- Step 4: Verify Reload & Data Persistence in Database ---');
    const { data: dbRun1, error: errDbRun1 } = await peClient
      .from('production_runs')
      .select('*, ng_details(*)')
      .eq('operation_id', testOpId)
      .single();

    assert(!errDbRun1 && Boolean(dbRun1), 'Tải lại kết quả sản xuất từ DB thành công');
    assert(dbRun1?.machine_id === 'AA08', `Mã máy lưu đúng: ${dbRun1?.machine_id}`);
    assert(dbRun1?.production_date === '2026-10-12', `Ngày sản xuất lưu đúng: ${dbRun1?.production_date}`);
    assert(Number(dbRun1?.cycle_time_seconds) === 47, `CT Actual lưu đúng: ${dbRun1?.cycle_time_seconds}s`);
    assert(dbRun1?.ok_qty === 16, `OK qty trong DB = 16`);
    assert(dbRun1?.kiv_qty === 0, `KIV qty trong DB = 0`);
    assert(dbRun1?.ng_qty === 2, `NG qty trong DB = 2`);
    assert(dbRun1?.operator_name === peFullName, `operator_name được gán chính xác từ profiles.full_name ("${dbRun1?.operator_name}")`);
    assert(dbRun1?.ng_details?.length === 2, `Số dòng NG details trong DB = 2`);

    const dimDefect = dbRun1?.ng_details?.find((d) => d.defect_name === 'Sai đường kính');
    assert(
      dimDefect?.cause === 'Mòn dao tiện mép' && dimDefect?.remark === 'Đã bù dao 0.02mm',
      'Cause và Remark của NG Detail được tách biệt đúng vào 2 cột riêng biệt'
    );

    // ------------------------------------------------------------------------
    // Step 5: Test Sửa và Lưu lại (Update & Resave)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 5: Sửa dữ liệu và lưu lại (Update & Resave) ---');
    const { data: saveRes2, error: errSave2 } = await peClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-12',
      p_cycle_time: 46.5,
      p_ok_qty: 25,
      p_kiv_qty: 5,
      p_ng_items: [
        {
          defect_name: 'Sai đường kính',
          defect_code: 'DEF-DIM-01',
          ng_qty: 2,
          cause: 'Mòn dao tiện mép',
          remark: 'Đã bù dao 0.03mm',
          photo_urls: [],
        },
      ],
      p_remarks: 'Cập nhật lại sản lượng sau khi bù dao',
    });

    assert(!errSave2 && saveRes2?.success === true, 'Sửa và lưu lại thành công');
    assert(saveRes2?.ok_qty === 25, 'OK qty cập nhật thành 25');
    assert(saveRes2?.kiv_qty === 5, 'KIV qty cập nhật thành 5');
    assert(saveRes2?.total_ng === 2, 'Tổng NG cập nhật thành 2 (1 dòng duy nhất x 2)');

    // Verify exactly 1 production_run exists (no duplicate run inserted)
    const { data: allRuns } = await peClient
      .from('production_runs')
      .select('id')
      .eq('operation_id', testOpId);
    assert(allRuns?.length === 1, 'Không sinh bản ghi trùng lặp (duy nhất 1 production_run cho operation)');

    // ------------------------------------------------------------------------
    // Step 6: Test Thêm / Xóa dòng NG Details
    // ------------------------------------------------------------------------
    console.log('\n--- Step 6: Kiểm tra Thêm/Xóa dòng NG Details ---');
    // Scenario 6A: Thêm thành 3 dòng NG (tổng NG = 6)
    const ngRowsThree = [
      { defect_name: 'Sai đường kính', ng_qty: 2, cause: 'Lệch tâm', remark: 'Đã chỉnh gá' },
      { defect_name: 'Bavia', ng_qty: 1, cause: 'Dao cùn', remark: 'Đã thay dao' },
      { defect_name: 'Xước bề mặt', ng_qty: 3, cause: 'Kẹp phôi chặt', remark: 'Điều chỉnh áp suất' },
    ];

    const { data: saveRes3, error: errSave3 } = await peClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-12',
      p_cycle_time: 46.5,
      p_ok_qty: 30,
      p_kiv_qty: 2,
      p_ng_items: ngRowsThree,
      p_remarks: 'Lưu với 3 dòng NG',
    });

    assert(!errSave3 && saveRes3?.success === true, 'Lưu với 3 dòng NG thành công');
    assert(saveRes3?.total_ng === 6, 'Tổng NG cập nhật tự động = 6 (2 + 1 + 3)');

    const { data: ngList3 } = await peClient
      .from('ng_details')
      .select('*')
      .eq('production_run_id', saveRes3.production_run_id);
    assert(ngList3?.length === 3, 'Bảng ng_details chứa đúng 3 bản ghi');

    // Scenario 6B: Xóa còn 0 dòng NG (không có NG)
    const { data: saveRes0, error: errSave0 } = await peClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-12',
      p_cycle_time: 46.5,
      p_ok_qty: 50,
      p_kiv_qty: 0,
      p_ng_items: [],
      p_remarks: 'Không có phế phẩm',
    });

    assert(!errSave0 && saveRes0?.success === true, 'Lưu khi xóa hết dòng NG thành công');
    assert(saveRes0?.total_ng === 0 && saveRes0?.ng_qty === 0, 'Tổng NG = 0');

    const { data: ngList0 } = await peClient
      .from('ng_details')
      .select('*')
      .eq('production_run_id', saveRes0.production_run_id);
    assert(ngList0?.length === 0, 'Bảng ng_details đã đồng bộ xóa hết còn 0 bản ghi');

    // ------------------------------------------------------------------------
    // Step 7: Test save_qa_check_result with Authenticated User Context
    // ------------------------------------------------------------------------
    console.log('\n--- Step 7: Kiểm tra save_qa_check_result với authenticated user ---');
    // Provision QA user
    const qaEmail = `qa_${runTag}@sample-test.vn`;
    const qaPhone = `+8496${crypto.randomInt(10000000, 99999999)}`;
    const qaPassword = `QaTest_${crypto.randomBytes(6).toString('hex')}!Aa1`;
    const qaFullName = 'Trần Thị QA Kiểm Tra';

    const { data: authQa } = await adminClient.auth.admin.createUser({
      email: qaEmail,
      password: qaPassword,
      email_confirm: true,
      user_metadata: { full_name: qaFullName },
    });

    await adminClient.from('profiles').insert({
      id: authQa.user.id,
      phone: qaPhone,
      email: qaEmail,
      full_name: qaFullName,
      role: 'QA',
      department: 'QA',
      is_active: true,
      must_change_password: false,
      can_make_pe_decisions: false,
    });

    const qaClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await qaClient.auth.signInWithPassword({ email: qaEmail, password: qaPassword });

    const { data: qaCheckRes, error: errQaCheck } = await qaClient.rpc('save_qa_check_result', {
      p_operation_id: testOpId,
      p_result: 'OK',
      p_sample_size: 10,
      p_ok_qty: 10,
      p_ng_qty: 0,
      p_notes: 'Kiểm tra đạt chất lượng xuất xưởng',
    });

    assert(
      !errQaCheck && qaCheckRes?.result === 'OK',
      'save_qa_check_result thành công qua authenticated QA user (NO username error)',
      errQaCheck ? errQaCheck.message : ''
    );
    assert(
      qaCheckRes?.inspector_name === qaFullName,
      `inspector_name được gán chính xác từ profiles.full_name ("${qaCheckRes?.inspector_name}")`
    );

    // Clean up QA user
    await adminClient.from('profiles').delete().eq('id', authQa.user.id);
    await adminClient.auth.admin.deleteUser(authQa.user.id);

  } catch (err) {
    console.error('Fatal execution error:', err);
    process.exitCode = 1;
  } finally {
    // ------------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------------
    console.log('\n--- Cleanup test records ---');
    if (testOpId) {
      await adminClient.from('qa_checks').delete().eq('operation_id', testOpId);
      await adminClient.from('ng_details').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await adminClient.from('production_runs').delete().eq('operation_id', testOpId);
    }
    if (testJobId) {
      await adminClient.from('job_operations').delete().eq('job_id', testJobId);
      await adminClient.from('jobs').delete().eq('id', testJobId);
    }
    if (testUserId) {
      await adminClient.from('profiles').delete().eq('id', testUserId);
      await adminClient.auth.admin.deleteUser(testUserId);
    }
    console.log('Cleanup finished.');
  }

  console.log('\n================================================================================');
  console.log(`TOTAL RESULT: ${passed} / ${total} CHECKS PASSED`);
  console.log('================================================================================');
}

runLiveVerification();
