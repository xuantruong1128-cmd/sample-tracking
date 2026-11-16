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

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase configuration in .env');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLiveVerification() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — R3 MINOR FIXES: LIVE STAGING VERIFICATION');
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

  const runId = 'r3_' + Date.now().toString(36);
  const createdJobIds = [];

  try {
    // -------------------------------------------------------------------------
    // PART 1: FIX 01 — Workcenter CYGG Description Verification
    // -------------------------------------------------------------------------
    console.log('--- PART 1: FIX 01 — Workcenter Master Mapping ---');

    const { data: cyggData, error: cyggErr } = await adminClient
      .from('workcenter_master')
      .select('*')
      .eq('code', 'CYGG');

    assert(!cyggErr && cyggData && cyggData.length > 0, 'CYGG exists in public.workcenter_master', cyggErr?.message);
    assert(
      cyggData && cyggData[0].description === 'Cylindrical Grinding',
      'CYGG description is "Cylindrical Grinding" (NOT "Auto Turn")',
      cyggData?.[0]?.description
    );
    assert(
      cyggData && cyggData[0].mc_type === 'Cylindrical Grinding',
      'CYGG mc_type is "Cylindrical Grinding"',
      cyggData?.[0]?.mc_type
    );

    const { data: a20cData, error: a20cErr } = await adminClient
      .from('workcenter_master')
      .select('*')
      .eq('code', 'A20C');

    assert(!a20cErr && a20cData && a20cData.length > 0, 'A20C exists in public.workcenter_master', a20cErr?.message);
    assert(
      a20cData && a20cData[0].description === 'Auto Turn',
      'A20C retains description "Auto Turn"',
      a20cData?.[0]?.description
    );

    const { data: allWc, error: allWcErr } = await adminClient
      .from('workcenter_master')
      .select('code, description, mc_type')
      .order('id');

    assert(!allWcErr && allWc && allWc.length === 37, 'All 37 official workcenters exist in master data', `Count: ${allWc?.length}`);

    // Verify all 37 workcenters have non-empty description
    const emptyDesc = (allWc || []).filter((w) => !w.description || w.description.trim() === '');
    assert(emptyDesc.length === 0, 'Zero workcenters have empty description', `Empty count: ${emptyDesc.length}`);

    // Verify CGMG is Centerless Grinding, D&TS is Drill & Tap, etc.
    const cgmg = (allWc || []).find((w) => w.code === 'CGMG');
    assert(cgmg && cgmg.description === 'Centerless Grinding', 'CGMG is Centerless Grinding', cgmg?.description);

    const dts = (allWc || []).find((w) => w.code === 'D&TS');
    assert(dts && dts.description === 'Drill & Tap', 'D&TS is Drill & Tap', dts?.description);

    // -------------------------------------------------------------------------
    // PART 2: FIX 02 — Auto Turn Mandatory Cycle Time Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- PART 2: FIX 02 — Mandatory Cycle Time for Auto Turn ---');

    // 2.1 Create a test JOB with Auto Turn operation (A20C)
    const testJobNo = `TEST-R3-AT-${Date.now().toString().slice(-6)}`;
    const { data: newJob, error: newJobErr } = await adminClient
      .from('jobs')
      .insert({
        job_no: testJobNo,
        part_no: 'PART-R3-AT',
        part_name: 'Test Auto Turn CT Actual',
        customer: 'CUST-TEST',
        material: 'SUS304',
        order_qty: 100,
        planned_start_date: '2026-10-15',
        planned_finish_date: '2026-10-25',
        status: 'ACTIVE',
      })
      .select()
      .single();

    assert(!newJobErr && newJob, 'Created test JOB for Auto Turn check', newJobErr?.message);
    if (!newJob) throw new Error('Failed to create test job: ' + newJobErr?.message);
    createdJobIds.push(newJob.id);

    // Create Auto Turn operation
    const { data: autoTurnOp, error: atOpErr } = await adminClient
      .from('job_operations')
      .insert({
        job_id: newJob.id,
        step_order: 10,
        operation_name: 'Auto Turn',
        workcenter_code: 'A20C',
        description: 'Auto Turn',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    assert(!atOpErr && autoTurnOp, 'Created Auto Turn operation (A20C)', atOpErr?.message);

    // Add production run WITHOUT Cycle Time (cycle_time_seconds = NULL)
    const { data: runWithoutCt, error: runWithoutCtErr } = await adminClient
      .from('production_runs')
      .insert({
        operation_id: autoTurnOp.id,
        machine_id: 'AA08',
        start_time: '2026-10-15T08:00:00Z',
        end_time: '2026-10-15T16:00:00Z',
        production_date: new Date().toISOString().split('T')[0],
        cycle_time_seconds: null,
        ok_qty: 90,
        ng_qty: 5,
        kiv_qty: 5,
      })
      .select()
      .single();

    assert(!runWithoutCtErr && runWithoutCt, 'Added Production Run with cycle_time_seconds = NULL', runWithoutCtErr?.message);

    // Transition operation to IN_PROGRESS as production has started
    await adminClient
      .from('job_operations')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', autoTurnOp.id);

    // Attempt to close Auto Turn operation via close_job_operation RPC -> MUST FAIL
    const { data: closeRes1, error: closeErr1 } = await adminClient.rpc('close_job_operation', {
      p_operation_id: autoTurnOp.id,
    });

    const expectedErrorMsg = 'Không thể đóng công đoạn Auto Turn. PE-MFG phải nhập Cycle Time thực tế (CT Actual) trước khi đóng.';
    const actualErrorMsg = closeErr1?.message || '';
    assert(
      closeErr1 && actualErrorMsg.includes(expectedErrorMsg),
      'close_job_operation REJECTS Auto Turn when CT Actual is NULL with exact required message',
      actualErrorMsg
    );

    // Attempt to close with cycle_time_seconds = 0 -> MUST ALSO FAIL
    await adminClient
      .from('production_runs')
      .update({ cycle_time_seconds: 0 })
      .eq('id', runWithoutCt.id);

    const { data: closeRes2, error: closeErr2 } = await adminClient.rpc('close_job_operation', {
      p_operation_id: autoTurnOp.id,
    });

    assert(
      closeErr2 && (closeErr2.message || '').includes(expectedErrorMsg),
      'close_job_operation REJECTS Auto Turn when CT Actual is 0',
      closeErr2?.message
    );

    // Now update production run with valid CT Actual > 0 (e.g. 42.5s)
    const { error: updateCtErr } = await adminClient
      .from('production_runs')
      .update({ cycle_time_seconds: 42.5 })
      .eq('id', runWithoutCt.id);

    assert(!updateCtErr, 'Updated production run with cycle_time_seconds = 42.5', updateCtErr?.message);

    // Attempt to close Auto Turn operation again -> MUST SUCCEED
    const { data: closeRes3, error: closeErr3 } = await adminClient.rpc('close_job_operation', {
      p_operation_id: autoTurnOp.id,
    });

    assert(!closeErr3 && closeRes3?.success === true, 'close_job_operation SUCCEEDS for Auto Turn with CT Actual > 0', closeErr3?.message);
    assert(closeRes3?.snapshot?.cycle_time_seconds === 42.5, 'Closed snapshot records valid cycle_time_seconds = 42.5', JSON.stringify(closeRes3?.snapshot));

    // Verify operation status in database is now CLOSED
    const { data: verifiedOp } = await adminClient
      .from('job_operations')
      .select('status, closed_at, closed_snapshot')
      .eq('id', autoTurnOp.id)
      .single();

    assert(verifiedOp && verifiedOp.status === 'CLOSED', 'Operation status in DB updated to CLOSED', verifiedOp?.status);

    // -------------------------------------------------------------------------
    // PART 3: FIX 02 — Non-Auto Turn (CYGG) does NOT require Cycle Time
    // -------------------------------------------------------------------------
    console.log('\n--- PART 3: FIX 02 — Non-Auto Turn (CYGG) Closes Without CT ---');

    const testJobNo2 = `TEST-R3-CYGG-${Date.now().toString().slice(-6)}`;
    const { data: newJob2, error: newJobErr2 } = await adminClient
      .from('jobs')
      .insert({
        job_no: testJobNo2,
        part_no: 'PART-R3-CYGG',
        part_name: 'Test CYGG Non-Auto Turn',
        customer: 'CUST-TEST',
        material: 'SUS304',
        order_qty: 100,
        planned_start_date: '2026-10-15',
        planned_finish_date: '2026-10-25',
        status: 'ACTIVE',
      })
      .select()
      .single();

    assert(!newJobErr2 && newJob2, 'Created test JOB for CYGG check', newJobErr2?.message);
    if (!newJob2) throw new Error('Failed to create test job 2: ' + newJobErr2?.message);
    createdJobIds.push(newJob2.id);

    // Create CYGG operation
    const { data: cyggOp, error: cyggOpErr } = await adminClient
      .from('job_operations')
      .insert({
        job_id: newJob2.id,
        step_order: 10,
        operation_name: 'Cylindrical Grinding',
        workcenter_code: 'CYGG',
        description: 'Cylindrical Grinding',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    assert(!cyggOpErr && cyggOp, 'Created CYGG operation', cyggOpErr?.message);

    // Add production run WITHOUT Cycle Time
    const { data: cyggRun, error: cyggRunErr } = await adminClient
      .from('production_runs')
      .insert({
        operation_id: cyggOp.id,
        machine_id: 'CY01',
        start_time: '2026-10-15T09:00:00Z',
        end_time: '2026-10-15T17:00:00Z',
        production_date: new Date().toISOString().split('T')[0],
        cycle_time_seconds: null,
        ok_qty: 95,
        ng_qty: 5,
        kiv_qty: 0,
      })
      .select()
      .single();

    assert(!cyggRunErr && cyggRun, 'Added CYGG Production Run without Cycle Time', cyggRunErr?.message);

    // Transition operation to IN_PROGRESS as production has started
    await adminClient
      .from('job_operations')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', cyggOp.id);

    // Call close_job_operation -> MUST SUCCEED (CT not required for CYGG)
    const { data: closeCyggRes, error: closeCyggErr } = await adminClient.rpc('close_job_operation', {
      p_operation_id: cyggOp.id,
    });

    assert(!closeCyggErr && closeCyggRes?.success === true, 'close_job_operation SUCCEEDS for CYGG without CT Actual', closeCyggErr?.message);

    // -------------------------------------------------------------------------
    // PART 4: Verification of Data Integrity (Historical Jobs Intact)
    // -------------------------------------------------------------------------
    console.log('\n--- PART 4: Historical Data Integrity ---');

    const { data: closedOps, error: closedOpsErr } = await adminClient
      .from('job_operations')
      .select('id, status, closed_snapshot')
      .eq('status', 'CLOSED')
      .not('id', 'in', `(${autoTurnOp.id},${cyggOp.id})`)
      .limit(5);

    assert(!closedOpsErr, 'Query historical closed operations', closedOpsErr?.message);
    assert(
      (closedOps || []).every((o) => o.status === 'CLOSED'),
      'Historical closed operations remained strictly immutable',
      `Checked ${closedOps?.length} operations`
    );

    // -------------------------------------------------------------------------
    // PART 5: FIX 03 — UI Code Cleanliness Check
    // -------------------------------------------------------------------------
    console.log('\n--- PART 5: FIX 03 — QA N1 Check Sheet Button ---');

    const execPanelContent = fs.readFileSync(
      path.resolve(__dirname, '../src/features/operations/OperationExecutionPanel.tsx'),
      'utf8'
    );

    // Check that Plus icon is not inside N1 upload button
    const hasN1Section = execPanelContent.includes('N1 Check Sheet / Image Upload Button');
    assert(hasN1Section, 'Found N1 Check Sheet upload button in OperationExecutionPanel.tsx');

    // Confirm button text is '+ Check Sheet / Ảnh'
    const hasSinglePlusText = execPanelContent.includes('<span>+ Check Sheet / Ảnh</span>');
    assert(hasSinglePlusText, 'Button contains exact text "<span>+ Check Sheet / Ảnh</span>"');

    // Ensure <Plus ... /> is not adjacent inside the label
    const lines = execPanelContent.split('\n');
    let n1LabelIndex = lines.findIndex((l) => l.includes('N1 Check Sheet / Image Upload Button'));
    let n1Snippet = lines.slice(n1LabelIndex, n1LabelIndex + 20).join('\n');
    const hasDuplicatePlus = n1Snippet.includes('<Plus');
    assert(!hasDuplicatePlus, 'No duplicate <Plus /> icon rendered inside N1 upload button');

  } finally {
    // Clean up created test jobs
    console.log('\n--- Cleaning up test jobs ---');
    for (const jid of createdJobIds) {
      await adminClient.from('jobs').delete().eq('id', jid);
    }
    console.log(`Cleaned up ${createdJobIds.length} test jobs.\n`);
  }

  console.log('================================================================================');
  console.log(`   LIVE VERIFICATION SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('================================================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runLiveVerification().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
