const { createClient } = require('@supabase/supabase-js');
const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';
const admin = createClient(PROD_URL, PROD_KEY);

async function clean() {
  const issueId = 'a639f2f2-bb37-4aa0-a928-9af4c74d56bb';
  const userId = '51c8c572-2936-4bb8-aa8d-88bec5e00be1';

  // 1. Get versions of issue
  const { data: vers } = await admin.from('drawing_review_versions').select('id').eq('issue_id', issueId);
  if (vers && vers.length > 0) {
    const vIds = vers.map(v => v.id);
    await admin.from('drawing_review_operations').delete().in('version_id', vIds);
    await admin.from('drawing_review_attachments').delete().in('version_id', vIds);
    // Immutability trigger might block deleting completed versions; let's check
    const { error: vErr } = await admin.from('drawing_review_versions').delete().eq('issue_id', issueId);
    if (vErr) console.log('Error deleting versions:', vErr.message);
  }
  const { error: iErr } = await admin.from('drawing_review_issues').delete().eq('id', issueId);
  if (iErr) console.log('Error deleting issue:', iErr.message);

  // 2. Delete profile and auth user
  await admin.from('profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);

  console.log('Cleaned up test issue and user.');
}

clean();
