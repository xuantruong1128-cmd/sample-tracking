const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const CLOUDFLARE_PROD_PROJECT = 'sample-tracking-prod';
const CLOUDFLARE_PROD_URL = 'https://sample-tracking-prod.pages.dev';

async function main() {
  console.log('='.repeat(80));
  console.log('  DEPLOY DRAWING VIEWER ZOOM/PAN/CROP HOTFIX TO PRODUCTION');
  console.log(`  Project:   ${CLOUDFLARE_PROD_PROJECT}`);
  console.log(`  Live URL:  ${CLOUDFLARE_PROD_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Build Production Frontend
  console.log('\n[1] Compiling frontend with production configuration...');
  execSync('npm run build', { shell: 'cmd.exe', encoding: 'utf8', timeout: 120000 });
  console.log('  ✅ Production build completed successfully.');

  // 2. Scan Bundle for Secrets & Endpoints
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

  // Check Drawing Viewer Hotfix Signatures
  const hasOverlay = allJs.includes('drawing-interaction-overlay');
  const hasCropBtn = allJs.includes('crop-drawing-avatar-card-btn') || allJs.includes('crop-avatar-btn');
  const hasFitBtn = allJs.includes('fit-drawing-btn');
  console.log(`  Feature Signatures:`);
  console.log(`    - Drawing Interaction Overlay: ${hasOverlay}`);
  console.log(`    - Crop Avatar Button:          ${hasCropBtn}`);
  console.log(`    - Fit Drawing Button:          ${hasFitBtn}`);

  if (!hasOverlay || !hasCropBtn || !hasFitBtn) {
    throw new Error('CRITICAL ABORT: Drawing viewer features missing from compiled bundle!');
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
      'drawing_viewer_pan_left_click',
      'drawing_viewer_mouse_wheel_zoom',
      'drawing_viewer_crop_avatar',
    ],
  }, null, 2));

  console.log('\n🎉 PRODUCTION FRONTEND DEPLOYMENT SUCCESSFUL!');
}

main().catch(err => {
  console.error('\n❌ DEPLOYMENT FAILED:', err);
  process.exit(1);
});
