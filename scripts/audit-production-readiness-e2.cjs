#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW V1.0 — PHASE E2: PRODUCTION READINESS AUDIT (READ-ONLY)
 * Script: scripts/audit-production-readiness-e2.cjs
 *
 * SAFETY GUARANTEE:
 * - 100% READ-ONLY INSPECTION.
 * - ZERO DDL, ZERO DML, ZERO INSERTS, ZERO UPDATES, ZERO DELETES.
 * - Audits Production (uqvxtgvdmdfgtjwzsxlj) and TEST (hosppagbopdghlupnhlr).
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const TEST_REF = 'hosppagbopdghlupnhlr';
const TEST_URL = 'https://hosppagbopdghlupnhlr.supabase.co';
const TEST_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhvc3BwYWdib3BkZ2hsdXBuaGxyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MTc1OTU1MCwiZXhwIjoyMTA3MzM1NTUwfQ.x1Ze7jWbLKf4HznF8Fwj6uxiyirwBuVKpjP3NvBTFDg';

const prodClient = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const testClient = createClient(TEST_URL, TEST_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runAudit() {
  console.log('='.repeat(80));
  console.log('   DRAWING REVIEW V1.0 — PHASE E2: PRODUCTION READINESS AUDIT (READ-ONLY)');
  console.log(`   Production Target: ${PROD_URL} (${PROD_REF})`);
  console.log(`   TEST Benchmark:    ${TEST_URL} (${TEST_REF})`);
  console.log(`   Timestamp:         ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const report = {
    timestamp: new Date().toISOString(),
    production: { ref: PROD_REF, tables: {}, buckets: [], sucon_master: null, cygg_master: null, ng_catalog: null },
    test: { ref: TEST_REF, tables: {}, buckets: [], sucon_master: null, cygg_master: null, ng_catalog: null },
    migration_diffs: {},
    compatibility: {},
  };

  // List of tables to inspect
  const EXISTING_TABLES = [
    'jobs',
    'job_operations',
    'production_runs',
    'ng_details',
    'qa_checks',
    'qa_ng_details',
    'pe_engineering_reviews',
    'pe_technical_dispositions',
    'kiv_reviews',
    'engineering_documents',
    'operation_sample_photos',
    'sample_final_reports',
    'attachments',
    'profiles',
    'audit_logs',
    'workcenter_master',
    'defect_catalog'
  ];

  const DRAWING_REVIEW_TABLES = [
    'drawing_review_issues',
    'drawing_review_versions',
    'drawing_review_operations',
    'drawing_review_attachments',
    'drawing_review_issue_sequences'
  ];

  console.log('\n--- 1. AUDITING PRODUCTION OPERATIONAL TABLES ---');
  for (const table of EXISTING_TABLES) {
    try {
      const { data, count, error } = await prodClient.from(table).select('*', { count: 'exact', head: false }).limit(2);
      if (error) {
        console.log(`  ❌ Table '${table}': ERROR - ${error.message} (${error.code})`);
        report.production.tables[table] = { exists: false, error: error.message };
      } else {
        const columns = data && data.length > 0 ? Object.keys(data[0]) : [];
        console.log(`  ✅ Table '${table}': EXISTS (${count} rows, sample columns: ${columns.slice(0, 6).join(', ')}...)`);
        report.production.tables[table] = { exists: true, count, columns };
      }
    } catch (e) {
      report.production.tables[table] = { exists: false, error: e.message };
    }
  }

  console.log('\n--- 2. AUDITING PRODUCTION DRAWING REVIEW TABLES (EXPECTED: NOT YET DEPLOYED) ---');
  for (const table of DRAWING_REVIEW_TABLES) {
    try {
      const { data, count, error } = await prodClient.from(table).select('*', { count: 'exact', head: false }).limit(1);
      if (error) {
        console.log(`  ⚪ Table '${table}': Not present in Production (${error.message})`);
        report.production.tables[table] = { exists: false, message: error.message };
      } else {
        console.log(`  ⚠️ Table '${table}': ALREADY EXISTS IN PROD! (${count} rows)`);
        report.production.tables[table] = { exists: true, count, columns: Object.keys(data[0] || {}) };
      }
    } catch (e) {
      report.production.tables[table] = { exists: false, error: e.message };
    }
  }

  console.log('\n--- 3. AUDITING TEST DRAWING REVIEW TABLES (BENCHMARK) ---');
  for (const table of DRAWING_REVIEW_TABLES) {
    try {
      const { data, count, error } = await testClient.from(table).select('*', { count: 'exact', head: false }).limit(2);
      if (error) {
        console.log(`  ❌ TEST Table '${table}': ERROR - ${error.message}`);
        report.test.tables[table] = { exists: false, error: error.message };
      } else {
        const cols = data && data.length > 0 ? Object.keys(data[0]) : [];
        console.log(`  ✅ TEST Table '${table}': OK (${count} rows, cols: ${cols.slice(0, 8).join(', ')})`);
        report.test.tables[table] = { exists: true, count, columns: cols };
      }
    } catch (e) {
      report.test.tables[table] = { exists: false, error: e.message };
    }
  }

  console.log('\n--- 4. AUDITING SUBCON MASTER DATA IN PRODUCTION ---');
  const { data: subconProd, error: scProdErr } = await prodClient
    .from('workcenter_master')
    .select('*')
    .ilike('code', '%subcon%');
  if (scProdErr) {
    console.log(`  ❌ Error querying SUBCON in Prod: ${scProdErr.message}`);
  } else {
    console.log(`  ✅ Production SUBCON records found (${subconProd.length}):`);
    subconProd.forEach(s => {
      console.log(`     ID: ${s.id} | Code: '${s.code}' | Name: '${s.name}' | Active: ${s.is_active} | Department: '${s.department}'`);
    });
    report.production.sucon_master = subconProd;
  }

  console.log('\n--- 5. AUDITING CYGG (CYLINDRICAL GRINDING) MASTER DATA IN PRODUCTION ---');
  const { data: cyggProd, error: cyggErr } = await prodClient
    .from('workcenter_master')
    .select('*')
    .ilike('code', 'CYGG');
  if (cyggErr) {
    console.log(`  ❌ Error querying CYGG in Prod: ${cyggErr.message}`);
  } else {
    console.log(`  ✅ Production CYGG records found (${cyggProd.length}):`);
    cyggProd.forEach(c => {
      console.log(`     ID: ${c.id} | Code: '${c.code}' | Name: '${c.name}' | Desc: '${c.description}' | McType: '${c.mc_type}' | Active: ${c.is_active}`);
    });
    report.production.cygg_master = cyggProd;
  }

  console.log('\n--- 6. AUDITING DEFECT CATALOG (MIGRATION 00030 CHECK) IN PRODUCTION ---');
  const { data: defectsProd, error: defErr } = await prodClient
    .from('defect_catalog')
    .select('*');
  if (defErr) {
    console.log(`  ❌ Error querying defect_catalog in Prod: ${defErr.message}`);
  } else {
    const activeDefects = (defectsProd || []).filter(d => d.is_active);
    console.log(`  ✅ Production defect_catalog: Total ${defectsProd.length} records, ${activeDefects.length} active.`);
    activeDefects.forEach(d => {
      console.log(`     [${d.code}] ${d.name_vi} (${d.category})`);
    });
    report.production.ng_catalog = {
      total: defectsProd.length,
      active_count: activeDefects.length,
      codes: activeDefects.map(d => d.code)
    };
  }

  console.log('\n--- 7. AUDITING QA_NG_DETAILS COLUMNS (MIGRATION 00030 CHECK) IN PRODUCTION ---');
  const { data: qaNgSample, error: qaNgErr } = await prodClient
    .from('qa_ng_details')
    .select('*')
    .limit(1);
  if (qaNgErr) {
    console.log(`  ❌ Error querying qa_ng_details in Prod: ${qaNgErr.message}`);
  } else {
    const cols = qaNgSample && qaNgSample.length > 0 ? Object.keys(qaNgSample[0]) : [];
    console.log(`  ✅ Production qa_ng_details columns: ${cols.join(', ')}`);
    console.log(`     Has 'cause' column (Migration 00030): ${cols.includes('cause')}`);
    report.production.qa_ng_cause_column = cols.includes('cause');
  }

  console.log('\n--- 8. AUDITING STORAGE BUCKETS IN PRODUCTION & TEST ---');
  try {
    const { data: prodBuckets, error: pbErr } = await prodClient.storage.listBuckets();
    if (pbErr) {
      console.log(`  ❌ Error listing Production buckets: ${pbErr.message}`);
    } else {
      console.log(`  ✅ Production Buckets (${prodBuckets.length}):`);
      prodBuckets.forEach(b => {
        console.log(`     - Name: '${b.name}' | ID: '${b.id}' | Public: ${b.public}`);
      });
      report.production.buckets = prodBuckets;
    }
  } catch (e) {
    console.log(`  ❌ Production storage error: ${e.message}`);
  }

  try {
    const { data: testBuckets, error: tbErr } = await testClient.storage.listBuckets();
    if (tbErr) {
      console.log(`  ❌ Error listing TEST buckets: ${tbErr.message}`);
    } else {
      console.log(`  ✅ TEST Buckets (${testBuckets.length}):`);
      testBuckets.forEach(b => {
        console.log(`     - Name: '${b.name}' | ID: '${b.id}' | Public: ${b.public}`);
      });
      report.test.buckets = testBuckets;
    }
  } catch (e) {
    console.log(`  ❌ TEST storage error: ${e.message}`);
  }

  console.log('\n--- 9. AUDITING USER ROLES & PROFILES IN PRODUCTION ---');
  const { data: prodProfiles, count: userCount, error: userErr } = await prodClient
    .from('profiles')
    .select('*', { count: 'exact' });
  if (userErr) {
    console.log(`  ❌ Error querying profiles in Prod: ${userErr.message}`);
  } else {
    console.log(`  ✅ Production Users Count: ${userCount}`);
    const rolesCount = {};
    prodProfiles.forEach(p => {
      rolesCount[p.role] = (rolesCount[p.role] || 0) + 1;
    });
    console.log('     Roles distribution in Prod:', rolesCount);
    report.production.roles_distribution = rolesCount;
  }

  // Save report to disk
  const outputPath = path.resolve(__dirname, '..', 'backups', 'production_audit_e2_report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n  ✅ Complete read-only audit report saved to: ${outputPath}`);
  console.log('='.repeat(80));
}

runAudit().catch(err => {
  console.error('FATAL AUDIT ERROR:', err);
  process.exit(1);
});
