/**
 * SAMPLE TRACKING — UI-04: Live Verification Script
 * Tests Supabase schema, atomic RPCs, production result, kiv_qty, ng_details,
 * photo constraints, and role guards on Supabase TEST.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const urlMatch = envContent.match(/VITE_SUPABASE_URL=(.*)/);
const anonMatch = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/);
const serviceMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

const url = urlMatch ? urlMatch[1].trim() : '';
const anonKey = anonMatch ? anonMatch[1].trim() : '';
const serviceKey = serviceMatch ? serviceMatch[1].trim() : '';

const adminClient = createClient(url, serviceKey || anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonClient = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTests() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — UI-04: JOB DETAIL & PRODUCTION RESULT LIVE VERIFICATION');
  console.log('================================================================================\n');

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition, message) {
    totalCount++;
    if (condition) {
      console.log(`✅ PASS [Check ${totalCount}]: ${message}`);
      passedCount++;
    } else {
      console.error(`❌ FAIL [Check ${totalCount}]: ${message}`);
      process.exitCode = 1;
    }
  }

  let createdJobId = null;
  let createdOpId = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Create a Test Job with 2 Operations (OP10, OP20)
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Setup Test JOB with OP10 & OP20 ---');
    const partNo = `PART-UI04-${Date.now()}`;
    const { data: jobRes, error: errJob } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: '',
      p_part_no: partNo,
      p_part_name: 'Trục truyền động UI04',
      p_customer: 'CUST-A',
      p_order_qty: 250,
      p_material: 'SUS304',
      p_material_spec: 'Ø25 x 120mm',
      p_planned_start_date: '2026-10-15',
      p_planned_finish_date: '2026-10-22',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'A20C',
          description: 'Auto Turn',
          planned_cycle_time_seconds: 45,
          machine_no: 'AA08',
          remark: 'Tiện ngoài',
        },
        {
          step_order: 20,
          workcenter_code: 'CGMG',
          description: 'Centerless Grinding',
          planned_cycle_time_seconds: 30,
          machine_no: 'MC-01',
          remark: 'Mài tròn vô tâm',
        },
      ],
    });

    assert(!errJob && jobRes?.id, `Created test job: ${jobRes?.job_no} (ID: ${jobRes?.id})`);
    createdJobId = jobRes?.id;

    // Fetch operations
    const { data: ops, error: errOps } = await adminClient
      .from('job_operations')
      .select('*')
      .eq('job_id', createdJobId)
      .order('step_order', { ascending: true });

    assert(!errOps && ops?.length === 2, `Retrieved 2 routing operations in exact order`);
    assert(ops[0].step_order === 10 && ops[1].step_order === 20, `Step orders are strictly 10 and 20`);
    createdOpId = ops[0].id;

    // ------------------------------------------------------------------------
    // Check 1: Defect Catalog Query
    // ------------------------------------------------------------------------
    console.log('\n--- Step 2: Verify Defect Catalog ---');
    const { data: defects, error: errDefects } = await adminClient
      .from('defect_catalog')
      .select('*')
      .eq('is_active', true);
    assert(!errDefects && defects?.length >= 5, `Defect catalog contains active entries (${defects?.length} items)`);
    const hasDiameter = defects.some((d) => d.name_vi === 'Sai đường kính');
    const hasBurr = defects.some((d) => d.name_vi === 'Bavia');
    assert(hasDiameter && hasBurr, `Catalog includes standard defects: 'Sai đường kính' & 'Bavia'`);

    // ------------------------------------------------------------------------
    // Check 2: Save Production Result with NG Details & KIV
    // ------------------------------------------------------------------------
    console.log('\n--- Step 3: Save Production Result (Machine, Date, CT Actual, OK, KIV, NG Details) ---');
    const ngPayload = [
      {
        defect_name: 'Sai đường kính',
        defect_code: 'DEF-DIM-01',
        ng_qty: 5,
        cause: 'Mòn dao tiện',
        remark: 'Đã thay dao mới',
        photo_urls: ['test/job/NG_PHOTO/photo1.jpg', 'test/job/NG_PHOTO/photo2.jpg'],
      },
      {
        defect_name: 'Bavia',
        defect_code: 'DEF-SRF-01',
        ng_qty: 8,
        cause: 'Tốc độ quay cao',
        remark: 'Cần gọt cạnh',
        photo_urls: [],
      },
    ];

    const { data: mfgSaveRes, error: errMfgSave } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: createdOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-16',
      p_cycle_time: 44.5,
      p_ok_qty: 120,
      p_kiv_qty: 15,
      p_ng_items: ngPayload,
      p_remarks: 'Lượt chạy buổi sáng',
    });

    assert(!errMfgSave && mfgSaveRes?.success, `save_production_result_with_ng executed successfully`);
    assert(mfgSaveRes?.ok_qty === 120, `OK quantity stored correctly (120)`);
    assert(mfgSaveRes?.kiv_qty === 15, `KIV quantity stored correctly (15)`);
    assert(mfgSaveRes?.total_ng === 13, `Total NG automatically summed from NG items (5 + 8 = 13)`);
    assert(mfgSaveRes?.ng_qty === 13, `Production run ng_qty matches total NG (13)`);

    // ------------------------------------------------------------------------
    // Check 3: Read Back from Supabase (Persistence & Separation of Cause and Remark)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 4: Verify Persistence & Field Separation ---');
    const { data: savedRun, error: errSavedRun } = await adminClient
      .from('production_runs')
      .select('*, ng_details(*)')
      .eq('operation_id', createdOpId)
      .single();

    assert(!errSavedRun && savedRun, `Fetched saved production run record from database`);
    assert(savedRun.machine_id === 'AA08', `Machine ID persisted accurately: ${savedRun.machine_id}`);
    assert(savedRun.kiv_qty === 15, `KIV quantity persisted accurately: ${savedRun.kiv_qty}`);
    assert(savedRun.ng_qty === 13, `Total NG persisted accurately: ${savedRun.ng_qty}`);
    assert(savedRun.ng_details?.length === 2, `Retrieved 2 associated NG detail rows`);

    const ngRow1 = savedRun.ng_details.find((d) => d.defect_name === 'Sai đường kính');
    assert(
      ngRow1?.cause === 'Mòn dao tiện' && ngRow1?.remark === 'Đã thay dao mới',
      `Cause ("${ngRow1?.cause}") and Remark ("${ngRow1?.remark}") are strictly stored in separate columns`
    );
    assert(
      ngRow1?.photo_urls?.length === 2,
      `Photo URLs array contains 2 photo links (${ngRow1?.photo_urls?.length})`
    );

    // ------------------------------------------------------------------------
    // Check 4: No Duplicate Runs on Repeated Save (Upsert / Update)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 5: Prevent Duplicate Production Runs on Repeated Save ---');
    const { data: repeatRes, error: errRepeat } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: createdOpId,
      p_machine_id: 'AA08-UPDATED',
      p_production_date: '2026-10-16',
      p_cycle_time: 42.0,
      p_ok_qty: 130,
      p_kiv_qty: 10,
      p_ng_items: [
        {
          defect_name: 'Sai đường kính',
          defect_code: 'DEF-DIM-01',
          ng_qty: 6,
          cause: 'Mòn dao',
          remark: 'Đã thay',
          photo_urls: ['test/job/NG_PHOTO/photo1.jpg'],
        },
      ],
      p_remarks: 'Cập nhật số liệu',
    });

    assert(!errRepeat && repeatRes?.success, `Repeated save completed successfully`);
    const { data: allRunsForOp } = await adminClient
      .from('production_runs')
      .select('id')
      .eq('operation_id', createdOpId);
    assert(allRunsForOp?.length === 1, `Exactly 1 production run exists for operation (0 duplicate runs created)`);
    assert(repeatRes.total_ng === 6, `Total NG updated immediately on change (6)`);

    // ------------------------------------------------------------------------
    // Check 5: QA Check & Completion Rule Verification
    // ------------------------------------------------------------------------
    console.log('\n--- Step 6: QA Inspection & Operation Completion Rule ---');
    const { data: qaRes, error: errQa } = await adminClient.rpc('save_qa_check_result', {
      p_operation_id: createdOpId,
      p_result: 'OK',
      p_sample_size: 10,
      p_ok_qty: 10,
      p_ng_qty: 0,
      p_notes: 'Thẩm định kích thước đạt yêu cầu kỹ thuật',
    });

    if (errQa) console.log('DEBUG errQa:', errQa);
    assert(!errQa && qaRes?.result === 'OK', `save_qa_check_result executed successfully with result OK`);

    // Verify operation status transitioned to COMPLETED (since Production OK = 130 > 0 AND QA = OK)
    const { data: updatedOp } = await adminClient
      .from('job_operations')
      .select('status')
      .eq('id', createdOpId)
      .single();
    assert(updatedOp?.status === 'COMPLETED', `Operation status updated to COMPLETED (Prod OK > 0 and QA OK)`);

    // ------------------------------------------------------------------------
    // Check 6: Closed Job Cannot be Edited (Job Close Guard)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 7: Closed Job Protection Guard ---');
    await adminClient.from('jobs').update({ status: 'CLOSE' }).eq('id', createdJobId);

    const { error: errClosedMfg } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: createdOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-16',
      p_cycle_time: 40,
      p_ok_qty: 10,
      p_kiv_qty: 0,
      p_ng_items: [],
    });
    assert(Boolean(errClosedMfg), `Save production result on CLOSE job is strictly rejected`);

    const { error: errClosedQa } = await adminClient.rpc('save_qa_check_result', {
      p_operation_id: createdOpId,
      p_result: 'OK',
      p_sample_size: 5,
      p_ok_qty: 5,
      p_ng_qty: 0,
    });
    assert(Boolean(errClosedQa), `Save QA check on CLOSE job is strictly rejected`);

    // ------------------------------------------------------------------------
    // Check 7: Role Authorization Guards (Anonymous / Unauthorized rejection)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 8: Role Authorization Guards ---');
    const { error: errAnonMfg } = await anonClient.rpc('save_production_result_with_ng', {
      p_operation_id: createdOpId,
      p_machine_id: 'AA08',
      p_production_date: '2026-10-16',
      p_cycle_time: 40,
      p_ok_qty: 10,
      p_kiv_qty: 0,
      p_ng_items: [],
    });
    assert(Boolean(errAnonMfg), `Anonymous caller is strictly rejected from save_production_result_with_ng`);

    const { error: errAnonQa } = await anonClient.rpc('save_qa_check_result', {
      p_operation_id: createdOpId,
      p_result: 'OK',
      p_sample_size: 5,
      p_ok_qty: 5,
      p_ng_qty: 0,
    });
    assert(Boolean(errAnonQa), `Anonymous caller is strictly rejected from save_qa_check_result`);

  } catch (err) {
    console.error('Fatal execution error:', err);
    process.exitCode = 1;
  } finally {
    // Clean up test data
    if (createdJobId) {
      console.log('\n--- Cleaning up test records ---');
      await adminClient.from('ng_details').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await adminClient.from('qa_checks').delete().eq('operation_id', createdOpId);
      await adminClient.from('production_runs').delete().eq('operation_id', createdOpId);
      await adminClient.from('job_operations').delete().eq('job_id', createdJobId);
      await adminClient.from('jobs').delete().eq('id', createdJobId);
      console.log('Cleaned up test job and relations.');
    }
  }

  console.log('\n================================================================================');
  console.log(`RESULTS: ${passedCount} / ${totalCount} CHECKS PASSED`);
  console.log('================================================================================');
}

runTests();
