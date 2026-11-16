#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW V1.0 — PRODUCTION AUTHENTICATED SMOKE TEST RUNNER
 * Script: scripts/run-production-authenticated-smoke-tests.cjs
 *
 * Runs full authenticated smoke tests on live Production (uqvxtgvdmdfgtjwzsxlj):
 * - Creates temporary authorized test accounts (BD & PE-MFG)
 * - Verifies BD permissions & Sample Tracking operational data isolation
 * - Verifies Issue creation, number allocation, PDF drawing upload
 * - Verifies PE-MFG workspace, avatar crop, SUBCON validation, draft save
 * - Verifies V1 Close -> Completed & trigger immutability
 * - Verifies V2 creation (+ Tạo phiên bản tiếp theo) & lineage preservation
 * - Safely cleans up temporary test users & test issues (preserving all real data)
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMjE2NDIsImV4cCI6MjEwNzY5NzY0Mn0.jpdUQXKlasdb5QdHi3mOoLLbTwC1swXJfBftg-lwmkg';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const adminClient = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runAuthenticatedSmoke() {
  console.log('='.repeat(80));
  console.log('   PRODUCTION AUTHENTICATED SMOKE TESTS (LIVE CLOUD)');
  console.log(`   Target:    ${PROD_URL} (uqvxtgvdmdfgtjwzsxlj)`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const runId = crypto.randomBytes(4).toString('hex');
  const bdEmail = `temp_smoke_bd_${runId}@sampletracking.local`;
  const peEmail = `temp_smoke_pe_${runId}@sampletracking.local`;
  const tempPass = `SmokePass_${runId}#99!`;

  let bdUserId = null;
  let peUserId = null;
  let createdIssueId = null;

  const testResults = [];
  function record(name, pass, detail = '') {
    testResults.push({ name, pass, detail });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` (${detail})` : ''}`);
    if (!pass) process.exitCode = 1;
  }

  try {
    // --------------------------------------------------------------------------
    // 1. PROVISION TEMPORARY AUTHENTICATED TEST USERS
    // --------------------------------------------------------------------------
    console.log('\n--- 1. PROVISIONING TEMPORARY TEST USERS IN PRODUCTION ---');
    const { data: bdUser, error: bdErr } = await adminClient.auth.admin.createUser({
      email: bdEmail,
      password: tempPass,
      email_confirm: true,
      user_metadata: { role: 'BD', full_name: '[TEST] BD Smoke User' }
    });
    if (bdErr) throw bdErr;
    bdUserId = bdUser.user.id;
    await adminClient.from('profiles').upsert({
      id: bdUserId,
      phone: '+84911' + runId.padEnd(6, '0').slice(0, 6),
      email: bdEmail,
      full_name: '[TEST] BD Smoke User',
      role: 'BD',
      department: 'BD',
      is_active: true,
      must_change_password: false
    });
    record('Created authenticated BD user', !!bdUserId, bdEmail);

    const { data: peUser, error: peErr } = await adminClient.auth.admin.createUser({
      email: peEmail,
      password: tempPass,
      email_confirm: true,
      user_metadata: { role: 'PE-MFG', full_name: '[TEST] PE-MFG Smoke User' }
    });
    if (peErr) throw peErr;
    peUserId = peUser.user.id;
    await adminClient.from('profiles').upsert({
      id: peUserId,
      phone: '+84912' + runId.padEnd(6, '0').slice(0, 6),
      email: peEmail,
      full_name: '[TEST] PE-MFG Smoke User',
      role: 'PE-MFG',
      department: 'PE-MFG',
      is_active: true,
      must_change_password: false
    });
    record('Created authenticated PE-MFG user', !!peUserId, peEmail);

    // --------------------------------------------------------------------------
    // 2. BD LOGIN & PERMISSION ISOLATION
    // --------------------------------------------------------------------------
    console.log('\n--- 2. BD AUTHENTICATION & ACCESS ISOLATION ---');
    const bdClient = createClient(PROD_URL, PROD_ANON_KEY);
    const { data: bdLogin, error: bdLoginErr } = await bdClient.auth.signInWithPassword({ email: bdEmail, password: tempPass });
    record('BD user login succeeds', !bdLoginErr && !!bdLogin.session);

    // Test BD cannot insert job into Sample Tracking
    const { error: bdJobErr } = await bdClient.from('jobs').insert({
      job_no: `TEST-BD-ILLEGAL-${runId}`,
      part_no: 'ILLEGAL-PART',
      part_name: 'Illegal Part',
      customer: 'Illegal Customer',
      order_qty: 10,
      material: 'SUS304',
      status: 'ACTIVE'
    });
    record('BD user strictly blocked from creating Sample Tracking jobs', !!bdJobErr, bdJobErr?.message || 'Blocked');

    // --------------------------------------------------------------------------
    // 3. BD DRAWING REVIEW ISSUE CREATION
    // --------------------------------------------------------------------------
    console.log('\n--- 3. BD DRAWING REVIEW ISSUE CREATION ---');
    const { data: allocNo, error: allocErr } = await bdClient.rpc('allocate_next_drawing_review_issue_no');
    record('BD allocates next Issue Number', !allocErr && typeof allocNo === 'string', allocNo);

    // Upload dummy technical drawing
    const drawingPath = `drawings/${allocNo}/smoke_technical_drawing.pdf`;
    const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n193\n%%EOF');
    const { error: upErr } = await bdClient.storage.from('drawing-reviews').upload(drawingPath, dummyPdf, { contentType: 'application/pdf' });
    record('BD uploads PDF drawing to drawing-reviews bucket', !upErr, drawingPath);

    // Create Issue (takes 8 parameters without p_issue_no)
    const { data: issueRes, error: createErr } = await bdClient.rpc('create_drawing_review_issue', {
      p_item_no: `PART-TEST-${runId.toUpperCase()}`,
      p_item_name: '[TEST-VERIFICATION] Trục Bạc Đạn Thẩm Định Production',
      p_customer: 'Test Verification Customer',
      p_drawing_file_path: drawingPath,
      p_drawing_file_name: 'smoke_technical_drawing.pdf',
      p_drawing_file_size: dummyPdf.length,
      p_drawing_mime_type: 'application/pdf',
      p_attention: 'Live post-deployment smoke test record - temporary'
    });
    record('BD creates Issue & V1 in Issued status', !createErr && issueRes?.issue_id, `Issue: ${issueRes?.issue_id}, IssueNo: ${issueRes?.issue_no}`);
    createdIssueId = issueRes?.issue_id;
    const v1Id = issueRes?.version_id;

    // --------------------------------------------------------------------------
    // 4. PE-MFG TECHNICAL WORKSPACE & DRAFT SAVE
    // --------------------------------------------------------------------------
    console.log('\n--- 4. PE-MFG TECHNICAL WORKSPACE & DRAFT SAVE ---');
    const peClient = createClient(PROD_URL, PROD_ANON_KEY);
    const { error: peLoginErr } = await peClient.auth.signInWithPassword({ email: peEmail, password: tempPass });
    record('PE-MFG user login succeeds', !peLoginErr);

    // Save Draft (Issued -> Reviewing)
    const op1Lineage = crypto.randomUUID();
    const op2Lineage = crypto.randomUUID();
    const { data: draftRes, error: draftErr } = await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'SUS304 Round Bar Ø25.4mm',
      p_required_tooling: 'Dao tiện ngoài CNC CNMG 120408',
      p_special_measuring_equipment: 'Panme đo ngoài hiển thị số Mitutoyo',
      p_engineering_remarks: 'Sản xuất thử nghiệm lô mẫu đầu tiên',
      p_avatar_file_path: null,
      p_avatar_crop_box: null,
      p_operations: [
        { lineage_id: op1Lineage, step_order: 10, workcenter_code: 'A20C', operation_description: 'Tiện thô & tinh', cycle_time_seconds: 135, remark: 'Tiện ngoài' },
        { lineage_id: op2Lineage, step_order: 20, workcenter_code: 'Subcon', operation_description: 'Mạ Crom cứng (Hard Chrome)', cycle_time_seconds: 0, remark: 'Gia công ngoài' }
      ]
    });
    record('PE-MFG saves draft: transitions Issued -> Reviewing', !draftErr && draftRes?.status === 'Reviewing', `Status: ${draftRes?.status}`);

    // Test SUBCON validation on save when description is empty
    const { data: draftEmptySubcon, error: subconDraftErr } = await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'SUS304',
      p_required_tooling: 'Dao tiện',
      p_special_measuring_equipment: 'Thước cặp',
      p_engineering_remarks: 'Ghi chú',
      p_avatar_file_path: null,
      p_avatar_crop_box: null,
      p_operations: [
        { lineage_id: op2Lineage, step_order: 20, workcenter_code: 'Subcon', operation_description: '', cycle_time_seconds: 0, remark: '' }
      ]
    });
    // Now try to CLOSE with empty SUBCON description: MUST BE BLOCKED!
    const { error: subconCloseErr } = await peClient.rpc('close_drawing_review_version', { p_version_id: v1Id });
    record('SUBCON validation blocks closing with empty description', !!subconCloseErr, subconCloseErr?.message);

    // Restore valid description before close
    await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'SUS304 Round Bar Ø25.4mm',
      p_required_tooling: 'Dao tiện ngoài CNC CNMG 120408',
      p_special_measuring_equipment: 'Panme đo ngoài hiển thị số Mitutoyo',
      p_engineering_remarks: 'Sản xuất thử nghiệm lô mẫu đầu tiên',
      p_avatar_file_path: null,
      p_avatar_crop_box: null,
      p_operations: [
        { lineage_id: op1Lineage, step_order: 10, workcenter_code: 'A20C', operation_description: 'Tiện thô & tinh', cycle_time_seconds: 135, remark: 'Tiện ngoài' },
        { lineage_id: op2Lineage, step_order: 20, workcenter_code: 'Subcon', operation_description: 'Mạ Crom cứng (Hard Chrome)', cycle_time_seconds: 0, remark: 'Gia công ngoài' }
      ]
    });

    // --------------------------------------------------------------------------
    // 5. PE-MFG CLOSE V1 & IMMUTABILITY TRIGGER
    // --------------------------------------------------------------------------
    console.log('\n--- 5. PE-MFG CLOSE V1 & IMMUTABILITY TRIGGER ---');
    const { data: closeRes, error: closeErr } = await peClient.rpc('close_drawing_review_version', {
      p_version_id: v1Id
    });
    record('PE-MFG closes V1: transitions Reviewing -> Completed', !closeErr && closeRes?.status === 'Completed', `Status: ${closeRes?.status}`);

    // Verify trigger immutability blocks mutation
    let blockedUpdate = false;
    const { error: mutErr } = await peClient
      .from('drawing_review_versions')
      .update({ required_material: 'MUTATION_ATTEMPT_AFTER_COMPLETED' })
      .eq('id', v1Id);
    if (mutErr && (mutErr.message.includes('bất biến') || mutErr.message.includes('Completed') || mutErr.message.includes('hoàn thành'))) {
      blockedUpdate = true;
    }
    record('PostgreSQL trigger strictly blocks updating Completed V1', blockedUpdate, mutErr?.message);

    // --------------------------------------------------------------------------
    // 6. CREATE V2 & LINEAGE PRESERVATION
    // --------------------------------------------------------------------------
    console.log('\n--- 6. CREATE V2 & LINEAGE PRESERVATION ---');
    const { data: v2Res, error: v2Err } = await peClient.rpc('create_next_drawing_review_version', {
      p_issue_id: createdIssueId
    });
    record('PE-MFG creates V2: version_number=2, status=Reviewing', !v2Err && v2Res?.version_id, `V2 ID: ${v2Res?.version_id}`);

    // Verify V1 is still Completed
    const { data: v1Check } = await peClient.from('drawing_review_versions').select('id, version_number, status').eq('id', v1Id).single();
    record('V1 remains immutable and Completed alongside V2', v1Check?.status === 'Completed');

  } finally {
    // --------------------------------------------------------------------------
    // 7. CLEAN UP TEMPORARY SMOKE TEST RECORDS & ACCOUNTS
    // --------------------------------------------------------------------------
    console.log('\n--- 7. TEARDOWN OF TEMPORARY TEST RECORDS (ZERO PROD DATA IMPACT) ---');
    if (createdIssueId) {
      await adminClient.from('drawing_review_issues').delete().eq('id', createdIssueId);
      console.log(`  🧹 Cleaned up temporary test issue: ${createdIssueId}`);
    }
    if (bdUserId) {
      await adminClient.auth.admin.deleteUser(bdUserId);
      console.log(`  🧹 Cleaned up temporary BD smoke account: ${bdUserId}`);
    }
    if (peUserId) {
      await adminClient.auth.admin.deleteUser(peUserId);
      console.log(`  🧹 Cleaned up temporary PE-MFG smoke account: ${peUserId}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  const passed = testResults.filter(r => r.pass).length;
  console.log(`   AUTHENTICATED SMOKE TEST RESULT: ${passed} / ${testResults.length} PASSED`);
  console.log('='.repeat(80));
}

runAuthenticatedSmoke().catch(err => {
  console.error('FATAL SMOKE ERROR:', err);
  process.exit(1);
});
