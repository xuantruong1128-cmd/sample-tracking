const { createClient } = require('@supabase/supabase-js');
const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';
const admin = createClient(PROD_URL, PROD_KEY);

async function deactivate() {
  const userId = '51c8c572-2936-4bb8-aa8d-88bec5e00be1';
  await admin.from('profiles').update({ is_active: false }).eq('id', userId);
  console.log('Deactivated temporary smoke account.');
}

deactivate();
