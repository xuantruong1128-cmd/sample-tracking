#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW V1.0 — PHASE E1 TEST FRONTEND DEPLOYMENT SCRIPT
 *
 * Target: Cloudflare Pages TEST Project 'sample-tracking'
 * Expected Domain: https://sample-tracking-89b.pages.dev
 * Target Supabase: hosppagbopdghlupnhlr (TEST)
 *
 * STRICT SAFETY INVARIANTS:
 * 1. MUST NOT target 'sample-tracking-prod'
 * 2. MUST NOT bundle Production Supabase 'uqvxtgvdmdfgtjwzsxlj'
 * 3. MUST NOT bundle any SUPABASE_SERVICE_ROLE_KEY
 * ==============================================================================
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_PROJECT_NAME = 'sample-tracking';
const PROD_PROJECT_NAME = 'sample-tracking-prod';
const TEST_SUPABASE_REF = 'hosppagbopdghlupnhlr';
const PROD_SUPABASE_REF = 'uqvxtgvdmdfgtjwzsxlj';

async function main() {
  console.log('='.repeat(80));
  console.log('  DRAWING REVIEW V1.0 — PHASE E1 TEST DEPLOYMENT ORCHESTRATOR');
  console.log(`  Target Cloudflare Project: ${TEST_PROJECT_NAME} (sample-tracking-89b.pages.dev)`);
  console.log(`  Target Supabase Backend:   ${TEST_SUPABASE_REF} (TEST ONLY)`);
  console.log(`  Timestamp:                 ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // --- STEP 1: SAFETY PRE-FLIGHT ---
  console.log('\n>>> STEP 1: TARGET & ENVIRONMENT SAFETY CHECKS <<<');
  if (TEST_PROJECT_NAME === PROD_PROJECT_NAME || TEST_PROJECT_NAME.includes('prod')) {
    throw new Error('CRITICAL ABORT: Target project name contains "prod"! Deployment halted.');
  }
  console.log(`  ✅ Confirmed Cloudflare Pages target is TEST: '${TEST_PROJECT_NAME}'`);

  // Ensure .env points to TEST
  const envPath = path.join(ROOT_DIR, '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (!envContent.includes(TEST_SUPABASE_REF)) {
    throw new Error(`CRITICAL ABORT: .env does not contain test project ref ${TEST_SUPABASE_REF}!`);
  }
  if (envContent.includes(PROD_SUPABASE_REF)) {
    throw new Error(`CRITICAL ABORT: .env contains production project ref ${PROD_SUPABASE_REF}!`);
  }
  console.log(`  ✅ .env verified pointing exclusively to TEST (${TEST_SUPABASE_REF})`);

  // --- STEP 2: ISOLATE .env.production TO PREVENT VITE FROM LOADING PROD CREDENTIALS ---
  console.log('\n>>> STEP 2: ISOLATING .env.production DURING TEST BUILD <<<');
  const prodEnvPath = path.join(ROOT_DIR, '.env.production');
  const prodEnvBackup = path.join(ROOT_DIR, '.env.production.isolated_backup');
  let prodEnvMoved = false;

  if (fs.existsSync(prodEnvPath)) {
    fs.renameSync(prodEnvPath, prodEnvBackup);
    prodEnvMoved = true;
    console.log('  ✅ .env.production temporarily isolated to prevent Vite production override');
  }

  try {
    // --- STEP 3: BUILD FRONTEND ---
    console.log('\n>>> STEP 3: BUILDING FRONTEND BUNDLE (tsc -b && vite build) <<<');
    const buildOutput = execSync('npm run build', {
      cwd: ROOT_DIR,
      shell: 'cmd.exe',
      encoding: 'utf8',
      timeout: 180000,
    });
    console.log(buildOutput);
    console.log('  ✅ Frontend build succeeded');

    // --- STEP 4: VERIFY DIST BUNDLE INTEGRITY & LEAK CHECKS ---
    console.log('\n>>> STEP 4: SCANNING DIST BUNDLE INTEGRITY & LEAK CHECKS <<<');
    const distAssetsDir = path.join(ROOT_DIR, 'dist', 'assets');
    const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    let foundTestRef = false;
    let foundProdRef = false;
    let foundSecret = false;

    for (const f of jsFiles) {
      const code = fs.readFileSync(path.join(distAssetsDir, f), 'utf8');
      if (code.includes(TEST_SUPABASE_REF)) {
        foundTestRef = true;
        console.log(`  ✅ Verified: '${f}' correctly references TEST Supabase (${TEST_SUPABASE_REF})`);
      }
      if (code.includes(PROD_SUPABASE_REF)) {
        foundProdRef = true;
        console.error(`  ❌ CRITICAL: '${f}' references PRODUCTION Supabase (${PROD_SUPABASE_REF})!`);
      }
      if (code.includes('service_role')) {
        foundSecret = true;
        console.error(`  ❌ CRITICAL: '${f}' leaks 'service_role' key!`);
      }
    }

    if (!foundTestRef) {
      throw new Error(`CRITICAL ABORT: TEST Supabase ref (${TEST_SUPABASE_REF}) was not found in dist assets!`);
    }
    if (foundProdRef) {
      throw new Error(`CRITICAL ABORT: PRODUCTION Supabase ref (${PROD_SUPABASE_REF}) leaked into dist assets!`);
    }
    if (foundSecret) {
      throw new Error(`CRITICAL ABORT: service_role key leaked into dist assets!`);
    }

    // Verify _redirects
    const redirectsPath = path.join(ROOT_DIR, 'dist', '_redirects');
    if (!fs.existsSync(redirectsPath)) {
      console.log('  Copying public/_redirects to dist/_redirects...');
      fs.copyFileSync(path.join(ROOT_DIR, 'public', '_redirects'), redirectsPath);
    }
    console.log('  ✅ dist/_redirects confirmed for SPA client routing');
    console.log('  ✅ 100% dist bundle safety verified');

    // --- STEP 5: DEPLOY TO CLOUDFLARE PAGES TEST ---
    console.log('\n>>> STEP 5: DEPLOYING TO CLOUDFLARE PAGES TEST PROJECT <<<');
    const deployCmd = `npx --yes wrangler pages deploy dist --project-name "${TEST_PROJECT_NAME}" --branch main`;
    console.log(`  Running: ${deployCmd}`);
    const deployOutput = execSync(deployCmd, {
      cwd: ROOT_DIR,
      shell: 'cmd.exe',
      encoding: 'utf8',
      timeout: 300000,
    });
    console.log(deployOutput);

    // Extract deployment URL
    const urlMatch = deployOutput.match(/https:\/\/[a-zA-Z0-9.-]+\.sample-tracking-89b\.pages\.dev/g) ||
                     deployOutput.match(/https:\/\/[a-zA-Z0-9.-]+\.pages\.dev/g);
    console.log('\n' + '='.repeat(80));
    console.log('  🎉 CLOUDFLARE PAGES TEST DEPLOYMENT SUCCESSFUL!');
    console.log(`  Primary Domain:    https://sample-tracking-89b.pages.dev`);
    if (urlMatch && urlMatch.length > 0) {
      console.log(`  Deployment URLs:   ${urlMatch.join(' , ')}`);
    }
    console.log('='.repeat(80));

    return {
      success: true,
      deployOutput,
      urlMatch,
    };
  } finally {
    // Restore .env.production
    if (prodEnvMoved && fs.existsSync(prodEnvBackup)) {
      fs.renameSync(prodEnvBackup, prodEnvPath);
      console.log('\n  ✅ .env.production restored successfully');
    }
  }
}

main().catch((err) => {
  console.error('\n🛑 DEPLOYMENT FAILURE:', err.message || err);
  process.exit(1);
});
