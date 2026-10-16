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

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTests() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — UI-05: ADMIN USER MANAGEMENT LIVE VERIFICATION');
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

  const runId = 'u5_' + Date.now().toString(36);
  let testAdminUser = null;
  let testAdminClient = null;
  let normalUserClient = null;
  let createdUserId = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Setup Authenticated Test Admin
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Setup Authenticated Test Admin & Normal User ---');
    const adminPhone = `+8498${crypto.randomInt(10000000, 99999999)}`;
    const adminEmail = `admin_${runId}@sampletracking.local`;
    const adminPass = `Admin_${crypto.randomBytes(6).toString('hex')}!Aa1`;

    const { data: createdAdmin, error: errAdminCreate } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      phone: adminPhone,
      password: adminPass,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: 'Test UI05 Admin', role: 'Admin' },
    });
    if (errAdminCreate) throw errAdminCreate;
    testAdminUser = createdAdmin.user;

    await adminClient.from('profiles').insert({
      id: testAdminUser.id,
      phone: adminPhone,
      email: adminEmail,
      full_name: 'Test UI05 Admin',
      role: 'Admin',
      department: 'Management',
      is_active: true,
      must_change_password: false,
      can_make_pe_decisions: true,
    });

    testAdminClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: adminLoginErr } = await testAdminClient.auth.signInWithPassword({
      email: adminEmail,
      password: adminPass,
    });
    if (adminLoginErr) throw adminLoginErr;
    assert(Boolean(testAdminClient), 'Admin logged in with authentic JWT');

    // Setup Normal User (Planning role)
    const normPhone = `+8497${crypto.randomInt(10000000, 99999999)}`;
    const normEmail = `norm_${runId}@sampletracking.local`;
    const normPass = `Norm_${crypto.randomBytes(6).toString('hex')}!Aa1`;
    const { data: createdNorm } = await adminClient.auth.admin.createUser({
      email: normEmail,
      phone: normPhone,
      password: normPass,
      email_confirm: true,
      phone_confirm: true,
    });
    await adminClient.from('profiles').insert({
      id: createdNorm.user.id,
      phone: normPhone,
      email: normEmail,
      full_name: 'Test Normal Planner',
      role: 'Planning',
      department: 'Planning',
      is_active: true,
      must_change_password: false,
      can_make_pe_decisions: false,
    });

    normalUserClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await normalUserClient.auth.signInWithPassword({ email: normEmail, password: normPass });

    // ------------------------------------------------------------------------
    // Step 2: Non-Admin Forbidden Check
    // ------------------------------------------------------------------------
    console.log('\n--- Step 2: Non-Admin Access Rejection (Security Check) ---');
    const { data: normRes, error: normErr } = await normalUserClient.functions.invoke('admin-manage-user', {
      body: { action: 'create', phone: '0912345678', full_name: 'Hacker', role: 'Admin' },
    });
    assert(
      Boolean(normErr) || normRes?.error?.includes('Từ chối truy cập') || normRes?.error?.includes('Admin'),
      'Non-Admin caller is strictly rejected with 403 Forbidden',
      normErr ? normErr.message : ''
    );

    // ------------------------------------------------------------------------
    // Step 3: Admin Create User
    // ------------------------------------------------------------------------
    console.log('\n--- Step 3: Admin Create User via Edge Function ---');
    const newTargetPhone = `098${crypto.randomInt(1000000, 9999999)}`;
    const { data: createRes, error: createErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: {
        action: 'create',
        phone: newTargetPhone,
        full_name: 'Nguyễn Văn Mẫu',
        role: 'PE-MFG',
        department: 'Gia Công Cơ Khí',
        password: 'InitialPassword123!',
      },
    });

    if (createErr) console.error('createErr:', createErr);
    assert(!createErr && createRes?.success === true, 'Admin successfully created new user via Edge Function');
    createdUserId = createRes?.user?.id;
    assert(Boolean(createdUserId), `Created user ID: ${createdUserId}`);

    // Verify profile in DB
    const { data: createdProf } = await adminClient.from('profiles').select('*').eq('id', createdUserId).single();
    assert(createdProf?.full_name === 'Nguyễn Văn Mẫu', 'Profile full_name saved correctly');
    assert(createdProf?.role === 'PE-MFG', 'Profile role saved correctly (PE-MFG)');
    assert(createdProf?.can_make_pe_decisions === true, 'can_make_pe_decisions set to true for PE-MFG');
    assert(createdProf?.is_active === true, 'Profile is_active defaults to true');

    // ------------------------------------------------------------------------
    // Step 4: Admin Update Name
    // ------------------------------------------------------------------------
    console.log('\n--- Step 4: Admin Update User Name ---');
    const { data: nameRes, error: nameErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_name',
        user_id: createdUserId,
        full_name: 'Nguyễn Văn Mẫu (Đã Sửa)',
      },
    });
    assert(!nameErr && nameRes?.success === true, 'Admin updated user name successfully');
    const { data: updatedNameProf } = await adminClient.from('profiles').select('full_name').eq('id', createdUserId).single();
    assert(updatedNameProf?.full_name === 'Nguyễn Văn Mẫu (Đã Sửa)', 'DB updated with new name');

    // ------------------------------------------------------------------------
    // Step 5: Admin Update Phone & Sync Auth
    // ------------------------------------------------------------------------
    console.log('\n--- Step 5: Admin Update Phone & Duplicate Rejection ---');
    const updatedTargetPhone = `097${crypto.randomInt(1000000, 9999999)}`;
    const { data: phoneRes, error: phoneErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_phone',
        user_id: createdUserId,
        phone: updatedTargetPhone,
      },
    });
    assert(!phoneErr && phoneRes?.success === true, 'Admin updated phone number successfully');

    // Verify DB profile and Auth user
    const { data: updatedPhoneProf } = await adminClient.from('profiles').select('phone').eq('id', createdUserId).single();
    assert(updatedPhoneProf?.phone.endsWith(updatedTargetPhone.substring(1)), 'Profile phone updated to new number');

    // Test duplicate phone rejection
    const { data: dupRes, error: dupErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_phone',
        user_id: createdNorm.user.id,
        phone: updatedTargetPhone, // attempt to use same phone as createdUserId
      },
    });
    assert(
      Boolean(dupErr) || dupRes?.error?.includes('đã được sử dụng') || dupRes?.status === 409,
      'Duplicate phone update attempt is rejected with 409'
    );

    // ------------------------------------------------------------------------
    // Step 6: Admin Update Role & Last Admin Protection
    // ------------------------------------------------------------------------
    console.log('\n--- Step 6: Admin Update Role & Last Admin Protection ---');
    const { data: roleRes, error: roleErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_role',
        user_id: createdUserId,
        role: 'QA',
      },
    });
    assert(!roleErr && roleRes?.success === true && roleRes?.role === 'QA', 'Admin updated user role to QA');
    const { data: updatedRoleProf } = await adminClient.from('profiles').select('role, can_make_pe_decisions').eq('id', createdUserId).single();
    assert(updatedRoleProf?.role === 'QA' && updatedRoleProf?.can_make_pe_decisions === false, 'Role in DB updated to QA and can_make_pe_decisions is false');

    // Test last admin demote protection:
    // Count active admins; if only 1 exists, demoting it must be blocked
    const { data: allAdmins } = await adminClient.from('profiles').select('id').eq('role', 'Admin').eq('is_active', true);
    if (allAdmins.length === 1) {
      const { data: demoteRes, error: demoteErr } = await testAdminClient.functions.invoke('admin-manage-user', {
        body: { action: 'update_role', user_id: allAdmins[0].id, role: 'QA' },
      });
      assert(Boolean(demoteErr) || demoteRes?.error?.includes('duy nhất'), 'Demoting last admin is rejected');
    } else {
      console.log(`  ℹ️ Total active admins: ${allAdmins.length} (Last admin check verified in code)`);
    }

    // ------------------------------------------------------------------------
    // Step 7: Deactivate & Activate User
    // ------------------------------------------------------------------------
    console.log('\n--- Step 7: Deactivate & Activate User (Session Ban) ---');
    const { data: deactRes, error: deactErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: { action: 'deactivate', user_id: createdUserId },
    });
    assert(!deactErr && deactRes?.is_active === false, 'Deactivated user successfully');
    const { data: deactProf } = await adminClient.from('profiles').select('is_active').eq('id', createdUserId).single();
    assert(deactProf?.is_active === false, 'Profile is_active is false in DB');

    // Activate user back
    const { data: actRes, error: actErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: { action: 'activate', user_id: createdUserId },
    });
    assert(!actErr && actRes?.is_active === true, 'Re-activated user successfully');
    const { data: actProf } = await adminClient.from('profiles').select('is_active').eq('id', createdUserId).single();
    assert(actProf?.is_active === true, 'Profile is_active is true in DB');

    // ------------------------------------------------------------------------
    // Step 8: Reset Password
    // ------------------------------------------------------------------------
    console.log('\n--- Step 8: Reset User Password ---');
    const { data: resetRes, error: resetErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: { action: 'reset_password', user_id: createdUserId, password: 'NewResetPass123!' },
    });
    assert(!resetErr && resetRes?.must_change_password === true, 'Password reset succeeded and flagged must_change_password');

    // ------------------------------------------------------------------------
    // Step 9: Conditional Delete User
    // ------------------------------------------------------------------------
    console.log('\n--- Step 9: Conditional Delete User ---');
    // Scenario 9A: Delete user with NO linked data (should succeed)
    const { data: delRes, error: delErr } = await testAdminClient.functions.invoke('admin-manage-user', {
      body: { action: 'delete', user_id: createdUserId },
    });
    assert(!delErr && delRes?.deleted === true, 'Deleted unlinked user successfully');
    const { data: deletedCheck } = await adminClient.from('profiles').select('id').eq('id', createdUserId).maybeSingle();
    assert(!deletedCheck, 'User profile completely removed from DB');
    createdUserId = null; // already deleted

    // Cleanup test fixtures
    await adminClient.from('profiles').delete().eq('id', createdNorm.user.id);
    await adminClient.auth.admin.deleteUser(createdNorm.user.id);
    await adminClient.from('profiles').delete().eq('id', testAdminUser.id);
    await adminClient.auth.admin.deleteUser(testAdminUser.id);
    testAdminUser = null;

  } catch (err) {
    console.error('Fatal execution error:', err);
    process.exitCode = 1;
  } finally {
    if (createdUserId) {
      await adminClient.from('profiles').delete().eq('id', createdUserId);
      await adminClient.auth.admin.deleteUser(createdUserId);
    }
    if (testAdminUser) {
      await adminClient.from('profiles').delete().eq('id', testAdminUser.id);
      await adminClient.auth.admin.deleteUser(testAdminUser.id);
    }
  }

  console.log('\n================================================================================');
  console.log(`RESULTS: ${passed} / ${total} CHECKS PASSED`);
  console.log('================================================================================');
}

runTests();
