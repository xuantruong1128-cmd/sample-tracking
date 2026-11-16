const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRef = 'uqvxtgvdmdfgtjwzsxlj';
const tmpDir = path.join(__dirname, '..', '.tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

console.log(`Deploying admin-manage-user Edge Function to ${projectRef}...`);
const cmd = `npx supabase functions deploy admin-manage-user --remote=${projectRef} --no-verify-jwt --yes`;
const out = execSync(cmd, {
  shell: 'cmd.exe',
  encoding: 'utf8',
  timeout: 120000,
  env: {
    ...process.env,
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    APPDATA: tmpDir,
    LOCALAPPDATA: tmpDir,
  },
});
console.log(out);
console.log('✅ admin-manage-user deployed successfully.');
