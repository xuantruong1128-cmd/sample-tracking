#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl.includes('hosppagbopdghlupnhlr')) {
  console.error('CRITICAL ABORT: Target is NOT Supabase TEST! (hosppagbopdghlupnhlr)');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function generateSecureTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  let pw = 'UatPass_';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < bytes.length; i++) {
    pw += chars[bytes[i] % chars.length];
  }
  return pw;
}

const UAT_ACCOUNTS = [
  {
    role: 'BD',
    phone: '0911000001',
    e164: '+84911000001',
    email: '84911000001@sampletracking.local',
    fullName: 'BD Reviewer UAT',
    department: 'Business Development',
    mustChangePw: true,
  },
  {
    role: 'PE-MFG',
    phone: '0911000002',
    e164: '+84911000002',
    email: '84911000002@sampletracking.local',
    fullName: 'PE Engineer UAT',
    department: 'PE-MFG',
    mustChangePw: true,
  },
  {
    role: 'Admin',
    phone: '0911000003',
    e164: '+84911000003',
    email: '84911000003@sampletracking.local',
    fullName: 'System Admin UAT',
    department: 'Ban Quản Trị',
    mustChangePw: true,
  },
];

async function setup() {
  console.log('='.repeat(80));
  console.log('  PROVISIONING AUTHORIZED UAT TEST ACCOUNTS ON SUPABASE TEST');
  console.log('='.repeat(80));

  const credentialsRecord = {};

  for (const acc of UAT_ACCOUNTS) {
    const tempPassword = generateSecureTempPassword();

    // Check if user exists
    const { data: userList, error: listErr } = await adminClient.auth.admin.listUsers();
    if (listErr) throw listErr;

    let existingUser = userList.users.find(
      (u) => u.email === acc.email || u.phone === acc.e164
    );

    let userId;
    if (existingUser) {
      userId = existingUser.id;
      console.log(`Updating existing auth user for ${acc.role} (${acc.phone})...`);
      const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
        password: tempPassword,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: {
          role: acc.role,
          full_name: acc.fullName,
          department: acc.department,
        },
      });
      if (updateErr) throw updateErr;
    } else {
      console.log(`Creating new auth user for ${acc.role} (${acc.phone})...`);
      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email: acc.email,
        phone: acc.e164,
        password: tempPassword,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: {
          role: acc.role,
          full_name: acc.fullName,
          department: acc.department,
        },
      });
      if (createErr) throw createErr;
      userId = newUser.user.id;
    }

    // Upsert profile
    const { error: profErr } = await adminClient.from('profiles').upsert({
      id: userId,
      email: acc.email,
      phone: acc.e164,
      full_name: acc.fullName,
      role: acc.role,
      department: acc.department,
      is_active: true,
      must_change_password: acc.mustChangePw,
      updated_at: new Date().toISOString(),
    });
    if (profErr) throw profErr;

    // Verify authentication works
    const { data: loginData, error: loginErr } = await anonClient.auth.signInWithPassword({
      email: acc.email,
      password: tempPassword,
    });
    if (loginErr || !loginData?.session) {
      throw new Error(`Auth verification failed for ${acc.role}: ${loginErr?.message}`);
    }
    await anonClient.auth.signOut();

    console.log(`  ✅ Account ${acc.role} (${acc.phone}) provisioned & verified active.`);

    credentialsRecord[acc.role] = {
      phone: acc.phone,
      e164: acc.e164,
      email: acc.email,
      fullName: acc.fullName,
      department: acc.department,
      mustChangePassword: acc.mustChangePw,
      tempPassword: tempPassword,
      status: 'VERIFIED_ACTIVE',
    };
  }

  // Save credentials securely to disk (DO NOT LOG PASSWORDS TO STDOUT)
  const credFilePath = path.resolve(__dirname, '../backups/uat_test_credentials.json');
  fs.writeFileSync(credFilePath, JSON.stringify(credentialsRecord, null, 2), { mode: 0o600 });
  console.log('\n✅ Secure temporary credentials saved to: backups/uat_test_credentials.json (0600)');
  console.log('✅ PASSWORDS ARE HIDDEN AND NOT LOGGED TO TERMINAL/REPORT.');
  console.log('='.repeat(80));
}

setup().catch((err) => {
  console.error('Error provisioning UAT accounts:', err);
  process.exit(1);
});
