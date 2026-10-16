const path = require('path');
const { createClient } = require('C:/Sample report - AI/node_modules/@supabase/supabase-js');
const fs = require('fs');

const envPath = path.resolve('C:/Sample report - AI/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const { data, error } = await client.from('jobs').select('*').limit(1);
  if (data && data[0]) {
    console.log('Columns in jobs:', Object.keys(data[0]));
  } else {
    // If table is empty, query a dummy insert to see columns
    const { error: insErr } = await client.from('jobs').insert({});
    console.log('Insert error schema hint:', insErr?.message);
  }
}

run().catch(console.error);
