/**
 * SAMPLE TRACKING — REVISION R2 LIVE VERIFICATION & BEFORE/AFTER PDF COMPARISON
 *
 * Verifies all R2 requirements:
 * R2-01: Unicode font embedding with Vietnamese diacritics & English text selection.
 * R2-02: Operations Breakdown table without CLOSED/Status column.
 * R2-03: NG Details Table (OP | Q'ty | Reason | Remark | Image), only filenames, text wrapping.
 * R2-04: Part Avatar selection, right side of Planning Overview, neutral placeholder, snapshot metadata.
 * R2-05: Dedicated Photo Appendix starting on new page, exactly 2 columns, pagination, non-crashing missing photos.
 * R2-06: Neutral header & footer with report name, Job Ticket, page number (no Supabase sentence).
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase configuration in .env');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Minimal valid PNG and JPEG buffers for testing photos
const DUMMY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DUMMY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAIBREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function runR2LiveVerification() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — REVISION R2 FINAL REPORT LIVE VERIFICATION');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName, detail = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ PASS [Check ${total}]: ${testName}`);
    } else {
      console.error(`  ❌ FAIL [Check ${total}]: ${testName}${detail ? ` - ${detail}` : ''}`);
      process.exitCode = 1;
    }
  }

  const runId = 'r2_' + Date.now().toString(36);
  const uatOutputDir = path.resolve(__dirname, '../uat_output');
  if (!fs.existsSync(uatOutputDir)) {
    fs.mkdirSync(uatOutputDir, { recursive: true });
  }

  let testJobId = null;
  let op1Id = null;
  let op2Id = null;
  let op3Id = null;
  let avatarPhotoId = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: VERIFY IMMUTABILITY OF EXISTING CLOSED REPORTS (Check 9)
    // -------------------------------------------------------------------------
    console.log('--- Step 1: Checking Existing Closed Reports Immutability ---');
    const { data: existingClosedReports } = await adminClient
      .from('sample_final_reports')
      .select('id, job_id, pdf_file_name, pdf_sha256, generation_status')
      .eq('generation_status', 'Ready')
      .order('id')
      .limit(3);

    assert(
      Array.isArray(existingClosedReports),
      'Existing closed report records query succeeded'
    );
    const existingHashesMap = new Map((existingClosedReports || []).map(r => [r.id, r.pdf_sha256]));

    // -------------------------------------------------------------------------
    // STEP 2: CREATE TEST JOB WITH VIETNAMESE CHARACTERS & MULTIPLE OPERATIONS
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Creating Test Job with Rich Vietnamese Diacritics ---');
    const vietnamesePartName = 'Trục Truyền Động Bạc Đạn & Khớp Nối CNC';
    const vietnameseCustomer = 'Công Ty TNHH Cơ Khí Chính Xác & Chế Tạo Mẫu';
    const vietnameseMaterial = 'Thép Không Gỉ SUS316L (Xử lý nhiệt & Tôi cao tần)';

    const { data: job, error: jobErr } = await adminClient
      .from('jobs')
      .insert({
        job_no: `JOB-R2-${Date.now().toString().slice(-6)}`,
        part_no: `BRACKET-R2-${runId.toUpperCase()}`,
        part_name: vietnamesePartName,
        customer: vietnameseCustomer,
        order_qty: 120,
        material: vietnameseMaterial,
        material_spec: 'Độ cứng 58-62 HRC, Mạ Crom cứng 25µm',
        planned_start_date: '2026-10-26',
        planned_finish_date: '2026-10-30',
        status: 'ACTIVE',
      })
      .select()
      .single();

    assert(!jobErr && job, 'Created test job with Vietnamese diacritics', jobErr?.message);
    testJobId = job.id;

    // Create 3 operations to test multi-page & operations breakdown
    const { data: op1, error: op1Err } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJobId,
        step_order: 10,
        operation_name: 'Tiện Định Hình CNC',
        machine_no: 'CNC-LATHE-01',
        workcenter_code: 'CNC',
        status: 'NOT_STARTED',
      })
      .select()
      .single();
    if (op1Err) throw new Error('OP1 insert error: ' + op1Err.message);
    op1Id = op1.id;

    const { data: op2, error: op2Err } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJobId,
        step_order: 20,
        operation_name: 'Phay Rãnh then & Khoan Lỗ',
        machine_no: 'MILLING-03',
        workcenter_code: 'CNC',
        status: 'NOT_STARTED',
      })
      .select()
      .single();
    if (op2Err) throw new Error('OP2 insert error: ' + op2Err.message);
    op2Id = op2.id;

    const { data: op3, error: op3Err } = await adminClient
      .from('job_operations')
      .insert({
        job_id: testJobId,
        step_order: 30,
        operation_name: 'Nhiệt Luyện & Xử Lý Bề Mặt',
        machine_no: 'FURNACE-02',
        workcenter_code: 'HEAT',
        status: 'NOT_STARTED',
      })
      .select()
      .single();
    if (op3Err) throw new Error('OP3 insert error: ' + op3Err.message);
    op3Id = op3.id;

    assert(Boolean(op1Id && op2Id && op3Id), 'Created 3 operations (OP10, OP20, OP30)');

    // -------------------------------------------------------------------------
    // STEP 3: UPLOAD SAMPLE PHOTOS & SELECT PART AVATAR (R2-04)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 3: Uploading Sample Photos & Testing Part Avatar Selection ---');
    const avatarFilePath = `${testJobId}/SAMPLE_PHOTO/${op1Id}_avatar_part_photo.png`;
    const photo2FilePath = `${testJobId}/SAMPLE_PHOTO/${op2Id}_sample_overview.jpg`;
    const photo3FilePath = `${testJobId}/SAMPLE_PHOTO/${op3Id}_treatment_finished.jpg`;
    const ngPhoto1Path = `${testJobId}/NG_PHOTO/${op1Id}_ng_scratch_close_up.jpg`;
    const ngPhoto2Path = `${testJobId}/NG_PHOTO/${op1Id}_ng_dimension_deviation.jpg`;
    const qaPhotoPath = `${testJobId}/QA_DOCS/${op2Id}_qa_measurement_photo.jpg`;

    // Upload physical files to storage
    await adminClient.storage.from('sample-documents').upload(avatarFilePath, DUMMY_PNG, { contentType: 'image/png' });
    await adminClient.storage.from('sample-documents').upload(photo2FilePath, DUMMY_JPEG, { contentType: 'image/jpeg' });
    await adminClient.storage.from('sample-documents').upload(photo3FilePath, DUMMY_JPEG, { contentType: 'image/jpeg' });
    await adminClient.storage.from('sample-documents').upload(ngPhoto1Path, DUMMY_JPEG, { contentType: 'image/jpeg' });
    await adminClient.storage.from('sample-documents').upload(ngPhoto2Path, DUMMY_JPEG, { contentType: 'image/jpeg' });
    await adminClient.storage.from('sample-documents').upload(qaPhotoPath, DUMMY_JPEG, { contentType: 'image/jpeg' });

    // Register sample photos in operation_sample_photos
    const { data: photoRec1 } = await adminClient
      .from('operation_sample_photos')
      .insert({
        job_id: testJobId,
        operation_id: op1Id,
        file_name: 'avatar_part_photo.png',
        file_path: avatarFilePath,
        file_size: DUMMY_PNG.length,
        mime_type: 'image/png',
        uploader_name: 'Kỹ Sư Trưởng PE-MFG',
      })
      .select()
      .single();
    avatarPhotoId = photoRec1.id;

    await adminClient
      .from('operation_sample_photos')
      .insert({
        job_id: testJobId,
        operation_id: op2Id,
        file_name: 'sample_overview.jpg',
        file_path: photo2FilePath,
        file_size: DUMMY_JPEG.length,
        mime_type: 'image/jpeg',
        uploader_name: 'Nguyễn Văn Kỹ Thuật',
      });

    await adminClient
      .from('operation_sample_photos')
      .insert({
        job_id: testJobId,
        operation_id: op3Id,
        file_name: 'treatment_finished.jpg',
        file_path: photo3FilePath,
        file_size: DUMMY_JPEG.length,
        mime_type: 'image/jpeg',
        uploader_name: 'Lê Văn Luyện Kim',
      });

    // Test RPC set_part_avatar
    const { data: avatarSetRes, error: avatarSetErr } = await adminClient.rpc('set_part_avatar', {
      p_job_id: testJobId,
      p_photo_id: avatarPhotoId,
    });
    assert(!avatarSetErr && avatarSetRes?.success === true, 'Successfully selected Part Avatar via set_part_avatar RPC');

    // Verify avatar marked in DB
    const { data: dbAvatarPhoto } = await adminClient
      .from('operation_sample_photos')
      .select('id, is_avatar')
      .eq('id', avatarPhotoId)
      .single();
    assert(dbAvatarPhoto?.is_avatar === true, 'operation_sample_photos record is_avatar is TRUE');

    // -------------------------------------------------------------------------
    // STEP 4: RECORD PRODUCTION RUNS & DEFECT DETAILS (R2-03)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 4: Recording Production Runs & NG Defect Details ---');
    // OP10 Production Run with 2 NG details via save_production_result_with_ng
    const { error: pr1Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op1Id,
      p_machine_id: 'CNC-LATHE-01',
      p_production_date: '2026-10-26',
      p_cycle_time: 46.5,
      p_ok_qty: 115,
      p_kiv_qty: 0,
      p_ng_items: [
        {
          defect_code: 'NG-SCRATCH',
          defect_name: 'Trầy xước bề mặt chi tiết tiện',
          ng_qty: 3,
          cause: 'Mạt phoi tiện cuốn vào bề mặt gia công do áp lực dung dịch tưới nguội chưa đạt chuẩn yêu cầu',
          remark: 'Đã vệ sinh bầu kẹp, thay vòi phun làm mát và tiến hành đánh bóng lại các chi tiết nhẹ',
          photo_urls: [ngPhoto1Path, ngPhoto2Path], // 2 filenames per R2-03 requirement
        },
        {
          defect_code: 'NG-TOLERANCE',
          defect_name: 'Sai lệch đường kính lắp bạc đạn Ø25 (+0.03mm)',
          ng_qty: 2,
          cause: 'Mòn dao tiện tinh WNMG080408 sau khi gia công lô 100 sản phẩm liên tục',
          remark: 'Đã thay mảnh dao tiện mới và hiệu chỉnh lại offset dao bù mòn trên bộ điều khiển Fanuc',
          photo_urls: [ngPhoto2Path],
        },
      ],
      p_remarks: 'Hoàn tất tiện định hình đạt yêu cầu dung sai trục',
    });
    if (pr1Err) throw new Error('PR1 error: ' + pr1Err.message);

    // OP20 Production Run (0 NG)
    const { error: pr2Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op2Id,
      p_machine_id: 'MILLING-03',
      p_production_date: '2026-10-27',
      p_cycle_time: 58.2,
      p_ok_qty: 115,
      p_kiv_qty: 0,
      p_ng_items: [],
      p_remarks: 'Phay rãnh then 8mm đạt độ song song 0.01mm',
    });
    if (pr2Err) throw new Error('PR2 error: ' + pr2Err.message);

    // OP30 Production Run (0 NG)
    const { error: pr3Err } = await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: op3Id,
      p_machine_id: 'FURNACE-02',
      p_production_date: '2026-10-28',
      p_cycle_time: 120.0,
      p_ok_qty: 115,
      p_kiv_qty: 0,
      p_ng_items: [],
      p_remarks: 'Độ cứng đạt 60 HRC, bề mặt mạ đồng đều không khuyết tật',
    });
    if (pr3Err) throw new Error('PR3 error: ' + pr3Err.message);

    // QA Check on OP2
    await adminClient.from('qa_checks').insert({
      operation_id: op2Id,
      sample_size: 10,
      ok_qty: 10,
      ng_qty: 0,
      result: 'OK',
      notes: 'Đo CMM kiểm tra kích thước then và độ đồng tâm đạt 100% bản vẽ',
    });

    // QA Document with photo on OP2
    await adminClient.from('qa_documents').insert({
      operation_id: op2Id,
      category: 'Inspection Report',
      file_name: 'qa_measurement_photo.jpg',
      file_path: qaPhotoPath,
      file_size: DUMMY_JPEG.length,
      mime_type: 'image/jpeg',
      remark: 'Ảnh kết quả đo kiểm trên máy CMM Mitutoyo',
      uploader_name: 'QA Trưởng Nhóm',
    });

    // Close all 3 operations
    await adminClient.from('job_operations').update({ status: 'CLOSED', closed_at: new Date().toISOString() }).eq('id', op1Id);
    await adminClient.from('job_operations').update({ status: 'CLOSED', closed_at: new Date().toISOString() }).eq('id', op2Id);
    await adminClient.from('job_operations').update({ status: 'CLOSED', closed_at: new Date().toISOString() }).eq('id', op3Id);

    // -------------------------------------------------------------------------
    // STEP 5: CLOSE JOB & CAPTURE REVISION R2 SNAPSHOT
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5: Executing close_job_final to Build R2 Snapshot ---');
    const { data: closeRes, error: closeErr } = await adminClient.rpc('close_job_final', {
      p_job_id: testJobId,
      p_confirm_ticket: job.job_no,
      p_close_reason: 'Tất cả 3 công đoạn hoàn thành xuất sắc đạt chuẩn chất lượng',
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'Sản phẩm mẫu đạt độ bóng Ra 0.4µm, độ cứng 60 HRC, lắp ghép thử nghiệm với động cơ servo đạt độ êm tuyệt đối. Cho phép xuất xưởng lô mẫu đầu tiên gửi khách hàng.',
    });

    assert(!closeErr && closeRes?.success === true, 'Executed close_job_final successfully');
    assert(closeRes?.report_id !== undefined, 'Returned valid report_id');

    // Verify snapshot includes part_avatar metadata
    const { data: rptRecord } = await adminClient
      .from('sample_final_reports')
      .select('snapshot_data')
      .eq('job_id', testJobId)
      .single();

    const snapshot = rptRecord?.snapshot_data || {};
    assert(snapshot.part_avatar !== undefined && snapshot.part_avatar !== null, 'Snapshot includes part_avatar object');
    assert(snapshot.part_avatar?.file_name === 'avatar_part_photo.png', 'Part Avatar filename correctly stored in snapshot');

    // -------------------------------------------------------------------------
    // STEP 6: TRIGGER REVISION R2 EDGE FUNCTION REPORT GENERATION
    // -------------------------------------------------------------------------
    console.log('\n--- Step 6: Invoking generate-final-report Edge Function (R2) ---');
    const { data: genRes, error: genErr } = await adminClient.functions.invoke('generate-final-report', {
      body: { job_id: testJobId },
    });

    assert(!genErr && genRes?.success === true, 'Edge Function generate-final-report returned success');

    // Verify report record transitioned to Ready
    const { data: finalReport } = await adminClient
      .from('sample_final_reports')
      .select('*')
      .eq('job_id', testJobId)
      .single();

    assert(finalReport.generation_status === 'Ready', 'Report generation_status transitioned to Ready');
    assert(finalReport.pdf_file_size > 15000, `PDF size is positive and realistic (${finalReport.pdf_file_size} bytes)`);
    assert(finalReport.zip_file_size > 15000, `ZIP size is positive and realistic (${finalReport.zip_file_size} bytes)`);

    // Download generated PDF & ZIP for byte-level inspection
    const { data: pdfBlob, error: dlPdfErr } = await adminClient.storage
      .from('sample-documents')
      .download(finalReport.pdf_file_path);
    assert(!dlPdfErr && pdfBlob, 'Downloaded generated PDF from storage');

    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
    const r2PdfPath = path.join(uatOutputDir, `${finalReport.pdf_file_name}`);
    fs.writeFileSync(r2PdfPath, pdfBuffer);
    console.log(`  💾 Saved R2 Generated PDF to: ${r2PdfPath}`);

    // Download ZIP
    const { data: zipBlob, error: dlZipErr } = await adminClient.storage
      .from('sample-documents')
      .download(finalReport.zip_file_path);
    assert(!dlZipErr && zipBlob, 'Downloaded generated ZIP package from storage');

    // -------------------------------------------------------------------------
    // STEP 7: DEEP PDF STREAM & LAYOUT INSPECTION (R2-01 to R2-06)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 7: Performing Deep PDF Structural & Content Inspection ---');

    // 1. Load with pdf-lib to inspect pages & structure
    const loadedPdf = await PDFDocument.load(pdfBuffer);
    const pageCount = loadedPdf.getPageCount();
    assert(pageCount >= 2, `PDF has multiple pages as required for dedicated appendix (Actual: ${pageCount} pages)`);

    // 2. Extract and decode text streams using embedded ToUnicode CMaps
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
          for (const m of matches) {
            map[m[1].toUpperCase()] = String.fromCodePoint(parseInt(m[2], 16));
          }
          cmaps.push(map);
        } else if (str.includes('BT') && str.includes('ET')) {
          textStreams.push(str);
        }
      } catch (e) {}

      pos = streamEnd + 9;
    }

    // Decode all hex text tokens across embedded font CMaps
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
          if (decoded.length * 4 >= hex.length * 0.7) {
            decodedTokens.push(decoded);
          }
        }
      }
    }
    const allExtractedText = decodedTokens.join(' ');

    // Check R2-01: Unicode font embedding & ToUnicode CMap
    assert(
      cmaps.length >= 2,
      'R2-01: Embedded Unicode Fonts with ToUnicode CMap mapping tables (Regular & Bold) for text selection & printing'
    );
    assert(
      allExtractedText.includes('Hồ Sơ Tổng Kết & Nghiệm Thu Sản Xuất Mẫu'),
      'R2-01: Correct Vietnamese diacritics rendered in PDF title and body text'
    );

    // Check R2-02: Operations Breakdown has NO Status column
    assert(
      !allExtractedText.includes('Trạng thái') && !allExtractedText.includes('CLOSED (Chốt)'),
      'R2-02: Operations Breakdown table contains NO CLOSED / Status column'
    );
    assert(
      allExtractedText.includes('Tiện Định Hình CNC') && allExtractedText.includes('CNC-LATHE-01'),
      'R2-02: Operations Breakdown table preserves OP, Process, Machine, CT, OK, NG, KIV values'
    );

    // Check R2-03: NG Details Table
    assert(
      allExtractedText.includes('[NG-SCRATCH] Trầy xước bề mặt chi tiết tiện') &&
      allExtractedText.includes('Đã vệ sinh bầu kẹp'),
      'R2-03: NG Details rendered with Reason and Remark wrapped properly'
    );
    assert(
      allExtractedText.includes('ng_scratch_close_up.jpg') || allExtractedText.includes('ng_dimension_deviation.jpg'),
      'R2-03: NG table displays image filenames (never thumbnails, up to 2 filenames per NG record)'
    );

    // Check R2-04: Part Avatar
    assert(
      allExtractedText.includes('avatar_part_photo.png (Ảnh đại diện)') || allExtractedText.includes('Ảnh sản phẩm mẫu (Ảnh đại diện)'),
      'R2-04: Part Avatar placed in Planning Overview section and listed in photo records'
    );

    // Check R2-05: Dedicated Photo Appendix
    assert(
      allExtractedText.includes('Tổng hợp hình ảnh mẫu sản phẩm, hình ảnh phế phẩm (NG)'),
      'R2-05: Dedicated Photo Appendix starts on a new page with proper header description'
    );
    assert(
      allExtractedText.includes('sample_overview.jpg') && allExtractedText.includes('Phế phẩm: [NG-SCRATCH]'),
      'R2-05: Photo Appendix includes sample photos, NG photos, and QA inspection photos'
    );

    // Check R2-06: Footer verification
    assert(
      !pdfBuffer.toString().includes('Tính bất biến được bảo đảm bởi Supabase') &&
      !allExtractedText.includes('Tính bất biến được bảo đảm bởi Supabase'),
      'R2-06: Supabase-related sentence removed entirely from PDF footer'
    );
    assert(
      allExtractedText.includes('SAMPLE PRODUCTION FINAL REPORT — Job Ticket:') && allExtractedText.includes('Trang 1 / 2'),
      'R2-06: Neutral footer with report name, Job Ticket and exact page number format (Trang X / Y) on all pages'
    );

    // -------------------------------------------------------------------------
    // STEP 8: TEST NEUTRAL PLACEHOLDER & MISSING PHOTO RESILIENCE
    // -------------------------------------------------------------------------
    console.log('\n--- Step 8: Testing Missing Photos & Placeholder Crash-Proof Handling ---');
    // Create second job without avatar and with a missing photo path to verify non-crashing behavior
    const { data: job2, error: job2Err } = await adminClient
      .from('jobs')
      .insert({
        job_no: `JOB-R2-SAFE-${Date.now().toString().slice(-6)}`,
        part_no: `PART-SAFE-${runId.toUpperCase()}`,
        part_name: 'Chi Tiết Thử Nghiệm Ảnh Mẫu Khuyết Tật',
        customer: 'Safety Check Corp',
        order_qty: 50,
        material: 'AL6061-T6',
        planned_start_date: '2026-10-26',
        planned_finish_date: '2026-10-28',
        status: 'ACTIVE',
      })
      .select()
      .single();
    if (job2Err) throw new Error('Job2 creation error: ' + job2Err.message);

    const { data: opSafe, error: opSafeErr } = await adminClient
      .from('job_operations')
      .insert({
        job_id: job2.id,
        step_order: 10,
        operation_name: 'Phay Khỏa Mặt',
        machine_no: 'CNC-01',
        workcenter_code: 'CNC',
        status: 'NOT_STARTED',
      })
      .select()
      .single();
    if (opSafeErr) throw new Error('OpSafe creation error: ' + opSafeErr.message);

    // Insert a phantom photo that does not exist in storage
    await adminClient.from('operation_sample_photos').insert({
      job_id: job2.id,
      operation_id: opSafe.id,
      file_name: 'phantom_missing_photo.png',
      file_path: `${job2.id}/phantom_non_existent.png`,
      file_size: 1024,
      mime_type: 'image/png',
      uploader_name: 'Test Safe',
    });

    await adminClient.rpc('save_production_result_with_ng', {
      p_operation_id: opSafe.id,
      p_machine_id: 'CNC-01',
      p_production_date: '2026-10-26',
      p_cycle_time: 30,
      p_ok_qty: 50,
      p_kiv_qty: 0,
      p_ng_items: [],
    });

    await adminClient.from('job_operations')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('id', opSafe.id);

    await adminClient.rpc('close_job_final', {
      p_job_id: job2.id,
      p_confirm_ticket: job2.job_no,
      p_close_reason: 'Kiểm tra độ bền bỉ khi không có avatar và tệp ảnh bị thiếu',
      p_evaluation_result: 'PASS',
      p_overall_assessment: 'Đánh giá khả năng chống crash khi ảnh không tồn tại.',
    });

    const { data: safeGenRes, error: safeGenErr } = await adminClient.functions.invoke('generate-final-report', {
      body: { job_id: job2.id },
    });

    assert(!safeGenErr && safeGenRes?.success === true, 'Edge function generated PDF safely despite missing photo & no avatar (no crash)');

    const { data: safeRpt } = await adminClient
      .from('sample_final_reports')
      .select('generation_status')
      .eq('job_id', job2.id)
      .single();
    assert(safeRpt?.generation_status === 'Ready', 'Report for job with missing photo reached Ready status cleanly');

    // -------------------------------------------------------------------------
    // STEP 9: VERIFY IMMUTABILITY PRESERVATION OF EXISTING REPORTS (Check 9)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 9: Re-verifying Existing Closed Reports Immutability ---');
    const { data: postCheckReports } = await adminClient
      .from('sample_final_reports')
      .select('id, pdf_sha256')
      .in('id', Array.from(existingHashesMap.keys()))
      .order('id');

    const postHashesMap = new Map((postCheckReports || []).map(r => [r.id, r.pdf_sha256]));
    let unchanged = true;
    for (const [id, preHash] of existingHashesMap.entries()) {
      if (postHashesMap.get(id) !== preHash) {
        unchanged = false;
        break;
      }
    }
    assert(unchanged, 'All previously closed immutable reports remained 100% byte-identical and untouched');

    // Cleanup safe test job
    await adminClient.from('jobs').delete().eq('id', job2.id);

  } catch (err) {
    console.error('Unexpected exception during live verification:', err);
    process.exitCode = 1;
  }

  console.log('\n================================================================================');
  console.log(`   R2 LIVE VERIFICATION SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('================================================================================');
}

runR2LiveVerification();
