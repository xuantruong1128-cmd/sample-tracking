const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateSecurePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$^*()_-+=';
  const bytes = crypto.randomBytes(24);
  let password = 'Prod';
  for (let i = 0; i < bytes.length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password + '2026#';
}

async function run() {
  console.log('=== STEP 1: PREPARING PRODUCTION SUPABASE PROJECT ===');
  
  const orgId = 'nhyxyfqrzokpapmdywau'; // xuantruong1128@gmail.com's Org
  const projectName = 'sample-tracking-prod';
  const region = 'ap-northeast-2'; // Seoul, same as TEST
  const dbPassword = generateSecurePassword();

  // Save DB credentials securely to local backup
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const credPath = path.join(backupDir, 'production_db_credentials.json');
  fs.writeFileSync(credPath, JSON.stringify({
    projectName,
    orgId,
    region,
    dbPassword,
    createdAt: new Date().toISOString()
  }, null, 2), { mode: 0o600 });
  console.log(`[OK] Generated database password saved securely to backups/production_db_credentials.json`);

  console.log(`[INFO] Creating Supabase project '${projectName}' in region '${region}'...`);
  
  try {
    const cmd = `npx supabase projects create "${projectName}" --org-id "${orgId}" --region "${region}" --db-password "${dbPassword}" --output-format json`;
    const output = execSync(cmd, { shell: 'cmd.exe', encoding: 'utf-8', timeout: 120000 });
    console.log('[OUTPUT]', output);
    
    // Parse output to find new project ID
    let createdProject = null;
    try {
      createdProject = JSON.parse(output);
    } catch {
      // In case there is extra stdout text
      const match = output.match(/\{[\s\S]*\}/);
      if (match) createdProject = JSON.parse(match[0]);
    }
    
    console.log('[SUCCESS] Project created:', createdProject);
  } catch (err) {
    console.error('[ERROR] Failed to create project via CLI:', err.message);
    if (err.stdout) console.error('[STDOUT]', err.stdout);
    if (err.stderr) console.error('[STDERR]', err.stderr);
    process.exit(1);
  }
}

run();
