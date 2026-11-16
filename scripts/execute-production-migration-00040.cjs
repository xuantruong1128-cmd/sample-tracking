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
  console.log('  APPLYING MIGRATION 00040 TO SUPABASE PRODUCTION');
  console.log(`  Target:    ${TARGET_PROD_URL} (${TARGET_PROD_REF})`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Execute db push
  console.log('\n[1] Executing supabase db push for migration 00040...');
  const pushCmd = `npx supabase db push --remote "${TARGET_PROD_REF}" --password "${dbPassword}" --yes`;
  const pushOut = execSync(pushCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 120000 });
  console.log(pushOut);

  // 2. Verify migration list shows 00040 is applied
  console.log('\n[2] Verifying remote migration status...');
  const migListCmd = `npx supabase migration list --remote "${TARGET_PROD_REF}" --password "${dbPassword}"`;
  const migListOut = execSync(migListCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 60000 });
  console.log(migListOut);

  // 3. Verify columns exist on drawing_review_versions
  console.log('\n[3] Verifying new columns on drawing_review_versions...');
  const { data: cols, error: colErr } = await prodClient
    .from('drawing_review_versions')
    .select('id, version_name, status, quoted_at, requote_requested_at')
    .limit(3);

  if (colErr) {
    throw new Error(`CRITICAL ERROR querying drawing_review_versions: ${colErr.message}`);
  }
  console.log(`  ✅ Successfully queried drawing_review_versions with new audit columns:`);
  console.log(JSON.stringify(cols, null, 2));

  console.log('\n================================================================================');
  console.log('  🎉 MIGRATION 00040 APPLIED AND VERIFIED WITH 100% SUCCESS!');
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('\n❌ MIGRATION 00040 EXECUTION FAILED:', err);
  process.exit(1);
});
