const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const credPath = path.resolve(__dirname, '../backups/uat_test_credentials.json');
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));

  for (const role of Object.keys(creds)) {
    const phone = creds[role].phone;
    console.log(`Setting must_change_password=false for ${role} (${phone})...`);
    await adminClient
      .from('profiles')
      .update({ must_change_password: false })
      .eq('phone', creds[role].e164);
  }
  console.log('✅ UAT accounts updated for direct browser login.');
}

main().catch(console.error);
