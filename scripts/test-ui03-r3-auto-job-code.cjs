/**
 * SAMPLE TRACKING — UI-03 R3: Live Auto Job Code Generation Verification
 * Tests all 11 backend/database requirements against Supabase TEST.
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
  console.log('   SAMPLE TRACKING — UI-03 R3: AUTOMATIC JOB CODE LIVE VERIFICATION');
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

  try {
    // ------------------------------------------------------------------------
    // Check 1: Preview code generation without mutating counter
    // ------------------------------------------------------------------------
    console.log('--- Test 1: Preview Job Code (Non-Mutating) ---');
    const { data: preview1, error: errPreview1 } = await anonClient.rpc('preview_next_job_code');
    assert(!errPreview1 && preview1 && /^[0-9]{6}-[0-9]{3,}$/.test(preview1), `Preview code format is valid: ${preview1}`);

    const { data: preview2, error: errPreview2 } = await anonClient.rpc('preview_next_job_code');
    assert(preview1 === preview2, `Preview is non-mutating (preview1 === preview2: ${preview1})`);

    // ------------------------------------------------------------------------
    // Check 2: Sequential increment for current month
    // ------------------------------------------------------------------------
    console.log('\n--- Test 2: Sequential Increment in Current Month ---');
    const { data: code1, error: errCode1 } = await adminClient.rpc('allocate_next_job_code');
    assert(!errCode1 && code1, `Allocated first code: ${code1}`);

    const { data: code2, error: errCode2 } = await adminClient.rpc('allocate_next_job_code');
    assert(!errCode2 && code2, `Allocated second code: ${code2}`);

    const seq1 = parseInt(code1.split('-')[1], 10);
    const seq2 = parseInt(code2.split('-')[1], 10);
    assert(seq2 === seq1 + 1, `Second code correctly increments by 1 (${seq1} -> ${seq2})`);

    // ------------------------------------------------------------------------
    // Check 3: Month transition restarts sequence at 001
    // ------------------------------------------------------------------------
    console.log('\n--- Test 3: Month Transition Starts from 001 ---');
    const futureMonthTimestamp = '2028-05-15T10:00:00+07:00'; // Unique future month
    const { data: monthCode1, error: errMonth1 } = await adminClient.rpc('allocate_next_job_code', {
      p_target_timestamp: futureMonthTimestamp,
    });
    assert(!errMonth1 && monthCode1 === '202805-001', `Fresh month begins strictly at 001: ${monthCode1}`);

    const { data: monthCode2, error: errMonth2 } = await adminClient.rpc('allocate_next_job_code', {
      p_target_timestamp: futureMonthTimestamp,
    });
    assert(!errMonth2 && monthCode2 === '202805-002', `Second in fresh month increments to 002: ${monthCode2}`);

    // Clean up sequence record for 202805
    await adminClient.from('job_code_sequences').delete().eq('year_month', '202805');

    // ------------------------------------------------------------------------
    // Check 4: Sequence transition from 999 to 1000
    // ------------------------------------------------------------------------
    console.log('\n--- Test 4: Sequence Transition 999 -> 1000 Unbounded ---');
    const testYearMonth = '202809';
    await adminClient.from('job_code_sequences').upsert({
      year_month: testYearMonth,
      last_seq: 999,
      updated_at: new Date().toISOString(),
    });

    const { data: code1000, error: err1000 } = await adminClient.rpc('allocate_next_job_code', {
      p_target_timestamp: '2028-09-10T12:00:00+07:00',
    });
    assert(!err1000 && code1000 === '202809-1000', `Transition from 999 to 1000 succeeds without capping: ${code1000}`);

    const { data: code1001, error: err1001 } = await adminClient.rpc('allocate_next_job_code', {
      p_target_timestamp: '2028-09-10T12:00:00+07:00',
    });
    assert(!err1001 && code1001 === '202809-1001', `Subsequent code continues sequentially: ${code1001}`);

    // Clean up sequence record for 202809
    await adminClient.from('job_code_sequences').delete().eq('year_month', testYearMonth);

    // ------------------------------------------------------------------------
    // Check 5: Concurrency Safety (10 Simultaneous Callers)
    // ------------------------------------------------------------------------
    console.log('\n--- Test 5: Concurrency Safety (10 Simultaneous Requests) ---');
    const concurrentMonth = '202811';
    const promises = Array.from({ length: 10 }).map(() =>
      adminClient.rpc('allocate_next_job_code', {
        p_target_timestamp: '2028-11-20T08:00:00+07:00',
      })
    );

    const results = await Promise.all(promises);
    const codes = results.map((r) => r.data).filter(Boolean);
    const uniqueCodes = new Set(codes);

    assert(codes.length === 10, `All 10 concurrent requests returned successfully (got ${codes.length})`);
    assert(uniqueCodes.size === 10, `All 10 concurrently generated codes are strictly unique (0 collision)`);

    // Clean up sequence record for 202811
    await adminClient.from('job_code_sequences').delete().eq('year_month', concurrentMonth);

    // ------------------------------------------------------------------------
    // Check 6: Role Guard (Unauthorized Caller Rejection)
    // ------------------------------------------------------------------------
    console.log('\n--- Test 6: Role Authorization Guard ---');
    const { data: anonAlloc, error: errAnonAlloc } = await anonClient.rpc('allocate_next_job_code');
    assert(
      Boolean(errAnonAlloc) || anonAlloc === null,
      `Anonymous or unauthorized caller is strictly rejected from allocating code`
    );

    // ------------------------------------------------------------------------
    // Check 7: create_job_with_routing Atomically Issues Code & Persists
    // ------------------------------------------------------------------------
    console.log('\n--- Test 7: create_job_with_routing Full Lifecycle ---');
    const testPartNo = `PART-TEST-${Date.now()}`;
    const { data: createdJob, error: errCreate } = await adminClient.rpc('create_job_with_routing', {
      p_job_no: 'CLIENT_ATTEMPTED_OVERRIDE_CODE', // Server MUST override this
      p_part_no: testPartNo,
      p_part_name: 'Test Part Name',
      p_customer: 'A',
      p_order_qty: 100,
      p_material: 'SUS304',
      p_material_spec: 'Ø20',
      p_planned_start_date: '2026-10-15',
      p_planned_finish_date: '2026-10-20',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'A20C',
          description: 'Auto Turn',
          planned_cycle_time_seconds: 45,
          machine_no: 'AA08',
          remark: 'Test note',
        },
        {
          step_order: 20,
          workcenter_code: 'CGMG',
          description: 'Centerless Grinding',
          planned_cycle_time_seconds: null,
          machine_no: null,
          remark: null,
        },
      ],
    });

    assert(!errCreate && createdJob, `create_job_with_routing completed successfully`);
    assert(
      createdJob.job_no !== 'CLIENT_ATTEMPTED_OVERRIDE_CODE',
      `Client override attempt was strictly ignored; assigned server code: ${createdJob.job_no}`
    );
    assert(
      /^[0-9]{6}-[0-9]{3,}$/.test(createdJob.job_no),
      `Server-assigned job_no complies with YYYYMM-NNN format: ${createdJob.job_no}`
    );

    // Clean up created test job and its operations
    if (createdJob?.id) {
      await adminClient.from('job_operations').delete().eq('job_id', createdJob.id);
      await adminClient.from('jobs').delete().eq('id', createdJob.id);
    }

  } catch (err) {
    console.error('Fatal execution error:', err);
    process.exitCode = 1;
  }

  console.log('\n================================================================================');
  console.log(`RESULTS: ${passedCount} / ${totalCount} CHECKS PASSED`);
  console.log('================================================================================');
}

runTests();
