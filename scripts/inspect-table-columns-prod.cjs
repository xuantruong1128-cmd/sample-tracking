#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function inspectColumns() {
  const tables = ['qa_checks', 'job_operations', 'pe_technical_dispositions', 'jobs', 'engineering_documents', 'sample_final_reports'];
  for (const t of tables) {
    const { data, error } = await client.from(t).select('*').limit(1);
    if (error) {
      console.log(`Table ${t}: Error - ${error.message}`);
    } else {
      console.log(`Table ${t} columns:`, Object.keys(data[0] || {}));
    }
  }
}

inspectColumns().catch(err => console.error(err));
