const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Load .env
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

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase configuration in .env');
  process.exit(1);
}

// Safety check: Never run automated write tests on production without authorization
if (supabaseUrl.includes('uqvxtgvdmdfgtjwzsxlj')) {
  console.error('FATAL: Targeting production project uqvxtgvdmdfgtjwzsxlj. Automated test aborted.');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EXPECTED_8_TYPES = [
  'NG Đường Kính',
  'NG Chiều Dài',
  'NG Kích thước',
  'NG Ren',
  'NG Ngoại quan',
  'NG Xước dập',
  'NG hình dáng',
  'Lỗi khác',
];

async function runLiveVerification() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — R3 FIX 04 & FIX 05: LIVE STAGING VERIFICATION');
  console.log('   Target Project: ' + supabaseUrl);
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

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Defect Catalog Standardization (8 Types)
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Defect Catalog Master Standardization (8 Types) ---');
    const { data: activeDefects, error: defErr } = await adminClient
      .from('defect_catalog')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });

    assert(!defErr, 'Query active defect_catalog without error', defErr?.message);
    assert(activeDefects && activeDefects.length === 8, 'Exactly 8 active defect types exist in defect_catalog', `Got ${activeDefects?.length}`);

    const activeNames = (activeDefects || []).map((d) => d.name_vi);
    for (const expName of EXPECTED_8_TYPES) {
      assert(activeNames.includes(expName), `defect_catalog includes standard type: "${expName}"`);
    }

    // Check inactive legacy defects preserved
    const { data: inactiveDefects } = await adminClient
      .from('defect_catalog')
      .select('*')
      .eq('is_active', false);

    assert(inactiveDefects && inactiveDefects.length > 0, 'Inactive legacy defects preserved without deletion', `Found ${inactiveDefects?.length}`);

    // -------------------------------------------------------------------------
    // TEST 2: Schema Column Check for qa_ng_details (cause column)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: qa_ng_details Schema Inspection ---');
    const { data: testQaNg, error: colErr } = await adminClient
      .from('qa_ng_details')
      .select('id, defect_name, cause, remark')
      .limit(1);

    assert(!colErr, 'qa_ng_details table contains "cause" column without schema cache error', colErr?.message);

    // -------------------------------------------------------------------------
    // TEST 3: Setup Test Job & Operation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Setting Up Dedicated Staging Test Job & Operation ---');
    const testPartNo = `PART-R3-NG-${Date.now().toString(36).toUpperCase()}`;
    const testJobNo = `JOB-R3-${Math.floor(100000 + Math.random() * 900000)}`;

    const { data: testJob, error: jobErr } = await adminClient
      .from('jobs')
      .insert({
        job_no: testJobNo,
        part_no: testPartNo,
        part_name: 'Trục thử nghiệm R3 NG Fix',
        customer: 'TEST-CORP',
        order_qty: 50,
        material: 'SUS304',
        planned_start_date: '2026-10-30',
        planned_finish_date: '2026-11-05',
        status: 'ACTIVE',
      })
      .select()
      .single();

    assert(!jobErr && testJob, 'Create test job on staging', jobErr?.message);

    const { data: testOp, error: opErr } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJob.id,
        step_order: 10,
        operation_name: 'Auto Turn',
        workcenter_code: 'A20C',
        description: 'Auto Turn',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    assert(!opErr && testOp, 'Create test operation on staging', opErr?.message);

    // -------------------------------------------------------------------------
    // TEST 4: Backend Validation in save_production_result_with_ng
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: PE-MFG NG Validation ("Lỗi khác" & Legacy support) ---');

    // Case 4A: Reject when defect_name = 'Lỗi khác' and cause is empty
    const { error: mfgRejectErr } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOp.id,
      p_machine_id: 'CNC-TEST-01',
      p_production_date: new Date().toISOString().split('T')[0],
      p_cycle_time: 35.5,
      p_ok_qty: 10,
      p_kiv_qty: 0,
      p_ng_items: [
        {
          ng_qty: 2,
          defect_name: 'Lỗi khác',
          cause: '', // Empty cause -> must be rejected
          remark: 'Ghi chú thử nghiệm',
        },
      ],
    });

    assert(
      mfgRejectErr && mfgRejectErr.message.includes('Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác'),
      'save_production_result_with_ng strictly rejects "Lỗi khác" with empty cause',
      mfgRejectErr?.message
    );

    // Case 4B: Accept when defect_name = 'Lỗi khác' with cause provided
    const { data: mfgAcceptData, error: mfgAcceptErr } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOp.id,
      p_machine_id: 'CNC-TEST-01',
      p_production_date: new Date().toISOString().split('T')[0],
      p_cycle_time: 35.5,
      p_ok_qty: 10,
      p_kiv_qty: 0,
      p_ng_items: [
        {
          ng_qty: 2,
          defect_name: 'Lỗi khác',
          defect_code: 'DEF-OTH-01',
          cause: 'Mẻ chip dao tiện mặt đầu',
          remark: 'Đã thay insert mới',
        },
      ],
    });

    assert(!mfgAcceptErr && mfgAcceptData?.success, 'save_production_result_with_ng accepts "Lỗi khác" when cause is specified', mfgAcceptErr?.message);

    // Case 4C: Accept standard NG type (e.g. 'NG Đường Kính')
    const { data: mfgStdData, error: mfgStdErr } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOp.id,
      p_machine_id: 'CNC-TEST-01',
      p_production_date: new Date().toISOString().split('T')[0],
      p_cycle_time: 35.5,
      p_ok_qty: 15,
      p_kiv_qty: 0,
      p_ng_items: [
        {
          ng_qty: 1,
          defect_name: 'NG Đường Kính',
          defect_code: 'NG-DIA',
          cause: null,
          remark: 'Âm 0.02mm',
        },
      ],
    });

    assert(!mfgStdErr && mfgStdData?.success, 'save_production_result_with_ng accepts standard NG type without mandatory cause', mfgStdErr?.message);

    // Case 4D: Accept historical/legacy defect name (e.g. 'Bavia')
    const { data: mfgLegacyData, error: mfgLegacyErr } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: testOp.id,
      p_machine_id: 'CNC-TEST-01',
      p_production_date: new Date().toISOString().split('T')[0],
      p_cycle_time: 35.5,
      p_ok_qty: 20,
      p_kiv_qty: 0,
      p_ng_items: [
        {
          ng_qty: 3,
          defect_name: 'Bavia',
          defect_code: 'DEF-SRF-01',
          cause: 'Mòn dao bo góc',
          remark: 'Di sản lịch sử',
        },
      ],
    });

    assert(!mfgLegacyErr && mfgLegacyData?.success, 'save_production_result_with_ng accepts legacy defect name without data loss', mfgLegacyErr?.message);

    // -------------------------------------------------------------------------
    // TEST 5: Backend Validation in save_qa_check_result
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: QA NG Validation ("Lỗi khác", cause persistence & legacy support) ---');

    // Case 5A: Reject QA check when defect_name = 'Lỗi khác' and cause is empty
    const { error: qaRejectErr } = await adminClient.rpc('save_qa_check_result', {
      p_operation_id: testOp.id,
      p_n1_result: 'OK',
      p_qa_ng_items: [
        {
          ng_qty: 1,
          defect_name: 'Lỗi khác',
          cause: '', // Empty cause -> must be rejected
          remark: 'Ghi chú QA',
        },
      ],
    });

    assert(
      qaRejectErr && qaRejectErr.message.includes('Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác cho lỗi QA'),
      'save_qa_check_result strictly rejects "Lỗi khác" with empty cause',
      qaRejectErr?.message
    );

    // Case 5B: Accept QA check when defect_name = 'Lỗi khác' with cause provided
    const { data: qaAcceptData, error: qaAcceptErr } = await adminClient.rpc('save_qa_check_result', {
      p_operation_id: testOp.id,
      p_n1_result: 'OK',
      p_qa_ng_items: [
        {
          ng_qty: 1,
          defect_name: 'Lỗi khác',
          defect_code: 'DEF-OTH-01',
          cause: 'Bề mặt bị xỉn màu do dung dịch tưới nguội pha sai tỷ lệ',
          remark: 'Báo phòng quản lý chất lượng',
        },
      ],
    });

    assert(!qaAcceptErr && (qaAcceptData?.id || qaAcceptData?.success), 'save_qa_check_result accepts "Lỗi khác" when cause is specified', qaAcceptErr?.message);

    // Case 5C: Verify 'cause' is accurately persisted into qa_ng_details table
    const { data: persistedQaNg, error: verifyQaErr } = await adminClient
      .from('qa_ng_details')
      .select('defect_name, cause, remark, ng_qty')
      .eq('operation_id', testOp.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    assert(!verifyQaErr && persistedQaNg, 'Query persisted qa_ng_details record', verifyQaErr?.message);
    assert(
      persistedQaNg?.defect_name === 'Lỗi khác' &&
      persistedQaNg?.cause === 'Bề mặt bị xỉn màu do dung dịch tưới nguội pha sai tỷ lệ',
      'qa_ng_details accurately stores specific description in "cause" column'
    );
    assert(
      persistedQaNg?.remark === 'Báo phòng quản lý chất lượng',
      'qa_ng_details keeps "remark" as a separate field, not replacing or conflating with cause'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Close Job Snapshot Check (cause preserved in qa_ng_details snapshot)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Close Operation & Final Report Snapshot Verification ---');

    // Close operation
    const { data: closeOpRes, error: closeOpErr } = await adminClient.rpc('close_job_operation', {
      p_operation_id: testOp.id,
    });
    assert(!closeOpErr && closeOpRes?.success, 'close_job_operation succeeded', closeOpErr?.message);

    // Close job
    const { data: closeJobRes, error: closeJobErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJob.id,
      p_confirm_ticket: testJob.job_no,
      p_close_reason: 'Hoàn tất nghiệm thu kiểm tra R3 FIX 04 và 05 trên Staging',
      p_acknowledged_warnings: [],
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'Đánh giá kỹ thuật hoàn hảo. 8 danh mục NG chuẩn hóa và Enter key không lỗi.',
    });
    assert(!closeJobErr && closeJobRes?.success, 'close_job_final succeeded', closeJobErr?.message);

    // Query sample_final_reports snapshot
    const { data: finalReport, error: repErr } = await adminClient
      .from('sample_final_reports')
      .select('snapshot_data')
      .eq('job_id', testJob.id)
      .single();

    assert(!repErr && finalReport, 'Query final report snapshot', repErr?.message);

    const snapshotOps = finalReport?.snapshot_data?.operations || [];
    const targetSnapOp = snapshotOps.find((o) => (o.operation_id || o.id) === testOp.id);
    assert(targetSnapOp, 'Snapshot contains target operation');

    const snapQaNg = targetSnapOp?.qa_ng_details || [];
    assert(snapQaNg.length > 0, 'Snapshot contains qa_ng_details entries');
    const targetQng = snapQaNg.find((q) => q.defect_name === 'Lỗi khác');
    assert(
      targetQng && targetQng.cause === 'Bề mặt bị xỉn màu do dung dịch tưới nguội pha sai tỷ lệ',
      'Final report immutable snapshot preserves qa_ng_details "cause" field'
    );

    // Clean up test records (safe staging only)
    await adminClient.from('sample_final_reports').delete().eq('job_id', testJob.id);
    await adminClient.from('qa_ng_details').delete().eq('operation_id', testOp.id);
    await adminClient.from('ng_details').delete().eq('production_run_id', mfgAcceptData?.production_run_id);
    await adminClient.from('production_runs').delete().eq('operation_id', testOp.id);
    await adminClient.from('qa_checks').delete().eq('operation_id', testOp.id);
    await adminClient.from('job_operations').delete().eq('id', testOp.id);
    await adminClient.from('jobs').delete().eq('id', testJob.id);

    console.log('\n================================================================================');
    console.log(`   LIVE VERIFICATION RESULTS: ${passed}/${total} CHECKS PASSED`);
    console.log('================================================================================\n');

    if (passed === total) {
      console.log('🎉 ALL LIVE CHECKS PASSED ON STAGING (hosppagbopdghlupnhlr)!');
      process.exit(0);
    } else {
      console.error(`❌ SOME CHECKS FAILED (${total - passed} failed)`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during live verification:', err);
    process.exit(1);
  }
}

runLiveVerification();
