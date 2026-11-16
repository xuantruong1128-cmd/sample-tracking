#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const credPath = path.join(__dirname, '..', 'backups', 'production_db_credentials.json');
const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const projectRef = 'uqvxtgvdmdfgtjwzsxlj';
const dbPassword = creds.dbPassword;

console.log(`Checking migration list for ${projectRef}...`);
try {
  const cmd = `npx supabase migration list --project-ref ${projectRef}`;
  const out = execSync(cmd, {
    shell: 'cmd.exe',
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
  });
  console.log(out);
} catch (e) {
  console.error('Error running migration list:', e.message);
  if (e.stdout) console.log('STDOUT:\n', e.stdout);
  if (e.stderr) console.error('STDERR:\n', e.stderr);
}
