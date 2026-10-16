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

async function runTests() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — UI-05 BUG FIX: PROFILE NAME SAVE LIVE VERIFICATION');
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

  const runId = 'u5_fix_' + Date.now().toString(36);
  let testAdminUser = null;
  let authUserClient = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Provision an Authenticated Test Admin User
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Provision an Authenticated Test Admin User ---');
    const adminPhone = `+8498${crypto.randomInt(10000000, 99999999)}`;
    const adminEmail = `admin_${runId}@sampletracking.local`;
    const adminPass = `Admin_${crypto.randomBytes(6).toString('hex')}!Aa1`;
    const initialName = 'Nguyễn Quản Trị Gốc';

    const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      phone: adminPhone,
      password: adminPass,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: {
        role: 'Admin',
        full_name: initialName,
        must_change_password: false,
      },
    });

    if (createErr || !createData.user) {
      throw new Error(`Failed to create test admin user: ${createErr?.message}`);
    }
    testAdminUser = createData.user;

    // Ensure profile in public.profiles
    const { error: profInsertErr } = await adminClient.from('profiles').upsert({
      id: testAdminUser.id,
      phone: adminPhone,
      role: 'Admin',
      full_name: initialName,
      is_active: true,
      must_change_password: false,
      department: 'Ban Giám Đốc',
    });
    if (profInsertErr) {
      throw new Error(`Failed to set up profile: ${profInsertErr.message}`);
    }

    // Authenticate client as this user
    authUserClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signinData, error: signinErr } = await authUserClient.auth.signInWithPassword({
      email: adminEmail,
      password: adminPass,
    });
    if (signinErr || !signinData.session) {
      throw new Error(`Failed to sign in test admin: ${signinErr?.message}`);
    }

    assert(signinData.session.user.id === testAdminUser.id, 'Authenticated test Admin user signed in successfully');

    // ------------------------------------------------------------------------
    // Step 2: Test Validation on Empty Name
    // ------------------------------------------------------------------------
    console.log('\n--- Step 2: Validation on Empty Name ---');
    const { data: emptyRpcData, error: emptyRpcErr } = await authUserClient.rpc('update_my_profile_name', {
      p_full_name: '   ',
    });
    assert(
      emptyRpcErr !== null && emptyRpcErr.message.includes('Họ và tên không được để trống'),
      'update_my_profile_name RPC rejects whitespace/empty name',
      emptyRpcErr?.message
    );

    // ------------------------------------------------------------------------
    // Step 3: Test Profile Name Update via RPC (update_my_profile_name)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 3: Profile Name Update via RPC ---');
    const updatedName1 = 'Đỗ Xuân Trường (Admin Đã Đổi)';

    const { data: rpcSuccessData, error: rpcSuccessErr } = await authUserClient.rpc('update_my_profile_name', {
      p_full_name: updatedName1,
    });

    assert(
      !rpcSuccessErr && rpcSuccessData?.success === true && rpcSuccessData?.full_name === updatedName1,
      'update_my_profile_name RPC executes successfully and returns updated full_name',
      rpcSuccessErr?.message
    );

    // Verify DB persistence by querying public.profiles
    const { data: profAfterRpc, error: profAfterRpcErr } = await authUserClient
      .from('profiles')
      .select('*')
      .eq('id', testAdminUser.id)
      .single();

    assert(
      !profAfterRpcErr && profAfterRpc?.full_name === updatedName1,
      'Database public.profiles reflects updated full_name persistently',
      `Got: ${profAfterRpc?.full_name}`
    );
    assert(
      profAfterRpc?.role === 'Admin' && profAfterRpc?.phone === adminPhone && profAfterRpc?.id === testAdminUser.id,
      'User role, phone, and ID remain strictly unchanged'
    );

    // ------------------------------------------------------------------------
    // Step 4: Test Fallback Direct Update (omitting updated_at)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 4: Fallback Direct Update on public.profiles ---');
    const updatedName2 = 'Đỗ Xuân Trường (Direct Update Fallback)';

    const { error: directUpdateErr } = await authUserClient
      .from('profiles')
      .update({
        full_name: updatedName2,
      })
      .eq('id', testAdminUser.id);

    assert(
      !directUpdateErr,
      'Direct update on public.profiles without updated_at succeeds without permission denied error',
      directUpdateErr?.message
    );

    // Query DB again to verify
    const { data: profAfterDirect, error: profAfterDirectErr } = await authUserClient
      .from('profiles')
      .select('*')
      .eq('id', testAdminUser.id)
      .single();

    assert(
      !profAfterDirectErr && profAfterDirect?.full_name === updatedName2,
      'Database public.profiles reflects direct update full_name',
      `Got: ${profAfterDirect?.full_name}`
    );

    // ------------------------------------------------------------------------
    // Step 5: Regression Check - Updating updated_at directly MUST fail (42501)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 5: Regression Check on Column Privileges ---');
    const { error: updatedWithTimestampErr } = await authUserClient
      .from('profiles')
      .update({
        full_name: 'Name With Timestamp',
        updated_at: new Date().toISOString(),
      })
      .eq('id', testAdminUser.id);

    assert(
      updatedWithTimestampErr !== null &&
      (updatedWithTimestampErr.code === '42501' || updatedWithTimestampErr.message.toLowerCase().includes('permission denied')),
      'PostgreSQL correctly rejects updating updated_at directly (confirming root cause and column privilege enforcement)',
      updatedWithTimestampErr?.message
    );

    // ------------------------------------------------------------------------
    // Step 6: Test Profile Refresh Simulation (AuthContext.refreshProfile)
    // ------------------------------------------------------------------------
    console.log('\n--- Step 6: Profile Refresh Simulation ---');
    // Fetch profile as AuthContext does
    const { data: refreshedProfile, error: refreshErr } = await authUserClient
      .from('profiles')
      .select('*')
      .eq('id', testAdminUser.id)
      .single();

    assert(
      !refreshErr && refreshedProfile?.full_name === updatedName2,
      'AuthContext fetchProfile reloads new name accurately from database'
    );

    // ------------------------------------------------------------------------
    // Step 7: Real Production Admin User Safety Check
    // ------------------------------------------------------------------------
    console.log('\n--- Step 7: Real Production Admin User Check ---');
    const realAdminPhone = '+84968041128';
    const { data: realAdminProf, error: realAdminErr } = await adminClient
      .from('profiles')
      .select('id, full_name, role, phone, is_active')
      .eq('phone', realAdminPhone)
      .single();

    assert(
      !realAdminErr && realAdminProf !== null,
      `Real Admin profile (+84968041128) exists and is intact (Role: ${realAdminProf?.role}, Active: ${realAdminProf?.is_active})`,
      realAdminErr?.message
    );

    console.log('\n================================================================================');
    console.log(`  VERIFICATION RESULT: ${passed}/${total} CHECKS PASSED`);
    console.log('================================================================================\n');

  } finally {
    // Cleanup test user
    if (testAdminUser?.id) {
      console.log('--- Cleanup: Removing test admin user ---');
      await adminClient.from('profiles').delete().eq('id', testAdminUser.id);
      await adminClient.auth.admin.deleteUser(testAdminUser.id);
      console.log('Cleanup complete.');
    }
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
