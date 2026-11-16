#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING — PRODUCTION R1 DEPLOYMENT ORCHESTRATOR
 * Script: scripts/execute-production-deployment-r1.cjs
 * ==============================================================================
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { takePreSnapshot, verifyPostDeploy } = require('./production-deploy-guard.cjs');

const projectRef = 'uqvxtgvdmdfgtjwzsxlj';
const prodUrl = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';

async function runProductionDeployment() {
  console.log('='.repeat(80));
  console.log('   SAMPLE TRACKING — PRODUCTION R1 LIVE DEPLOYMENT');
  console.log(`   Target Project: ${prodUrl} (${projectRef})`);
  console.log(`   Timestamp:      ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // STEP 1: PRE-DEPLOY SNAPSHOT
  console.log('\n>>> STEP 1: TAKING LIVE PRE-DEPLOYMENT CRYPTOGRAPHIC SNAPSHOT <<<');
  const snapshot = await takePreSnapshot();
  const snapshotPath = path.resolve(__dirname, '..', 'backups', 'pre_deploy_snapshot_live.json');

  // STEP 2: APPLY DATABASE MIGRATION 00026
  console.log('\n>>> STEP 2: APPLYING MIGRATION 00026 TO PRODUCTION DATABASE <<<');
  const dbOut = execSync('node scripts/deploy-production-db.cjs', {
    encoding: 'utf-8',
    timeout: 300000,
  });
  console.log(dbOut);

  // STEP 3: DEPLOY EDGE FUNCTIONS
  console.log('\n>>> STEP 3: DEPLOYING EDGE FUNCTIONS TO PRODUCTION <<<');
  const fnOut = execSync('node scripts/deploy-production-functions.cjs', {
    encoding: 'utf-8',
    timeout: 300000,
  });
  console.log(fnOut);

  // STEP 4: POST-DEPLOY DATA INTEGRITY VERIFICATION
  console.log('\n>>> STEP 4: VERIFYING ZERO DATA LOSS & POST-DEPLOY INTEGRITY <<<');
  const verified = await verifyPostDeploy(snapshotPath);

  if (!verified) {
    console.error('\n🛑 POST-DEPLOY INTEGRITY FAILED! Check discrepancies above.');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('   🎉 PRODUCTION R1 DEPLOYMENT COMPLETED WITH ZERO DATA LOSS!');
  console.log('================================================================================');
}

runProductionDeployment().catch((err) => {
  console.error('\n❌ Fatal deployment failure:', err);
  process.exit(1);
});
