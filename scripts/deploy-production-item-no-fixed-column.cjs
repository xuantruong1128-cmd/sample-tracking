const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const CLOUDFLARE_PROD_PROJECT = 'sample-tracking-prod';
const CLOUDFLARE_PROD_URL = 'https://sample-tracking-prod.pages.dev';

async function main() {
  console.log('='.repeat(80));
  console.log('  DEPLOY ITEM NO. FIXED COLUMN UPDATE TO CLOUDFLARE PAGES PRODUCTION');
  console.log(`  Project:   ${CLOUDFLARE_PROD_PROJECT}`);
  console.log(`  Live URL:  ${CLOUDFLARE_PROD_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Build Production Frontend
  console.log('\n[1] Building production bundle...');
  execSync('npm run build', { shell: 'cmd.exe', encoding: 'utf8', timeout: 120000 });
  console.log('  ✅ Production build completed successfully.');

  // 2. Scan Bundle for Secrets & Signatures
  console.log('\n[2] Scanning dist/ assets...');
  const distAssetsDir = path.resolve(__dirname, '..', 'dist', 'assets');
  const jsFiles = fs.readdirSync(distAssetsDir).filter(f => f.endsWith('.js'));
  let totalChars = 0;
  let allJs = '';

  for (const f of jsFiles) {
    const content = fs.readFileSync(path.join(distAssetsDir, f), 'utf8');
    totalChars += content.length;
    allJs += content;
  }

  const prodMatches = (allJs.match(new RegExp(TARGET_PROD_REF, 'g')) || []).length;
  const testMatches = (allJs.match(/hosppagbopdghlupnhlr/g) || []).length;
  const serviceMatches = (allJs.match(/service_role/g) || []).length;

  console.log(`  Bundle size: ${totalChars.toLocaleString()} chars across ${jsFiles.length} JS files.`);
  console.log(`  Production Supabase ref (${TARGET_PROD_REF}): ${prodMatches} occurrence(s)`);
  console.log(`  TEST Supabase ref: ${testMatches} occurrence(s)`);
  console.log(`  Leaked service_role tokens: ${serviceMatches} occurrence(s)`);

  if (prodMatches === 0) throw new Error('CRITICAL ABORT: Production Supabase URL missing from bundle!');
  if (testMatches > 0) throw new Error('CRITICAL LEAK: TEST Supabase URL found in bundle!');
  if (serviceMatches > 0) throw new Error('CRITICAL LEAK: service_role secret found in bundle!');

  // Check Item No. Fixed Column Signatures
  const hasItemNoCol = allJs.includes('job-col-item_no');
  const hasJobTicketCol = allJs.includes('job-col-job_ticket');
  console.log(`  Feature Signatures:`);
  console.log(`    - Item No. Column Element:   ${hasItemNoCol}`);
  console.log(`    - Job Ticket Column Element: ${hasJobTicketCol}`);

  if (!hasItemNoCol || !hasJobTicketCol) {
    throw new Error('CRITICAL ABORT: Column signatures missing from compiled bundle!');
  }

  // 3. Deploy to Cloudflare Pages
  console.log(`\n[3] Deploying bundle to Cloudflare Pages (${CLOUDFLARE_PROD_PROJECT})...`);
  const deployCmd = `npx wrangler pages deploy dist --project-name "${CLOUDFLARE_PROD_PROJECT}" --branch "main" --commit-dirty=true`;
  const deployOut = execSync(deployCmd, { shell: 'cmd.exe', encoding: 'utf8', timeout: 180000 });
  console.log(deployOut);

  // Extract Deployment URL and ID
  const urlMatch = deployOut.match(/https:\/\/[a-f0-9]+\.sample-tracking-prod\.pages\.dev/);
  const deploymentUrl = urlMatch ? urlMatch[0] : CLOUDFLARE_PROD_URL;
  const deploymentId = urlMatch ? urlMatch[0].replace('https://', '').split('.')[0] : 'main-prod';

  console.log(`  ✅ Live Deployment Complete!`);
  console.log(`  Deployment ID:  ${deploymentId}`);
  console.log(`  Deployment URL: ${deploymentUrl}`);
  console.log(`  Production URL: ${CLOUDFLARE_PROD_URL}`);

  // 4. Verify Live Cloudflare Deployment via HTTP
  console.log('\n[4] Probing live Cloudflare Pages production URL...');
  await new Promise((resolve, reject) => {
    https.get(CLOUDFLARE_PROD_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 400 && data.includes('<div id="root">')) {
          console.log(`  ✅ HTTP probe successful: status ${res.statusCode}, HTML payload intact.`);
          resolve();
        } else {
          reject(new Error(`HTTP probe failed with status ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });

  // Save metadata
  const metaPath = path.resolve(__dirname, '..', 'backups', 'latest_prod_deployment.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    deploymentId,
    deploymentUrl,
    productionUrl: CLOUDFLARE_PROD_URL,
    project: CLOUDFLARE_PROD_PROJECT,
    features: [
      'item_no_sticky_fixed_leftmost_column',
      'job_ticket_regular_column',
      '2_device_session_limit',
      'desktop_mobile_auto_detect',
      'device_slot_conflict_warning_modal',
      'admin_revoke_all_user_devices',
      'drawing_review_save_error_modal',
    ],
  }, null, 2));

  console.log('\n================================================================================');
  console.log('  🎉 PRODUCTION FRONTEND DEPLOYMENT COMPLETED WITH 100% SUCCESS!');
  console.log(`  Deployment ID: ${deploymentId}`);
  console.log(`  Live URL:      ${CLOUDFLARE_PROD_URL}`);
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('\n❌ DEPLOYMENT FAILED:', err.message);
  process.exit(1);
});
