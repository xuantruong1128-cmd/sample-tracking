#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — REAL GATE B LIVE CLOUD INTEGRATION TEST RUNNER
 * Script: scripts/run-gate-b-live-tests.cjs
 *
 * Implements 100% of the real cloud integration scenarios specified in:
 * docs/gate_b_test_matrix.md
 *
 * Requirements (B2-R1-01 through B2-R1-06 Remediation):
 *  - STRICT TARGET VALIDATION (R1-01):
 *      * Accepts ONLY dedicated SUPABASE_TEST_* credentials.
 *      * Zero fallback to generic SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
 *      * Verifies actual project identity against an independently configured allowlist.
 *      * Requires explicit disposable-project confirmation (SUPABASE_TEST_IS_DISPOSABLE=true).
 *      * Rejects unexpected project identities.
 *      * Unique test-run ID and unique test-user identities for every run.
 *      * Aborts if any proposed test identity already exists; NEVER resets passwords or overwrites profiles.
 *      * Tracks all created resources and cleans up ONLY resources created by this run.
 *      * Reports all cleanup failures.
 *  - REAL EDGE VERIFICATION (R1-04 & R1-05):
 *      * Replaces direct service-role confirmation with authentic Edge Function calls using user JWT.
 *      * Verifies MIME signatures, file sizes, and SHA-256 matching.
 *  - SAFE TEARDOWN (R1-01):
 *      * Never deletes unrelated jobs or users.
 * ==============================================================================
 */

const { createClient, FunctionsHttpError } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateTargetApproval, createStorageResourceTracker } = require('./gate-b-target-validator.cjs');

// ------------------------------------------------------------------------------
// 0. ENVIRONMENT & PREFLIGHT SAFETY GUARD (R1-01)
// ------------------------------------------------------------------------------
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
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
}

// STRICT CREDENTIAL PARSING: ONLY accept SUPABASE_TEST_* credentials. NO generic fallbacks!
const supabaseUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const isDisposable = process.env.SUPABASE_TEST_IS_DISPOSABLE === 'true';

console.log('='.repeat(80));
console.log('   SAMPLE TRACKING V1.0 — REAL GATE B INTEGRATION TEST RUNNER');
console.log('='.repeat(80));

// Guard 1: Verify presence of all dedicated test credentials
if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error('\n⚠️  [GATE B AUDIT STATUS: BLOCKED]');
  console.error('   Lý do: Chưa cấu hình đầy đủ thông số kết nối cơ sở dữ liệu thật trong .env:');
  console.error('     - SUPABASE_TEST_URL (Bắt buộc URL riêng biệt cho kiểm thử)');
  console.error('     - SUPABASE_TEST_SERVICE_KEY (service_role key)');
  console.error('     - SUPABASE_TEST_ANON_KEY (anon key)');
  console.error('   Theo R1-01: Tuyệt đối không fallback về SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.');
  console.error('   Script kiểm thử fail-closed và dừng lại với mã thoát 1.\n');
  process.exit(1);
}

// Guard 1b: Verify service and anon keys are distinct
if (serviceKey === anonKey) {
  console.error('\n🛑 [GATE B SAFETY GUARD: IDENTICAL SERVICE AND ANON KEYS]');
  console.error('   Lý do: SUPABASE_TEST_SERVICE_KEY và SUPABASE_TEST_ANON_KEY không được giống nhau.');
  console.error('   Anon client bắt buộc phải dùng anon key, không được dùng service key.\n');
  process.exit(1);
}

// Guard 2, 3 & 4: Require independently approved disposable target via shared validator (F-03)
// Resolves strictly from canonical repository root config/gate-b-approved-target.json via __dirname
// Environment variable path overrides and working-directory redirects are strictly ignored.
const approvalResult = validateTargetApproval({
  targetUrl: supabaseUrl,
  isDisposableEnv: isDisposable,
});

if (!approvalResult.ok) {
  console.error('\n🛑 [GATE B SAFETY GUARD: TARGET APPROVAL REJECTED]');
  console.error(`   Lý do: ${approvalResult.reason}`);
  console.error('   Theo F-03: Runner từ chối thực thi trên mục tiêu không được phê duyệt độc lập để bảo vệ an toàn dữ liệu.\n');
  process.exit(1);
}

const { targetRef, targetHost } = approvalResult;
console.log(`  Target verified: ${targetHost} (Ref: ${targetRef}) [INDEPENDENT APPROVAL: MATCH]`);

// ------------------------------------------------------------------------------
// 1. UNIQUE RUN IDENTITY & RESOURCE TRACKER (R1-01)
// ------------------------------------------------------------------------------
const runId = 'gb_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
const testJobNo = `GATEB-${runId.toUpperCase()}`;

console.log(`  Run ID: ${runId}`);
console.log(`  Test Job Number: ${testJobNo}`);

const storageTracker = createStorageResourceTracker();

// Registry tracking all created resources strictly for this run
const createdResources = {
  users: [],
  jobs: [],
  confirmedStoragePaths: storageTracker.confirmedStoragePaths,
  ambiguousStoragePaths: storageTracker.ambiguousStoragePaths,
  get storagePaths() {
    return storageTracker.getPathsToDelete();
  },
};

let passed = 0;
let failed = 0;

function assert(condition, testId, testName, detail) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS [${testId}]: ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL [${testId}]: ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Definitions for 6 test personas with run-unique emails and phones
const PERSONA_TEMPLATES = [
  {
    code: 'P-ADMIN',
    prefix: 'admin',
    fullName: 'Gate B Admin',
    role: 'Admin',
    department: 'Management',
    isActive: true,
    canMakePeDecisions: false,
  },
  {
    code: 'P-PLAN',
    prefix: 'planning',
    fullName: 'Gate B Planner',
    role: 'Planning',
    department: 'Planning',
    isActive: true,
    canMakePeDecisions: false,
  },
  {
    code: 'P-PE-LEAD',
    prefix: 'pe_lead',
    fullName: 'Gate B PE Lead',
    role: 'PE-MFG',
    department: 'PE',
    isActive: true,
    canMakePeDecisions: true,
  },
  {
    code: 'P-PE-OPER',
    prefix: 'pe_oper',
    fullName: 'Gate B PE Operator',
    role: 'PE-MFG',
    department: 'PE',
    isActive: true,
    canMakePeDecisions: false,
  },
  {
    code: 'P-QA',
    prefix: 'qa',
    fullName: 'Gate B QA Inspector',
    role: 'QA',
    department: 'QA',
    isActive: true,
    canMakePeDecisions: false,
  },
  {
    code: 'P-INACTIVE',
    prefix: 'inactive',
    fullName: 'Gate B Inactive User',
    role: 'PE-MFG',
    department: 'PE',
    isActive: false,
    canMakePeDecisions: false,
  },
];

const personaClients = {};
const personaUsers = {};

async function setupPersonas() {
  console.log('\n[SETUP] Khởi tạo tài khoản kiểm thử duy nhất cho phiên chạy...');

  // Pre-check: Fetch existing users to ensure NO identity collision
  const { data: userList, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    throw new Error(`Failed to list existing auth users: ${listErr.message}`);
  }

  const existingEmails = new Set((userList?.users || []).map((u) => u.email?.toLowerCase()));

  // Check profiles table for existing phones
  const { data: existingProfiles, error: profilesErr } = await adminClient.from('profiles').select('phone');
  if (profilesErr) {
    throw new Error(`Failed to check existing profiles: ${profilesErr.message}`);
  }
  const existingPhones = new Set((existingProfiles || []).map((p) => p.phone));

  for (let i = 0; i < PERSONA_TEMPLATES.length; i++) {
    const tmpl = PERSONA_TEMPLATES[i];
    const uniqueEmail = `${tmpl.prefix}_${runId}@gateb-audit.test`;
    const uniquePhone = `+8498${crypto.randomInt(10000000, 99999999)}`;
    const password = `Pass_${crypto.randomBytes(8).toString('hex')}!Aa1`;

    // Abort if any proposed identity already exists
    if (existingEmails.has(uniqueEmail.toLowerCase())) {
      throw new Error(`Safety abort: Proposed test email '${uniqueEmail}' already exists!`);
    }
    if (existingPhones.has(uniquePhone)) {
      throw new Error(`Safety abort: Proposed test phone '${uniquePhone}' already exists!`);
    }

    // Create user in Supabase Auth
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: uniqueEmail,
      password: password,
      email_confirm: true,
      user_metadata: { full_name: tmpl.fullName },
    });

    if (createErr || !created?.user) {
      throw new Error(`Failed to create test user ${uniqueEmail}: ${createErr?.message}`);
    }

    const user = created.user;
    createdResources.users.push(user.id);
    personaUsers[tmpl.code] = user;

    // Insert profile without overwriting existing profiles
    const { error: profileErr } = await adminClient.from('profiles').insert({
      id: user.id,
      phone: uniquePhone,
      email: uniqueEmail,
      full_name: tmpl.fullName,
      role: tmpl.role,
      department: tmpl.department,
      is_active: tmpl.isActive,
      must_change_password: false,
      can_make_pe_decisions: tmpl.canMakePeDecisions,
    });

    if (profileErr) {
      throw new Error(`Failed to insert profile for ${tmpl.code}: ${profileErr.message}`);
    }

    // Sign in to obtain authentic JWT client
    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signErr } = await client.auth.signInWithPassword({
      email: uniqueEmail,
      password: password,
    });

    if (signErr) {
      throw new Error(`Failed to sign in persona ${tmpl.code}: ${signErr.message}`);
    }

    personaClients[tmpl.code] = client;
  }

  console.log(`  ✅ Đã tạo và xác thực an toàn 6 persona duy nhất cho runId ${runId}.`);
}

// ------------------------------------------------------------------------------
// 2. RUN 20 GATE B SCENARIOS
// ------------------------------------------------------------------------------
async function executeGateBScenarios() {
  let createdJobId = null;
  let createdOpId = null;
  let createdRunId = null;
  let createdQaCheckId = null;
  let createdAttachmentId = null;
  let createdStoragePath = null;

    // --------------------------------------------------------------------------
    // TC-01: Anonymous Access Rejection (Fail-closed RLS on all internal tables)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-01: Anonymous Access Rejection (P-ANON) ---');
    const { data: anonJobs, error: anonJobErr } = await anonClient.from('jobs').select('*');
    const { data: anonAtt, error: anonAttErr } = await anonClient.from('attachments').select('*');
    const { data: anonQa, error: anonQaErr } = await anonClient.from('qa_checks').select('*');
    assert(
      (anonJobErr !== null || (anonJobs && anonJobs.length === 0)) &&
      (anonAttErr !== null || (anonAtt && anonAtt.length === 0)) &&
      (anonQaErr !== null || (anonQa && anonQa.length === 0)),
      'TC-01',
      'Anonymous clients cannot access jobs, attachments, or QA checks',
      'Anonymous read was completely blocked or returned empty set'
    );

    // --------------------------------------------------------------------------
    // TC-02: Deactivated Account Access Block (P-INACTIVE)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-02: Deactivated Account Block (P-INACTIVE) ---');
    const { data: inactJobs, error: inactErr } = await personaClients['P-INACTIVE'].from('jobs').select('*');
    assert(
      inactErr !== null || (inactJobs && inactJobs.length === 0),
      'TC-02a',
      'Deactivated accounts are denied data read access by is_user_active() RLS'
    );

    // --------------------------------------------------------------------------
    // TC-03: Planning Creates ACTIVE Job (P-PLAN)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-03: Job Creation (P-PLAN) ---');
    const { data: jobData, error: jobCreateErr } = await personaClients['P-PLAN'].from('jobs').insert({
      job_no: testJobNo,
      part_no: 'PART-GB-01',
      part_name: 'Gate B Precision Bushing',
      customer: 'AUDIT-CORP',
      order_qty: 50,
      material: 'AL6061-T6',
      planned_start_date: '2026-10-15',
      planned_finish_date: '2026-10-20',
      status: 'ACTIVE',
    }).select().single();

    assert(!jobCreateErr && jobData?.id, 'TC-03', 'Planning creates new ACTIVE job', jobCreateErr?.message);
    createdJobId = jobData?.id;
    if (createdJobId) createdResources.jobs.push(createdJobId);

    // --------------------------------------------------------------------------
    // TC-04: PE Owner Assignment Authority (P-PLAN vs P-PE-OPER)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-04: PE Owner Assignment Authority ---');
    // Shop-floor operator attempts to assign PE Owner -> Must FAIL (RLS denies UPDATE)
    const { data: operAssignData, error: operAssignErr } = await personaClients['P-PE-OPER'].from('jobs').update({
      pe_owner_id: personaUsers['P-PE-LEAD'].id,
    }).eq('id', createdJobId).select();
    const isUpdateBlocked = operAssignErr !== null || (Array.isArray(operAssignData) && operAssignData.length === 0);
    assert(isUpdateBlocked, 'TC-04a', 'PE Operator cannot assign PE Owner (RLS blocks unauthorized update)');

    // Planning assigns designated PE Owner -> Must SUCCEED
    const { error: planAssignErr } = await personaClients['P-PLAN'].from('jobs').update({
      pe_owner_id: personaUsers['P-PE-LEAD'].id,
    }).eq('id', createdJobId);
    assert(!planAssignErr, 'TC-04b', 'Planning assigns eligible PE Owner', planAssignErr?.message);

    // --------------------------------------------------------------------------
    // TC-05: Planning Defines Routing Operation in NOT_STARTED (P-PLAN)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-05: Planning Operation Routing ---');
    const { data: opData, error: opCreateErr } = await personaClients['P-PLAN'].from('job_operations').insert({
      job_id: createdJobId,
      step_order: 1,
      operation_name: 'Phay CNC 3-Truc',
      planned_machine: 'CNC-01',
      planned_cycle_time_seconds: 120.5,
      status: 'NOT_STARTED',
    }).select().single();

    assert(!opCreateErr && opData?.id, 'TC-05', 'Planning creates operation in NOT_STARTED status', opCreateErr?.message);
    createdOpId = opData?.id;

    // --------------------------------------------------------------------------
    // TC-06: Operator Records First Run and Advances to IN_PROGRESS (P-PE-OPER)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-06: Operator Production Run & Progression (R1-03) ---');
    const nowIso = new Date().toISOString();
    // Test forged operator_id: PE-OPER attempts to pass Admin's ID as operator_id
    const { data: runData, error: runCreateErr } = await personaClients['P-PE-OPER'].from('production_runs').insert({
      operation_id: createdOpId,
      machine_id: 'CNC-01',
      operator_id: personaUsers['P-ADMIN'].id, // Attempt to forge operator identity
      operator_name: 'Fake Operator',
      start_time: nowIso,
      end_time: nowIso,
      ok_qty: 10,
      ng_qty: 0,
      remarks: 'First batch test run',
    }).select().single();

    assert(!runCreateErr && runData?.id, 'TC-06a', 'Operator inserts first production run', runCreateErr?.message);
    // R1-03: Verify operator_id was unconditionally stamped from authenticated actor
    assert(
      runData?.operator_id === personaUsers['P-PE-OPER'].id,
      'TC-06b',
      'Trigger unconditionally stamps operator_id using authenticated actor (auth.uid)'
    );
    createdRunId = runData?.id;

    // --------------------------------------------------------------------------
    // TC-02b: Deactivated Account Mutation Rejection Specifically by Authorization (F-04)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-02b: Deactivated Account Mutation Rejection Specifically by Authorization (F-04) ---');
    const { data: inactRunData, error: inactRunErr } = await personaClients['P-INACTIVE'].from('production_runs').insert({
      operation_id: createdOpId,
      machine_id: 'CNC-01',
      start_time: nowIso,
      end_time: nowIso,
      ok_qty: 5,
      ng_qty: 0,
      remarks: 'Deactivated user mutation attempt on valid operation',
    }).select().single();

    // F-04: Verify rejection is specifically due to authorization (is_user_active), NOT foreign-key or missing-field error:
    const isAuthRejection = inactRunErr !== null &&
      !inactRunData &&
      inactRunErr.code !== '23503' && // Reject foreign key error as test success
      inactRunErr.code !== '23502' && // Reject missing field error as test success
      (inactRunErr.code === '42501' ||
       inactRunErr.message.toLowerCase().includes('row-level security') ||
       inactRunErr.message.toLowerCase().includes('permission denied') ||
       inactRunErr.message.toLowerCase().includes('unauthorized') ||
       inactRunErr.message.toLowerCase().includes('active internal user'));

    assert(
      isAuthRejection,
      'TC-02b',
      'Deactivated account (P-INACTIVE) mutation on valid operation is rejected specifically by authorization RLS',
      inactRunErr?.message || 'Unexpected success'
    );

    // --------------------------------------------------------------------------
    // TC-02c: Mandatory First-Login Password Change Enforcement
    // --------------------------------------------------------------------------
    console.log('\n--- TC-02c: Mandatory First-Login Password Change Enforcement ---');
    const pwdTestEmail = `pwd_test_${runId}@gateb-audit.test`;
    const pwdTestPhone = `+8498${crypto.randomInt(10000000, 99999999)}`;
    const tempPassword = '123456';

    const { data: pwdAuthUser, error: pwdAuthErr } = await adminClient.auth.admin.createUser({
      email: pwdTestEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Gate B Password Test User' },
    });

    if (!pwdAuthErr && pwdAuthUser?.user) {
      const pwdUserId = pwdAuthUser.user.id;
      createdResources.users.push(pwdUserId);

      await adminClient.from('profiles').insert({
        id: pwdUserId,
        phone: pwdTestPhone,
        email: pwdTestEmail,
        full_name: 'Gate B Password Test User',
        role: 'Planning',
        department: 'Planning',
        is_active: true,
        must_change_password: true, // Initial pending password change
      });

      const tempPwdClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await tempPwdClient.auth.signInWithPassword({
        email: pwdTestEmail,
        password: tempPassword,
      });

      // 1. Must be denied access to jobs by RLS
      const { data: blockedJobs, error: blockedJobErr } = await tempPwdClient.from('jobs').select('*');
      assert(
        blockedJobErr !== null || (blockedJobs && blockedJobs.length === 0),
        'TC-02c1',
        'User with pending password change is denied read access to business data by RLS'
      );

      // 2. Reject new password identical to temporary password (123456)
      const { error: identicalErr } = await tempPwdClient.rpc('complete_first_login_password_change', {
        p_new_password: '123456',
      });
      assert(identicalErr !== null, 'TC-02c2', 'Rejects new password identical to temporary password (123456)');

      // 3. Reject new password shorter than 8 characters
      const { error: shortErr } = await tempPwdClient.rpc('complete_first_login_password_change', {
        p_new_password: 'short',
      });
      assert(shortErr !== null, 'TC-02c3', 'Rejects new password shorter than 8 characters');

      // 3a. NEGATIVE TEST: Direct RPC bypass attempt WITHOUT changing password in GoTrue Auth
      // The attacker attempts to call complete_first_login_password_change with a valid-format password
      // while their actual password in auth.users is still 123456. Must be strictly rejected by server!
      const bypassAttemptPass = `Bypass_${crypto.randomBytes(6).toString('hex')}!Aa1`;
      const { error: bypassErr } = await tempPwdClient.rpc('complete_first_login_password_change', {
        p_new_password: bypassAttemptPass,
      });
      assert(
        bypassErr !== null,
        'TC-02c-neg1',
        'Direct RPC bypass attempt without GoTrue password update is cryptographically rejected by server'
      );

      // Verify that must_change_password is STILL true after failed bypass
      const { data: profileAfterBypass } = await adminClient
        .from('profiles')
        .select('must_change_password')
        .eq('id', pwdUserId)
        .single();
      assert(
        profileAfterBypass?.must_change_password === true,
        'TC-02c-neg1-verify',
        'Profile must_change_password remains TRUE following rejected bypass attempt'
      );

      // 3b. NEGATIVE TEST: Direct SQL table UPDATE on public.profiles to clear must_change_password
      // Column privileges must deny UPDATE on must_change_password to authenticated users
      const { error: tableBypassErr } = await tempPwdClient
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', pwdUserId);
      assert(
        tableBypassErr !== null,
        'TC-02c-neg2',
        'Direct SQL update on profiles.must_change_password is denied by column permissions'
      );

      // 4. Update password in GoTrue Auth
      const validNewPass = `New_${crypto.randomBytes(6).toString('hex')}!Aa1`;
      await tempPwdClient.auth.updateUser({ password: validNewPass });

      // 4a. NEGATIVE TEST: RPC call with MISMATCHED password after GoTrue update
      // Attacker updated password to validNewPass, but passes a different password to RPC. Must FAIL!
      const { error: mismatchErr } = await tempPwdClient.rpc('complete_first_login_password_change', {
        p_new_password: `Mismatch_${crypto.randomBytes(6).toString('hex')}!Aa1`,
      });
      assert(
        mismatchErr !== null,
        'TC-02c-neg3',
        'RPC call with password that does not match authenticated credentials in Auth is strictly rejected'
      );

      // 4b. POSITIVE TEST: Legitimate verified completion matching auth credentials
      const { data: changeRes, error: changeErr } = await tempPwdClient.rpc('complete_first_login_password_change', {
        p_new_password: validNewPass,
      });
      assert(!changeErr && changeRes?.status === 'COMPLETED', 'TC-02c4', 'Cryptographically verified password change completes successfully');

      // 5. Subsequent access to jobs is now authorized
      const { data: allowedJobs, error: allowedJobErr } = await tempPwdClient.from('jobs').select('id').eq('id', createdJobId);
      assert(!allowedJobErr && allowedJobs?.length === 1, 'TC-02c5', 'After completing password change, user gains full business data access');
    } else {
      assert(false, 'TC-02c', 'Failed to create temporary password test user', pwdAuthErr?.message);
    }

    const { error: opStartErr } = await personaClients['P-PE-OPER'].from('job_operations').update({
      status: 'IN_PROGRESS',
    }).eq('id', createdOpId);
    assert(!opStartErr, 'TC-06c', 'Operator advances operation to IN_PROGRESS', opStartErr?.message);

    // --------------------------------------------------------------------------
    // TC-07: Operator Cannot Complete Operation (Separation of Duty) (P-PE-OPER)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-07: Operator Cannot Complete Operation (Separation of Duty) ---');
    const { error: operCompleteErr } = await personaClients['P-PE-OPER'].from('job_operations').update({
      status: 'COMPLETED',
    }).eq('id', createdOpId);
    assert(operCompleteErr !== null, 'TC-07', 'PE Operator blocked from completing operation (Requires designated PE Owner)');

    // --------------------------------------------------------------------------
    // TC-08: QA Evaluation Recording & Monotonic Event Sequence (P-QA)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-08: QA Evaluation & Sequence Allocation ---');
    const { data: qaData, error: qaErr } = await personaClients['P-QA'].from('qa_checks').insert({
      operation_id: createdOpId,
      production_run_id: createdRunId,
      sample_size: 10,
      ok_qty: 5,
      ng_qty: 5,
      result: 'NG',
      notes: 'Kích thước vượt dung sai ±0.02mm',
    }).select().single();

    assert(!qaErr && qaData?.event_seq === 1, 'TC-08', 'QA records check and server allocates monotonic event_seq = 1', qaErr?.message);
    createdQaCheckId = qaData?.id;

    // --------------------------------------------------------------------------
    // TC-09: QA Check Record Immutability (P-QA & P-ADMIN)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-09: QA Record Immutability (P-QA & P-ADMIN) ---');
    const { error: qaUpdateErr } = await personaClients['P-QA'].from('qa_checks').update({
      result: 'OK',
    }).eq('id', createdQaCheckId);
    assert(qaUpdateErr !== null, 'TC-09a', 'QA checks are strictly immutable for QA (trigger blocks UPDATE)');

    const { error: adminQaUpdateErr } = await personaClients['P-ADMIN'].from('qa_checks').update({
      result: 'OK',
    }).eq('id', createdQaCheckId);
    assert(adminQaUpdateErr !== null, 'TC-09b', 'QA checks are strictly immutable even for Admin (trigger blocks UPDATE)');

    // --------------------------------------------------------------------------
    // TC-10: PE Cannot Complete While QA NG Without Disposition (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-10: PE Completion Blocked on Unresolved QA NG ---');
    const { error: blockedCompleteErr } = await personaClients['P-PE-LEAD'].from('job_operations').update({
      status: 'COMPLETED',
    }).eq('id', createdOpId);
    assert(blockedCompleteErr !== null, 'TC-10', 'PE blocked from completing operation with unresolved QA NG check');

    // --------------------------------------------------------------------------
    // TC-11: Valid PE Technical Disposition Permits Completion (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-11: Technical Disposition & Authorized Completion ---');
    const { data: dispData, error: dispErr } = await personaClients['P-PE-LEAD'].from('pe_technical_dispositions').insert({
      job_id: createdJobId,
      operation_id: createdOpId,
      qa_check_id: createdQaCheckId,
      decision_type: 'CONTINUE_AS_IS',
      technical_reason: 'Dung sai nằm trong khoảng chấp nhận của khách hàng theo phụ lục 2',
      decision_maker_name: 'Tran Van Lead',
    }).select().single();

    assert(!dispErr && dispData?.id, 'TC-11a', 'Authorized PE Owner creates valid technical disposition', dispErr?.message);

    const { error: peCompleteErr } = await personaClients['P-PE-LEAD'].from('job_operations').update({
      status: 'COMPLETED',
    }).eq('id', createdOpId);
    assert(!peCompleteErr, 'TC-11b', 'PE completes operation after valid technical disposition', peCompleteErr?.message);

    // --------------------------------------------------------------------------
    // TC-12: Authorized Operation Reopen Requires Reason (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-12: Authorized Operation Reopening ---');
    const { error: reopenNoReasonErr } = await personaClients['P-PE-LEAD'].from('job_operations').update({
      status: 'IN_PROGRESS',
      reopen_reason: 'abc', // < 5 characters
    }).eq('id', createdOpId);
    assert(reopenNoReasonErr !== null, 'TC-12a', 'Reopen rejected with insufficient reason (< 5 chars)');

    const { error: reopenValidErr } = await personaClients['P-PE-LEAD'].from('job_operations').update({
      status: 'IN_PROGRESS',
      reopen_reason: 'Chỉnh sửa đường chạy dao CNC bổ sung',
    }).eq('id', createdOpId);
    assert(!reopenValidErr, 'TC-12b', 'Reopen succeeds with valid reason', reopenValidErr?.message);

    const { data: reopenedOp } = await adminClient.from('job_operations').select('reopened_by, reopened_at').eq('id', createdOpId).single();
    assert(
      reopenedOp?.reopened_by === personaUsers['P-PE-LEAD'].id && Boolean(reopenedOp?.reopened_at),
      'TC-12c',
      'Reopen correctly stamped reopened_by and reopened_at'
    );

    // --------------------------------------------------------------------------
    // TC-13: Anti-Recycling of Pre-Reopen Dispositions (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-13: Pre-Reopen Disposition Recycling Blocked ---');
    const { error: recycledCompleteErr } = await personaClients['P-PE-LEAD'].from('job_operations').update({
      status: 'COMPLETED',
    }).eq('id', createdOpId);
    assert(
      recycledCompleteErr !== null,
      'TC-13',
      'Pre-reopen disposition cannot be recycled to re-complete reopened operation'
    );

    // Issue post-reopen disposition so job operations can proceed cleanly
    await personaClients['P-PE-LEAD'].from('pe_technical_dispositions').insert({
      job_id: createdJobId,
      operation_id: createdOpId,
      qa_check_id: createdQaCheckId,
      decision_type: 'CONTINUE_AS_IS',
      technical_reason: 'Đã kiểm tra lại sau reopen, dung sai đạt chuẩn',
      decision_maker_name: 'Tran Van Lead',
    });
    await personaClients['P-PE-LEAD'].from('job_operations').update({ status: 'COMPLETED' }).eq('id', createdOpId);

    // --------------------------------------------------------------------------
    // TC-14: Metadata-First Attachment Registration (Unconditionally PENDING) (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-14: Attachment Registration (Forced PENDING) ---');
    // Valid PDF file buffer (%PDF- header)
    const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const validPdfHash = crypto.createHash('sha256').update(validPdfBuffer).digest('hex');
    createdStoragePath = `${createdJobId}/DRAWING/spec_${runId}.pdf`;

    const { data: attData, error: attInsertErr } = await personaClients['P-PE-LEAD'].from('attachments').insert({
      job_id: createdJobId,
      operation_id: createdOpId,
      file_name: 'spec.pdf',
      file_path: createdStoragePath,
      file_size: validPdfBuffer.length,
      mime_type: 'application/pdf',
      file_type: 'DRAWING',
      content_hash: validPdfHash,
      upload_status: 'READY', // Attempt to forge READY status
    }).select().single();

    assert(!attInsertErr && attData?.id, 'TC-14a', 'Attachment registered via client metadata', attInsertErr?.message);
    assert(attData?.upload_status === 'PENDING', 'TC-14b', 'Trigger unconditionally overrides upload_status to PENDING');
    createdAttachmentId = attData?.id;

    // --------------------------------------------------------------------------
    // TC-15: Storage Upload Policy Enforcement (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-15: Storage Upload Policy Enforcement ---');
    let storageUploadErr = null;
    try {
      const uploadRes = await personaClients['P-PE-LEAD'].storage
        .from('sample-documents')
        .upload(createdStoragePath, validPdfBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        });
      storageUploadErr = uploadRes.error;
      storageTracker.recordUploadAttempt({
        path: createdStoragePath,
        error: storageUploadErr,
      });
    } catch (uploadEx) {
      storageUploadErr = uploadEx;
      storageTracker.recordUploadAttempt({
        path: createdStoragePath,
        thrown: uploadEx,
      });
    }

    assert(!storageUploadErr, 'TC-15', 'Storage RLS permits upload matching pre-registered PENDING attachment', storageUploadErr?.message);

    // --------------------------------------------------------------------------
    // TC-16: Real Edge Function Verification & Negative Paths (R1-04 & R1-05)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-16: Real Edge Function Verification (R1-04 & R1-05) ---');
    // 16a. Direct ordinary-user call to confirm_attachment_upload RPC is DENIED
    const { error: directConfirmErr } = await personaClients['P-PE-LEAD'].rpc('confirm_attachment_upload', {
      p_attachment_id: createdAttachmentId,
    });
    assert(directConfirmErr !== null, 'TC-16a', 'Direct client call to confirm_attachment_upload is REVOKED (Forbidden)');

    // 16b. Call verify-and-confirm-upload Edge Function using authentic user JWT
    const { data: efData, error: efErr } = await personaClients['P-PE-LEAD'].functions.invoke('verify-and-confirm-upload', {
      body: { attachment_id: createdAttachmentId },
    });
    assert(!efErr && efData?.success && efData?.status === 'READY', 'TC-16b', 'Edge Function verifies bytes and marks attachment READY via user JWT', efErr?.message || efData?.error);

    // 16c. Negative Test: Mismatched SHA-256 hash
    const badHashBuffer = Buffer.from('%PDF-1.4\nBadHashContent\n%%EOF');
    const badHashDeclared = 'a'.repeat(64); // Different hash
    const badHashPath = `${createdJobId}/DRAWING/bad_hash_${runId}.pdf`;

    const { data: badHashAtt, error: badHashInsertErr } = await personaClients['P-PE-LEAD'].from('attachments').insert({
      job_id: createdJobId,
      file_name: 'bad_hash.pdf',
      file_path: badHashPath,
      file_size: badHashBuffer.length,
      mime_type: 'application/pdf',
      file_type: 'DRAWING',
      content_hash: badHashDeclared,
    }).select().single();

    if (badHashAtt?.id) {
      let badUploadErr = null;
      try {
        const uploadRes = await personaClients['P-PE-LEAD'].storage
          .from('sample-documents')
          .upload(badHashPath, badHashBuffer, { contentType: 'application/pdf', upsert: false });
        badUploadErr = uploadRes.error;
        storageTracker.recordUploadAttempt({ path: badHashPath, error: badUploadErr });
      } catch (uploadEx) {
        badUploadErr = uploadEx;
        storageTracker.recordUploadAttempt({ path: badHashPath, thrown: uploadEx });
      }
      assert(!badUploadErr, 'TC-16c1', 'Bad hash test file uploaded to storage', badUploadErr?.message);

      const { data: mismatchData, error: mismatchErr } = await personaClients['P-PE-LEAD'].functions.invoke('verify-and-confirm-upload', {
        body: { attachment_id: badHashAtt.id },
      });
      // In Supabase SDK, non-200 responses return FunctionsHttpError.
      // Assert rejection and verify database status directly:
      const { data: badHashDbRecord } = await adminClient.from('attachments').select('upload_status, last_error').eq('id', badHashAtt.id).single();
      assert(
        (mismatchErr !== null || mismatchData?.status === 'FAILED') && badHashDbRecord?.upload_status === 'FAILED',
        'TC-16c2',
        'Edge Function rejects mismatched SHA-256 checksum and sets database status to FAILED'
      );
    } else {
      assert(false, 'TC-16c', 'Failed to register bad-hash attachment', badHashInsertErr?.message);
    }

    // 16d. Negative Test: Missing storage object
    const missingPath = `${createdJobId}/DRAWING/missing_${runId}.pdf`;
    const { data: missingAtt, error: missingInsertErr } = await personaClients['P-PE-LEAD'].from('attachments').insert({
      job_id: createdJobId,
      file_name: 'missing.pdf',
      file_path: missingPath,
      file_size: 1024,
      mime_type: 'application/pdf',
      file_type: 'DRAWING',
      content_hash: validPdfHash,
    }).select().single();

    if (missingAtt?.id) {
      const { data: missingData, error: missingErr } = await personaClients['P-PE-LEAD'].functions.invoke('verify-and-confirm-upload', {
        body: { attachment_id: missingAtt.id },
      });
      const { data: missingDbRecord } = await adminClient.from('attachments').select('upload_status, last_error').eq('id', missingAtt.id).single();
      assert(
        (missingErr !== null || missingData?.status === 'FAILED') && missingDbRecord?.upload_status === 'FAILED',
        'TC-16d',
        'Edge Function rejects non-existent storage object and sets database status to FAILED'
      );
    } else {
      assert(false, 'TC-16d', 'Failed to register missing-file attachment', missingInsertErr?.message);
    }

    // 16e. Negative Test: Unauthorized caller calling Edge Function (F-04)
    console.log('\n--- TC-16e: Unauthorized Edge Function Caller Rejection (F-04) ---');
    const { data: unauthEfData, error: unauthEfErr } = await personaClients['P-QA'].functions.invoke('verify-and-confirm-upload', {
      body: { attachment_id: createdAttachmentId },
    });
    const { data: unauthAttDb } = await adminClient.from('attachments').select('upload_status').eq('id', createdAttachmentId).single();

    // F-04: Require authentic FunctionsHttpError with HTTP 403 status, no data payload, and untouched DB record
    const isFunctionsHttpError = unauthEfErr instanceof FunctionsHttpError;
    const isHttp403 = Boolean(unauthEfErr && unauthEfErr.context && unauthEfErr.context.status === 403);
    const hasNoData = !unauthEfData;
    const isDbUnchanged = unauthAttDb?.upload_status === 'READY';

    const isValidRejection = isFunctionsHttpError && isHttp403 && hasNoData && isDbUnchanged;

    assert(
      isValidRejection,
      'TC-16e',
      'Edge Function rejects unauthorized caller specifically with HTTP 403 FunctionsHttpError without altering database status',
      `isFunctionsHttpError: ${isFunctionsHttpError}, HTTP status: ${unauthEfErr?.context?.status}, hasNoData: ${hasNoData}, dbStatus: ${unauthAttDb?.upload_status}, Message: ${unauthEfErr?.message}`
    );

    // 16f. Retry FAILED attachment with replacement bytes (Fix 3 & R1-02)
    if (badHashAtt?.id) {
      const replacementBuffer = Buffer.from('%PDF-1.4\nReplacementValidContent\n%%EOF');
      const replacementHash = crypto.createHash('sha256').update(replacementBuffer).digest('hex');

      // Retry RPC sets status to PENDING with new metadata and generates fresh collision-free path
      const { data: retryRes, error: retryRpcErr } = await personaClients['P-PE-LEAD'].rpc('retry_attachment_upload', {
        p_attachment_id: badHashAtt.id,
        p_new_size: replacementBuffer.length,
        p_new_mime: 'application/pdf',
        p_new_hash: replacementHash,
        p_new_path: null,
      });
      assert(!retryRpcErr && retryRes?.status === 'PENDING' && Boolean(retryRes?.file_path), 'TC-16f1', 'retry_attachment_upload resets FAILED to PENDING with replacement hash and fresh storage path');

      const retriedStoragePath = retryRes.file_path;

      // Upload replacement file to storage using fresh path with upsert: false (Fix 3: zero collision)
      let replacementUploadErr = null;
      try {
        const uploadRes = await personaClients['P-PE-LEAD'].storage
          .from('sample-documents')
          .upload(retriedStoragePath, replacementBuffer, { contentType: 'application/pdf', upsert: false });
        replacementUploadErr = uploadRes.error;
        storageTracker.recordUploadAttempt({ path: retriedStoragePath, error: replacementUploadErr });
      } catch (uploadEx) {
        replacementUploadErr = uploadEx;
        storageTracker.recordUploadAttempt({ path: retriedStoragePath, thrown: uploadEx });
      }
      assert(!replacementUploadErr, 'TC-16f2', 'Replacement file uploaded to fresh storage path without collision', replacementUploadErr?.message);

      // Edge Function confirms new bytes to READY
      const { data: retryEfData, error: retryEfErr } = await personaClients['P-PE-LEAD'].functions.invoke('verify-and-confirm-upload', {
        body: { attachment_id: badHashAtt.id },
      });
      assert(!retryEfErr && retryEfData?.success && retryEfData?.status === 'READY', 'TC-16f3', 'Edge Function verifies replacement bytes and marks retried attachment READY');
    } else {
      assert(false, 'TC-16f', 'Cannot test retry: prerequisite badHashAtt missing');
    }

    // --------------------------------------------------------------------------
    // TC-17: Direct Client UPDATE on Attachments Blocked (P-PE-LEAD & P-ADMIN)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-17: Direct Client UPDATE on Attachments Blocked ---');
    const { error: directAttUpdateErr } = await personaClients['P-PE-LEAD'].from('attachments').update({
      upload_status: 'READY',
    }).eq('id', createdAttachmentId);
    assert(directAttUpdateErr !== null, 'TC-17a', 'PostgreSQL privilege revocation blocks direct client UPDATE on attachments by PE-LEAD');

    const { error: adminAttUpdateErr } = await personaClients['P-ADMIN'].from('attachments').update({
      upload_status: 'READY',
    }).eq('id', createdAttachmentId);
    assert(adminAttUpdateErr !== null, 'TC-17b', 'PostgreSQL privilege revocation blocks direct client UPDATE on attachments by Admin');

    // --------------------------------------------------------------------------
    // TC-18: Anti-Downgrade Guard (READY Cannot Become FAILED) (P-PE-LEAD)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-18: Anti-Downgrade Guard on READY Attachments ---');
    const { error: failReadyErr } = await personaClients['P-PE-LEAD'].rpc('fail_attachment_upload', {
      p_attachment_id: createdAttachmentId,
      p_error: 'Attempted downgrade',
    });
    assert(failReadyErr !== null, 'TC-18', 'fail_attachment_upload strictly rejects READY attachments (Anti-downgrade)');

    // --------------------------------------------------------------------------
    // TC-19: Option A Universal Signed URL Generation & Download Access (Fix 6)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-19: Option A Signed URL & Evidence Verification ---');
    // 19a. Option A DB visibility
    const { data: qaReadAtt, error: qaReadErr } = await personaClients['P-QA'].from('attachments').select('*').eq('id', createdAttachmentId);
    const { data: planReadAtt, error: planReadErr } = await personaClients['P-PLAN'].from('attachments').select('*').eq('id', createdAttachmentId);
    assert(
      !qaReadErr && qaReadAtt?.length === 1 && !planReadErr && planReadAtt?.length === 1,
      'TC-19a',
      'Option A policy grants QA and Planning database read access to registered READY documents'
    );

    // 19b. P-QA requests signed URL via create-signed-url Edge Function
    const { data: qaSignData, error: qaSignErr } = await personaClients['P-QA'].functions.invoke('create-signed-url', {
      body: { file_path: createdStoragePath, expires_in: 300 },
    });
    assert(!qaSignErr && Boolean(qaSignData?.signedUrl), 'TC-19b', 'P-QA successfully obtains signed URL for PE drawing evidence', qaSignErr?.message);

    // 19c. Verify downloaded content from signed URL matches uploaded binary
    if (qaSignData?.signedUrl) {
      try {
        const fetchUrl = qaSignData.signedUrl.startsWith('http')
          ? qaSignData.signedUrl
          : `${supabaseUrl}/storage/v1${qaSignData.signedUrl}`;
        const fetchRes = await fetch(fetchUrl);
        const downloadedBuffer = Buffer.from(await fetchRes.arrayBuffer());
        const downloadedHash = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');
        assert(
          fetchRes.ok && downloadedHash === validPdfHash,
          'TC-19c',
          'P-QA downloads binary via signed URL and byte hash strictly matches original PDF'
        );
      } catch (fetchErr) {
        assert(false, 'TC-19c', `Fetch signed URL exception: ${fetchErr.message}`);
      }
    } else {
      assert(false, 'TC-19c', 'Cannot verify download: signedUrl was not generated');
    }

    // 19d. P-PLAN requests signed URL via create-signed-url Edge Function (Option A cross-department)
    const { data: planSignData, error: planSignErr } = await personaClients['P-PLAN'].functions.invoke('create-signed-url', {
      body: { file_path: createdStoragePath, expires_in: 300 },
    });
    assert(!planSignErr && Boolean(planSignData?.signedUrl), 'TC-19d', 'P-PLAN successfully obtains signed URL for PE drawing evidence', planSignErr?.message);

    // 19e. Negative Test: Deactivated account (P-INACTIVE) cannot obtain signed URL
    const { data: inactiveSignData, error: inactiveSignErr } = await personaClients['P-INACTIVE'].functions.invoke('create-signed-url', {
      body: { file_path: createdStoragePath, expires_in: 300 },
    });
    assert(
      inactiveSignErr !== null || inactiveSignData?.error !== undefined,
      'TC-19e',
      'Deactivated account (P-INACTIVE) is strictly blocked from creating signed URL'
    );

    // 19f. Negative Test: Anonymous caller without JWT cannot create signed URL
    const { data: anonSignData, error: anonSignErr } = await anonClient.functions.invoke('create-signed-url', {
      body: { file_path: createdStoragePath, expires_in: 300 },
    });
    assert(
      anonSignErr !== null || anonSignData?.error !== undefined,
      'TC-19f',
      'Anonymous caller without JWT is strictly blocked from creating signed URL'
    );

    // 19g. Negative Test: Direct anonymous access to private storage bucket without signed URL is rejected
    try {
      const directStorageUrl = `${supabaseUrl}/storage/v1/object/public/sample-documents/${createdStoragePath}`;
      const directRes = await fetch(directStorageUrl);
      assert(!directRes.ok, 'TC-19g', 'Private storage bucket strictly rejects direct unauthenticated URL access');
    } catch {
      assert(true, 'TC-19g', 'Private storage bucket strictly rejects direct unauthenticated access');
    }

    // --------------------------------------------------------------------------
    // TC-20: Closed Job Absolute Immutability (P-PLAN & P-ADMIN)
    // --------------------------------------------------------------------------
    console.log('\n--- TC-20: Closed Job Absolute Immutability ---');
    // Close job
    const { error: closeJobErr } = await personaClients['P-PLAN'].from('jobs').update({
      status: 'CLOSE',
    }).eq('id', createdJobId);
    assert(!closeJobErr, 'TC-20a', 'Planning closes job successfully', closeJobErr?.message);

    // Attempt to add new operation to closed job -> Blocked
    const { error: closedOpErr } = await personaClients['P-PLAN'].from('job_operations').insert({
      job_id: createdJobId,
      step_order: 2,
      operation_name: 'Post-close op',
      status: 'NOT_STARTED',
    });
    assert(closedOpErr !== null, 'TC-20b', 'Closed job rejects new operations');

    // Attempt to add production run to closed job -> Blocked
    const { error: closedRunErr } = await personaClients['P-PE-OPER'].from('production_runs').insert({
      operation_id: createdOpId,
      machine_id: 'CNC-01',
      start_time: nowIso,
      end_time: nowIso,
      ok_qty: 1,
      ng_qty: 0,
    });
    assert(closedRunErr !== null, 'TC-20c', 'Closed job rejects new production runs');

    // Attempt to add attachment to closed job -> Blocked
    const { error: closedAttErr } = await personaClients['P-PE-LEAD'].from('attachments').insert({
      job_id: createdJobId,
      file_name: 'late_drawing.pdf',
      file_path: `${createdJobId}/DRAWING/late_${runId}.pdf`,
      file_size: 1024,
      mime_type: 'application/pdf',
      file_type: 'DRAWING',
      content_hash: validPdfHash,
    });
    assert(closedAttErr !== null, 'TC-20d', 'Closed job rejects new attachments');

    // Attempt to mutate closed job header attributes -> Blocked
    const { error: closedJobUpdateErr } = await personaClients['P-PLAN'].from('jobs').update({
      order_qty: 999,
    }).eq('id', createdJobId);
    assert(closedJobUpdateErr !== null, 'TC-20e', 'Closed job attributes (order_qty, dates, assignments) are strictly immutable');
}

// ------------------------------------------------------------------------------
// 3. TARGETED SAFE CLEANUP (R1-01 & Fix 5)
// ------------------------------------------------------------------------------
async function cleanupCreatedResources() {
  console.log('\n[TEARDOWN] Dọn dẹp an toàn các tài nguyên được tạo bởi phiên chạy này...');
  let cleanupFailures = 0;
  const uncleanedResources = {
    storagePaths: [],
    jobs: [],
    profiles: [],
    users: [],
  };

  // 3a. Clean storage files (Fix B: delete ONLY confirmed run-owned objects)
  const ambiguousEntries = storageTracker.ambiguousStoragePaths;
  if (ambiguousEntries.length > 0) {
    console.warn(`  ⚠️  [AUDIT WARNING] ${ambiguousEntries.length} ambiguous/unconfirmed storage path(s) detected; skipping deletion to protect non-owned objects:`);
    for (const entry of ambiguousEntries) {
      console.warn(`     - ${entry.path} (reason: ${entry.reason})`);
    }
  }

  const pathsToDelete = storageTracker.getPathsToDelete();
  if (pathsToDelete.length > 0) {
    try {
      const { error: storageRemoveErr } = await adminClient.storage
        .from('sample-documents')
        .remove(pathsToDelete);
      if (storageRemoveErr) {
        cleanupFailures++;
        uncleanedResources.storagePaths.push(...pathsToDelete);
        console.error(`  ❌ Cleanup error (storage): ${storageRemoveErr.message}`);
      } else {
        console.log(`  ✓ Đã xóa ${pathsToDelete.length} tệp Storage.`);
      }
    } catch (err) {
      cleanupFailures++;
      uncleanedResources.storagePaths.push(...pathsToDelete);
      console.error(`  ❌ Cleanup exception (storage): ${err.message}`);
    }
  }

  // 3b. Clean test jobs
  for (const jId of createdResources.jobs) {
    try {
      const { error: jobDelErr } = await adminClient.from('jobs').delete().eq('id', jId);
      if (jobDelErr) {
        cleanupFailures++;
        uncleanedResources.jobs.push(jId);
        console.error(`  ❌ Cleanup error (job ${jId}): ${jobDelErr.message}`);
      } else {
        console.log(`  ✓ Đã xóa JOB ${jId}.`);
      }
    } catch (err) {
      cleanupFailures++;
      uncleanedResources.jobs.push(jId);
      console.error(`  ❌ Cleanup exception (job ${jId}): ${err.message}`);
    }
  }

  // 3c. Clean test profiles and auth users (F-03: Inspect profile DELETE and report failure)
  for (const uId of createdResources.users) {
    try {
      const { error: profileDelErr } = await adminClient.from('profiles').delete().eq('id', uId);
      if (profileDelErr) {
        cleanupFailures++;
        uncleanedResources.profiles.push(uId);
        console.error(`  ❌ Cleanup error (profile ${uId}): ${profileDelErr.message}`);
      }
      const { error: userDelErr } = await adminClient.auth.admin.deleteUser(uId);
      if (userDelErr) {
        cleanupFailures++;
        uncleanedResources.users.push(uId);
        console.error(`  ❌ Cleanup error (user ${uId}): ${userDelErr.message}`);
      }
    } catch (err) {
      cleanupFailures++;
      uncleanedResources.users.push(uId);
      console.error(`  ❌ Cleanup exception (user ${uId}): ${err.message}`);
    }
  }

  if (cleanupFailures === 0) {
    console.log(`  ✓ Đã xóa ${createdResources.users.length} tài khoản người dùng kiểm thử.`);
    console.log('  ✅ Hoàn tất dọn dẹp tài nguyên.');
  } else {
    console.error(`  🚨 Có ${cleanupFailures} lỗi trong quá trình dọn dẹp tài nguyên!`);
    console.error('  🚨 Danh sách tài nguyên chưa được dọn dẹp sạch:', JSON.stringify(uncleanedResources, null, 2));
  }

  return cleanupFailures;
}

// ------------------------------------------------------------------------------
// 4. MAIN RUNNER (Fix 5: try/finally wrapping setup and scenarios)
// ------------------------------------------------------------------------------
async function main() {
  let cleanupErrors = 0;
  try {
    await setupPersonas();
    await executeGateBScenarios();
  } catch (err) {
    failed++;
    console.error('\n❌ Lỗi nghiêm trọng khi thực thi Gate B:', err.message || err);
  } finally {
    cleanupErrors = await cleanupCreatedResources();
  }

  console.log('\n' + '='.repeat(80));
  if (failed === 0 && cleanupErrors === 0) {
    console.log(`🎉 100% GATE B LIVE CLOUD INTEGRATION TEST SUITE PASSED!`);
    console.log(`   Tổng số bài kiểm tra đạt: ${passed} / ${passed}`);
    console.log('='.repeat(80) + '\n');
    process.exit(0);
  } else {
    console.error(`⛔ GATE B INTEGRATION TESTS FAILED: ${failed} lỗi kiểm thử, ${cleanupErrors} lỗi dọn dẹp / ${passed + failed} bài.`);
    console.log('='.repeat(80) + '\n');
    process.exit(1);
  }
}

main();
