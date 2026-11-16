const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const credPath = path.join(__dirname, '..', 'backups', 'production_db_credentials.json');
const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const TARGET_PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const dbPassword = creds.dbPassword;

try {
  const cmd = `npx supabase db push --dry-run --remote "${TARGET_PROD_REF}" --password "${dbPassword}"`;
  console.log('Running:', cmd.replace(dbPassword, '******'));
  const out = execSync(cmd, { shell: 'cmd.exe', encoding: 'utf8' });
  console.log('Output:\n', out);
} catch (e) {
  console.error('Error:', e.message);
  if (e.stdout) console.log('Stdout:', e.stdout);
  if (e.stderr) console.error('Stderr:', e.stderr);
}
