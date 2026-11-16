const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const credPath = path.join(__dirname, '..', 'backups', 'production_db_credentials.json');
if (!fs.existsSync(credPath)) {
  console.error('[ERROR] Credentials file not found at:', credPath);
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
const projectRef = 'uqvxtgvdmdfgtjwzsxlj';
const dbPassword = creds.dbPassword;

console.log(`=== STEP 2: APPLYING MIGRATIONS TO PRODUCTION (${projectRef}) ===`);

try {
  // Use percent-encoding or pass via -p flag
  const cmd = `npx supabase db push --project-ref "${projectRef}" --include-all --yes`;
  console.log(`[INFO] Running: npx supabase db push --project-ref ${projectRef} ...`);
  const output = execSync(cmd, {
    shell: 'cmd.exe',
    encoding: 'utf-8',
    timeout: 300000,
    env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
  });
  console.log('[OUTPUT]\n', output);
  console.log('[SUCCESS] Migrations successfully pushed to Production database!');
} catch (err) {
  console.error('[ERROR] Migration push failed:', err.message);
  if (err.stdout) console.error('[STDOUT]', err.stdout);
  if (err.stderr) console.error('[STDERR]', err.stderr);
  process.exit(1);
}
