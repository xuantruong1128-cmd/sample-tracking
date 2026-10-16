const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...rest] = trimmed.split('=');
    const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
    if (!process.env[key.trim()]) {
      process.env[key.trim()] = val;
    }
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function clean() {
  const ids = ['15bc984f-7bde-4ef3-816a-1979af81bc57', 'c693c78d-4b81-4a1f-8361-58faba507257'];
  await supabase.from('job_operations').delete().in('job_id', ids);
  await supabase.from('jobs').delete().in('id', ids);
  console.log('✅ Cleaned test artifacts #8 and #9 successfully.');
}

clean().catch(console.error);
