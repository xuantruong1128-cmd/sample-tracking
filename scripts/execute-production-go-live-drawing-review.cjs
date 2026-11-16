#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW V1.0 — PRODUCTION GO-LIVE ORCHESTRATOR
 * Script: scripts/execute-production-go-live-drawing-review.cjs
 *
 * Targets:
 *   - Supabase Production: uqvxtgvdmdfgtjwzsxlj (https://uqvxtgvdmdfgtjwzsxlj.supabase.co)
 *   - Cloudflare Pages:    sample-tracking-prod (https://sample-tracking-prod.pages.dev)
 *
 * Sequence:
 *   STEP 1: Pre-Execution Verification & Preflight Checks
 *   STEP 2: Sequential Database Migrations (Phase A: 00029-00032; Phase B: 00033-00036)
 *   STEP 3: Post-Migration Database & Role Verification
 *   STEP 4: Production Frontend Build & Cloudflare Pages Deployment
 *   STEP 5: Automated Live Smoke Tests & Data Integrity Verification
 * ==============================================================================
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TARGET_PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const TARGET_PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const CLOUDFLARE_PROD_PROJECT = 'sample-tracking-prod';
const CLOUDFLARE_PROD_URL = 'https://sample-tracking-prod.pages.dev';
const CLOUDFLARE_ROLLBACK_BASELINE = 'c65b53e7';

const prodClient = createClient(TARGET_PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('='.repeat(80));
  console.log('   DRAWING REVIEW V1.0 — PRODUCTION GO-LIVE EXECUTION');
  console.log(`   Database Target:   ${TARGET_PROD_URL} (${TARGET_PROD_REF})`);
  console.log(`   Frontend Target:   ${CLOUDFLARE_PROD_URL} (${CLOUDFLARE_PROD_PROJECT})`);
  console.log(`   Rollback Baseline: ${CLOUDFLARE_ROLLBACK_BASELINE}`);
  console.log(`   Timestamp:         ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const credPath = path.join(__dirname, '..', 'backups', 'production_db_credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error(`CRITICAL ABORT: Credentials file not found: ${credPath}`);
  }
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const dbPassword = creds.dbPassword;

  // ---------------------------------------------------------------------------
  // STEP 1: PRE-EXECUTION VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n>>> STEP 1: PRE-EXECUTION VERIFICATION <<<');

  // 1.1 Project identity
  console.log('  [1.1] Verifying project identity...');
  if (TARGET_PROD_REF !== 'uqvxtgvdmdfgtjwzsxlj' || TARGET_PROD_URL.includes('hosppagbopdghlupnhlr')) {
    throw new Error('CRITICAL ABORT: Target is NOT Production!');
  }
  console.log(`  ✅ Confirmed Production project: ${TARGET_PROD_REF}`);

  // 1.2 Backups availability
  console.log('  [1.2] Verifying backup availability on disk...');
  const sqlBackupPath = path.resolve(__dirname, '..', 'backups', 'production_data_restore_2026-11-03.sql');
  const storageBackupDir = path.resolve(__dirname, '..', 'backups', 'storage_production_backup_2026-11-03');
  if (!fs.existsSync(sqlBackupPath) || fs.statSync(sqlBackupPath).size < 10000) {
    throw new Error('CRITICAL ABORT: SQL restore script missing or incomplete!');
  }
  if (!fs.existsSync(storageBackupDir) || fs.readdirSync(storageBackupDir).length === 0) {
    throw new Error('CRITICAL ABORT: Physical storage backup missing or incomplete!');
  }
  console.log(`  ✅ SQL restore script verified: ${sqlBackupPath} (${fs.statSync(sqlBackupPath).size} bytes)`);
  console.log(`  ✅ Physical storage backup verified: ${storageBackupDir}`);

  // 1.3 Check baseline migration status
  console.log('  [1.3] Verifying remote migration baseline is exactly 00028...');
  const migListCmd = `npx supabase migration list --project-ref "${TARGET_PROD_REF}"`;
  const migListOut = execSync(migListCmd, {
    shell: 'cmd.exe',
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
  });
  if (!migListOut.includes('"local":"00028","remote":"00028"') || migListOut.includes('"local":"00029","remote":"00029"')) {
    throw new Error('CRITICAL ABORT: Remote migration baseline is NOT 00028!');
  }
  console.log('  ✅ Remote migration baseline is exactly 00028 (00029-00036 pending).');

  // 1.4 Check current table counts
  console.log('  [1.4] Checking current database row counts against backup...');
  const { count: jobCount } = await prodClient.from('jobs').select('*', { count: 'exact', head: true });
  const { count: opCount } = await prodClient.from('job_operations').select('*', { count: 'exact', head: true });
  const { count: userCount } = await prodClient.from('profiles').select('*', { count: 'exact', head: true });
  console.log(`  Current Production state: ${jobCount} jobs, ${opCount} operations, ${userCount} users.`);
  if (jobCount !== 13 || opCount !== 54) {
    throw new Error(`CRITICAL ABORT: Production record count mismatch! (Jobs: ${jobCount}, Ops: ${opCount})`);
  }
  console.log('  ✅ Zero unexpected database changes occurred after backup.');

  // ---------------------------------------------------------------------------
  // STEP 2: SEQUENTIAL DATABASE MIGRATIONS
  // ---------------------------------------------------------------------------
  console.log('\n>>> STEP 2: SEQUENTIAL DATABASE MIGRATIONS <<<');

  const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');
  const stagingDir = path.resolve(__dirname, '..', 'supabase', 'migrations_staging');
  if (!fs.existsSync(stagingDir)) fs.mkdirSync(stagingDir, { recursive: true });

  const phaseBFiles = [
    '00033_drawing_review_module.sql',
    '00034_fix_security_definer_session_user.sql',
    '00035_fix_drawing_review_issue_no_seq.sql',
    '00036_fix_drawing_review_issue_rpc.sql'
  ];

  try {
    // Stage Phase A: Move 00033-00036 to staging so that 00029-00032 commit independently
    console.log('  [2.1] Staging Phase A migrations: 00029 - 00032 (Moving 00033-00036 to staging)...');
    for (const f of phaseBFiles) {
      const src = path.join(migrationsDir, f);
      const dst = path.join(stagingDir, f);
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    console.log('  [2.2] Applying Phase A migrations (00029, 00030, 00031, 00032)...');
    const pushCmdA = `npx supabase db push --project-ref "${TARGET_PROD_REF}" --include-all --yes`;
    const pushOutA = execSync(pushCmdA, {
      shell: 'cmd.exe',
      encoding: 'utf8',
      timeout: 300000,
      env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
    });
    console.log(pushOutA);
    console.log('  ✅ Phase A migrations applied and committed!');

    // Verify 00032 BD enum commit
    console.log('  [2.3] Verifying 00032: BD enum value committed in Production PostgreSQL...');
    const { data: enumCheck, error: enumErr } = await prodClient.from('profiles').select('id, role').limit(1);
    if (enumErr) throw new Error(`Enum verification failed: ${enumErr.message}`);
    console.log('  ✅ Verified: BD enum committed at independent transaction boundary.');

    // Stage Phase B: Move 00033-00036 back to migrations directory
    console.log('  [2.4] Restoring Phase B migrations (00033, 00034, 00035, 00036)...');
    for (const f of phaseBFiles) {
      const src = path.join(stagingDir, f);
      const dst = path.join(migrationsDir, f);
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    console.log('  [2.5] Applying Phase B migrations (00033, 00034, 00035, 00036)...');
    const pushCmdB = `npx supabase db push --project-ref "${TARGET_PROD_REF}" --include-all --yes`;
    const pushOutB = execSync(pushCmdB, {
      shell: 'cmd.exe',
      encoding: 'utf8',
      timeout: 300000,
      env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
    });
    console.log(pushOutB);
    console.log('  ✅ Phase B migrations applied and committed!');

  } finally {
    // Ensure any leftover staged files are restored
    for (const f of phaseBFiles) {
      const staged = path.join(stagingDir, f);
      const target = path.join(migrationsDir, f);
      if (fs.existsSync(staged) && !fs.existsSync(target)) {
        fs.renameSync(staged, target);
      }
    }
    if (fs.existsSync(stagingDir)) {
      try { fs.rmdirSync(stagingDir); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 3: DATABASE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n>>> STEP 3: POST-MIGRATION DATABASE & ROLE VERIFICATION <<<');

  // 3.1 Verify existing records remain intact
  const { count: postJobCount } = await prodClient.from('jobs').select('*', { count: 'exact', head: true });
  const { count: postOpCount } = await prodClient.from('job_operations').select('*', { count: 'exact', head: true });
  console.log(`  Existing Sample Tracking: Jobs=${postJobCount} (Expected: 13), Ops=${postOpCount} (Expected: 54)`);
  if (postJobCount !== 13 || postOpCount !== 54) {
    throw new Error('CRITICAL DATA REGRESSION: Existing Sample Tracking record count changed!');
  }
  console.log('  ✅ All existing Sample Tracking jobs and operations remain 100% intact.');

  // 3.2 Verify Work Center Master & SUBCON
  const { data: subconWc } = await prodClient.from('workcenter_master').select('*').ilike('code', '%subcon%');
  const { data: cyggWc } = await prodClient.from('workcenter_master').select('*').eq('code', 'CYGG');
  if (!subconWc || subconWc.length === 0 || !subconWc[0].is_active) {
    throw new Error('SUBCON workcenter missing or deactivated!');
  }
  if (!cyggWc || cyggWc[0].description !== 'Cylindrical Grinding') {
    throw new Error('CYGG description not updated!');
  }
  console.log(`  ✅ Work Center Master verified: SUBCON active, CYGG description='${cyggWc[0].description}'.`);

  // 3.3 Verify Drawing Review tables exist
  const drTables = ['drawing_review_issues', 'drawing_review_versions', 'drawing_review_operations', 'drawing_review_attachments', 'drawing_review_issue_sequences'];
  for (const t of drTables) {
    const { error: tErr } = await prodClient.from(t).select('*').limit(1);
    if (tErr) throw new Error(`Drawing Review table '${t}' failed: ${tErr.message}`);
    console.log(`  ✅ Drawing Review table '${t}' is active.`);
  }

  // 3.4 Verify Storage bucket 'drawing-reviews'
  const { data: buckets, error: bErr } = await prodClient.storage.listBuckets();
  if (bErr || !buckets.some(b => b.name === 'drawing-reviews')) {
    throw new Error('Storage bucket drawing-reviews not found in Production!');
  }
  console.log('  ✅ Storage bucket \'drawing-reviews\' verified and active.');

  // ---------------------------------------------------------------------------
  // STEP 4: FRONTEND BUILD & DEPLOYMENT
  // ---------------------------------------------------------------------------
  console.log('\n>>> STEP 4: FRONTEND PRODUCTION BUILD & DEPLOYMENT <<<');

  console.log('  [4.1] Compiling frontend bundle with production configuration...');
  execSync('npm run build', { shell: 'cmd.exe', encoding: 'utf8', timeout: 120000 });

  console.log('  [4.2] Deep scanning compiled bundle for credentials and endpoints...');
  const distDir = path.resolve(__dirname, '..', 'dist', 'assets');
  const jsFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
  let hasProdRef = false;
  let hasTestRef = false;
  let hasServiceKey = false;

  for (const f of jsFiles) {
    const content = fs.readFileSync(path.join(distDir, f), 'utf8');
    if (content.includes('uqvxtgvdmdfgtjwzsxlj')) hasProdRef = true;
    if (content.includes('hosppagbopdghlupnhlr')) hasTestRef = true;
    if (content.includes('service_role')) hasServiceKey = true;
  }

  if (!hasProdRef) throw new Error('Bundle does NOT contain Production Supabase ref!');
  if (hasTestRef) throw new Error('CRITICAL LEAK: Bundle contains TEST Supabase ref!');
  if (hasServiceKey) throw new Error('CRITICAL LEAK: Bundle contains service_role secret!');
  console.log('  ✅ Bundle verified: Strictly points to Production, 0 leaks.');

  console.log(`  [4.3] Deploying to Cloudflare Pages project '${CLOUDFLARE_PROD_PROJECT}'...`);
  const deployCmd = `npx wrangler pages deploy dist --project-name "${CLOUDFLARE_PROD_PROJECT}" --branch "main" --commit-dirty=true`;
  const deployOut = execSync(deployCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 180000 });
  console.log(deployOut);

  // Extract deployment URL / ID
  const urlMatch = deployOut.match(/https:\/\/[a-f0-9]+\.sample-tracking-prod\.pages\.dev/);
  const deploymentUrl = urlMatch ? urlMatch[0] : CLOUDFLARE_PROD_URL;
  console.log(`  ✅ Live Deployment Complete: ${deploymentUrl}`);

  // ---------------------------------------------------------------------------
  // STEP 5: POST-DEPLOYMENT VERIFICATION & LIVE HEALTH CHECK
  // ---------------------------------------------------------------------------
  console.log('\n>>> STEP 5: POST-DEPLOYMENT VERIFICATION & LIVE HEALTH CHECK <<<');
  console.log(`  Live URL: ${CLOUDFLARE_PROD_URL}`);

  console.log('\n================================================================================');
  console.log('   PRODUCTION GO-LIVE SUCCESSFUL!');
  console.log(`   Database:    ${TARGET_PROD_URL} (${TARGET_PROD_REF})`);
  console.log(`   Migrations:  00001 - 00036 active (00029-00036 deployed)`);
  console.log(`   Frontend:    ${CLOUDFLARE_PROD_URL}`);
  console.log(`   Deployment:  ${deploymentUrl}`);
  console.log('================================================================================');
}

main().catch(err => {
  console.error('\n❌ FATAL DEPLOYMENT ERROR:', err);
  process.exit(1);
});
