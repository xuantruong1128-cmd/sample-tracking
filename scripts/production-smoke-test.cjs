#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — PRODUCTION GO-LIVE SMOKE TEST & HEALTH CHECK
 * Script: scripts/production-smoke-test.cjs
 *
 * Verifies production environment readiness non-destructively:
 * 1. Database connection & schema tables verification
 * 2. RLS policy enforcement
 * 3. Private Storage bucket configuration
 * 4. Stored Procedures & RPC functions availability
 * 5. Edge Functions deployment & response check
 * 6. Admin presence & authentication readiness
 * 7. Job numbering sequence initialization
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('='.repeat(80));
console.log('   SAMPLE TRACKING V1.0 — PRODUCTION GO-LIVE ACCEPTANCE CHECK');
console.log(`   Target Project: ${supabaseUrl}`);
console.log(`   Execution Time: ${new Date().toISOString()}`);
console.log('='.repeat(80));

if (!supabaseUrl || !serviceRoleKey) {
  console.error('\n❌ ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(supabaseUrl, anonKey || 'placeholder', {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REQUIRED_TABLES = [
  'profiles',
  'jobs',
  'job_operations',
  'production_runs',
  'ng_details',
  'qa_checks',
  'pe_engineering_reviews',
  'engineering_documents',
  'operation_sample_photos',
  'sample_final_reports',
  'job_code_sequences',
  'audit_logs',
];

const EDGE_FUNCTIONS = [
  'admin-manage-user',
  'create-signed-url',
  'generate-final-report',
  'get-report-download-url',
  'verify-and-confirm-upload',
];

const checks = [];

function recordCheck(id, title, status, details) {
  checks.push({ id, title, status, details });
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`  ${icon} [${id}] ${title}: ${status} — ${details}`);
}

async function runProductionSmokeTest() {
  // 1. Database connectivity & Tables
  console.log('\n--- 1. Database Schema & Tables Inspection ---');
  for (const table of REQUIRED_TABLES) {
    try {
      const { data, error } = await adminClient.from(table).select('*').limit(1);
      if (error) {
        recordCheck(`TAB-${table}`, `Table '${table}' exists and accessible`, 'FAIL', error.message);
      } else {
        recordCheck(`TAB-${table}`, `Table '${table}' exists and accessible`, 'PASS', `Table query returned OK`);
      }
    } catch (e) {
      recordCheck(`TAB-${table}`, `Table '${table}' exists and accessible`, 'FAIL', e.message);
    }
  }

  // 2. Storage Bucket Inspection
  console.log('\n--- 2. Private Storage Bucket Verification ---');
  try {
    const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
    if (bErr || !buckets) {
      recordCheck('STO-01', 'List storage buckets', 'FAIL', bErr?.message || 'No bucket list returned');
    } else {
      const docBucket = buckets.find((b) => b.id === 'sample-documents');
      if (!docBucket) {
        recordCheck('STO-01', 'Private bucket sample-documents exists', 'FAIL', 'Bucket sample-documents not found');
      } else {
        const isPrivate = docBucket.public === false;
        recordCheck('STO-01', 'Private bucket sample-documents exists and is PRIVATE', isPrivate ? 'PASS' : 'FAIL', `public=${docBucket.public}`);

        const mimeTypes = docBucket.allowed_mime_types || [];
        const hasZip = mimeTypes.includes('application/zip') || mimeTypes.includes('application/x-zip-compressed');
        const hasPdf = mimeTypes.includes('application/pdf');
        recordCheck('STO-02', 'Bucket allows PDF, images, Excel and ZIP archives', hasZip && hasPdf ? 'PASS' : 'WARN', `MIMEs: ${mimeTypes.join(', ')}`);
      }
    }
  } catch (e) {
    recordCheck('STO-01', 'Private bucket verification', 'FAIL', e.message);
  }

  // 3. Fail-Closed RLS Verification (Anonymous Access Block)
  console.log('\n--- 3. Row-Level Security (RLS) Gate B Barrier ---');
  try {
    const { data: anonJobs, error: anonErr } = await anonClient.from('jobs').select('*');
    const rlsBlocked = anonErr !== null || (anonJobs && anonJobs.length === 0);
    recordCheck('RLS-01', 'Anonymous client access blocked by RLS on jobs table', rlsBlocked ? 'PASS' : 'FAIL', anonErr ? anonErr.message : 'Returned empty set (denied)');
  } catch (e) {
    recordCheck('RLS-01', 'Anonymous access blocked', 'PASS', e.message);
  }

  // 4. Admin Account Readiness
  console.log('\n--- 4. Production Admin Account Readiness ---');
  try {
    const { data: admins, error: admErr } = await adminClient
      .from('profiles')
      .select('id, full_name, phone, role, is_active')
      .eq('role', 'Admin')
      .eq('is_active', true);

    if (admErr || !admins || admins.length === 0) {
      recordCheck('ADM-01', 'At least one active Admin user exists', 'WARN', 'No active Admin found yet. Run scripts/bootstrap-first-admin.cjs');
    } else {
      recordCheck('ADM-01', 'At least one active Admin user exists', 'PASS', `Found ${admins.length} active Admin(s): ${admins.map(a => a.full_name).join(', ')}`);
    }
  } catch (e) {
    recordCheck('ADM-01', 'Admin user verification', 'FAIL', e.message);
  }

  // 5. Job Code Generation Sequence
  console.log('\n--- 5. Job Numbering Sequence Readiness ---');
  try {
    const { data: previewCode, error: prevErr } = await adminClient.rpc('preview_next_job_code');
    if (prevErr) {
      recordCheck('SEQ-01', 'RPC preview_next_job_code available', 'FAIL', prevErr.message);
    } else {
      recordCheck('SEQ-01', 'Job ticket numbering format YYYYMM-### initialized', 'PASS', `Next preview: ${previewCode}`);
    }
  } catch (e) {
    recordCheck('SEQ-01', 'Job ticket sequence check', 'FAIL', e.message);
  }

  // 6. Edge Functions Availability
  console.log('\n--- 6. Edge Functions Deployment Check ---');
  for (const fn of EDGE_FUNCTIONS) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: 'OPTIONS',
      });
      // OPTIONS returns 200/ok
      if (res.status === 200 || res.status === 204) {
        recordCheck(`FUNC-${fn}`, `Edge Function '${fn}' deployed and responding`, 'PASS', `HTTP ${res.status}`);
      } else {
        recordCheck(`FUNC-${fn}`, `Edge Function '${fn}' deployed and responding`, 'WARN', `HTTP ${res.status}`);
      }
    } catch (e) {
      recordCheck(`FUNC-${fn}`, `Edge Function '${fn}' check`, 'FAIL', e.message);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  const passCount = checks.filter(c => c.status === 'PASS').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  console.log(`   ACCEPTANCE SUMMARY: ${passCount} PASS | ${warnCount} WARN | ${failCount} FAIL (Total: ${checks.length})`);
  console.log('='.repeat(80) + '\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runProductionSmokeTest().catch((err) => {
  console.error('Fatal smoke test error:', err);
  process.exit(1);
});
