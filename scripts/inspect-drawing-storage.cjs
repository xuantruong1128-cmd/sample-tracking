const { createClient } = require('@supabase/supabase-js');
const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';
const supa = createClient(PROD_URL, PROD_KEY);

async function checkStorage() {
  const { data: issues } = await supa.from('drawing_review_issues').select('id, issue_no, drawing_file_path');
  console.log('Issue file paths:', issues);

  const { data: vers } = await supa.from('drawing_review_versions').select('id, issue_id, version_name, avatar_file_path');
  console.log('Version avatars:', vers);

  const { data: atts } = await supa.from('drawing_review_attachments').select('id, file_path');
  console.log('Attachments:', atts);
}

checkStorage();
