#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const prodClient = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('--- Checking schema_migrations on Production ---');
  try {
    const { data, error } = await prodClient.schema('supabase_migrations').from('schema_migrations').select('*').order('version');
    if (error) {
      console.log('Direct supabase_migrations query error:', error.message);
    } else {
      console.log('Found ' + data.length + ' migrations recorded in supabase_migrations.schema_migrations:');
      data.forEach(m => console.log('  - ' + m.version));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Also check checksums of local migrations 00001 to 00036
  console.log('\n--- Local Migration Files & SHA-256 Checksums ---');
  const migDir = path.resolve(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  files.forEach(f => {
    const content = fs.readFileSync(path.join(migDir, f));
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    console.log(`  ${f}: ${hash.slice(0, 16)}... (${content.length} bytes)`);
  });
}

main().catch(err => console.error(err));
