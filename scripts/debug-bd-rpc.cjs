#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMjE2NDIsImV4cCI6MjEwNzY5NzY0Mn0.jpdUQXKlasdb5QdHi3mOoLLbTwC1swXJfBftg-lwmkg';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const adminClient = createClient(PROD_URL, PROD_SERVICE_KEY);

async function testBdRpc() {
  const email = `test_bd_debug_2@sampletracking.local`;
  const pass = 'TestPass123!#';
  const { data: user } = await adminClient.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { role: 'BD' } });
  
  // Use upsert to guarantee profile row exists!
  const { error: upErr } = await adminClient.from('profiles').upsert({
    id: user.user.id,
    phone: '+84999999999',
    email: email,
    full_name: 'Test BD User',
    role: 'BD',
    department: 'BD',
    is_active: true,
    must_change_password: false
  });
  console.log('Upsert profile error:', upErr);

  const bdClient = createClient(PROD_URL, PROD_ANON_KEY);
  const { data: sess, error: signErr } = await bdClient.auth.signInWithPassword({ email, password: pass });
  console.log('Sign in error:', signErr);

  const { data, error } = await bdClient.rpc('allocate_next_drawing_review_issue_no');
  console.log('Result data:', data);
  console.log('Result error:', error);

  await adminClient.auth.admin.deleteUser(user.user.id);
}

testBdRpc().catch(e => console.error(e));
