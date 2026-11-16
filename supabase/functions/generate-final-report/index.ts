import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';
import { getRobotoRegularFontBytes, getRobotoBoldFontBytes } from './fonts.ts';

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

function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const paragraphs = String(text).replace(/\r\n/g, '\n').split('\n');

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
        currentLine = test;
      } else {
        if (currentLine) lines.push(currentLine);
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          let chunk = '';
          for (const char of word) {
            if (font.widthOfTextAtSize(chunk + char, fontSize) <= maxWidth) {
              chunk += char;
            } else {
              lines.push(chunk);
              chunk = char;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

async function embedImageSafely(pdfDoc: PDFDocument, bytes: Uint8Array): Promise<any> {
  if (!bytes || bytes.length < 8) return null;
  // JPEG magic: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    try {
      return await pdfDoc.embedJpg(bytes);
    } catch {
      return null;
    }
  }
  // PNG magic: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    try {
      return await pdfDoc.embedPng(bytes);
    } catch {
      return null;
    }
  }
  // Try fallback
  try {
    return await pdfDoc.embedJpg(bytes);
  } catch {
    try {
      return await pdfDoc.embedPng(bytes);
    } catch {
      return null;
    }
  }
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
    // 1. GENERATE PDF REPORT USING PDF-LIB WITH UNICODE FONTS (REVISION R2)
    // =========================================================================
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontRegular = await pdfDoc.embedFont(getRobotoRegularFontBytes(), { subset: true });
    const fontBold = await pdfDoc.embedFont(getRobotoBoldFontBytes(), { subset: true });

    let page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
    let y = 800;

    const drawPageText = (text: string, options: any) => {
      page.drawText(String(text ?? ''), options);
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

    // SECTION 1: PLANNING OVERVIEW + PART AVATAR (R2-04)
    drawText('1. THÔNG TIN CHUNG (PLANNING OVERVIEW)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    const yOverviewTop = y;

    // 2-column info grid on the left (x: 40 to 405)
    const infoRows = [
      [`Mã JOB Ticket:`, snapshot.job_no || 'N/A', `Mã bản vẽ (Part No):`, snapshot.part_no || 'N/A'],
      [`Tên sản phẩm:`, snapshot.part_name || 'N/A', `Khách hàng:`, snapshot.customer || 'N/A'],
      [`Sản lượng đặt hàng:`, `${snapshot.order_qty || 0} pcs`, `Ngày giao hàng:`, snapshot.delivery_date || 'N/A'],
      [`Vật liệu:`, snapshot.material || 'N/A', `Xử lý bề mặt:`, snapshot.treatment || snapshot.material_spec || 'N/A'],
      [`Thời gian đóng JOB:`, snapshot.closed_at ? new Date(snapshot.closed_at).toLocaleString('vi-VN') : 'N/A', `Người đóng JOB:`, snapshot.closed_by_name || 'N/A'],
    ];

    infoRows.forEach((row) => {
      drawText(row[0], 45, 8, true, rgb(0.3, 0.3, 0.3));
      drawText(String(row[1]).slice(0, 20), 125, 8, false, rgb(0.1, 0.1, 0.1));
      drawText(row[2], 225, 8, true, rgb(0.3, 0.3, 0.3));
      drawText(String(row[3]).slice(0, 20), 310, 8, false, rgb(0.1, 0.1, 0.1));
      y -= 13;
    });

    // R2-04: Part Avatar on the right side of Planning Overview (x: 415 to 555, width: 140, height: 75)
    const avatarBoxX = 415;
    const avatarBoxY = yOverviewTop - 70;
    const avatarBoxW = 140;
    const avatarBoxH = 72;

    let avatarEmbedded = false;
    const partAvatar = snapshot.part_avatar;
    if (partAvatar && partAvatar.file_path) {
      try {
        const { data: avatarBlob, error: avErr } = await adminClient.storage
          .from('sample-documents')
          .download(partAvatar.file_path);

        if (!avErr && avatarBlob) {
          const avatarArrayBuf = await avatarBlob.arrayBuffer();
          const avatarBytes = new Uint8Array(avatarArrayBuf);
          const embeddedImg = await embedImageSafely(pdfDoc, avatarBytes);
          if (embeddedImg) {
            const dims = embeddedImg.scale(1);
            const maxW = avatarBoxW - 8;
            const maxH = avatarBoxH - 16;
            const scale = Math.min(maxW / dims.width, maxH / dims.height);
            const renderW = dims.width * scale;
            const renderH = dims.height * scale;
            const imgX = avatarBoxX + (avatarBoxW - renderW) / 2;
            const imgY = avatarBoxY + 14 + (maxH - renderH) / 2;

            page.drawRectangle({
              x: avatarBoxX,
              y: avatarBoxY,
              width: avatarBoxW,
              height: avatarBoxH,
              color: rgb(0.98, 0.99, 1.0),
              borderColor: rgb(0.8, 0.85, 0.9),
              borderWidth: 0.8,
            });

            page.drawImage(embeddedImg, {
              x: imgX,
              y: imgY,
              width: renderW,
              height: renderH,
            });

            page.drawText('Ảnh đại diện sản phẩm', {
              x: avatarBoxX + 15,
              y: avatarBoxY + 4,
              size: 6.5,
              font: fontBold,
              color: rgb(0.3, 0.4, 0.6),
            });

            avatarEmbedded = true;
          }
        }
      } catch {
        avatarEmbedded = false;
      }
    }

    if (!avatarEmbedded) {
      // Neutral placeholder when no avatar exists or download failed
      page.drawRectangle({
        x: avatarBoxX,
        y: avatarBoxY,
        width: avatarBoxW,
        height: avatarBoxH,
        color: rgb(0.96, 0.97, 0.98),
        borderColor: rgb(0.82, 0.85, 0.9),
        borderWidth: 0.8,
      });

      page.drawText('[ẢNH ĐẠI DIỆN SẢN PHẨM]', {
        x: avatarBoxX + 12,
        y: avatarBoxY + 40,
        size: 7.5,
        font: fontBold,
        color: rgb(0.5, 0.55, 0.6),
      });

      page.drawText('(Chưa có ảnh mẫu đại diện)', {
        x: avatarBoxX + 16,
        y: avatarBoxY + 26,
        size: 7,
        font: fontRegular,
        color: rgb(0.6, 0.65, 0.7),
      });
    }

    y = Math.min(y, avatarBoxY - 14);
    ensureSpace(60);

    // SECTION 2: FINAL EVALUATION BADGE & ASSESSMENT
    drawText('2. ĐÁNH GIÁ NGHIỆM THU CUỐI CÙNG (FINAL EVALUATION)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 16;

    const evalResult = report.evaluation_result || 'PASS';
    let evalColor = rgb(0.1, 0.6, 0.2); // Green for PASS
    if (evalResult === 'CONDITIONAL') evalColor = rgb(0.85, 0.5, 0.05); // Orange
    if (evalResult === 'FAIL' || evalResult === 'REJECT') evalColor = rgb(0.8, 0.15, 0.15); // Red

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

    drawPageText(`Thời điểm đánh giá: ${report.closed_at ? new Date(report.closed_at).toLocaleString('vi-VN') : 'N/A'}`, {
      x: 55,
      y: y - 44,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });

    y -= 70;
    ensureSpace(40);

    drawText('Nhận xét kỹ thuật tổng thể:', 45, 8.5, true, rgb(0.2, 0.2, 0.2));
    y -= 11;

    const assessmentLines = wrapText(report.overall_assessment || 'Không có ghi chú thêm.', 500, fontRegular, 8);
    assessmentLines.forEach((line) => {
      ensureSpace(12);
      drawText(line, 55, 8, false, rgb(0.2, 0.2, 0.2));
      y -= 11;
    });
    y -= 4;

    if (report.improvements_required) {
      ensureSpace(25);
      drawText('Hạng mục cần cải tiến:', 45, 8.5, true, rgb(0.7, 0.3, 0.1));
      y -= 11;
      const impLines = wrapText(report.improvements_required, 500, fontRegular, 8);
      impLines.forEach((line) => {
        ensureSpace(12);
        drawText(line, 55, 8, false, rgb(0.2, 0.2, 0.2));
        y -= 11;
      });
      y -= 4;
    }

    if (report.unresolved_issues) {
      ensureSpace(25);
      drawText('Vấn đề tồn đọng:', 45, 8.5, true, rgb(0.8, 0.1, 0.1));
      y -= 11;
      const unresLines = wrapText(report.unresolved_issues, 500, fontRegular, 8);
      unresLines.forEach((line) => {
        ensureSpace(12);
        drawText(line, 55, 8, false, rgb(0.2, 0.2, 0.2));
        y -= 11;
      });
      y -= 4;
    }

    y -= 8;
    ensureSpace(60);

    // =========================================================================
    // SECTION 3: OPERATIONS BREAKDOWN (R2-02: Status column REMOVED)
    // OP, Process, Machine, CT, OK, NG, KIV
    // =========================================================================
    drawText('3. TIẾN ĐỘ & KẾT QUẢ SẢN XUẤT THEO CÔNG ĐOẠN (OPERATIONS BREAKDOWN)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    const drawOpsHeader = () => {
      page.drawRectangle({
        x: 40,
        y: y - 12,
        width: 515,
        height: 16,
        color: rgb(0.9, 0.93, 0.97),
      });

      page.drawText('Bước', { x: 45, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Công đoạn (Process)', { x: 85, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Máy (Machine)', { x: 275, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('CT (s)', { x: 360, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('OK', { x: 415, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
      page.drawText('NG', { x: 465, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.7, 0.1, 0.1) });
      page.drawText('KIV', { x: 515, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.7, 0.5, 0.1) });
      y -= 18;
    };

    drawOpsHeader();

    const ops = snapshot.operations || [];
    ops.forEach((op: any) => {
      if (y - 18 < 50) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = 800;
        drawOpsHeader();
      }

      const pr = op.production_run || {};
      drawPageText(`OP${op.step_order}`, { x: 45, y, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      drawPageText(String(op.operation_name || '').slice(0, 32), { x: 85, y, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
      drawPageText(String(pr.machine_id || op.machine_no || '-').slice(0, 12), { x: 275, y, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
      drawPageText(String(pr.cycle_time_seconds || '-'), { x: 360, y, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
      drawPageText(String(pr.ok_qty ?? 0), { x: 415, y, size: 8, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
      drawPageText(String(pr.ng_qty ?? 0), { x: 465, y, size: 8, font: fontBold, color: rgb(0.7, 0.1, 0.1) });
      drawPageText(String(pr.kiv_qty ?? 0), { x: 515, y, size: 8, font: fontBold, color: rgb(0.7, 0.5, 0.1) });

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

    // =========================================================================
    // SECTION 4: NG DETAILS TABLE (R2-03: Formal Table Replacement)
    // OP | Q'ty | Reason | Remark | Image
    // =========================================================================
    drawText('4. BÁO CÁO PHẾ PHẨM & NGUYÊN NHÂN LỖI (NG DETAILS)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    const drawNgHeader = () => {
      page.drawRectangle({
        x: 40,
        y: y - 12,
        width: 515,
        height: 16,
        color: rgb(0.92, 0.94, 0.98),
      });

      page.drawText('Bước (OP)', { x: 45, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('SL (Q\'ty)', { x: 95, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Lỗi / Nguyên nhân (Reason)', { x: 145, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Ghi chú (Remark)', { x: 295, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText('Tệp ảnh đính kèm (Image)', { x: 425, y: y - 8, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      y -= 18;
    };

    interface FinalNgRecord {
      opStep: number;
      source: 'PE-MFG' | 'QA';
      defectQty: number;
      defectCode?: string;
      defectName: string;
      cause?: string;
      remark?: string;
      photoUrls?: string[];
    }

    let allNgRecords: FinalNgRecord[] = [];
    ops.forEach((op: any) => {
      // 1. PE-MFG NG Records
      (op.ng_details || []).forEach((ng: any) => {
        allNgRecords.push({
          opStep: op.step_order,
          source: 'PE-MFG',
          defectQty: ng.defect_qty || ng.ng_qty || 0,
          defectCode: ng.defect_code,
          defectName: ng.defect_name || 'Lỗi sản xuất',
          cause: ng.cause,
          remark: ng.remark,
          photoUrls: ng.photo_urls || [],
        });
      });

      // 2. QA NG Records (Part C2)
      (op.qa_ng_details || []).forEach((qng: any) => {
        allNgRecords.push({
          opStep: op.step_order,
          source: 'QA',
          defectQty: qng.defect_qty || qng.ng_qty || 0,
          defectCode: qng.defect_code,
          defectName: qng.defect_name || 'Lỗi thẩm định QA',
          cause: qng.cause,
          remark: qng.remark,
          photoUrls: qng.photo_urls || [],
        });
      });
    });

    if (allNgRecords.length === 0) {
      drawText('• Không ghi nhận phế phẩm (Không phát sinh lỗi NG từ PE-MFG hoặc QA).', 45, 8, false, rgb(0.3, 0.5, 0.3));
      y -= 14;
    } else {
      drawNgHeader();

      for (const item of allNgRecords) {
        const { opStep, source } = item;
        const prefix = source === 'QA' ? '[QA-NG]' : '[PE-MFG]';
        const reasonText = `${prefix} [${item.defectCode || 'NG'}] ${item.defectName}${item.cause ? `\nNN: ${item.cause}` : ''}`;
        const remarkText = item.remark || '-';

        // Extract filenames (up to 2 per requirement R2-03)
        const photoUrls = item.photoUrls || [];
        const fileNames = photoUrls.slice(0, 2).map((u: string) => {
          let raw = (u || '').split('/').pop()?.split('?')[0] || '';
          raw = raw.replace(/^[0-9a-fA-F-]{36}_/, '');
          return sanitizeFileName(raw);
        }).filter(Boolean);

        const reasonLines = wrapText(reasonText, 140, fontRegular, 7.5);
        const remarkLines = wrapText(remarkText, 120, fontRegular, 7.5);
        const imageLines = fileNames.length > 0 ? fileNames : ['-'];

        const maxLines = Math.max(reasonLines.length, remarkLines.length, imageLines.length, 1);
        const rowHeight = maxLines * 10 + 6;

        if (y - rowHeight < 50) {
          page = pdfDoc.addPage([595.28, 841.89]);
          y = 800;
          drawNgHeader();
        }

        const startY = y;
        drawPageText(`OP${opStep}`, { x: 45, y: startY, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
        drawPageText(`${item.defectQty} pcs`, { x: 95, y: startY, size: 8, font: fontBold, color: rgb(0.7, 0.1, 0.1) });

        reasonLines.forEach((line, idx) => {
          drawPageText(line, { x: 145, y: startY - idx * 10, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
        });

        remarkLines.forEach((line, idx) => {
          drawPageText(line, { x: 295, y: startY - idx * 10, size: 7.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
        });

        imageLines.forEach((name, idx) => {
          const displayName = name.length > 28 ? name.slice(0, 25) + '...' : name;
          drawPageText(displayName, { x: 425, y: startY - idx * 10, size: 7, font: fontRegular, color: rgb(0.2, 0.3, 0.5) });
        });

        y -= rowHeight;
        page.drawLine({
          start: { x: 40, y: y + 2 },
          end: { x: 555, y: y + 2 },
          thickness: 0.3,
          color: rgb(0.85, 0.85, 0.85),
        });
      }
    }

    y -= 10;
    ensureSpace(50);

    // =========================================================================
    // SECTION 5: QA INSPECTION & REVIEWS (C1: Revised QA presentation)
    // Display: OP, N1 Result (OK/NG), QA remarks, QA Total NG
    // Do NOT display: QA Result, Sample Size, QA OK Quantity, QA KIV
    // =========================================================================
    drawText('5. KẾT QUẢ KIỂM TRA CHẤT LƯỢNG (QA INSPECTION)', 40, 10, true, rgb(0.15, 0.2, 0.3));
    y -= 14;

    let hasQa = false;
    ops.forEach((op: any) => {
      const qaList = op.qa_checks || [];
      qaList.forEach((qc: any) => {
        hasQa = true;
        ensureSpace(14);
        const n1Res = qc.n1_result || (qc.result === 'NG' ? 'NG' : 'OK');
        const qColor = n1Res === 'OK' ? rgb(0.1, 0.5, 0.2) : rgb(0.8, 0.2, 0.2);
        const totalNg = qc.qa_total_ng ?? qc.ng_qty ?? 0;
        const notes = qc.notes || '-';
        drawText(
          `• OP${op.step_order} QA: Kết quả N1 [${n1Res}] | Tổng lỗi QA: ${totalNg} pcs | Ghi chú: ${notes}`,
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

    // SECTION 6: ATTACHMENT & DOCUMENT INDEX
    drawText('6. MỤC LỤC TÀI LIỆU KỸ THUẬT & HỒ SƠ ĐÍNH KÈM (ATTACHMENT INDEX)', 40, 10, true, rgb(0.15, 0.2, 0.3));
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
          `• [Sample Photo] OP${op.step_order}: ${sp.file_name}${sp.is_avatar ? ' (Ảnh đại diện)' : ''} - Tải lên bởi: ${sp.uploader_name || 'MFG'}`,
          45,
          7.5,
          false,
          rgb(0.2, 0.2, 0.2)
        );
        y -= 11;
      });

      const qaDocs = op.qa_documents || [];
      qaDocs.forEach((qd: any) => {
        docCount++;
        ensureSpace(12);
        drawText(
          `• [QA Doc: ${qd.category}] OP${op.step_order}: ${qd.file_name} - Tải lên bởi: ${qd.uploader_name || 'QA'}`,
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

    // =========================================================================
    // SECTION 7: PHOTO APPENDIX (R2-05 & C3: Dedicated 2-Column Photo Appendix)
    // Starts on a brand new page after text sections & document indexes
    // =========================================================================
    interface AppendixItem {
      opStep: number;
      filePath: string;
      fileName: string;
      desc: string;
      type: 'SAMPLE' | 'PE_NG' | 'QA_NG' | 'N1_CHECK_SHEET' | 'QA_DOC';
    }

    const appendixItems: AppendixItem[] = [];
    const seenPaths = new Set<string>();

    // 1. Sample photos
    ops.forEach((op: any) => {
      (op.sample_photos || []).forEach((sp: any) => {
        if (sp.file_path && !seenPaths.has(sp.file_path)) {
          seenPaths.add(sp.file_path);
          appendixItems.push({
            opStep: op.step_order,
            filePath: sp.file_path,
            fileName: sp.file_name,
            desc: `Ảnh sản phẩm mẫu${sp.is_avatar ? ' (Ảnh đại diện)' : ''}`,
            type: 'SAMPLE',
          });
        }
      });
    });

    // 2. PE-MFG NG photos
    ops.forEach((op: any) => {
      (op.ng_details || []).forEach((ng: any) => {
        (ng.photo_urls || []).forEach((u: string) => {
          if (u && !seenPaths.has(u)) {
            seenPaths.add(u);
            const rawName = (u.split('/').pop()?.split('?')[0] || 'PE_NG_Photo.jpg').replace(/^[0-9a-fA-F-]{36}_/, '');
            const fn = sanitizeFileName(rawName);
            appendixItems.push({
              opStep: op.step_order,
              filePath: u,
              fileName: fn,
              desc: `Phế phẩm PE-MFG: [${ng.defect_code || 'NG'}] ${ng.defect_name || 'Lỗi'}${ng.remark ? ` (${ng.remark})` : ''}`,
              type: 'PE_NG',
            });
          }
        });
      });
    });

    // 3. QA NG photos (C3)
    ops.forEach((op: any) => {
      (op.qa_ng_details || []).forEach((qng: any) => {
        (qng.photo_urls || []).forEach((u: string) => {
          if (u && !seenPaths.has(u)) {
            seenPaths.add(u);
            const rawName = (u.split('/').pop()?.split('?')[0] || 'QA_NG_Photo.jpg').replace(/^[0-9a-fA-F-]{36}_/, '');
            const fn = sanitizeFileName(rawName);
            appendixItems.push({
              opStep: op.step_order,
              filePath: u,
              fileName: fn,
              desc: `Phế phẩm QA: [${qng.defect_code || 'NG'}] ${qng.defect_name || 'Lỗi'}${qng.remark ? ` (${qng.remark})` : ''}`,
              type: 'QA_NG',
            });
          }
        });
      });
    });

    // 4. N1 Check Sheet images (C3)
    ops.forEach((op: any) => {
      (op.qa_checks || []).forEach((qc: any) => {
        (qc.n1_check_sheet_urls || []).forEach((u: string) => {
          const lower = u.toLowerCase();
          const isImg = lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp');
          if (isImg && !seenPaths.has(u)) {
            seenPaths.add(u);
            const rawName = (u.split('/').pop()?.split('?')[0] || 'N1_CheckSheet.jpg').replace(/^[0-9a-fA-F-]{36}_/, '');
            const cleanName = rawName.replace(/^n1_\d+_/, '');
            const fn = sanitizeFileName(cleanName);
            appendixItems.push({
              opStep: op.step_order,
              filePath: u,
              fileName: fn,
              desc: `N1 Check Sheet [${qc.n1_result || 'OK'}]: OP${op.step_order}`,
              type: 'N1_CHECK_SHEET',
            });
          }
        });
      });
    });

    // 5. QA inspection photos / documents
    ops.forEach((op: any) => {
      (op.qa_documents || []).forEach((qd: any) => {
        const mime = (qd.mime_type || '').toLowerCase();
        const fn = (qd.file_name || '').toLowerCase();
        const isImg = mime.startsWith('image/') || fn.endsWith('.jpg') || fn.endsWith('.jpeg') || fn.endsWith('.png') || fn.endsWith('.webp');
        if (isImg && qd.file_path && !seenPaths.has(qd.file_path)) {
          seenPaths.add(qd.file_path);
          appendixItems.push({
            opStep: op.step_order,
            filePath: qd.file_path,
            fileName: qd.file_name,
            desc: `Kiểm tra QA (${qd.category})${qd.remark ? `: ${qd.remark}` : ''}`,
            type: 'QA_DOC',
          });
        }
      });
    });

    if (appendixItems.length > 0) {
      // Must start on a new page after all text sections and document indexes
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 800;

      drawText('7. PHỤ LỤC HÌNH ẢNH (PHOTO APPENDIX)', 40, 11, true, rgb(0.15, 0.2, 0.3));
      y -= 12;
      drawText('Tổng hợp hình ảnh mẫu sản phẩm, hình ảnh phế phẩm (NG) và biên bản kiểm tra chất lượng (QA)', 40, 8, false, rgb(0.4, 0.4, 0.4));
      y -= 18;

      const cardWidth = 245;
      const cardHeight = 175;
      const colX = [40, 310];

      for (let i = 0; i < appendixItems.length; i += 2) {
        if (y - cardHeight < 50) {
          page = pdfDoc.addPage([595.28, 841.89]);
          y = 800;
        }

        const rowItems = [appendixItems[i], appendixItems[i + 1]].filter(Boolean);

        for (let colIdx = 0; colIdx < rowItems.length; colIdx++) {
          const item = rowItems[colIdx];
          const xPos = colX[colIdx];
          const yPos = y - cardHeight;

          // Outer frame
          page.drawRectangle({
            x: xPos,
            y: yPos,
            width: cardWidth,
            height: cardHeight,
            color: rgb(0.99, 0.99, 1.0),
            borderColor: rgb(0.85, 0.88, 0.92),
            borderWidth: 0.8,
          });

          // Download and render image
          let rendered = false;
          try {
            const { data: imgBlob, error: imgErr } = await adminClient.storage
              .from('sample-documents')
              .download(item.filePath);

            if (!imgErr && imgBlob) {
              const arrayBuf = await imgBlob.arrayBuffer();
              const imgBytes = new Uint8Array(arrayBuf);
              const embeddedImg = await embedImageSafely(pdfDoc, imgBytes);

              if (embeddedImg) {
                const dims = embeddedImg.scale(1);
                const maxImgW = cardWidth - 10;
                const maxImgH = 125;
                const scale = Math.min(maxImgW / dims.width, maxImgH / dims.height);
                const renderW = dims.width * scale;
                const renderH = dims.height * scale;
                const imgX = xPos + (cardWidth - renderW) / 2;
                const imgY = yPos + 44 + (maxImgH - renderH) / 2;

                page.drawImage(embeddedImg, {
                  x: imgX,
                  y: imgY,
                  width: renderW,
                  height: renderH,
                });
                rendered = true;
              }
            }
          } catch {
            rendered = false;
          }

          if (!rendered) {
            // Missing or inaccessible image neutral placeholder (R2-05 safe handling)
            page.drawRectangle({
              x: xPos + 5,
              y: yPos + 44,
              width: cardWidth - 10,
              height: 125,
              color: rgb(0.95, 0.96, 0.97),
              borderColor: rgb(0.88, 0.9, 0.92),
              borderWidth: 0.5,
            });

            page.drawText('[ẢNH KHÔNG KHẢ DỤNG]', {
              x: xPos + 60,
              y: yPos + 110,
              size: 8,
              font: fontBold,
              color: rgb(0.6, 0.3, 0.3),
            });

            page.drawText(item.fileName.slice(0, 30), {
              x: xPos + 20,
              y: yPos + 95,
              size: 7,
              font: fontRegular,
              color: rgb(0.4, 0.4, 0.4),
            });

            page.drawText('(Tệp không tồn tại hoặc lỗi định dạng)', {
              x: xPos + 40,
              y: yPos + 80,
              size: 6.5,
              font: fontRegular,
              color: rgb(0.55, 0.55, 0.55),
            });
          }

          // Caption Box at bottom of card
          page.drawLine({
            start: { x: xPos, y: yPos + 42 },
            end: { x: xPos + cardWidth, y: yPos + 42 },
            thickness: 0.5,
            color: rgb(0.85, 0.88, 0.92),
          });

          page.drawText(`OP${item.opStep}: ${item.fileName}`.slice(0, 35), {
            x: xPos + 6,
            y: yPos + 28,
            size: 7.5,
            font: fontBold,
            color: rgb(0.2, 0.25, 0.35),
          });

          const descLines = wrapText(item.desc, cardWidth - 12, fontRegular, 6.8);
          descLines.slice(0, 2).forEach((dLine, dIdx) => {
            page.drawText(dLine, {
              x: xPos + 6,
              y: yPos + 16 - dIdx * 9,
              size: 6.8,
              font: fontRegular,
              color: rgb(0.4, 0.45, 0.5),
            });
          });
        }

        y -= (cardHeight + 12);
      }
    }

    // =========================================================================
    // R2-06: NEUTRAL HEADER & FOOTER WITH PAGE NUMBERS (Supabase sentence removed)
    // =========================================================================
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;

    pages.forEach((p, idx) => {
      // Running header on page 2 and beyond
      if (idx > 0) {
        p.drawText(`SAMPLE PRODUCTION FINAL REPORT — ${jobNo} | Mã bản vẽ: ${partNo}`, {
          x: 40,
          y: 818,
          size: 7.5,
          font: fontBold,
          color: rgb(0.45, 0.5, 0.6),
        });

        p.drawLine({
          start: { x: 40, y: 812 },
          end: { x: 555, y: 812 },
          thickness: 0.5,
          color: rgb(0.85, 0.88, 0.92),
        });
      }

      // Neutral running footer on every page
      p.drawLine({
        start: { x: 40, y: 32 },
        end: { x: 555, y: 32 },
        thickness: 0.5,
        color: rgb(0.8, 0.82, 0.85),
      });

      const footerLeft = `SAMPLE PRODUCTION FINAL REPORT — Job Ticket: ${jobNo} (Part: ${partNo})`;
      p.drawText(footerLeft, {
        x: 40,
        y: 20,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.45, 0.45, 0.45),
      });

      const footerRight = `Trang ${idx + 1} / ${totalPages}`;
      const pageNumWidth = fontRegular.widthOfTextAtSize(footerRight, 7.5);
      p.drawText(footerRight, {
        x: 555 - pageNumWidth,
        y: 20,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.45, 0.45, 0.45),
      });
    });

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
      part_avatar: snapshot.part_avatar || null,
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

      // Collect QA NG Photos (C3)
      for (const qng of op.qa_ng_details || []) {
        const urls = qng.photo_urls || [];
        for (let i = 0; i < urls.length; i++) {
          const u = urls[i];
          if (!u) continue;
          const cleanName = `OP${op.step_order}_QA_NG_${qng.defect_code || 'DEFECT'}_${i + 1}.jpg`;
          await downloadAndAttach('qa_ng_photos', u, cleanName);
        }
      }

      // Collect N1 Check Sheets (C3)
      for (const qc of op.qa_checks || []) {
        for (const u of qc.n1_check_sheet_urls || []) {
          if (!u) continue;
          const raw = u.split('/').pop() || 'check_sheet';
          const cleanName = `OP${op.step_order}_N1_${raw.replace(/^n1_\d+_/, '')}`;
          await downloadAndAttach('n1_check_sheets', u, cleanName);
        }
      }

      // Collect QA Documents (R1-02)
      for (const qd of op.qa_documents || []) {
        if (!qd.file_path) continue;
        const catClean = sanitizeFileName(qd.category || 'Other').replace(/\s+/g, '_');
        const name = `OP${op.step_order}_${catClean}_${sanitizeFileName(qd.file_name)}`;
        await downloadAndAttach('qa_documents', qd.file_path, name);
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
        message: 'Báo cáo PDF Revision R2 và gói ZIP đã được khởi tạo thành công.',
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
