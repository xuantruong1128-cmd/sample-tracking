const { execSync } = require('child_process');

const projectRef = 'uqvxtgvdmdfgtjwzsxlj';
const functions = [
  'admin-manage-user',
  'create-signed-url',
  'generate-final-report',
  'get-report-download-url',
  'verify-and-confirm-upload'
];

console.log(`=== STEP 3: DEPLOYING EDGE FUNCTIONS TO PRODUCTION (${projectRef}) ===`);

for (const fn of functions) {
  console.log(`\n[INFO] Deploying function '${fn}'...`);
  try {
    const cmd = `npx supabase functions deploy ${fn} --project-ref ${projectRef} --no-verify-jwt`;
    const output = execSync(cmd, { shell: 'cmd.exe', encoding: 'utf-8', timeout: 120000 });
    console.log(`[OK] '${fn}' deployed successfully.`);
    console.log(output.trim());
  } catch (err) {
    console.error(`[ERROR] Failed to deploy '${fn}':`, err.message);
    if (err.stdout) console.error('[STDOUT]', err.stdout);
    if (err.stderr) console.error('[STDERR]', err.stderr);
    process.exit(1);
  }
}

console.log('\n[SUCCESS] All 5 Edge Functions deployed successfully to Production!');
