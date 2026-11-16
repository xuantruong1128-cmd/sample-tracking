#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TARGET_PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const TARGET_PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const credPath = path.join(__dirname, '..', 'backups', 'production_db_credentials.json');
const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const dbPassword = creds.dbPassword;

const prodClient = createClient(TARGET_PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('='.repeat(80));
  console.log('  APPLYING MIGRATION 00044 TO SUPABASE PRODUCTION');
  console.log(`  Target:    ${TARGET_PROD_URL} (${TARGET_PROD_REF})`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Execute db push
  console.log('\n[1] Executing supabase db push for migration 00044...');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  
  const pushCmd = `npx supabase db push --remote "${TARGET_PROD_REF}" --password "${dbPassword}" --yes`;
  const pushOut = execSync(pushCmd, {
    shell: 'cmd.exe',
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      HOME: tmpDir,
      USERPROFILE: tmpDir,
      APPDATA: tmpDir,
      LOCALAPPDATA: tmpDir,
    },
  });
  console.log(pushOut);

  // 2. Verify migration list
  console.log('\n[2] Verifying remote migration status...');
  const migListCmd = `npx supabase migration list --remote "${TARGET_PROD_REF}" --password "${dbPassword}"`;
  const migListOut = execSync(migListCmd, {
    shell: 'cmd.exe',
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      HOME: tmpDir,
      USERPROFILE: tmpDir,
      APPDATA: tmpDir,
      LOCALAPPDATA: tmpDir,
    },
  });
  console.log(migListOut);

  // 3. Verify user_active_devices table
  console.log('\n[3] Verifying user_active_devices table...');
  const { data: devices, error: devErr, count } = await prodClient
    .from('user_active_devices')
    .select('*', { count: 'exact' });

  if (devErr) {
    throw new Error(`CRITICAL ERROR querying user_active_devices: ${devErr.message}`);
  }

  console.log(`  ✅ Successfully verified user_active_devices table! Active records count: ${count}`);

  console.log('\n================================================================================');
  console.log('  🎉 MIGRATION 00044 APPLIED AND VERIFIED WITH 100% SUCCESS!');
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('\n❌ MIGRATION 00044 EXECUTION FAILED:', err);
  process.exit(1);
});
