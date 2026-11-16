#!/usr/bin/env node
/**
 * TEST DATABASE LIVE INTEGRATION VERIFICATION: MATERIAL TYPE & SPECIFICATION SPLIT
 * Target: Supabase TEST project (hosppagbopdghlupnhlr) ONLY.
 * Strictly PROHIBITED on Production (uqvxtgvdmdfgtjwzsxlj).
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables
const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('ERROR: .env file not found at:', envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

const supabaseUrl = env.SUPABASE_TEST_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_TEST_SERVICE_KEY;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

// SAFETY CHECK
if (!supabaseUrl.includes('hosppagbopdghlupnhlr')) {
  console.error(`\n🛑 SAFETY BLOCK: Target URL is not TEST project 'hosppagbopdghlupnhlr' (got ${supabaseUrl})`);
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runLiveTest() {
  const runId = crypto.randomBytes(4).toString('hex');
  const bdEmail = `test_bd_mat_${runId}@sampletracking.test`;
  const peEmail = `test_pe_mat_${runId}@sampletracking.test`;
  const testPassword = `TestPass_${runId}!`;

  let bdUserId = null;
  let peUserId = null;
  let issueId = null;

  console.log('========================================================================');
  console.log('  LIVE INTEGRATION TEST: MATERIAL TYPE & SPECIFICATION SPLIT');
  console.log(`  Target: Supabase TEST (${supabaseUrl})`);
  console.log(`  Run ID: ${runId}`);
  console.log('========================================================================\n');

  try {
    // 1. Provision Test Users
    console.log('[1/8] Provisioning temporary BD and PE-MFG users...');
    const { data: bdAuth, error: bdAuthErr } = await adminClient.auth.admin.createUser({
      email: bdEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: `BD Tester ${runId}`, role: 'BD' },
    });
    if (bdAuthErr) throw bdAuthErr;
    bdUserId = bdAuth.user.id;

    await adminClient.from('profiles').insert({
      id: bdUserId,
      email: bdEmail,
      phone: `+84988${Math.floor(100000 + Math.random() * 900000)}`,
      full_name: `BD Tester ${runId}`,
      role: 'BD',
      department: 'Business Development',
      is_active: true,
      must_change_password: false,
    });

    const { data: peAuth, error: peAuthErr } = await adminClient.auth.admin.createUser({
      email: peEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: `PE Tester ${runId}`, role: 'PE-MFG' },
    });
    if (peAuthErr) throw peAuthErr;
    peUserId = peAuth.user.id;

    await adminClient.from('profiles').insert({
      id: peUserId,
      email: peEmail,
      phone: `+84977${Math.floor(100000 + Math.random() * 900000)}`,
      full_name: `PE Tester ${runId}`,
      role: 'PE-MFG',
      department: 'PE-MFG',
      is_active: true,
      must_change_password: false,
    });
    console.log('  ✅ BD and PE-MFG users provisioned successfully.');

    // Create client sessions
    const bdClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await bdClient.auth.signInWithPassword({ email: bdEmail, password: testPassword });

    const peClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await peClient.auth.signInWithPassword({ email: peEmail, password: testPassword });

    // 2. BD issues new Drawing Review request
    console.log('\n[2/8] BD issues new Drawing Review request...');
    const { data: issueRes, error: issueErr } = await bdClient.rpc('create_drawing_review_issue', {
      p_item_no: `MAT-SPLIT-${runId.toUpperCase()}`,
      p_item_name: 'Trục Bạc Inox Test Material Split',
      p_customer: 'Toyota Tsusho Japan',
      p_drawing_file_path: `drawings/test-${runId}.pdf`,
      p_drawing_file_name: `test-${runId}.pdf`,
      p_drawing_file_size: 102400,
      p_drawing_mime_type: 'application/pdf',
      p_attention: 'Yêu cầu kiểm tra phôi trước khi tiện thô'
    });
    if (issueErr) throw issueErr;
    issueId = issueRes.issue_id;
    const v1Id = issueRes.version_id;
    console.log(`  ✅ Issue created: ${issueRes.issue_no} (ID: ${issueId}) with initial version V1 (ID: ${v1Id})`);

    // 3. PE saves draft with Material Type and Material Specification
    console.log('\n[3/8] PE-MFG saves draft with Material Type & Specification...');
    const testMatType = 'SUS316L';
    const testMatSpec = 'Ø19.05 h9 × L3000\nRunout 0.08/400 max\nHardness 22–30 HRC ±0.02';

    const { data: saveRes, error: saveErr } = await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_material_type: testMatType,
      p_material_specification: testMatSpec,
      p_required_tooling: 'Dao tiện rãnh Sandvik CoroCut 2',
      p_special_measuring_equipment: 'Đồng hồ so Mitutoyo 0.001mm',
      p_engineering_remarks: 'Kiểm tra độ đảo sau nhiệt luyện tôi ram',
      p_operations: [
        {
          step_order: 1,
          workcenter_code: 'CNC-01',
          operation_description: 'Tiện thô và tiện tinh 2 đầu trục',
          cycle_time_seconds: 145,
          remark: 'Tưới nguội áp lực cao',
          is_removed: false,
        }
      ]
    });
    if (saveErr) throw saveErr;
    console.log(`  ✅ Draft saved successfully! Version status: ${saveRes.status}`);

    // 4. Verify Database Row in drawing_review_versions
    console.log('\n[4/8] Verifying columns and legacy synchronization in database...');
    const { data: v1Row, error: v1Err } = await adminClient
      .from('drawing_review_versions')
      .select('id, version_name, status, material_type, material_specification, required_material')
      .eq('id', v1Id)
      .single();
    if (v1Err) throw v1Err;

    if (v1Row.material_type !== testMatType) {
      throw new Error(`material_type mismatch! Expected: "${testMatType}", got: "${v1Row.material_type}"`);
    }
    if (v1Row.material_specification !== testMatSpec) {
      throw new Error(`material_specification mismatch! Expected: "${testMatSpec}", got: "${v1Row.material_specification}"`);
    }
    const expectedConsolidated = `${testMatType}\n${testMatSpec}`;
    if (v1Row.required_material !== expectedConsolidated) {
      throw new Error(`required_material synchronization mismatch! Expected: "${expectedConsolidated}", got: "${v1Row.required_material}"`);
    }
    console.log('  ✅ V1 material_type strictly matches:', JSON.stringify(v1Row.material_type));
    console.log('  ✅ V1 material_specification strictly preserves Unicode symbols:', JSON.stringify(v1Row.material_specification));
    console.log('  ✅ V1 required_material consolidated string correctly synchronized:', JSON.stringify(v1Row.required_material));

    // 5. Close V1 Version (Immutability Lock)
    console.log('\n[5/8] Closing V1 version (lock to Completed)...');
    const { data: closeRes, error: closeErr } = await peClient.rpc('close_drawing_review_version', {
      p_version_id: v1Id
    });
    if (closeErr) throw closeErr;
    console.log(`  ✅ V1 closed successfully! Result:`, closeRes);

    // Verify V1 status is Completed
    const { data: v1Closed, error: v1ClosedErr } = await adminClient
      .from('drawing_review_versions')
      .select('status')
      .eq('id', v1Id)
      .single();
    if (v1ClosedErr) throw v1ClosedErr;
    if (v1Closed.status !== 'Completed') throw new Error(`V1 status is not Completed (got ${v1Closed.status})`);
    console.log('  ✅ V1 is Completed.');

    // 6. Create V2 Version via create_next_drawing_review_version
    console.log('\n[6/8] Creating V2 via create_next_drawing_review_version...');
    const { data: v2Res, error: v2Err } = await peClient.rpc('create_next_drawing_review_version', {
      p_issue_id: issueId
    });
    if (v2Err) throw v2Err;
    const v2Id = v2Res.version_id;
    console.log(`  ✅ V2 created! Name: ${v2Res.version_name}, ID: ${v2Id}`);

    // Verify V2 inherited both material_type and material_specification from V1
    const { data: v2Row, error: v2RowErr } = await adminClient
      .from('drawing_review_versions')
      .select('id, version_name, status, material_type, material_specification, required_material')
      .eq('id', v2Id)
      .single();
    if (v2RowErr) throw v2RowErr;

    if (v2Row.material_type !== testMatType) {
      throw new Error(`V2 material_type inheritance failed! Expected: "${testMatType}", got: "${v2Row.material_type}"`);
    }
    if (v2Row.material_specification !== testMatSpec) {
      throw new Error(`V2 material_specification inheritance failed! Expected: "${testMatSpec}", got: "${v2Row.material_specification}"`);
    }
    console.log('  ✅ V2 inherited material_type:', JSON.stringify(v2Row.material_type));
    console.log('  ✅ V2 inherited material_specification:', JSON.stringify(v2Row.material_specification));

    // 7. Update V2 with different material fields
    console.log('\n[7/8] Modifying V2 and verifying V1 remains immutable...');
    const v2NewMatType = 'S32205 Duplex';
    const v2NewMatSpec = 'Ø25.40 h8 × L2000 (Dung sai độ tròn 0.005 max)';

    const { error: v2UpdateErr } = await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v2Id,
      p_material_type: v2NewMatType,
      p_material_specification: v2NewMatSpec,
      p_operations: [
        {
          step_order: 1,
          workcenter_code: 'CNC-01',
          operation_description: 'Tiện thô và tiện tinh 2 đầu trục',
          cycle_time_seconds: 160,
          remark: '',
          is_removed: false,
        }
      ]
    });
    if (v2UpdateErr) throw v2UpdateErr;

    // Verify V2 has updated fields
    const { data: v2Updated, error: v2UpErr } = await adminClient
      .from('drawing_review_versions')
      .select('material_type, material_specification')
      .eq('id', v2Id)
      .single();
    if (v2UpErr) throw v2UpErr;

    if (v2Updated.material_type !== v2NewMatType || v2Updated.material_specification !== v2NewMatSpec) {
      throw new Error('V2 update was not applied properly');
    }
    console.log('  ✅ V2 updated to:', v2Updated);

    // Verify V1 is 100% UNCHANGED and IMMUTABLE
    const { data: v1Final, error: v1FinErr } = await adminClient
      .from('drawing_review_versions')
      .select('material_type, material_specification, status')
      .eq('id', v1Id)
      .single();
    if (v1FinErr) throw v1FinErr;

    if (v1Final.material_type !== testMatType || v1Final.material_specification !== testMatSpec) {
      throw new Error('V1 was mutated during V2 modification! Immutability violated!');
    }
    console.log('  ✅ V1 is 100% UNCHANGED and immutable:', v1Final);

    console.log('\n[8/8] Cleaning up temporary test data...');
  } finally {
    // Cleanup issue and users
    if (issueId) {
      await adminClient.from('drawing_review_issues').delete().eq('id', issueId);
    }
    if (bdUserId) {
      await adminClient.from('profiles').delete().eq('id', bdUserId);
      await adminClient.auth.admin.deleteUser(bdUserId);
    }
    if (peUserId) {
      await adminClient.from('profiles').delete().eq('id', peUserId);
      await adminClient.auth.admin.deleteUser(peUserId);
    }
    console.log('  ✅ Test data and users cleaned up.');
  }

  console.log('\n========================================================================');
  console.log('🎉 ALL LIVE INTEGRATION CHECKS PASSED ON SUPABASE TEST (hosppagbopdghlupnhlr)!');
  console.log('========================================================================');
}

runLiveTest().catch(err => {
  console.error('\n❌ FATAL TEST ERROR:', err);
  process.exit(1);
});
