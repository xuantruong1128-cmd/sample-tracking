#!/usr/bin/env node
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

const client = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function verifyBdEnum() {
  console.log('Verifying BD enum value on TEST database (hosppagbopdghlupnhlr)...');
  
  // Test query profiles filtering by role = 'BD'
  // If 'BD' was NOT in user_role enum, PostgREST / Postgres throws "invalid input value for enum user_role: 'BD'"
  const { data, error } = await client.from('profiles').select('id, full_name, role').eq('role', 'BD');
  
  if (error) {
    console.error('❌ Failed checking BD enum:', error.message);
    process.exit(1);
  }

  console.log('✅ Query for role=BD succeeded without enum type error!');
  console.log('   Current BD profiles count:', data.length);
  console.log('✅ 00032_add_bd_user_role_enum.sql VERIFIED SUCCESSFULLY!');
}

verifyBdEnum().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
