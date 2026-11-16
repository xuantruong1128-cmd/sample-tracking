const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function createSampleDrawing() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // --- Page 1: Main Drawing ---
  const page1 = pdfDoc.addPage([842, 595]); // A4 Landscape
  const { width, height } = page1.getSize();

  // Draw border
  page1.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: rgb(0.1, 0.2, 0.4),
    borderWidth: 2,
  });

  // Title block
  page1.drawRectangle({
    x: width - 320,
    y: 20,
    width: 300,
    height: 100,
    borderColor: rgb(0.1, 0.2, 0.4),
    borderWidth: 1.5,
  });

  page1.drawText('TECHNICAL DRAWING / BAN VE KY THUAT', {
    x: 40,
    y: height - 50,
    size: 18,
    font: font,
    color: rgb(0.1, 0.2, 0.5),
  });

  page1.drawText('PART NO: UAT-E1-PRT-001', {
    x: width - 310,
    y: 100,
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
  });

  page1.drawText('PART NAME: Spline Shaft / Truc Then Hoa', {
    x: width - 310,
    y: 80,
    size: 11,
    font: regularFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page1.drawText('CUSTOMER: UAT Customer Corp', {
    x: width - 310,
    y: 60,
    size: 10,
    font: regularFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page1.drawText('MATERIAL: S45C (HRC 45-50) | SCALE: 1:1', {
    x: width - 310,
    y: 40,
    size: 9,
    font: regularFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page1.drawText('REV: V1.0 | SHEET: 1 OF 2', {
    x: width - 310,
    y: 25,
    size: 8,
    font: regularFont,
    color: rgb(0.4, 0.4, 0.4),
  });

  // Draw mechanical part illustration (Shaft outline)
  // Main body
  page1.drawRectangle({
    x: 100,
    y: 250,
    width: 500,
    height: 120,
    borderColor: rgb(0, 0, 0),
    borderWidth: 2,
    color: rgb(0.95, 0.97, 1.0),
  });

  // Stepped shoulder 1
  page1.drawRectangle({
    x: 100,
    y: 270,
    width: 80,
    height: 80,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
    color: rgb(0.9, 0.93, 0.98),
  });

  // Stepped shoulder 2
  page1.drawRectangle({
    x: 520,
    y: 275,
    width: 80,
    height: 70,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
    color: rgb(0.9, 0.93, 0.98),
  });

  // Centerline
  page1.drawLine({
    start: { x: 70, y: 310 },
    end: { x: 630, y: 310 },
    thickness: 1,
    color: rgb(0.8, 0.1, 0.1),
    dashArray: [8, 4, 2, 4],
  });

  // Dimension lines & text
  page1.drawText('DIA 60 +/- 0.01', {
    x: 320,
    y: 385,
    size: 11,
    font: font,
    color: rgb(0, 0, 0),
  });

  page1.drawText('LENGTH 250 +/- 0.05', {
    x: 300,
    y: 225,
    size: 11,
    font: font,
    color: rgb(0, 0, 0),
  });

  page1.drawText('Ra 0.8 um (CYGG)', {
    x: 330,
    y: 280,
    size: 10,
    font: regularFont,
    color: rgb(0.1, 0.5, 0.2),
  });

  // --- Page 2: Detailed Views & Inspection Specs ---
  const page2 = pdfDoc.addPage([842, 595]);
  page2.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: rgb(0.1, 0.2, 0.4),
    borderWidth: 2,
  });

  page2.drawText('TECHNICAL SPECIFICATIONS & QUALITY REQUIREMENTS', {
    x: 40,
    y: height - 50,
    size: 16,
    font: font,
    color: rgb(0.1, 0.2, 0.5),
  });

  page2.drawText('1. Heat Treatment (SUBCON): Induction hardening HRC 45 - 50, depth 1.5 - 2.0mm', {
    x: 40,
    y: height - 100,
    size: 11,
    font: regularFont,
    color: rgb(0, 0, 0),
  });

  page2.drawText('2. Cylindrical Grinding: Outer diameter runout <= 0.005mm TIR', {
    x: 40,
    y: height - 130,
    size: 11,
    font: regularFont,
    color: rgb(0, 0, 0),
  });

  page2.drawText('3. Surface Finish: No scratches, burrs, or chatter marks permitted', {
    x: 40,
    y: height - 160,
    size: 11,
    font: regularFont,
    color: rgb(0, 0, 0),
  });

  page2.drawText('4. 100% Critical Dimension Inspection required before shipment', {
    x: 40,
    y: height - 190,
    size: 11,
    font: regularFont,
    color: rgb(0, 0, 0),
  });

  page2.drawText('REV: V1.0 | SHEET: 2 OF 2', {
    x: width - 200,
    y: 30,
    size: 9,
    font: regularFont,
    color: rgb(0.4, 0.4, 0.4),
  });

  const outDir = path.resolve(__dirname, '../uat_output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'sample_technical_drawing.pdf');
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, pdfBytes);
  console.log(`✅ Sample technical drawing PDF created at: ${outPath} (${pdfBytes.length} bytes)`);
}

createSampleDrawing().catch(console.error);
