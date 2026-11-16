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

async function runLiveVerification() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — R4 ROUTING & HOMEPAGE: LIVE STAGING VERIFICATION');
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

  let createdJobId = null;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Workcenter CYGG Description in public.workcenter_master
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Workcenter Master CYGG and A20C Descriptions ---');
    const { data: cyggData, error: cyggErr } = await adminClient
      .from('workcenter_master')
      .select('code, description, mc_type')
      .eq('code', 'CYGG');

    assert(!cyggErr, 'Query workcenter_master for CYGG without error', cyggErr?.message);
    assert(cyggData && cyggData.length > 0, 'CYGG exists in workcenter_master');
    const cygg = cyggData && cyggData[0];
    assert(cygg?.description === 'Cylindrical Grinding', 'CYGG description is "Cylindrical Grinding"', cygg?.description);
    assert(cygg?.mc_type === 'Cylindrical Grinding', 'CYGG mc_type is "Cylindrical Grinding"', cygg?.mc_type);

    const { data: a20cData } = await adminClient
      .from('workcenter_master')
      .select('code, description')
      .eq('code', 'A20C');
    assert(a20cData && a20cData[0]?.description === 'Auto Turn', 'A20C description is "Auto Turn"');

    // -------------------------------------------------------------------------
    // TEST 2: Backend create_job_with_routing Mandatory CT Target on Auto Turn
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: create_job_with_routing CT Target Validation ---');

    // Case 2A: Reject Auto Turn (A20C) when CT Target is NULL
    const { error: rejectNullCtErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: null,
      p_part_no: 'PART-R4-TEST-1',
      p_part_name: 'Chi tiết test R4 Auto Turn CT null',
      p_customer: 'TEST-CORP',
      p_order_qty: 100,
      p_material: 'SUS304',
      p_material_spec: 'Ø12',
      p_planned_start_date: '2026-11-02',
      p_planned_finish_date: '2026-11-09',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'A20C', // Auto Turn
          description: 'Auto Turn',
          planned_cycle_time_seconds: null,
        },
      ],
    });

    assert(
      rejectNullCtErr && rejectNullCtErr.message.includes('bắt buộc phải có Thời gian chu kỳ mục tiêu'),
      'create_job_with_routing rejects Auto Turn with null CT Target',
      rejectNullCtErr?.message
    );

    // Case 2B: Reject Auto Turn (A20C) when CT Target <= 0
    const { error: rejectZeroCtErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: null,
      p_part_no: 'PART-R4-TEST-2',
      p_part_name: 'Chi tiết test R4 Auto Turn CT zero',
      p_customer: 'TEST-CORP',
      p_order_qty: 100,
      p_material: 'SUS304',
      p_material_spec: 'Ø12',
      p_planned_start_date: '2026-11-02',
      p_planned_finish_date: '2026-11-09',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'A20C', // Auto Turn
          description: 'Auto Turn',
          planned_cycle_time_seconds: 0,
        },
      ],
    });

    assert(
      rejectZeroCtErr && (rejectZeroCtErr.message.includes('bắt buộc phải có Thời gian chu kỳ mục tiêu') || rejectZeroCtErr.message.includes('số dương lớn hơn 0')),
      'create_job_with_routing rejects Auto Turn with CT Target <= 0',
      rejectZeroCtErr?.message
    );

    // Case 2C: Accept Auto Turn when valid CT Target > 0 is provided
    const { data: acceptJobData, error: acceptJobErr } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: null,
      p_part_no: 'PART-R4-VALID-CT',
      p_part_name: 'Chi tiết test R4 Auto Turn hợp lệ',
      p_customer: 'TEST-CORP',
      p_order_qty: 100,
      p_material: 'SUS304',
      p_material_spec: 'Ø12',
      p_planned_start_date: '2026-11-02',
      p_planned_finish_date: '2026-11-09',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'A20C', // Auto Turn
          description: 'Auto Turn',
          planned_cycle_time_seconds: 42.5,
        },
        {
          step_order: 20,
          workcenter_code: 'CYGG', // Cylindrical Grinding - non-Auto Turn
          description: 'Cylindrical Grinding',
          planned_cycle_time_seconds: null, // non-Auto Turn allows null CT
        },
      ],
    });

    assert(!acceptJobErr && acceptJobData?.success, 'create_job_with_routing succeeds with valid Auto Turn CT Target', acceptJobErr?.message);
    createdJobId = acceptJobData?.job_id;

    // Case 2D: Verify non-Auto Turn (CYGG) was created with NULL cycle time without error
    const { data: createdOps } = await adminClient
      .from('job_operations')
      .select('id, step_order, workcenter_code, description, planned_cycle_time_seconds')
      .eq('job_id', createdJobId)
      .order('step_order', { ascending: true });

    assert(createdOps && createdOps.length === 2, 'Created job contains exactly 2 operations');
    const cyggOp = createdOps?.find((o) => o.workcenter_code === 'CYGG');
    assert(cyggOp && cyggOp.planned_cycle_time_seconds === null, 'CYGG operation preserves null CT Target without breaking');

    // -------------------------------------------------------------------------
    // TEST 3: update_job_planning_and_routing CT Target Validation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: update_job_planning_and_routing CT Target Validation ---');

    // Case 3A: Reject update when Auto Turn CT Target is cleared to null
    const { error: updateRejectErr } = await adminClient.rpc('update_job_planning_and_routing', {
      p_job_id: createdJobId,
      p_part_no: 'PART-R4-VALID-CT',
      p_part_name: 'Chi tiết test R4 Auto Turn hợp lệ',
      p_customer: 'TEST-CORP',
      p_order_qty: 120,
      p_material: 'SUS304',
      p_material_spec: 'Ø12',
      p_planned_start_date: '2026-11-02',
      p_planned_finish_date: '2026-11-10',
      p_operations: [
        {
          id: createdOps[0].id,
          step_order: 10,
          workcenter_code: 'A20C',
          description: 'Auto Turn',
          planned_cycle_time_seconds: null, // Attempt to clear CT Target -> must be rejected
        },
        {
          id: createdOps[1].id,
          step_order: 20,
          workcenter_code: 'CYGG',
          description: 'Cylindrical Grinding',
          planned_cycle_time_seconds: null,
        },
      ],
    });

    assert(
      updateRejectErr && updateRejectErr.message.includes('bắt buộc phải có Thời gian chu kỳ mục tiêu'),
      'update_job_planning_and_routing rejects clearing Auto Turn CT Target',
      updateRejectErr?.message
    );

    // Case 3B: Accept update when Auto Turn CT Target is valid
    const { data: updateAcceptData, error: updateAcceptErr } = await adminClient.rpc('update_job_planning_and_routing', {
      p_job_id: createdJobId,
      p_part_no: 'PART-R4-VALID-CT',
      p_part_name: 'Chi tiết test R4 Auto Turn hợp lệ - Updated',
      p_customer: 'TEST-CORP',
      p_order_qty: 120,
      p_material: 'SUS304',
      p_material_spec: 'Ø12',
      p_planned_start_date: '2026-11-02',
      p_planned_finish_date: '2026-11-10',
      p_operations: [
        {
          id: createdOps[0].id,
          step_order: 10,
          workcenter_code: 'A20C',
          description: 'Auto Turn',
          planned_cycle_time_seconds: 50.0,
        },
        {
          id: createdOps[1].id,
          step_order: 20,
          workcenter_code: 'CYGG',
          description: 'Cylindrical Grinding',
          planned_cycle_time_seconds: null,
        },
      ],
    });

    assert(!updateAcceptErr && updateAcceptData?.success, 'update_job_planning_and_routing succeeds with valid CT Target', updateAcceptErr?.message);

    // -------------------------------------------------------------------------
    // TEST 4: Actual Close Field in Database Schema (closed_at)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: jobs.closed_at Schema and Actual Close Verification ---');

    const { data: jobBeforeClose } = await adminClient
      .from('jobs')
      .select('status, closed_at')
      .eq('id', createdJobId)
      .single();

    assert(jobBeforeClose?.status === 'ACTIVE', 'Job status is ACTIVE before close');
    assert(jobBeforeClose?.closed_at === null, 'Job closed_at is NULL while ACTIVE (never guessed)');

    // Close both operations before closing the overall job
    const op1 = createdOps[0];
    const op2 = createdOps[1];

    // OP 10: Auto Turn requires CT actual > 0
    const { error: run1Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op1.id,
      p_machine_id: 'CNC-R4',
      p_production_date: '2026-11-02',
      p_cycle_time: 48.0, // CT actual > 0
      p_ok_qty: 120,
      p_kiv_qty: 0,
      p_ng_items: [],
    });
    assert(!run1Err, 'Save production result for OP 10 succeeds', run1Err?.message);

    const { error: closeOp1Err } = await adminClient.rpc('close_job_operation', { p_operation_id: op1.id });
    assert(!closeOp1Err, 'Close operation 10 (Auto Turn) succeeds with CT > 0', closeOp1Err?.message);

    // OP 20: Non-Auto Turn allows null CT
    const { error: run2Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op2.id,
      p_machine_id: 'GRIND-01',
      p_production_date: '2026-11-02',
      p_cycle_time: null, // non-Auto Turn allows null CT
      p_ok_qty: 120,
      p_kiv_qty: 0,
      p_ng_items: [],
    });
    assert(!run2Err, 'Save production result for OP 20 succeeds with null CT', run2Err?.message);

    const { error: closeOp2Err } = await adminClient.rpc('close_job_operation', { p_operation_id: op2.id });
    assert(!closeOp2Err, 'Close operation 20 (Cylindrical Grinding) succeeds', closeOp2Err?.message);

    const { data: closeJobRes, error: closeJobErr } = await adminClient.rpc('close_job_final', {
      p_job_id: createdJobId,
      p_confirm_ticket: acceptJobData.job_no,
      p_close_reason: 'Kiểm thử R4 nghiệm thu Live Staging',
      p_acknowledged_warnings: [],
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'R4 Routing & Homepage Live Test hoàn tất',
    });

    assert(!closeJobErr && closeJobRes?.success, 'close_job_final executed successfully', closeJobErr?.message);

    const { data: jobAfterClose } = await adminClient
      .from('jobs')
      .select('status, closed_at')
      .eq('id', createdJobId)
      .single();

    assert(jobAfterClose?.status === 'CLOSE', 'Job status transitioned to CLOSE');
    assert(jobAfterClose?.closed_at !== null, 'Job closed_at is accurately populated on CLOSE', jobAfterClose?.closed_at);

    // Clean up staging test records
    await adminClient.from('sample_final_reports').delete().eq('job_id', createdJobId);
    await adminClient.from('production_runs').delete().in('operation_id', [op1.id, op2.id]);
    await adminClient.from('job_operations').delete().eq('job_id', createdJobId);
    await adminClient.from('jobs').delete().eq('id', createdJobId);

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
    if (createdJobId) {
      await adminClient.from('sample_final_reports').delete().eq('job_id', createdJobId).catch(() => {});
      await adminClient.from('job_operations').delete().eq('job_id', createdJobId).catch(() => {});
      await adminClient.from('jobs').delete().eq('id', createdJobId).catch(() => {});
    }
    process.exit(1);
  }
}

runLiveVerification();
