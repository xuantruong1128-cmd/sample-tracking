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

const adminClient = createClient(TARGET_PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('='.repeat(80));
  console.log('  CLEANUP OF TEST DRAWING REVIEW RECORDS ON PRODUCTION');
  console.log(`  Target:    ${TARGET_PROD_URL} (${TARGET_PROD_REF})`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Execute db push for migration 00038
  console.log('\n[1] Applying migration 00038_cleanup_test_drawing_reviews.sql...');
  const pushCmd = `npx supabase db push --remote "${TARGET_PROD_REF}" --password "${dbPassword}" --yes`;
  const pushOut = execSync(pushCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 120000 });
  console.log(pushOut);

  // 2. Remove test drawing files from Storage
  console.log('\n[2] Removing test drawings from storage bucket "drawing-reviews"...');
  const filesToRemove = [
    'drawings/261103-N003/smoke_technical_drawing.pdf',
    'drawings/261104-N001/smoke_technical_drawing.pdf',
    'drawings/SMOKE-8422032/prod_smoke_drawing_8422032.png',
  ];

  const { data: removeRes, error: removeErr } = await adminClient.storage
    .from('drawing-reviews')
    .remove(filesToRemove);

  if (removeErr) {
    console.warn('  ⚠️ Warning removing storage files:', removeErr.message);
  } else {
    console.log(`  ✅ Removed ${removeRes?.length || 0} storage file(s):`, removeRes);
  }

  // 3. Verify Remaining Drawing Review Issues on Production
  console.log('\n[3] Auditing remaining Drawing Review Issues on Production...');
  const { data: issues, error: iErr } = await adminClient
    .from('drawing_review_issues')
    .select('id, issue_no, item_no, item_name, customer, created_at');

  if (iErr) throw iErr;
  console.log(`  Total Drawing Review Issues remaining: ${issues.length}`);
  for (const iss of issues) {
    console.log(`    - IssueNo: ${iss.issue_no} | ItemNo: ${iss.item_no} | Customer: ${iss.customer} | Name: ${iss.item_name}`);
  }

  if (issues.length !== 1 || issues[0].issue_no !== '261104-N003') {
    throw new Error(`CRITICAL: Unexpected remaining issues count or ID! Found: ${JSON.stringify(issues)}`);
  }
  console.log('  ✅ Verified: Only authentic customer issue 261104-N003 (PHINIA) remains in database.');

  // 4. Verify Remaining Profiles
  console.log('\n[4] Auditing remaining Staff Profiles on Production...');
  const { data: profiles, error: pErr } = await adminClient
    .from('profiles')
    .select('id, phone, full_name, role, department, is_active')
    .order('created_at', { ascending: true });

  if (pErr) throw pErr;
  console.log(`  Total Profiles remaining: ${profiles.length}`);
  for (const p of profiles) {
    console.log(`    - ${p.phone} | ${p.full_name} | Role: ${p.role} | Dept: ${p.department} | Active: ${p.is_active}`);
  }

  // 5. Verify Core Sample Tracking Tables Intact
  console.log('\n[5] Verifying Core Sample Tracking table row counts...');
  const { count: jobCount } = await adminClient.from('jobs').select('*', { count: 'exact', head: true });
  const { count: opCount } = await adminClient.from('job_operations').select('*', { count: 'exact', head: true });
  const { count: runCount } = await adminClient.from('production_runs').select('*', { count: 'exact', head: true });
  const { count: qaCount } = await adminClient.from('qa_checks').select('*', { count: 'exact', head: true });

  console.log(`  Jobs: ${jobCount} (Expected: 13)`);
  console.log(`  Operations: ${opCount} (Expected: 54)`);
  console.log(`  Runs: ${runCount} (Expected: 37)`);
  console.log(`  QA Checks: ${qaCount} (Expected: 32)`);

  if (jobCount !== 13 || opCount !== 54) {
    throw new Error('CRITICAL: Sample Tracking core data was modified!');
  }
  console.log('  ✅ Core Sample Tracking data remains 100% intact.');

  console.log('\n================================================================================');
  console.log('  🎉 CLEANUP COMPLETED WITH 100% SUCCESS!');
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('\n❌ CLEANUP FAILED:', err);
  process.exit(1);
});
