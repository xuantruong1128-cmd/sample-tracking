#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(PROD_URL, PROD_SERVICE_KEY);

async function test() {
  const { data, error } = await client.rpc('allocate_next_drawing_review_issue_no');
  console.log('Data:', data);
  console.log('Error:', error);
}

test();
