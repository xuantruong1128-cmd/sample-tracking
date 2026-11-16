const { createClient } = require('@supabase/supabase-js');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const supa = createClient(PROD_URL, PROD_KEY, {
  auth: { persistSession: false }
});

async function run() {
  const { data: versions, error: verErr } = await supa
    .from('drawing_review_versions')
    .select('id, issue_id, version_name, status, required_material, required_tooling, special_measuring_equipment, engineering_remarks');

  if (verErr) console.error('Error versions:', verErr);
  else console.log('Versions:', JSON.stringify(versions, null, 2));
}

run();
