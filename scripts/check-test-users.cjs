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

const supabase = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function checkUsers() {
  const { data: profiles, error } = await supabase.from('profiles').select('id, phone, full_name, role, is_active, must_change_password');
  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }
  console.log('Existing profiles on TEST:');
  console.table(profiles);
}

checkUsers();
