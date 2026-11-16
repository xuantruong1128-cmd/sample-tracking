const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}
const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await client.from('workcenter_master').select('*').order('stt');
  if (error) console.error(error);
  else {
    console.log(`Found ${data.length} workcenters:`);
    for (const row of data) {
      console.log(`STT: ${row.stt}, Code: ${row.code}, MC Type: ${row.mc_type}, Desc: ${row.description}`);
    }
  }
}
run();
