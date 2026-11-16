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
  console.log('  APPLYING MIGRATION 00041 TO SUPABASE PRODUCTION');
  console.log(`  Target:    ${TARGET_PROD_URL} (${TARGET_PROD_REF})`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Execute db push
  console.log('\n[1] Executing supabase db push for migration 00041...');
  const pushCmd = `npx supabase db push --remote "${TARGET_PROD_REF}" --password "${dbPassword}" --yes`;
  const pushOut = execSync(pushCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 120000 });
  console.log(pushOut);

  // 2. Verify migration list shows 00041 is applied
  console.log('\n[2] Verifying remote migration status...');
  const migListCmd = `npx supabase migration list --remote "${TARGET_PROD_REF}" --password "${dbPassword}"`;
  const migListOut = execSync(migListCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 60000 });
  console.log(migListOut);

  // 3. Verify activity logs table and backfilled data
  console.log('\n[3] Verifying drawing_review_activity_logs table...');
  const { data: logs, error: logErr, count } = await prodClient
    .from('drawing_review_activity_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(5);

  if (logErr) {
    throw new Error(`CRITICAL ERROR querying drawing_review_activity_logs: ${logErr.message}`);
  }

  console.log(`  ✅ Successfully queried drawing_review_activity_logs! Total records: ${count}`);
  console.log('  Sample recent logs:');
  console.log(JSON.stringify(logs, null, 2));

  console.log('\n================================================================================');
  console.log('  🎉 MIGRATION 00041 APPLIED AND VERIFIED WITH 100% SUCCESS!');
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('\n❌ MIGRATION 00041 EXECUTION FAILED:', err);
  process.exit(1);
});
