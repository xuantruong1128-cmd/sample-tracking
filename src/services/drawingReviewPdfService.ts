import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getRobotoRegularFontBytes, getRobotoBoldFontBytes } from '../lib/pdfFonts';
import { getDrawingFileSignedUrl } from './drawingReviewService';
import type {
  DrawingReviewIssue,
  DrawingReviewVersion,
  DrawingReviewOperation,
  DrawingReviewAttachment,
} from '../types/drawingReview';

export interface GenerateDrawingReviewPdfOptions {
  issue: DrawingReviewIssue;
  version: DrawingReviewVersion;
  operations: DrawingReviewOperation[];
  attachments: DrawingReviewAttachment[];
  avatarBytes?: Uint8Array | null;
  drawingBytes?: Uint8Array | null;
  drawingMimeType?: string;
  attachmentBytesList?: Array<{ bytes: Uint8Array; caption?: string | null; name: string }>;
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

/**
 * Generates the official Drawing Review PDF report with Unicode Vietnamese support,
 * Item Avatar, Routing Table (NO Total CT), Technical Specs, Remarks, Drawings and Photos.
 */
export async function generateDrawingReviewPdf(
  options: GenerateDrawingReviewPdfOptions
): Promise<Uint8Array> {
  const {
    issue,
    version,
    operations,
    avatarBytes,
    drawingBytes,
    drawingMimeType,
    attachmentBytesList,
  } = options;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`BÁO CÁO ĐÁNH GIÁ BẢN VẼ - ${issue.item_no || ''} - ${version.version_name || ''}`);
  pdfDoc.setAuthor('Sample Tracking System - Drawing Review Module');

  const fontRegular = await pdfDoc.embedFont(getRobotoRegularFontBytes());
  const fontBold = await pdfDoc.embedFont(getRobotoBoldFontBytes());

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  // Colors
  const cNavy = rgb(0.08, 0.2, 0.38); // #143361
  const cDark = rgb(0.12, 0.16, 0.22); // #1f2937
  const cMuted = rgb(0.4, 0.45, 0.52); // #64748b
  const cLight = rgb(0.96, 0.97, 0.98); // #f8fafc
  const cBorder = rgb(0.85, 0.88, 0.92); // #d9e2ec
  const cBlueBg = rgb(0.93, 0.96, 1.0); // #edf4ff

  // --------------------------------------------------------------------------
  // PAGE 1: OVERVIEW & SPECIFICATIONS & ROUTING
  // --------------------------------------------------------------------------
  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Header Banner
  currentPage.drawRectangle({
    x: margin,
    y: y - 54,
    width: contentWidth,
    height: 54,
    color: cNavy,
  });

  currentPage.drawText('CÔNG TY TNHH KỸ THUẬT & SẢN XUẤT', {
    x: margin + 14,
    y: y - 18,
    size: 10,
    font: fontBold,
    color: rgb(0.85, 0.92, 1.0),
  });

  currentPage.drawText('BÁO CÁO ĐÁNH GIÁ BẢN VẼ KỸ THUẬT (DRAWING REVIEW REPORT)', {
    x: margin + 14,
    y: y - 36,
    size: 13,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 64;

  // Metadata Card + Avatar Frame
  const cardHeight = 110;
  currentPage.drawRectangle({
    x: margin,
    y: y - cardHeight,
    width: contentWidth,
    height: cardHeight,
    color: cLight,
    borderColor: cBorder,
    borderWidth: 1,
  });

  // Left column: Issue Info
  const leftX = margin + 14;
  let textY = y - 18;
  const rowStep = 15;

  const drawField = (label: string, value: string, boldVal: boolean = false) => {
    currentPage.drawText(label, {
      x: leftX,
      y: textY,
      size: 8.5,
      font: fontRegular,
      color: cMuted,
    });
    currentPage.drawText(value || '—', {
      x: leftX + 105,
      y: textY,
      size: 9,
      font: boldVal ? fontBold : fontRegular,
      color: cDark,
    });
    textY -= rowStep;
  };

  drawField('Mã yêu cầu (Issue No):', issue.issue_no, true);
  drawField('Mã bản vẽ (Item No):', issue.item_no, true);
  drawField('Tên sản phẩm (Item Name):', issue.item_name);
  drawField('Khách hàng (Customer):', issue.customer);
  drawField(
    'Phiên bản & Trạng thái:',
    `${version.version_name} — ${version.status === 'Completed' ? 'Đã hoàn thành (Completed)' : version.status}`,
    true
  );
  if (issue.attention) {
    drawField('Yêu cầu đặc biệt (Attention):', issue.attention);
  }

  // Right column: Item Avatar
  const avatarSize = 80;
  const avatarX = margin + contentWidth - avatarSize - 14;
  const avatarY = y - cardHeight + 15;

  currentPage.drawRectangle({
    x: avatarX,
    y: avatarY,
    width: avatarSize,
    height: avatarSize,
    color: rgb(0.92, 0.94, 0.97),
    borderColor: cBorder,
    borderWidth: 1,
  });

  let embeddedAvatar = null;
  if (avatarBytes) {
    embeddedAvatar = await embedImageSafely(pdfDoc, avatarBytes);
  }

  if (embeddedAvatar) {
    currentPage.drawImage(embeddedAvatar, {
      x: avatarX + 2,
      y: avatarY + 2,
      width: avatarSize - 4,
      height: avatarSize - 4,
    });
  } else {
    currentPage.drawText('ITEM', {
      x: avatarX + 25,
      y: avatarY + 45,
      size: 10,
      font: fontBold,
      color: cMuted,
    });
    currentPage.drawText('AVATAR', {
      x: avatarX + 19,
      y: avatarY + 32,
      size: 9,
      font: fontBold,
      color: cMuted,
    });
  }

  y -= cardHeight + 14;

  // Section Heading: Preliminary Routing
  currentPage.drawText('1. QUY TRÌNH CÔNG NGHỆ SƠ BỘ (PRELIMINARY ROUTING)', {
    x: margin,
    y,
    size: 10.5,
    font: fontBold,
    color: cNavy,
  });
  currentPage.drawText('*(Chu kỳ đơn vị: giây/sản phẩm; Không cộng tổng Total CT)*', {
    x: margin + 300,
    y,
    size: 7.5,
    font: fontRegular,
    color: cMuted,
  });

  y -= 14;

  // Routing Table Columns: OP (45), W/C (65), Mô tả (175), CT (70), Ghi chú (160)
  const colW = [45, 65, 175, 70, 160];
  const colX = [
    margin,
    margin + colW[0],
    margin + colW[0] + colW[1],
    margin + colW[0] + colW[1] + colW[2],
    margin + colW[0] + colW[1] + colW[2] + colW[3],
  ];

  // Table Header
  const headerHeight = 20;
  currentPage.drawRectangle({
    x: margin,
    y: y - headerHeight,
    width: contentWidth,
    height: headerHeight,
    color: rgb(0.18, 0.28, 0.44),
  });

  const tableHeaders = ['Công đoạn', 'Tổ máy', 'Mô tả công đoạn', 'CT (sec/pc)', 'Ghi chú kỹ thuật'];
  for (let i = 0; i < tableHeaders.length; i++) {
    currentPage.drawText(tableHeaders[i], {
      x: colX[i] + 6,
      y: y - 14,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  }

  y -= headerHeight;

  // Table Rows
  const activeOps = operations.filter((op) => !op.is_removed);
  let stepSeq = 10;

  for (let idx = 0; idx < activeOps.length; idx++) {
    const op = activeOps[idx];
    const opNumber = `OP${stepSeq}`;
    stepSeq += 10;

    const descLines = wrapText(op.operation_description || '', colW[2] - 12, fontRegular, 8);
    const remarkLines = wrapText(op.remark || '', colW[4] - 12, fontRegular, 8);
    const maxLines = Math.max(1, descLines.length, remarkLines.length);
    const rowHeight = Math.max(18, maxLines * 11 + 6);

    // Page overflow check
    if (y - rowHeight < margin + 40) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    const isEven = idx % 2 === 0;
    currentPage.drawRectangle({
      x: margin,
      y: y - rowHeight,
      width: contentWidth,
      height: rowHeight,
      color: isEven ? rgb(1, 1, 1) : rgb(0.97, 0.98, 0.99),
      borderColor: cBorder,
      borderWidth: 0.5,
    });

    // Column separators
    for (let c = 1; c < colX.length; c++) {
      currentPage.drawLine({
        start: { x: colX[c], y },
        end: { x: colX[c], y: y - rowHeight },
        thickness: 0.5,
        color: cBorder,
      });
    }

    // Cells
    currentPage.drawText(opNumber, {
      x: colX[0] + 6,
      y: y - 12,
      size: 8.5,
      font: fontBold,
      color: cNavy,
    });

    currentPage.drawText(op.workcenter_code || '—', {
      x: colX[1] + 6,
      y: y - 12,
      size: 8,
      font: fontBold,
      color: cDark,
    });

    // Mô tả
    for (let l = 0; l < descLines.length; l++) {
      currentPage.drawText(descLines[l], {
        x: colX[2] + 6,
        y: y - 12 - l * 11,
        size: 8,
        font: fontRegular,
        color: cDark,
      });
    }

    // CT
    const ctText =
      op.cycle_time_seconds !== null && op.cycle_time_seconds !== undefined
        ? `${Number(op.cycle_time_seconds).toFixed(1)} s`
        : '—';
    currentPage.drawText(ctText, {
      x: colX[3] + 6,
      y: y - 12,
      size: 8,
      font: fontBold,
      color: cDark,
    });

    // Remark
    for (let l = 0; l < remarkLines.length; l++) {
      currentPage.drawText(remarkLines[l], {
        x: colX[4] + 6,
        y: y - 12 - l * 11,
        size: 7.5,
        font: fontRegular,
        color: cMuted,
      });
    }

    y -= rowHeight;
  }

  if (activeOps.length === 0) {
    const emptyRowHeight = 20;
    currentPage.drawRectangle({
      x: margin,
      y: y - emptyRowHeight,
      width: contentWidth,
      height: emptyRowHeight,
      color: rgb(1, 1, 1),
      borderColor: cBorder,
      borderWidth: 0.5,
    });
    currentPage.drawText('Chưa có công đoạn nào được lập cho phiên bản này.', {
      x: margin + 14,
      y: y - 14,
      size: 8,
      font: fontRegular,
      color: cMuted,
    });
    y -= emptyRowHeight;
  }

  y -= 16;

  // Technical Specifications Section
  if (y < margin + 120) {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }

  currentPage.drawText('2. THÔNG TIN KỸ THUẬT BỔ SUNG (TECHNICAL SPECIFICATIONS)', {
    x: margin,
    y,
    size: 10.5,
    font: fontBold,
    color: cNavy,
  });

  y -= 12;

  const drawTechBox = (title: string, content: string | null | undefined, boxColor: any) => {
    const textLines = wrapText(content || 'Không có yêu cầu đặc biệt.', contentWidth - 20, fontRegular, 8);
    const bHeight = Math.max(34, textLines.length * 11 + 22);

    if (y - bHeight < margin + 40) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    currentPage.drawRectangle({
      x: margin,
      y: y - bHeight,
      width: contentWidth,
      height: bHeight,
      color: boxColor,
      borderColor: cBorder,
      borderWidth: 1,
    });

    currentPage.drawText(title, {
      x: margin + 10,
      y: y - 14,
      size: 8.5,
      font: fontBold,
      color: cNavy,
    });

    for (let l = 0; l < textLines.length; l++) {
      currentPage.drawText(textLines[l], {
        x: margin + 10,
        y: y - 26 - l * 11,
        size: 8,
        font: fontRegular,
        color: cDark,
      });
    }

    y -= bHeight + 8;
  };

  const matType = version.material_type?.trim();
  const matSpec = version.material_specification?.trim() || (!matType ? version.required_material?.trim() : undefined);

  drawTechBox('• Chủng loại vật liệu (Material Type):', matType || 'Chưa chỉ định', cLight);
  drawTechBox(
    '• Quy cách / Thông số vật liệu phôi (Material Specification):',
    matSpec || 'Không có yêu cầu đặc biệt.',
    cLight
  );
  drawTechBox('• Yêu cầu dao cụ / đồ gá (Required Tooling):', version.required_tooling, cLight);
  drawTechBox(
    '• Thiết bị đo lường đặc biệt (Special Measuring Equipment):',
    version.special_measuring_equipment,
    cLight
  );
  drawTechBox(
    '• Ghi chú kỹ thuật PE-MFG (Engineering Remarks):',
    version.engineering_remarks,
    cBlueBg
  );

  // --------------------------------------------------------------------------
  // PAGE 2+: TECHNICAL DRAWINGS (EMBEDDED ORIGINAL)
  // --------------------------------------------------------------------------
  if (drawingBytes && drawingBytes.length > 0) {
    if (drawingMimeType?.includes('pdf') || issue.drawing_file_name.toLowerCase().endsWith('.pdf')) {
      try {
        const drawingDoc = await PDFDocument.load(drawingBytes, { ignoreEncryption: true });
        const pageIndices = drawingDoc.getPageIndices();
        const copiedPages = await pdfDoc.copyPages(drawingDoc, pageIndices);
        for (const p of copiedPages) {
          pdfDoc.addPage(p);
        }
      } catch (err) {
        console.warn('Could not copy drawing PDF pages:', err);
      }
    } else {
      // Image drawing: add a dedicated full-page drawing preview
      const drawingPage = pdfDoc.addPage([pageWidth, pageHeight]);
      drawingPage.drawText('BẢN VẼ KỸ THUẬT GỐC (TECHNICAL DRAWING)', {
        x: margin,
        y: pageHeight - margin - 10,
        size: 11,
        font: fontBold,
        color: cNavy,
      });

      const embeddedImg = await embedImageSafely(pdfDoc, drawingBytes);
      if (embeddedImg) {
        const imgDims = embeddedImg.scaleToFit(contentWidth, pageHeight - margin * 2 - 30);
        drawingPage.drawImage(embeddedImg, {
          x: margin + (contentWidth - imgDims.width) / 2,
          y: margin + 20,
          width: imgDims.width,
          height: imgDims.height,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // PAGE 3+: PHOTO ATTACHMENTS GALLERY
  // --------------------------------------------------------------------------
  if (attachmentBytesList && attachmentBytesList.length > 0) {
    let photoPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let py = pageHeight - margin;

    photoPage.drawText('HÌNH ẢNH & TÀI LIỆU ĐÍNH KÈM (ATTACHMENT GALLERY)', {
      x: margin,
      y: py,
      size: 11,
      font: fontBold,
      color: cNavy,
    });

    py -= 24;

    const itemWidth = (contentWidth - 16) / 2;
    const itemHeight = 180;
    let col = 0;

    for (let i = 0; i < attachmentBytesList.length; i++) {
      const att = attachmentBytesList[i];
      if (col === 0 && py - itemHeight < margin) {
        photoPage = pdfDoc.addPage([pageWidth, pageHeight]);
        py = pageHeight - margin;
      }

      const px = margin + col * (itemWidth + 16);
      const embeddedPhoto = await embedImageSafely(pdfDoc, att.bytes);

      photoPage.drawRectangle({
        x: px,
        y: py - itemHeight,
        width: itemWidth,
        height: itemHeight,
        color: cLight,
        borderColor: cBorder,
        borderWidth: 1,
      });

      if (embeddedPhoto) {
        const photoDims = embeddedPhoto.scaleToFit(itemWidth - 16, itemHeight - 38);
        photoPage.drawImage(embeddedPhoto, {
          x: px + (itemWidth - photoDims.width) / 2,
          y: py - itemHeight + 30 + (itemHeight - 38 - photoDims.height) / 2,
          width: photoDims.width,
          height: photoDims.height,
        });
      }

      // Caption
      const captionText = att.caption || att.name;
      const cLines = wrapText(captionText, itemWidth - 16, fontRegular, 8);
      for (let l = 0; l < Math.min(2, cLines.length); l++) {
        photoPage.drawText(cLines[l], {
          x: px + 8,
          y: py - itemHeight + 18 - l * 10,
          size: 7.5,
          font: fontRegular,
          color: cDark,
        });
      }

      col++;
      if (col >= 2) {
        col = 0;
        py -= itemHeight + 16;
      }
    }
  }

  // --------------------------------------------------------------------------
  // FOOTERS ON ALL PAGES
  // --------------------------------------------------------------------------
  const totalPages = pdfDoc.getPageCount();
  const nowStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const page = pdfDoc.getPage(pIdx);
    const pSize = page.getSize();
    const footerY = 16;

    page.drawLine({
      start: { x: margin, y: footerY + 12 },
      end: { x: pSize.width - margin, y: footerY + 12 },
      thickness: 0.5,
      color: cBorder,
    });

    page.drawText(
      `Mã yêu cầu: ${issue.issue_no} | Phiên bản: ${version.version_name} | Xuất ngày: ${nowStr}`,
      {
        x: margin,
        y: footerY,
        size: 7.5,
        font: fontRegular,
        color: cMuted,
      }
    );

    const pageStr = `Trang ${pIdx + 1} / ${totalPages}`;
    const pageStrWidth = fontRegular.widthOfTextAtSize(pageStr, 7.5);
    page.drawText(pageStr, {
      x: pSize.width - margin - pageStrWidth,
      y: footerY,
      size: 7.5,
      font: fontRegular,
      color: cMuted,
    });
  }

  return await pdfDoc.save();
}

/**
 * High level trigger to fetch data, generate and download Drawing Review PDF
 */
export async function downloadDrawingReviewPdf(
  issue: DrawingReviewIssue,
  version: DrawingReviewVersion,
  operations: DrawingReviewOperation[],
  attachments: DrawingReviewAttachment[],
  extraAttachmentBlobs?: Array<{ blob: Blob; caption?: string; name: string }>
): Promise<{ success: boolean; error?: string }> {
  try {
    let avatarBytes: Uint8Array | null = null;
    let drawingBytes: Uint8Array | null = null;
    const attachmentBytesList: Array<{ bytes: Uint8Array; caption?: string | null; name: string }> =
      [];

    // 1. Fetch Item Avatar if available
    if (version.avatar_file_path) {
      try {
        const res = await getDrawingFileSignedUrl(version.avatar_file_path, 300);
        if (res.signedUrl) {
          const resp = await fetch(res.signedUrl);
          avatarBytes = new Uint8Array(await resp.arrayBuffer());
        }
      } catch (err) {
        console.warn('Could not load avatar for PDF:', err);
      }
    }

    // 2. Fetch original drawing
    if (issue.drawing_file_path) {
      try {
        const res = await getDrawingFileSignedUrl(issue.drawing_file_path, 300);
        if (res.signedUrl) {
          const resp = await fetch(res.signedUrl);
          drawingBytes = new Uint8Array(await resp.arrayBuffer());
        }
      } catch (err) {
        console.warn('Could not load drawing for PDF:', err);
      }
    }

    // 3. Fetch attachment photos (up to 8)
    for (const att of (attachments || []).slice(0, 8)) {
      try {
        const res = await getDrawingFileSignedUrl(att.file_path, 300);
        if (res.signedUrl) {
          const resp = await fetch(res.signedUrl);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          attachmentBytesList.push({
            bytes,
            caption: att.caption,
            name: att.file_name,
          });
        }
      } catch (err) {
        console.warn(`Could not load attachment ${att.file_name} for PDF:`, err);
      }
    }

    // 3.5 Process extra in-memory attachment blobs (e.g. freshly captured annotated drawing)
    if (extraAttachmentBlobs && extraAttachmentBlobs.length > 0) {
      for (const extra of extraAttachmentBlobs) {
        try {
          const bytes = new Uint8Array(await extra.blob.arrayBuffer());
          attachmentBytesList.push({
            bytes,
            caption: extra.caption,
            name: extra.name,
          });
        } catch (err) {
          console.warn('Could not read extra attachment blob for PDF:', err);
        }
      }
    }

    // 4. Generate PDF
    const pdfBytes = await generateDrawingReviewPdf({
      issue,
      version,
      operations,
      attachments,
      avatarBytes,
      drawingBytes,
      drawingMimeType: issue.drawing_mime_type,
      attachmentBytesList,
    });

    // 5. Trigger download in browser
    const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${issue.issue_no}_${version.version_name}_Drawing_Review.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xuất tệp báo cáo PDF.' };
  }
}
