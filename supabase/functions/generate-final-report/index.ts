import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function computeSha256Hex(buffer: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function toAscii(str: string): string {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .replace(/[^\x20-\x7E]/g, ' ');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let targetJobId: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    let callerUser: any = null;
    let callerProfile: any = null;

    const isServiceKeyMatch = (token === serviceRoleKey && serviceRoleKey.length > 0);
    let isServiceRoleJwt = false;
    const currentProjectRef = (supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.role === 'service_role' && (!payload.ref || payload.ref === currentProjectRef || payload.ref === 'hosppagbopdghlupnhlr')) {
          isServiceRoleJwt = true;
        }
      }
    } catch {
      // not a JWT
    }

    if (isServiceKeyMatch || isServiceRoleJwt) {
      const { data: adminProf } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'Admin')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      callerUser = { id: adminProf?.id || null };
      callerProfile = {
        id: adminProf?.id || null,
        role: 'Admin',
        is_department_leader: true,
        is_active: true,
        full_name: adminProf?.full_name || 'Admin System',
      };
    } else {
      const { data: { user }, error: callerError } = await adminClient.auth.getUser(token);
      if (callerError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerUser = user;

      // Role check: Admin or PE-MFG Leader
      const { data: profile, error: profileErr } = await adminClient
        .from('profiles')
        .select('role, is_department_leader, is_active, full_name')
        .eq('id', callerUser.id)
        .single();

      if (profileErr || !profile || !profile.is_active) {
        return new Response(JSON.stringify({ error: 'Forbidden: Inactive account or profile not found' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerProfile = profile;
    }

    const isPeMfgLeader = callerProfile.role === 'PE-MFG' && callerProfile.is_department_leader === true;
    const isAdmin = callerProfile.role === 'Admin';
    if (!isPeMfgLeader && !isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Quyền hạn bị từ chối: Chỉ PE-MFG Leader hoặc Admin mới được tạo lại báo cáo.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { job_id } = body;
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'Missing required field: job_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    targetJobId = job_id;

    // Fetch existing report record
    const { data: report, error: reportErr } = await adminClient
      .from('sample_final_reports')
      .select('*')
      .eq('job_id', job_id)
      .single();

    if (reportErr || !report) {
      return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ báo cáo cho JOB này.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update status to Generating
    await adminClient
      .from('sample_final_reports')
      .update({
        generation_status: 'Generating',
        generation_error: null,
        generation_attempts: (report.generation_attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id);

    const snapshot = report.snapshot_data || {};
    const partNo = sanitizeFileName(snapshot.part_no || 'UNKNOWN_PART');
    const jobNo = sanitizeFileName(snapshot.job_no || 'UNKNOWN_JOB');
    const baseName = `${partNo} - ${jobNo}`;

    // =========================================================================
    // 1. GENERATE PDF REPORT USING PDF-LIB
    // =========================================================================
    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
    let y = 800;

    const drawPageText = (text: string, options: any) => {
      page.drawText(toAscii(String(text || '')), options);
    };

    const drawText = (
      text: string,
      x: number,
      size: number,
      isBold = false,
      color = rgb(0.1, 0.1, 0.1)
    ) => {
      drawPageText(text, {
        x,
        y,
        size,
        font: isBold ? fontBold : fontRegular,
        color,
      });
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < 50) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = 800;
        // Mini page header
        drawPageText(`SAMPLE FINAL REPORT: ${jobNo} (Part: ${partNo})`, {
          x: 40,
          y: 815,
          size: 8,
          font: fontRegular,
          color: rgb(0.5, 0.5, 0.5),
        });
        page.drawLine({
          start: { x: 40, y: 810 },
          end: { x: 555, y: 810 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
      }
    };

    // Header Title
    drawText('SAMPLE PRODUCTION FINAL REPORT', 40, 16, true, rgb(0.1, 0.2, 0.4));
    y -= 14;
    drawText('Hồ Sơ Tổng Kết & Nghiệm Thu Sản Xuất Mẫu', 40, 10, false, rgb(0.4, 0.4, 0.4));
    y -= 15;

    page.drawLine({
      start: { x: 40, y },
      end: { x: 555, y },
      thickness: 1.5,
      color: rgb(0.2, 0.3, 0.6),
    });
    y -= 18;

    // SECTION: JOB PLANNING OVERVIEW (Grid)
    drawText('1. THÔNG TIN CHUNG (PLANNING OVERVIEW)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    const infoRows = [
      [`Mã JOB Ticket:`, snapshot.job_no || 'N/A', `Mã bản vẽ (Part No):`, snapshot.part_no || 'N/A'],
      [`Tên sản phẩm:`, snapshot.part_name || 'N/A', `Khách hàng:`, snapshot.customer || 'N/A'],
      [`Sản lượng đặt hàng:`, `${snapshot.order_qty || 0} pcs`, `Ngày giao hàng:`, snapshot.delivery_date || 'N/A'],
      [`Vật liệu:`, snapshot.material || 'N/A', `Xử lý bề mặt:`, snapshot.treatment || 'N/A'],
      [`Độ cứng:`, snapshot.hardness || 'N/A', `Phiên bản bản vẽ:`, snapshot.drawing_version || 'N/A'],
      [`Thời gian đóng JOB:`, snapshot.closed_at || 'N/A', `Người đóng JOB:`, snapshot.closed_by_name || 'N/A'],
    ];

    infoRows.forEach((row) => {
      ensureSpace(14);
      drawText(row[0], 45, 8.5, true, rgb(0.3, 0.3, 0.3));
      drawText(row[1], 145, 8.5, false, rgb(0.1, 0.1, 0.1));
      drawText(row[2], 300, 8.5, true, rgb(0.3, 0.3, 0.3));
      drawText(row[3], 420, 8.5, false, rgb(0.1, 0.1, 0.1));
      y -= 12;
    });

    y -= 10;
    ensureSpace(60);

    // SECTION: FINAL EVALUATION BADGE & ASSESSMENT
    drawText('2. ĐÁNH GIÁ NGHIỆM THU CUỐI CÙNG (FINAL EVALUATION)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 16;

    const evalResult = report.evaluation_result || 'PASS';
    let evalColor = rgb(0.1, 0.6, 0.2); // Green for PASS
    if (evalResult === 'CONDITIONAL') evalColor = rgb(0.85, 0.5, 0.05); // Orange
    if (evalResult === 'FAIL') evalColor = rgb(0.8, 0.15, 0.15); // Red

    // Evaluation box
    page.drawRectangle({
      x: 40,
      y: y - 55,
      width: 515,
      height: 60,
      color: rgb(0.97, 0.98, 1.0),
      borderColor: evalColor,
      borderWidth: 1.5,
    });

    drawPageText(`KẾT QUẢ: ${evalResult}`, {
      x: 55,
      y: y - 18,
      size: 13,
      font: fontBold,
      color: evalColor,
    });

    drawPageText(`Người đánh giá: ${report.closed_by_name || 'N/A'} (PE-MFG Leader)`, {
      x: 55,
      y: y - 32,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });

    drawPageText(`Thời điểm đánh giá: ${report.closed_at || 'N/A'}`, {
      x: 55,
      y: y - 44,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });

    y -= 70;
    ensureSpace(50);

    drawText('Nhận xét kỹ thuật tổng thể:', 45, 8.5, true, rgb(0.2, 0.2, 0.2));
    y -= 11;
    drawText(report.overall_assessment || 'Không có ghi chú thêm.', 55, 8, false, rgb(0.2, 0.2, 0.2));
    y -= 14;

    if (report.improvements_required) {
      ensureSpace(25);
      drawText('Hạng mục cần cải tiến:', 45, 8.5, true, rgb(0.7, 0.3, 0.1));
      y -= 11;
      drawText(report.improvements_required, 55, 8, false, rgb(0.2, 0.2, 0.2));
      y -= 14;
    }

    if (report.unresolved_issues) {
      ensureSpace(25);
      drawText('Vấn đề tồn đọng:', 45, 8.5, true, rgb(0.8, 0.1, 0.1));
      y -= 11;
      drawText(report.unresolved_issues, 55, 8, false, rgb(0.2, 0.2, 0.2));
      y -= 14;
    }

    y -= 8;
    ensureSpace(60);

    // SECTION: OPERATIONS & PRODUCTION RESULTS
    // Invariant: OK/NG/KIV are displayed PER OPERATION, never summed across operations
    drawText('3. TIẾN ĐỘ & KẾT QUẢ SẢN XUẤT THEO CÔNG ĐOẠN (OPERATIONS BREAKDOWN)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    // Table Header
    page.drawRectangle({
      x: 40,
      y: y - 12,
      width: 515,
      height: 16,
      color: rgb(0.9, 0.93, 0.97),
    });

    const colX = [45, 80, 200, 260, 330, 380, 430, 480];
    drawPageText('Bước', { x: colX[0], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    drawPageText('Công đoạn', { x: colX[1], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    drawPageText('Máy', { x: colX[2], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    drawPageText('CT (s)', { x: colX[3], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    drawPageText('OK', { x: colX[4], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
    drawPageText('NG', { x: colX[5], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.7, 0.1, 0.1) });
    drawPageText('KIV', { x: colX[6], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.7, 0.5, 0.1) });
    drawPageText('Trạng thái', { x: colX[7], y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;

    const ops = snapshot.operations || [];
    ops.forEach((op: any) => {
      ensureSpace(16);
      const pr = op.production_run || {};
      drawPageText(`OP${op.step_order}`, { x: colX[0], y, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      drawPageText(String(op.operation_name || '').slice(0, 22), { x: colX[1], y, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
      drawPageText(String(pr.machine_id || op.machine_no || '-').slice(0, 10), { x: colX[2], y, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
      drawPageText(String(pr.cycle_time_seconds || '-'), { x: colX[3], y, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
      drawPageText(String(pr.ok_qty ?? 0), { x: colX[4], y, size: 8, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
      drawPageText(String(pr.ng_qty ?? 0), { x: colX[5], y, size: 8, font: fontBold, color: rgb(0.7, 0.1, 0.1) });
      drawPageText(String(pr.kiv_qty ?? 0), { x: colX[6], y, size: 8, font: fontBold, color: rgb(0.7, 0.5, 0.1) });
      drawPageText(String(op.status || 'CLOSED'), { x: colX[7], y, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
      
      page.drawLine({
        start: { x: 40, y: y - 3 },
        end: { x: 555, y: y - 3 },
        thickness: 0.3,
        color: rgb(0.85, 0.85, 0.85),
      });
      y -= 14;
    });

    y -= 10;
    ensureSpace(50);

    // SECTION: DEFECT LOGS (NG DETAILS)
    drawText('4. BÁO CÁO PHẾ PHẨM & NGUYÊN NHÂN LỖI (NG DETAILS)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    let hasNg = false;
    ops.forEach((op: any) => {
      const ngList = op.ng_details || [];
      ngList.forEach((ng: any) => {
        hasNg = true;
        ensureSpace(14);
        drawText(
          `• OP${op.step_order} [${ng.defect_code || 'NG'}]: ${ng.defect_name || 'Lỗi'} | SL: ${ng.defect_qty || 0} | NN: ${ng.cause || 'Chưa rõ'} | Ghi chú: ${ng.remark || '-'}`,
          45,
          7.5,
          false,
          rgb(0.2, 0.2, 0.2)
        );
        y -= 11;
      });
    });

    if (!hasNg) {
      drawText('• Không ghi nhận phế phẩm (Không phát sinh lỗi NG trong toàn bộ quy trình).', 45, 8, false, rgb(0.3, 0.5, 0.3));
      y -= 12;
    }

    y -= 10;
    ensureSpace(50);

    // SECTION: QA INSPECTION & REVIEWS
    drawText('5. KẾT QUẢ KIỂM TRA CHẤT LƯỢNG (QA INSPECTION)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    let hasQa = false;
    ops.forEach((op: any) => {
      const qaList = op.qa_checks || [];
      qaList.forEach((qc: any) => {
        hasQa = true;
        ensureSpace(14);
        const qColor = qc.result === 'OK' ? rgb(0.1, 0.5, 0.2) : rgb(0.8, 0.2, 0.2);
        drawText(
          `• OP${op.step_order} QA: Kết quả [${qc.result || 'OK'}] | Mẫu: ${qc.sample_size || 0} | OK: ${qc.ok_qty || 0} | NG: ${qc.ng_qty || 0} | Ghi chú: ${qc.notes || '-'}`,
          45,
          7.5,
          false,
          qColor
        );
        y -= 11;
      });
    });

    if (!hasQa) {
      drawText('• Chưa có ghi nhận kiểm tra QA độc lập.', 45, 8, false, rgb(0.5, 0.5, 0.5));
      y -= 12;
    }

    y -= 10;
    ensureSpace(50);

    // SECTION: ATTACHMENT & DOCUMENT INDEX
    drawText('6. MỤC LỤC TÀI LIỆU KỸ THUẬT & HÌNH ẢNH (ATTACHMENT INDEX)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    const engDocs = snapshot.engineering_documents || [];
    let docCount = 0;
    engDocs.forEach((doc: any) => {
      docCount++;
      ensureSpace(12);
      drawText(
        `• [${doc.category}] ${doc.file_name} (${doc.version || 'v1'}) - Tải lên bởi: ${doc.uploader_name || 'Hệ thống'}`,
        45,
        7.5,
        false,
        rgb(0.2, 0.2, 0.2)
      );
      y -= 11;
    });

    ops.forEach((op: any) => {
      const photos = op.sample_photos || [];
      photos.forEach((sp: any) => {
        docCount++;
        ensureSpace(12);
        drawText(
          `• [Sample Photo] OP${op.step_order}: ${sp.file_name} - Tải lên bởi: ${sp.uploader_name || 'MFG'}`,
          45,
          7.5,
          false,
          rgb(0.2, 0.2, 0.2)
        );
        y -= 11;
      });
    });

    if (docCount === 0) {
      drawText('• Không đính kèm tệp kỹ thuật bổ sung.', 45, 8, false, rgb(0.5, 0.5, 0.5));
      y -= 12;
    }

    // Footer signature notice on last page
    ensureSpace(40);
    y -= 10;
    page.drawLine({
      start: { x: 40, y },
      end: { x: 555, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 14;
    drawText('Hồ sơ số hóa tự động từ hệ thống Sample Tracking Online - Tính bất biến được bảo đảm bởi Supabase.', 40, 7.5, false, rgb(0.5, 0.5, 0.5));

    const pdfBytes = await pdfDoc.save();
    const pdfSha256 = await computeSha256Hex(pdfBytes);
    const pdfFileName = `${baseName}.pdf`;
    const pdfStoragePath = `${job_id}/final_report/${pdfFileName}`;

    // Upload PDF to sample-documents
    const { error: pdfUploadErr } = await adminClient.storage
      .from('sample-documents')
      .upload(pdfStoragePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (pdfUploadErr) {
      throw new Error(`Lỗi khi lưu trữ PDF báo cáo: ${pdfUploadErr.message}`);
    }

    // =========================================================================
    // 2. GENERATE ZIP ARCHIVE USING FFLATE
    // =========================================================================
    const zipEntries: Record<string, Uint8Array> = {};
    const manifest: any = {
      archive_name: `${baseName}.zip`,
      generated_at: new Date().toISOString(),
      job_no: snapshot.job_no,
      part_no: snapshot.part_no,
      master_pdf: pdfFileName,
      files: [] as any[],
      missing_files: [] as any[],
    };

    // Add generated PDF into root of ZIP
    zipEntries[pdfFileName] = pdfBytes;
    manifest.files.push({
      folder: '/',
      file_name: pdfFileName,
      size: pdfBytes.length,
      sha256: pdfSha256,
    });

    // Helper to download object from Supabase Storage
    const downloadAndAttach = async (folder: string, storagePath: string, preferredName?: string) => {
      try {
        const { data: fileBlob, error: dlErr } = await adminClient.storage
          .from('sample-documents')
          .download(storagePath);

        if (dlErr || !fileBlob) {
          manifest.missing_files.push({
            folder,
            storage_path: storagePath,
            reason: dlErr?.message || 'File not found in storage',
          });
          return;
        }

        const arrayBuf = await fileBlob.arrayBuffer();
        const fileBytes = new Uint8Array(arrayBuf);
        const fileName = sanitizeFileName(preferredName || storagePath.split('/').pop() || 'document');
        const zipPath = `${folder}/${fileName}`;

        zipEntries[zipPath] = fileBytes;
        manifest.files.push({
          folder,
          file_name: fileName,
          size: fileBytes.length,
          storage_path: storagePath,
        });
      } catch (err: any) {
        manifest.missing_files.push({
          folder,
          storage_path: storagePath,
          reason: err.message,
        });
      }
    };

    // Collect Engineering Documents
    for (const doc of engDocs) {
      if (!doc.file_path) continue;
      let targetFolder = 'other_documents';
      if (doc.category === 'Drawing') targetFolder = 'drawings';
      else if (doc.category === 'Check Sheet') targetFolder = 'check_sheets';
      else if (doc.category === 'Setting') targetFolder = 'settings';

      await downloadAndAttach(targetFolder, doc.file_path, doc.file_name);
    }

    // Collect Sample Photos & NG Photos
    for (const op of ops) {
      for (const sp of op.sample_photos || []) {
        if (!sp.file_path) continue;
        const name = `OP${op.step_order}_${sp.file_name}`;
        await downloadAndAttach('sample_photos', sp.file_path, name);
      }
      for (const ng of op.ng_details || []) {
        const urls = ng.photo_urls || [];
        for (let i = 0; i < urls.length; i++) {
          const u = urls[i];
          if (!u) continue;
          const cleanName = `OP${op.step_order}_NG_${ng.defect_code || 'DEFECT'}_${i + 1}.jpg`;
          await downloadAndAttach('ng_photos', u, cleanName);
        }
      }
    }

    // Add manifest.json into ZIP
    const manifestJson = JSON.stringify(manifest, null, 2);
    zipEntries['manifest.json'] = strToU8(manifestJson);

    // Compress all entries into ZIP
    const zipBytes = zipSync(zipEntries, { level: 6 });
    const zipSha256 = await computeSha256Hex(zipBytes);
    const zipFileName = `${baseName}.zip`;
    const zipStoragePath = `${job_id}/final_report/${zipFileName}`;

    // Upload ZIP to sample-documents
    const { error: zipUploadErr } = await adminClient.storage
      .from('sample-documents')
      .upload(zipStoragePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (zipUploadErr) {
      throw new Error(`Lỗi khi lưu trữ ZIP báo cáo: ${zipUploadErr.message}`);
    }

    // =========================================================================
    // 3. UPDATE FINAL REPORT RECORD TO READY
    // =========================================================================
    const { data: updatedReport, error: updateErr } = await adminClient
      .from('sample_final_reports')
      .update({
        generation_status: 'Ready',
        generation_error: null,
        generated_at: new Date().toISOString(),
        pdf_file_name: pdfFileName,
        pdf_file_path: pdfStoragePath,
        pdf_file_size: pdfBytes.length,
        pdf_sha256: pdfSha256,
        zip_file_name: zipFileName,
        zip_file_path: zipStoragePath,
        zip_file_size: zipBytes.length,
        zip_sha256: zipSha256,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id)
      .select('*')
      .single();

    if (updateErr) {
      throw new Error(`Lỗi cập nhật trạng thái báo cáo: ${updateErr.message}`);
    }

    // Audit Log
    await adminClient.from('audit_logs').insert({
      user_id: callerUser?.id || null,
      action: 'GENERATE_FINAL_REPORT_SUCCESS',
      entity_type: 'sample_final_reports',
      entity_id: report.id,
      old_values: { generation_status: 'Generating' },
      new_values: {
        generation_status: 'Ready',
        pdf_size: pdfBytes.length,
        zip_size: zipBytes.length,
        missing_count: manifest.missing_files.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: 'Ready',
        report: updatedReport,
        message: 'Báo cáo PDF và gói ZIP đã được khởi tạo thành công.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    if (targetJobId) {
      try {
        await adminClient
          .from('sample_final_reports')
          .update({
            generation_status: 'Failed',
            generation_error: error.message || 'Lỗi hệ thống khi sinh báo cáo.',
            updated_at: new Date().toISOString(),
          })
          .eq('job_id', targetJobId);
      } catch {
        // ignore secondary error
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal error during report generation',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
