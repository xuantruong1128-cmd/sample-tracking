const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error('Missing Supabase configuration in .env');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLiveVerification() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — PHASE F FINAL REPORT LIVE VERIFICATION (Supabase TEST)');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName, detail) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ PASS [Check ${total}]: ${testName}`);
    } else {
      console.error(`  ❌ FAIL [Check ${total}]: ${testName}${detail ? ` - ${detail}` : ''}`);
      process.exitCode = 1;
    }
  }

  const runId = 'rpt_' + Date.now().toString(36);
  let testJobId = null;
  let adminUserId = null;
  let adminToken = null;
  let peMfgLeaderUserId = null;
  let peMfgLeaderToken = null;
  let planningUserId = null;
  let planningToken = null;

  try {
    // 1. Audit Table & Bucket
    const { data: bData, error: bErr } = await adminClient.storage.listBuckets();
    const docBucket = bData?.find((b) => b.id === 'sample-documents');
    assert(
      docBucket && docBucket.allowed_mime_types.includes('application/zip'),
      'Storage bucket "sample-documents" allows application/zip',
      JSON.stringify(docBucket?.allowed_mime_types)
    );

    const { data: repProbe, error: repErr } = await adminClient
      .from('sample_final_reports')
      .select('id, generation_status')
      .limit(1);
    assert(!repErr, 'Table "sample_final_reports" is present and accessible via RLS/Admin');

    // 2. Fetch or create users for authentication testing
    // Let's find an existing Admin and an existing PE-MFG Leader from profiles
    const { data: adminProf } = await adminClient
      .from('profiles')
      .select('id, role, is_active')
      .eq('role', 'Admin')
      .eq('is_active', true)
      .limit(1)
      .single();

    const { data: peLeaderProf } = await adminClient
      .from('profiles')
      .select('id, role, is_department_leader, is_active')
      .eq('role', 'PE-MFG')
      .eq('is_department_leader', true)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const { data: planningProf } = await adminClient
      .from('profiles')
      .select('id, role, is_active')
      .eq('role', 'Planning')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    assert(adminProf, 'Found active Admin profile in database', adminProf?.id);

    // 3. Create a clean test JOB
    const testJobNo = `TEST-JOB-${Date.now().toString().slice(-6)}`;
    const testPartNo = `PART-${runId.toUpperCase()}`;

    const { data: newJob, error: jobErr } = await adminClient
      .from('jobs')
      .insert({
        job_no: testJobNo,
        part_no: testPartNo,
        part_name: 'Live Test Report Bracket',
        customer: 'Live Verification Customer',
        order_qty: 50,
        material: 'SUS304',
        planned_start_date: new Date().toISOString().slice(0, 10),
        planned_finish_date: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
        status: 'ACTIVE',
        created_by: adminProf.id,
      })
      .select()
      .single();

    assert(!jobErr && newJob?.id, `Created test JOB ${testJobNo}`, jobErr?.message);
    testJobId = newJob?.id;

    if (!testJobId) throw new Error('Cannot continue without test job');

    // 4. Create Operations (OP10 & OP20)
    const { data: op10, error: op10Err } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJobId,
        step_order: 10,
        operation_name: 'Phay Khỏa Mặt',
        machine_no: 'CNC-MILL-01',
        workcenter_code: 'CNC',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    const { data: op20, error: op20Err } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJobId,
        step_order: 20,
        operation_name: 'Khoan & Taro',
        machine_no: 'DRILL-02',
        workcenter_code: 'DRILL',
        status: 'NOT_STARTED',
      })
      .select()
      .single();

    assert(!op10Err && !op20Err, 'Created OP10 and OP20 for test JOB');

    // 5. Add Production Run & Defect details to OP10 & OP20
    const { error: pr1Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op10.id,
      p_machine_id: 'CNC-MILL-01',
      p_production_date: new Date().toISOString().slice(0, 10),
      p_cycle_time: 45,
      p_ok_qty: 48,
      p_kiv_qty: 0,
      p_ng_items: [
        {
          defect_name: 'Vát mép không đều',
          defect_code: 'NG-CHAMFER',
          ng_qty: 2,
          cause: 'Góc dao bị lệch 0.5 độ',
          remark: 'Đã căn chỉnh lại dao',
        },
      ],
    });
    assert(!pr1Err, 'Saved production run for OP10 with NG items', pr1Err?.message);

    await adminClient.from('qa_checks').insert({
      operation_id: op10.id,
      sample_size: 5,
      ok_qty: 5,
      ng_qty: 0,
      result: 'OK',
      notes: 'Đạt yêu cầu kích thước kiểm tra',
      created_by: adminProf.id,
    });

    const { error: pr2Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op20.id,
      p_machine_id: 'DRILL-02',
      p_production_date: new Date().toISOString().slice(0, 10),
      p_cycle_time: 30,
      p_ok_qty: 48,
      p_kiv_qty: 0,
      p_ng_items: [],
    });
    assert(!pr2Err, 'Saved production run for OP20', pr2Err?.message);

    await adminClient.from('qa_checks').insert({
      operation_id: op20.id,
      sample_size: 5,
      ok_qty: 5,
      ng_qty: 0,
      result: 'OK',
      notes: 'Ren taro trơn tru chuẩn ren M6',
      created_by: adminProf.id,
    });

    // Add Engineering Document
    const dummyDocPath = `${testJobId}/DOCUMENTS/sample_drawing.pdf`;
    await adminClient.storage
      .from('sample-documents')
      .upload(dummyDocPath, Buffer.from('%PDF-1.4 Mock drawing content'), {
        contentType: 'application/pdf',
        upsert: true,
      });

    await adminClient.from('engineering_documents').insert({
      job_id: testJobId,
      operation_id: op10.id,
      category: 'Drawing',
      file_name: 'sample_drawing.pdf',
      file_path: dummyDocPath,
      file_size: 200,
      mime_type: 'application/pdf',
      version: 'v1',
      uploaded_by: adminProf.id,
      uploader_name: 'Admin Test',
    });

    // 6. Close Operations OP10 and OP20
    const { data: clOp10, error: clOp10Err } = await adminClient.rpc('close_job_operation', {
      p_operation_id: op10.id,
    });
    assert(clOp10?.success === true, 'Successfully closed OP10', clOp10Err?.message || clOp10?.error);

    const { data: clOp20, error: clOp20Err } = await adminClient.rpc('close_job_operation', {
      p_operation_id: op20.id,
    });
    assert(clOp20?.success === true, 'Successfully closed OP20', clOp20Err?.message || clOp20?.error);

    // 7. Test close_job_final validation rules
    // Test 7.1: Invalid evaluation enum
    const { error: invalidEnumErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJobId,
      p_confirm_ticket: testJobNo,
      p_evaluation_result: 'INVALID_STATUS',
      p_overall_assessment: 'Đánh giá mẫu hợp lệ',
    });
    assert(invalidEnumErr !== null, 'Rejected invalid evaluation result enum');

    // Test 7.2: Assessment too short (< 5 chars)
    const { error: shortAssessErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJobId,
      p_confirm_ticket: testJobNo,
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'abc',
    });
    assert(shortAssessErr !== null, 'Rejected overall_assessment shorter than 5 chars');

    // Test 7.3: CONDITIONAL without improvements_required
    const { error: condNoImpErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJobId,
      p_confirm_ticket: testJobNo,
      p_evaluation_result: 'CONDITIONAL',
      p_overall_assessment: 'Sản phẩm tạm ổn nhưng cần cải tiến',
      p_improvements_required: '',
    });
    assert(condNoImpErr !== null, 'Enforced mandatory improvements_required for CONDITIONAL result');

    // Test 7.4: When warnings exist (uncompleted QA), close_reason is mandatory
    const { error: warnNoReasonErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJobId,
      p_confirm_ticket: testJobNo,
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'Sản phẩm mẫu đạt chuẩn kỹ thuật, dung sai đáp ứng hoàn hảo.',
      p_close_reason: null,
    });
    assert(warnNoReasonErr !== null, 'Option B: Enforced explanation reason when warnings exist (missing QA checks)');

    // Test 7.5: Valid close_job_final call with close_reason & warnings acknowledged
    const { data: closeRes, error: closeErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJobId,
      p_confirm_ticket: testJobNo,
      p_close_reason: 'Chấp nhận đóng JOB theo kế hoạch nghiệm thu sản xuất mẫu đợt 1',
      p_acknowledged_warnings: ['2 công đoạn chưa hoàn tất QA độc lập'],
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'Sản phẩm mẫu đạt chuẩn kỹ thuật, dung sai đáp ứng hoàn hảo.',
      p_improvements_required: null,
      p_unresolved_issues: null,
    });

    assert(closeRes?.success === true, 'Successfully executed close_job_final with PASS evaluation', closeErr?.message);
    assert(closeRes?.status === 'CLOSE', 'Job status transitioned to CLOSE');
    assert(closeRes?.report_id !== undefined, 'Returned report_id from close_job_final');

    // 8. Verify sample_final_reports record
    const { data: repRecord, error: repFetchErr } = await adminClient
      .from('sample_final_reports')
      .select('*')
      .eq('job_id', testJobId)
      .single();

    assert(!repFetchErr && repRecord, 'Found sample_final_reports record in database');
    assert(repRecord?.generation_status === 'Pending', 'Initial generation_status is Pending');
    assert(repRecord?.evaluation_result === 'PASS', 'Stored evaluation_result is PASS');

    // 9. Invariant Verification: OK/NG quantities are separated per operation step and NOT summed across operations
    const snapshotOps = repRecord?.snapshot_data?.operations || [];
    assert(snapshotOps.length === 2, 'Snapshot contains 2 operations (OP10 and OP20)');
    const op10Data = snapshotOps.find((o) => o.step_order === 10);
    const op20Data = snapshotOps.find((o) => o.step_order === 20);

    assert(
      op10Data?.production_run?.ok_qty === 48 && op10Data?.production_run?.ng_qty === 2,
      'OP10 preserves its exact run quantities (OK: 48, NG: 2)'
    );
    assert(
      op20Data?.production_run?.ok_qty === 48 && op20Data?.production_run?.ng_qty === 0,
      'OP20 preserves its exact run quantities (OK: 48, NG: 0)'
    );
    assert(
      repRecord?.snapshot_data?.total_ok === undefined,
      'CRITICAL INVARIANT: No invalid total OK/NG cross-operation summation exists in snapshot'
    );

    // 10. Test Edge Function: generate-final-report
    console.log('\n  --- Testing Edge Function: generate-final-report ---');
    // Generate an admin auth token or invoke via functions endpoint
    const { data: genRes, error: genErr } = await adminClient.functions.invoke('generate-final-report', {
      body: { job_id: testJobId },
    });

    assert(!genErr && genRes?.success === true, 'Edge Function generate-final-report executed successfully', genErr?.message || genRes?.error);
    assert(genRes?.status === 'Ready', 'Report status transitioned to Ready');

    // 11. Verify Physical Storage Artifacts
    const { data: readyRep } = await adminClient
      .from('sample_final_reports')
      .select('*')
      .eq('job_id', testJobId)
      .single();

    assert(readyRep?.pdf_file_path !== null, `PDF path recorded: ${readyRep?.pdf_file_path}`);
    assert(readyRep?.zip_file_path !== null, `ZIP path recorded: ${readyRep?.zip_file_path}`);
    assert(readyRep?.pdf_file_size > 0, `PDF size is positive (${readyRep?.pdf_file_size} bytes)`);
    assert(readyRep?.zip_file_size > 0, `ZIP size is positive (${readyRep?.zip_file_size} bytes)`);
    assert(readyRep?.pdf_sha256 && readyRep?.pdf_sha256.length === 64, 'PDF SHA-256 computed and stored');
    assert(readyRep?.zip_sha256 && readyRep?.zip_sha256.length === 64, 'ZIP SHA-256 computed and stored');

    // Check physical presence in sample-documents
    const { data: pdfBlob, error: pdfDlErr } = await adminClient.storage
      .from('sample-documents')
      .download(readyRep.pdf_file_path);
    assert(!pdfDlErr && pdfBlob, 'Physical PDF successfully downloaded from storage');

    const { data: zipBlob, error: zipDlErr } = await adminClient.storage
      .from('sample-documents')
      .download(readyRep.zip_file_path);
    assert(!zipDlErr && zipBlob, 'Physical ZIP successfully downloaded from storage');

    // 12. Test Edge Function: get-report-download-url
    console.log('\n  --- Testing Edge Function: get-report-download-url ---');
    const { data: dlPdfRes, error: dlPdfErr } = await adminClient.functions.invoke('get-report-download-url', {
      body: { job_id: testJobId, file_type: 'pdf' },
    });

    assert(!dlPdfErr && dlPdfRes?.signedUrl, 'Authorized caller received signedUrl for PDF');
    assert(dlPdfRes?.expiresIn === 300, 'Signed URL TTL is strictly capped at 300 seconds (Gate B)');

    const { data: dlZipRes, error: dlZipErr } = await adminClient.functions.invoke('get-report-download-url', {
      body: { job_id: testJobId, file_type: 'zip' },
    });
    assert(!dlZipErr && dlZipRes?.signedUrl, 'Authorized caller received signedUrl for ZIP');

    // 13. Audit Log Verification
    const { data: rptLogs } = await adminClient
      .from('audit_logs')
      .select('action, entity_type')
      .eq('entity_id', readyRep.id);

    const logActions = rptLogs?.map((l) => l.action) || [];
    assert(
      logActions.includes('GENERATE_FINAL_REPORT_SUCCESS'),
      'Audit log recorded GENERATE_FINAL_REPORT_SUCCESS',
      JSON.stringify(logActions)
    );
    assert(
      logActions.includes('DOWNLOAD_FINAL_REPORT_PDF') && logActions.includes('DOWNLOAD_FINAL_REPORT_ZIP'),
      'Audit log recorded DOWNLOAD_FINAL_REPORT_PDF and DOWNLOAD_FINAL_REPORT_ZIP',
      JSON.stringify(logActions)
    );

    console.log(`\n================================================================================`);
    console.log(`   LIVE VERIFICATION SUMMARY: ${passed}/${total} CHECKS PASSED`);
    console.log(`================================================================================\n`);

  } finally {
    // 14. Cleanup Test Job and Storage
    if (testJobId) {
      console.log('  🧹 Cleaning up test artifacts for job:', testJobId);
      // Remove files in storage
      const { data: files } = await adminClient.storage
        .from('sample-documents')
        .list(`${testJobId}/final_report`);
      if (files && files.length > 0) {
        await adminClient.storage
          .from('sample-documents')
          .remove(files.map((f) => `${testJobId}/final_report/${f.name}`));
      }
      await adminClient.storage
        .from('sample-documents')
        .remove([`${testJobId}/DOCUMENTS/sample_drawing.pdf`]);

      // Remove job via cascade
      await adminClient.from('jobs').delete().eq('id', testJobId);
      console.log('  ✅ Cleanup completed cleanly.\n');
    }
  }
}

runLiveVerification().catch((err) => {
  console.error('Fatal error during live verification:', err);
  process.exit(1);
});
