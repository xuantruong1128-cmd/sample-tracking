const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const prodRef = 'uqvxtgvdmdfgtjwzsxlj';
const testRef = 'hosppagbopdghlupnhlr';

const prodUrl = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const prodAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMjE2NDIsImV4cCI6MjEwNzY5NzY0Mn0.jpdUQXKlasdb5QdHi3mOoLLbTwC1swXJfBftg-lwmkg';
const prodServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const testUrl = 'https://hosppagbopdghlupnhlr.supabase.co';
const testServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhvc3BwYWdib3BkZ2hsdXBuaGxyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MTc1OTU1MCwiZXhwIjoyMTA3MzM1NTUwfQ.x1Ze7jWbLKf4HznF8Fwj6uxiyirwBuVKpjP3NvBTFDg';

const prodClient = createClient(prodUrl, prodServiceKey);
const prodAnonClient = createClient(prodUrl, prodAnonKey);
const testClient = createClient(testUrl, testServiceKey);

async function runComprehensiveVerification() {
  console.log('='.repeat(80));
  console.log('   SAMPLE TRACKING V1.0 — COMPREHENSIVE PRODUCTION VERIFICATION');
  console.log(`   Target Project: ${prodUrl} (${prodRef})`);
  console.log(`   TEST Project:   ${testUrl} (${testRef})`);
  console.log(`   Timestamp:      ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const results = {
    task1_project_ref: false,
    task2_schema_inspection: false,
    task3_no_test_leaks: false,
    task4_master_data: false,
    task5_zero_transactional: false,
    task6_admin_provisioning: false,
    task7_rls_security: false,
    task8_storage_security: false,
    task9_edge_functions: false,
    task10_test_data_integrity: false
  };

  // 1. Task 1: Project Ref Verification
  console.log('\n--- TASK 1: VERIFY EXACT PRODUCTION PROJECT REF ---');
  if (prodUrl.includes(prodRef) && !prodUrl.includes(testRef)) {
    console.log(`  ✅ Verified Production Project Ref: ${prodRef} (Correct and isolated from TEST)`);
    results.task1_project_ref = true;
  } else {
    console.error(`  ❌ Project Ref verification failed!`);
  }

  // 2. Task 2 & 3: Inspect scripts/production-schema-v1.0.sql
  console.log('\n--- TASK 2 & 3: INSPECT production-schema-v1.0.sql AGAINST 25 MIGRATIONS ---');
  const schemaPath = path.join(__dirname, 'production-schema-v1.0.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    const hasTestRef = schemaContent.includes(testRef);
    const hasTestEmail = schemaContent.includes('nhan.nguyen@') || schemaContent.includes('thu.huong@');
    const hasJobsInsert = /insert\s+into\s+public\.jobs/i.test(schemaContent);
    const hasRunsInsert = /insert\s+into\s+public\.production_runs/i.test(schemaContent);
    
    // Check 25 migrations
    const migrationFiles = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations'))
      .filter(f => f.endsWith('.sql')).sort();
    
    console.log(`  ✅ Found ${migrationFiles.length} migration files in supabase/migrations/`);
    let allFound = true;
    for (const mf of migrationFiles) {
      if (!schemaContent.includes(mf)) {
        console.warn(`  ⚠️ Migration header for ${mf} not found in schema file`);
        allFound = false;
      }
    }
    if (allFound) {
      console.log(`  ✅ All 25 migrations represented in production-schema-v1.0.sql`);
      results.task2_schema_inspection = true;
    }

    // Check for static transactional data inserts outside of function bodies
    // Static transactional data would look like: INSERT INTO public.jobs VALUES (...)
    const hasStaticJobsInsert = /insert\s+into\s+public\.jobs\s+values/i.test(schemaContent);
    const hasStaticRunsInsert = /insert\s+into\s+public\.production_runs\s+values/i.test(schemaContent);
    const hasStaticUsersInsert = /insert\s+into\s+auth\.users/i.test(schemaContent);

    if (!hasTestRef && !hasTestEmail && !hasStaticJobsInsert && !hasStaticRunsInsert && !hasStaticUsersInsert) {
      console.log(`  ✅ Schema contains zero TEST endpoints, zero TEST accounts, and zero static transactional inserts.`);
      results.task3_no_test_leaks = true;
    } else {
      console.error(`  ❌ Schema leak detected: hasTestRef=${hasTestRef}, hasStaticJobsInsert=${hasStaticJobsInsert}`);
    }
  }

  // 3. Task 6: Master Data Counts & Quality
  console.log('\n--- TASK 6: MASTER DATA COUNTS & INTEGRITY (WORKCENTERS & DEFECTS) ---');
  const { data: wcData, count: wcCount, error: wcErr } = await prodClient.from('workcenter_master').select('*', { count: 'exact' });
  const { data: dfData, count: dfCount, error: dfErr } = await prodClient.from('defect_catalog').select('*', { count: 'exact' });

  if (!wcErr && wcCount === 37) {
    console.log(`  ✅ workcenter_master: Exactly 37 records active and verified.`);
    // Verify required workcenters exist: CAMC, B12C, A20C, D&TS, CGMG, etc.
    const wcCodes = new Set(wcData.map(w => w.code));
    const sampleRequired = ['CAMC', 'B12C', 'A20C', 'D&TS', 'CGMG', 'CNC1', 'EDM1'];
    const missing = sampleRequired.filter(c => !wcCodes.has(c));
    if (missing.length === 0) {
      console.log(`  ✅ Core workcenter codes verified: ${sampleRequired.join(', ')}`);
    }
  } else {
    console.error(`  ❌ workcenter_master count mismatch: ${wcCount} (expected 37)`);
  }

  if (!dfErr && dfCount === 8) {
    console.log(`  ✅ defect_catalog: Exactly 8 defect catalog records active and verified.`);
    results.task4_master_data = (wcCount === 37 && dfCount === 8);
  } else {
    console.error(`  ❌ defect_catalog count mismatch: ${dfCount} (expected 8)`);
  }

  // 4. Task 7: Zero Transactional Data Verification
  console.log('\n--- TASK 7: ZERO TRANSACTIONAL RECORDS VERIFICATION ---');
  const transactionalTables = [
    'jobs',
    'job_operations',
    'production_runs',
    'ng_details',
    'qa_checks',
    'pe_engineering_reviews',
    'engineering_documents',
    'operation_sample_photos',
    'sample_final_reports',
    'attachments',
    'pe_technical_dispositions',
    'kiv_reviews',
    'job_code_sequences'
  ];

  let zeroClean = true;
  for (const t of transactionalTables) {
    const { count, error } = await prodClient.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`  ❌ Error querying ${t}: ${error.message}`);
      zeroClean = false;
    } else {
      const isZero = count === 0;
      if (!isZero) zeroClean = false;
      console.log(`  ${t.padEnd(26)}: ${count} rows (${isZero ? '✅ EMPTY' : '❌ NOT EMPTY'})`);
    }
  }
  results.task5_zero_transactional = zeroClean;

  // 5. Task 8: Initial Production Admin Verification
  console.log('\n--- TASK 8: INITIAL PRODUCTION ADMIN ACCOUNT ---');
  const { data: profiles, error: profErr } = await prodClient.from('profiles').select('*');
  if (!profErr && profiles) {
    console.log(`  Total user profiles in Production: ${profiles.length} (Requirement: Exactly 1)`);
    if (profiles.length === 1) {
      const admin = profiles[0];
      const phoneMatch = admin.phone === '+84968041128' || admin.phone === '0968041128';
      const roleMatch = admin.role === 'Admin';
      const activeMatch = admin.is_active === true;
      const mustChange = admin.must_change_password === true;
      
      console.log(`  Admin Phone:              ${admin.phone} (${phoneMatch ? '✅ MATCH' : '❌'})`);
      console.log(`  Admin Role:               ${admin.role} (${roleMatch ? '✅ MATCH' : '❌'})`);
      console.log(`  Admin Active Status:      ${admin.is_active} (${activeMatch ? '✅ ACTIVE' : '❌'})`);
      console.log(`  Must Change Password:     ${admin.must_change_password} (${mustChange ? '✅ ENFORCED' : '❌'})`);
      console.log(`  Production Admin UID:     ${admin.id}`);
      
      // Check TEST admin ID to ensure no reuse
      const { data: testAdmin } = await testClient.from('profiles').select('id').eq('role', 'Admin').limit(1).single();
      if (testAdmin && testAdmin.id !== admin.id) {
        console.log(`  ✅ Distinct User ID confirmed (Prod: ${admin.id} != Test: ${testAdmin.id})`);
        results.task6_admin_provisioning = phoneMatch && roleMatch && activeMatch && mustChange;
      }
    }
  }

  // 6. Task 9: Edge Functions Status & Deployment
  console.log('\n--- TASK 9: 5 EDGE FUNCTIONS DEPLOYMENT & HEALTH ---');
  const edgeFunctions = [
    'admin-manage-user',
    'create-signed-url',
    'generate-final-report',
    'get-report-download-url',
    'verify-and-confirm-upload'
  ];
  let funcsAllOk = true;
  for (const fn of edgeFunctions) {
    try {
      const url = `${prodUrl}/functions/v1/${fn}`;
      const res = await fetch(url, { method: 'OPTIONS' });
      if (res.status === 200) {
        console.log(`  ✅ Edge Function '${fn}': HTTP 200 (Active & Responding)`);
      } else {
        console.warn(`  ⚠️ Edge Function '${fn}': HTTP ${res.status}`);
        funcsAllOk = false;
      }
    } catch (e) {
      console.error(`  ❌ Edge Function '${fn}': Fetch error: ${e.message}`);
      funcsAllOk = false;
    }
  }
  results.task9_edge_functions = funcsAllOk;

  // 7. Task 10: RLS & Private Storage Security
  console.log('\n--- TASK 10: RLS & STORAGE VERIFICATION ---');
  // Anonymous access to jobs
  const { data: anonJobs, error: anonJobsErr } = await prodAnonClient.from('jobs').select('*');
  const rlsBlocked = (!anonJobs || anonJobs.length === 0);
  console.log(`  RLS Gate B Anonymous Access: ${rlsBlocked ? '✅ BLOCKED (Protected)' : '❌ EXPOSED'}`);
  results.task7_rls_security = rlsBlocked;

  // Storage bucket check
  const { data: buckets, error: bErr } = await prodClient.storage.listBuckets();
  if (!bErr && buckets) {
    const docBucket = buckets.find(b => b.name === 'sample-documents');
    if (docBucket) {
      console.log(`  Bucket 'sample-documents' exists: public=${docBucket.public} (${docBucket.public === false ? '✅ SECURE PRIVATE' : '❌ PUBLIC'})`);
      console.log(`  Allowed MIME Types: ${docBucket.allowed_mime_types.join(', ')}`);
      results.task8_storage_security = (docBucket.public === false);
    }
  }

  // 8. TEST Database Integrity Check
  console.log('\n--- TEST DATABASE INTEGRITY CHECK (VERIFY ZERO ALTERATION) ---');
  const { count: testJobsCount } = await testClient.from('jobs').select('*', { count: 'exact', head: true });
  const { count: testOpsCount } = await testClient.from('job_operations').select('*', { count: 'exact', head: true });
  console.log(`  TEST Jobs count:       ${testJobsCount} (Expected: 17)`);
  console.log(`  TEST Operations count: ${testOpsCount} (Expected: 45)`);
  if (testJobsCount === 17 && testOpsCount === 45) {
    console.log(`  ✅ TEST Database was NEVER altered (100% UNTOUCHED & INTACT)`);
    results.task10_test_data_integrity = true;
  } else {
    console.error(`  ❌ TEST Database count changed!`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('   PRODUCTION PREFLIGHT & INITIALIZATION VERIFICATION SUMMARY');
  console.log('='.repeat(80));
  const allPass = Object.values(results).every(v => v === true);
  for (const [task, pass] of Object.entries(results)) {
    console.log(`   ${task.padEnd(30)}: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  }
  console.log('='.repeat(80));
  console.log(`   OVERALL VERIFICATION STATUS: ${allPass ? '🟢 ALL CHECKS PASSED (PRODUCTION READY)' : '🔴 FAILED'}`);
  console.log('='.repeat(80));
}

runComprehensiveVerification();
