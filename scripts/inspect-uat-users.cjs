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

if (!supabaseUrl.includes('hosppagbopdghlupnhlr')) {
  console.error('Target is NOT TEST! Aborting.');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: profiles, error } = await adminClient
    .from('profiles')
    .select('id, email, phone, full_name, role, department, is_active, must_change_password');
  
  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }

  console.log('=== TEST PROFILES (' + profiles.length + ') ===');
  for (const p of profiles) {
    console.log(`- ${p.phone} | ${p.role} | ${p.full_name} | dept: ${p.department} | active: ${p.is_active} | must_change_pw: ${p.must_change_password}`);
  }
}

main().catch(console.error);
