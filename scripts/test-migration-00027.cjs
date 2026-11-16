const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await client.from('operation_sample_photos').select('id, is_avatar').limit(1);
  console.log('Query operation_sample_photos error:', error, 'data:', data);
  const { data: rpcData, error: rpcError } = await client.rpc('set_part_avatar', {
    p_job_id: '00000000-0000-0000-0000-000000000000',
    p_photo_id: null,
  });
  console.log('RPC set_part_avatar test response:', rpcError ? rpcError.message : rpcData);
}

run();
