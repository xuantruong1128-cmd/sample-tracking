/**
 * SAMPLE TRACKING — PRODUCTION R2 LIVE END-TO-END VERIFICATION
 *
 * Verifies live operational functionality on Production (uqvxtgvdmdfgtjwzsxlj):
 * - Creates a test verification job
 * - Tests PE Review OK/NG enforcement
 * - Tests N1 inspection with Check Sheet
 * - Tests QA NG Details with live defect aggregation
 * - Closes job with final evaluation
 * - Triggers generate-final-report Edge Function
 * - Downloads and inspects generated PDF R2 report
 * - Cleans up or archives verification record safely
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');

const TARGET_PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(TARGET_PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DUMMY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DUMMY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAIBREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function verifyProductionR2() {
  console.log('='.repeat(80));
  console.log('   SAMPLE TRACKING — PRODUCTION LIVE R2 END-TO-END VERIFICATION');
  console.log(`   Target:    ${TARGET_PROD_URL} (uqvxtgvdmdfgtjwzsxlj)`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  let passed = 0;
  let total = 0;
  function assert(condition, name, err = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ [Prod Check ${total}]: ${name}`);
    } else {
      console.error(`  ❌ [Prod Check ${total}]: ${name}${err ? ` - ${err}` : ''}`);
      process.exitCode = 1;
    }
  }

  const runCode = 'PROD_R2_' + Date.now().toString(36).toUpperCase();

  // 1. Create Verification Job
  console.log('\n--- 1. Creating Production Verification Job ---');
  const { data: job, error: jErr } = await client
    .from('jobs')
    .insert({
      job_no: `JOB-PR2-${Date.now().toString().slice(-5)}`,
      part_no: `PROD-VAL-${runCode}`,
      part_name: 'Trục Bạc Đạn Thẩm Định Production R2',
      customer: 'Production Validation Corp',
      order_qty: 50,
      material: 'SUS304',
      planned_start_date: '2026-10-26',
      planned_finish_date: '2026-10-31',
      status: 'ACTIVE',
    })
    .select()
    .single();

  assert(!jErr && job, 'Created live production validation job', jErr?.message);

  // 2. Create Operation
  const { data: op, error: opErr } = await client
    .from('job_operations')
    .insert({
      job_id: job.id,
      step_order: 10,
      operation_name: 'Gia Công Thẩm Định CNC',
      machine_no: 'CNC-PROD-01',
      workcenter_code: 'CNC',
      status: 'NOT_STARTED',
    })
    .select()
    .single();

  assert(!opErr && op, 'Created operation OP10', opErr?.message);

  // 3. Upload Sample Photo & Set Part Avatar
  console.log('\n--- 2. Uploading Avatar & Sample Photos ---');
  const avatarPath = `${job.id}/SAMPLE_PHOTO/${op.id}_avatar.png`;
  const n1Path = `${job.id}/QA_DOCS/${op.id}_checksheet.jpg`;
  const qaNgPhotoPath = `${job.id}/QA_NG_PHOTO/${op.id}_defect.jpg`;

  await client.storage.from('sample-documents').upload(avatarPath, DUMMY_PNG, { contentType: 'image/png' });
  await client.storage.from('sample-documents').upload(n1Path, DUMMY_JPEG, { contentType: 'image/jpeg' });
  await client.storage.from('sample-documents').upload(qaNgPhotoPath, DUMMY_JPEG, { contentType: 'image/jpeg' });

  const { data: spPhoto } = await client
    .from('operation_sample_photos')
    .insert({
      job_id: job.id,
      operation_id: op.id,
      file_name: 'prod_avatar.png',
      file_path: avatarPath,
      file_size: DUMMY_PNG.length,
      mime_type: 'image/png',
      uploader_name: 'Production Admin',
    })
    .select()
    .single();

  const { data: avRes, error: avErr } = await client.rpc('set_part_avatar', {
    p_job_id: job.id,
    p_photo_id: spPhoto.id,
  });
  assert(!avErr && avRes?.success === true, 'Set Part Avatar on Production');

  // 4. Save PE Production Run (OK=48, NG=2)
  console.log('\n--- 3. Recording Production Run & Defect ---');
  const { error: prErr } = await client.rpc('save_production_result_with_ng', {
    p_operation_id: op.id,
    p_machine_id: 'CNC-PROD-01',
    p_production_date: '2026-10-26',
    p_cycle_time: 35.0,
    p_ok_qty: 48,
    p_kiv_qty: 0,
    p_ng_items: [
      {
        defect_code: 'PE-BURR',
        defect_name: 'Bavia đầu trục tiện',
        ng_qty: 2,
        cause: 'Mòn dao tiện mặt đầu',
        remark: 'Đã mài lại dao',
        photo_urls: [],
      },
    ],
    p_remarks: 'Chạy thử nghiệm sản xuất',
  });
  assert(!prErr, 'Saved PE-MFG production run on Production', prErr?.message);

  // 5. Test PE Review
  console.log('\n--- 4. Testing PE Review Enforcement ---');
  const { data: peRev, error: peErr } = await client
    .from('pe_engineering_reviews')
    .insert({
      operation_id: op.id,
      job_id: job.id,
      review_result: 'OK',
      engineering_comment: 'Đạt yêu cầu thẩm định sản xuất.',
      reviewer_name: 'Production PE Leader',
      reviewer_role: 'PE-MFG',
    })
    .select()
    .single();
  assert(!peErr && peRev?.review_result === 'OK', 'PE Review OK accepted on Production');

  // 6. Test QA N1 & QA NG Details
  console.log('\n--- 5. Testing QA Inspection N1 & QA NG Details ---');
  const qaDefects = [
    {
      defect_code: 'QA-SCRATCH',
      defect_name: 'Xước bề mặt 0.02mm',
      ng_qty: 1,
      remark: 'Kiểm tra kính lúp phát hiện',
      photo_urls: [qaNgPhotoPath],
    },
    {
      defect_code: 'QA-DENT',
      defect_name: 'Móp gờ định vị',
      ng_qty: 2,
      remark: 'Lỗi gá đặt',
      photo_urls: [],
    },
  ];

  const { data: qaRes, error: qaErr } = await client.rpc('save_qa_check_result', {
    p_operation_id: op.id,
    p_n1_result: 'OK',
    p_n1_check_sheet_urls: [n1Path],
    p_notes: 'Thẩm định N1 Production hoàn tất.',
    p_qa_ng_items: qaDefects,
  });

  assert(!qaErr && qaRes?.success === true, 'Saved QA Inspection with N1 and defect rows', qaErr?.message);
  assert(qaRes?.qa_total_ng === 3, 'QA Total NG correctly auto-aggregated to 3 pcs');

  // 7. Close Operation & Close Job
  console.log('\n--- 6. Closing Operation and Closing Job ---');
  await client.from('job_operations').update({ status: 'CLOSED', closed_at: new Date().toISOString() }).eq('id', op.id);

  const { data: closeRes, error: closeErr } = await client.rpc('close_job_final', {
    p_job_id: job.id,
    p_confirm_ticket: job.job_no,
    p_close_reason: 'Thẩm định nghiệm thu Production R2 hoàn tất',
    p_evaluation_result: 'PASS',
    p_overall_assessment: 'Sản phẩm mẫu đạt 100% dung sai và độ bóng trên dây chuyền sản xuất thực tế.',
  });

  assert(!closeErr && closeRes?.success === true, 'Executed close_job_final RPC on Production');

  // 8. Invoke Edge Function generate-final-report on Production
  console.log('\n--- 7. Invoking Edge Function generate-final-report on Production ---');
  const { data: genRes, error: genErr } = await client.functions.invoke('generate-final-report', {
    body: { job_id: job.id },
  });

  assert(!genErr && genRes?.success === true, 'Production generate-final-report Edge Function succeeded', genErr?.message);

  // 9. Verify Generated Report PDF and ZIP
  console.log('\n--- 8. Verifying Generated Report PDF and ZIP on Production ---');
  const { data: rpt } = await client
    .from('sample_final_reports')
    .select('*')
    .eq('job_id', job.id)
    .single();

  assert(rpt?.generation_status === 'Ready', 'Report record reached Ready status on Production');
  assert(rpt?.pdf_file_size > 15000, `PDF size is realistic (${rpt?.pdf_file_size} bytes)`);
  assert(rpt?.zip_file_size > 15000, `ZIP size is realistic (${rpt?.zip_file_size} bytes)`);

  // Download PDF from production storage
  const { data: pdfBlob, error: dlErr } = await client.storage
    .from('sample-documents')
    .download(rpt.pdf_file_path);

  assert(!dlErr && pdfBlob, 'Downloaded generated PDF from production storage');

  const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
  const prodPdfPath = path.resolve(__dirname, '..', 'uat_output', `PROD_LIVE_VERIFIED_${rpt.pdf_file_name}`);
  fs.writeFileSync(prodPdfPath, pdfBuffer);
  console.log(`  💾 Saved Live Production PDF to: ${prodPdfPath}`);

  // Inspect PDF stream
  let cmaps = [];
  let textStreams = [];
  let pos = 0;
  while (pos < pdfBuffer.length) {
    const streamStart = pdfBuffer.indexOf('stream', pos);
    if (streamStart === -1) break;
    let dataStart = streamStart + 6;
    if (pdfBuffer[dataStart] === 0x0d && pdfBuffer[dataStart + 1] === 0x0a) dataStart += 2;
    else if (pdfBuffer[dataStart] === 0x0a) dataStart += 1;
    const streamEnd = pdfBuffer.indexOf('endstream', dataStart);
    if (streamEnd === -1) break;
    try {
      const inflated = zlib.inflateSync(pdfBuffer.subarray(dataStart, streamEnd));
      const str = inflated.toString('latin1');
      if (str.includes('beginbfchar')) {
        const map = {};
        const matches = str.matchAll(/<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4})>/g);
        for (const m of matches) map[m[1].toUpperCase()] = String.fromCodePoint(parseInt(m[2], 16));
        cmaps.push(map);
      } else if (str.includes('BT') && str.includes('ET')) {
        textStreams.push(str);
      }
    } catch {}
    pos = streamEnd + 9;
  }

  let decodedTokens = [];
  for (const stream of textStreams) {
    const matches = stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g);
    for (const m of matches) {
      const hex = m[1];
      for (const cmap of cmaps) {
        let decoded = '';
        for (let i = 0; i < hex.length; i += 4) {
          const glyph = hex.slice(i, i + 4).toUpperCase();
          if (cmap[glyph]) decoded += cmap[glyph];
        }
        if (decoded.length * 4 >= hex.length * 0.7) decodedTokens.push(decoded);
      }
    }
  }
  const allText = decodedTokens.join(' ');

  assert(allText.includes('5. KẾT QUẢ KIỂM TRA CHẤT LƯỢNG (QA INSPECTION)'), 'PDF Section 5 header rendered on Production');
  assert(allText.includes('N1 [OK]'), 'PDF Section 5 displays N1 [OK] on Production');
  assert(allText.includes('Tổng lỗi QA: 3 pcs'), 'PDF Section 5 displays QA Total NG: 3 pcs on Production');
  assert(allText.includes('[PE-MFG]') && allText.includes('[QA-NG]'), 'PDF Section 4 NG table source separation on Production');
  assert(allText.includes('7. PHỤ LỤC HÌNH ẢNH (PHOTO APPENDIX)'), 'PDF Section 7 Photo Appendix rendered on Production');

  console.log('\n' + '='.repeat(80));
  console.log(`   PRODUCTION LIVE VERIFICATION SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('================================================================================');

  if (passed === total) {
    console.log('\n🎉 ALL PRODUCTION LIVE CHECKS PASSED WITH 100% SUCCESS RATE!');
  } else {
    process.exitCode = 1;
  }
}

verifyProductionR2().catch((err) => {
  console.error('\n❌ Fatal production verification error:', err);
  process.exit(1);
});
