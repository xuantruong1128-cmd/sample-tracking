#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(PROD_URL, PROD_SERVICE_KEY);

async function checkProfiles() {
  const { data: profiles, error } = await client.from('profiles').select('id, phone, full_name, role, department, is_active, must_change_password');
  console.log('Profiles in Production:');
  profiles.forEach(p => {
    console.log(`  - ID: ${p.id} | Phone: ${p.phone} | Name: ${p.full_name} | Role: ${p.role} | Dept: ${p.department} | Active: ${p.is_active} | MustChangePass: ${p.must_change_password}`);
  });
}

checkProfiles();
