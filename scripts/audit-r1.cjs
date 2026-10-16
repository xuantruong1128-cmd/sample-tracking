const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
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

async function audit() {
  console.log('=== AUDIT AUTH USERS ===');
  const { data: users, error: uErr } = await client.auth.admin.listUsers();
  if (uErr) {
    console.error('List users err:', uErr.message);
  } else {
    console.log(`Found ${users.users.length} users:`);
    users.users.forEach((u) => {
      console.log(`  - [${u.id}] email: ${u.email} | phone: ${u.phone} | meta:`, u.user_metadata);
    });
  }

  console.log('\n=== AUDIT PROFILES ===');
  const { data: profiles, error: pErr } = await client.from('profiles').select('*');
  if (pErr) {
    console.error('Profiles err:', pErr.message);
  } else {
    console.log(`Found ${profiles.length} profiles:`);
    profiles.forEach((p) => {
      console.log(`  - [${p.id}] name: "${p.full_name}" | role: ${p.role} | phone: ${p.phone} | is_leader: ${p.is_department_leader}`);
    });
  }

  console.log('\n=== AUDIT STORAGE BUCKETS ===');
  const { data: buckets, error: bErr } = await client.storage.listBuckets();
  if (bErr) {
    console.error('Buckets err:', bErr.message);
  } else {
    console.log(`Found ${buckets.length} buckets:`);
    buckets.forEach((b) => {
      console.log(`  - Bucket: id="${b.id}", name="${b.name}", public=${b.public}, file_size_limit=${b.file_size_limit}, allowed_mime_types=${JSON.stringify(b.allowed_mime_types)}`);
    });
  }

  console.log('\n=== AUDIT ENUM USER_ROLE & DATABASE SCHEMA ===');
  // Check enum types by querying an information schema or test insert
  const { data: jobs, error: jErr } = await client.from('jobs').select('id, job_no, status').limit(5);
  console.log('Sample jobs in DB:', jobs);

  const { data: atts, error: aErr } = await client.from('attachments').select('*').limit(5);
  console.log('Sample attachments in DB:', atts);
}

audit().catch(console.error);
