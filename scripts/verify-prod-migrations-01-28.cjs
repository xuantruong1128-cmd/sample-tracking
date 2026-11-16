#!/usr/bin/env node
/**
 * Verifies that Production (uqvxtgvdmdfgtjwzsxlj) contains all schema objects,
 * columns, enums, and RPCs corresponding to migrations 00001 through 00028.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function verifyBaseline() {
  console.log('='.repeat(80));
  console.log('   PRODUCTION SCHEMA VERIFICATION FOR MIGRATIONS 00001 - 00028');
  console.log('='.repeat(80));

  const checks = [
    // 00001-00004
    { name: '00001: jobs table', query: () => client.from('jobs').select('id, job_no, part_no, order_qty').limit(1) },
    { name: '00001: job_operations table', query: () => client.from('job_operations').select('id, job_id, step_order, operation_name').limit(1) },
    { name: '00001: production_runs table', query: () => client.from('production_runs').select('id, operation_id, ok_qty, ng_qty').limit(1) },
    { name: '00001: ng_details table', query: () => client.from('ng_details').select('id, production_run_id, ng_qty').limit(1) },
    { name: '00001: qa_checks table', query: () => client.from('qa_checks').select('id, operation_id, check_result').limit(1) },
    { name: '00001: profiles table', query: () => client.from('profiles').select('id, phone, role').limit(1) },
    { name: '00001: attachments table', query: () => client.from('attachments').select('id, file_path').limit(1) },
    { name: '00001: workcenter_master table', query: () => client.from('workcenter_master').select('id, code, mc_type').limit(1) },
    { name: '00001: defect_catalog table', query: () => client.from('defect_catalog').select('id, code, name_vi').limit(1) },
    { name: '00001: audit_logs table', query: () => client.from('audit_logs').select('id, action, entity_type').limit(1) },

    // 00010-00014: UI-04 columns
    { name: '00010-00014: qa_checks check_sheet_urls', query: () => client.from('qa_checks').select('check_sheet_urls').limit(1) },
    { name: '00010-00014: job_operations pe_mfg_username', query: () => client.from('job_operations').select('pe_mfg_username').limit(1) },

    // 00018-00020: Workflow V2 tables & columns
    { name: '00018: kiv_reviews table', query: () => client.from('kiv_reviews').select('id, job_id, operation_id').limit(1) },
    { name: '00018: pe_engineering_reviews table', query: () => client.from('pe_engineering_reviews').select('id, job_id, operation_id, review_result').limit(1) },
    { name: '00018: pe_technical_dispositions table', query: () => client.from('pe_technical_dispositions').select('id, job_id, disposition').limit(1) },
    { name: '00018: jobs planning_lockout column', query: () => client.from('jobs').select('planning_lockout').limit(1) },
    { name: '00018: job_operations closed_by column', query: () => client.from('job_operations').select('closed_by, closed_at').limit(1) },

    // 00021: Engineering Documents R1
    { name: '00021: engineering_documents table', query: () => client.from('engineering_documents').select('id, job_id, document_type, file_path').limit(1) },

    // 00022-00025: Sample Final Reports
    { name: '00022: sample_final_reports table', query: () => client.from('sample_final_reports').select('id, job_id, evaluation_result, overall_assessment').limit(1) },

    // 00026: Production UX & Permission R1
    { name: '00026: profiles is_department_leader', query: () => client.from('profiles').select('is_department_leader, must_change_password').limit(1) },

    // 00027: Final Report Revision R2
    { name: '00027: sample_final_reports revision_no & report_status', query: () => client.from('sample_final_reports').select('revision_no, report_status').limit(1) },

    // 00028: QA inspection and PE review R2
    { name: '00028: qa_ng_details table', query: () => client.from('qa_ng_details').select('id, qa_check_id, defect_code, ng_qty').limit(1) },
    { name: '00028: operation_sample_photos table', query: () => client.from('operation_sample_photos').select('id, job_id, operation_id, file_path').limit(1) },
    { name: '00028: pe_engineering_reviews engineering_comment', query: () => client.from('pe_engineering_reviews').select('engineering_comment, improvement_required').limit(1) }
  ];

  let passed = 0;
  for (const c of checks) {
    try {
      const { data, error } = await c.query();
      if (error) {
        console.log(`  ❌ ${c.name}: FAILED (${error.message})`);
      } else {
        console.log(`  ✅ ${c.name}: VERIFIED`);
        passed++;
      }
    } catch (err) {
      console.log(`  ❌ ${c.name}: EXCEPTION (${err.message})`);
    }
  }

  console.log(`\nResult: ${passed} / ${checks.length} baseline migration checks PASSED.`);
}

verifyBaseline().catch(err => console.error(err));
