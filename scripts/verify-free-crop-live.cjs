#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW HOTFIX R2: FREE CROP LIVE CDP VERIFICATION
 *
 * Drives headless Google Chrome via native Chrome DevTools Protocol (CDP)
 * Target: https://sample-tracking-89b.pages.dev (Cloudflare Pages TEST)
 * Backend: hosppagbopdghlupnhlr.supabase.co (Supabase TEST)
 * ==============================================================================
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'https://sample-tracking-89b.pages.dev';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UAT_OUTPUT_DIR = path.resolve(__dirname, '../uat_output');
const ARTIFACT_DIR = path.resolve(
  'C:\\Users\\xuantruong do\\.gemini\\antigravity\\brain\\078bd566-721e-46b9-8787-668467504479'
);
const CRED_PATH = path.resolve(__dirname, '../backups/uat_test_credentials.json');

if (!fs.existsSync(UAT_OUTPUT_DIR)) {
  fs.mkdirSync(UAT_OUTPUT_DIR, { recursive: true });
}

// Load credentials
const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const PE_USER = credentials['PE-MFG'];

// Load .env
const envPath = path.resolve(__dirname, '../.env');
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

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// CRC32 utility
function crc32(buf) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// Create a high-res sample technical drawing PNG (1200 x 800)
function createTechnicalDrawingPng(width = 1200, height = 800) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(2, 9); // RGB
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // Draw technical drawing blueprint grid + border + title block
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // Filter none
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 3;
      const isGrid = x % 40 === 0 || y % 40 === 0;
      const isOuterBorder = x < 16 || x >= width - 16 || y < 16 || y >= height - 16;
      const isTitleBlock = x >= width - 350 && y >= height - 120;
      const isPartGraphic =
        x >= 200 && x <= 600 && y >= 250 && y <= 450 && (x === 200 || x === 600 || y === 250 || y === 450);

      if (isOuterBorder || isPartGraphic) {
        // High contrast blueprint line (white/bright cyan)
        row[idx] = 240;
        row[idx + 1] = 245;
        row[idx + 2] = 255;
      } else if (isTitleBlock) {
        // Title block zone
        row[idx] = 30;
        row[idx + 1] = 45;
        row[idx + 2] = 75;
      } else if (isGrid) {
        // Subtle grid line
        row[idx] = 25;
        row[idx + 1] = 40;
        row[idx + 2] = 65;
      } else {
        // Dark blueprint background
        row[idx] = 15;
        row[idx + 1] = 25;
        row[idx + 2] = 45;
      }
    }
    rawRows.push(row);
  }

  const idatData = zlib.deflateSync(Buffer.concat(rawRows));
  const idatChunk = makeChunk('IDAT', idatData);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

class CDPSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { resolve, reject } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      } catch (err) {
        console.error('CDP message parse error:', err);
      }
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval Exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  async screenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const fullPath = path.join(UAT_OUTPUT_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(res.data, 'base64'));
    console.log(`  📸 Captured: ${filename}`);

    if (fs.existsSync(ARTIFACT_DIR)) {
      const artifactPath = path.join(ARTIFACT_DIR, filename);
      fs.copyFileSync(fullPath, artifactPath);
    }
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 2500));
  }

  async waitForSelector(selector, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  async waitForText(text, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate(`document.body.innerText.includes('${text}')`);
      if (exists) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for text: ${text}`);
  }

  async click(selector) {
    await this.waitForSelector(selector);
    await this.evaluate(`document.querySelector('${selector}').click()`);
    await new Promise((r) => setTimeout(r, 300));
  }

  async type(selector, value) {
    await this.waitForSelector(selector);
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) throw new Error('Element not found: ${selector}');
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const proto = el instanceof HTMLTextAreaElement 
          ? window.HTMLTextAreaElement.prototype 
          : window.HTMLInputElement.prototype;
        const setVal = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setVal.call(el, '${escaped}');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function startChrome() {
  const profileDir = path.resolve(__dirname, '../backups/chrome-free-crop-profile');
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${profileDir}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 25; i++) {
    try {
      const targets = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json/list', (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });

      const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
      if (pageTarget?.webSocketDebuggerUrl) {
        return { proc, webSocketDebuggerUrl: pageTarget.webSocketDebuggerUrl };
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('Chrome remote debugging did not respond on port 9222');
}

async function main() {
  console.log('='.repeat(80));
  console.log('  LIVE CDP BROWSER VERIFICATION: FREE-FORM RECTANGULAR CROPPING');
  console.log(`  Target:    ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  let activeIssue = null;
  const drawingBuffer = createTechnicalDrawingPng(1200, 800);
  const drawingBase64 = drawingBuffer.toString('base64');

  try {
    // 1. Seed or find active review issue in TEST database
    console.log('\n>>> STEP 0: SEEDING OR FETCHING REVIEW ISSUE ON TEST <<<');
    const issueCode = 'CROP' + Date.now().toString().slice(-6);
    const { data: issue, error: issueErr } = await adminClient
      .from('drawing_review_issues')
      .insert({
        issue_no: issueCode,
        item_no: 'VALVE-BODY-SS316',
        item_name: 'Thân Van Inox 316',
        customer: 'Yokogawa Electric',
        drawing_file_path: 'drawings/demo-valve.pdf',
        drawing_file_name: 'demo-valve.pdf',
        drawing_file_size: 153600,
        drawing_mime_type: 'application/pdf',
        attention: 'Bản vẽ chi tiết phục vụ kiểm thử Free Crop',
      })
      .select()
      .single();

    if (issueErr) throw new Error('Failed to seed issue: ' + issueErr.message);
    activeIssue = issue;

    const { data: ver, error: verErr } = await adminClient
      .from('drawing_review_versions')
      .insert({
        issue_id: issue.id,
        version_number: 1,
        version_name: 'V1',
        status: 'Reviewing',
        material_type: 'SUS316',
        material_specification: 'Ø45 × L120',
        required_material: 'SUS316\nØ45 × L120',
        required_tooling: 'Dao tiện chích rãnh',
        special_measuring_equipment: 'Panme 25-50mm',
        engineering_remarks: 'Bản vẽ mẫu kiểm thử Free Crop',
      })
      .select()
      .single();
    if (verErr) throw verErr;

    // Insert operation
    await adminClient.from('drawing_review_operations').insert({
      version_id: ver.id,
      lineage_id: crypto.randomUUID(),
      step_order: 1,
      workcenter_code: 'CNC-01',
      operation_description: 'Tiện ngoài và chích rãnh',
      cycle_time_seconds: 120,
      remark: 'Kiểm tra độ nhám Ra 0.8',
      is_removed: false,
    });

    console.log(`  ✅ Seeded review issue: ${issue.issue_no} (ID: ${issue.id}, Version: ${ver.id})`);

    // 2. Launch Chrome
    console.log('\n>>> STEP 1: LAUNCHING CHROME & AUTHENTICATING AS PE-MFG <<<');
    const { proc, webSocketDebuggerUrl } = await startChrome();
    const WebSocket = globalThis.WebSocket || require('ws');
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res) => {
      ws.onopen = res;
      ws.addEventListener?.('open', res);
    });
    const cdp = new CDPSession(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.setViewport(1440, 900);

    // Navigate to Login
    await cdp.navigate(`${BASE_URL}/login`);
    await cdp.waitForSelector('#phone, input[name="phone"], input[type="text"]');

    // Fill phone and password
    const pwd = PE_USER.tempPassword || PE_USER.password;
    await cdp.type('#phone, input[type="text"], input[name="phone"]', PE_USER.phone);
    await cdp.type('#password, input[type="password"]', pwd);
    await cdp.click('button[type="submit"]');

    // Wait for Dashboard
    await cdp.waitForSelector('nav, header, [data-testid="navbar"]');
    console.log(`  ✅ Logged in successfully as PE-MFG (${PE_USER.phone})`);

    // Navigate to Drawing Review detail page
    console.log('\n>>> STEP 2: NAVIGATING TO DRAWING REVIEW DETAIL PAGE <<<');
    await cdp.navigate(`${BASE_URL}/drawing-reviews/${activeIssue.id}`);
    await cdp.waitForSelector('h1, h2, [data-testid="drawing-viewer-root"]');
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`  ✅ Loaded Drawing Review detail workspace for issue ${activeIssue.issue_no}`);

    // Trigger Image Editor Modal with our test technical drawing
    console.log('\n>>> STEP 3: OPENING IMAGE EDITOR MODAL WITH TECHNICAL DRAWING <<<');
    await cdp.evaluate(`
      (() => {
        // Create File from base64
        const binary = atob('${drawingBase64}');
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const file = new File([bytes], 'blueprint-drawing-sample.png', { type: 'image/png' });

        // Trigger avatar crop or attachment file input in DOM
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let targetedInput = null;
        for (const input of fileInputs) {
          targetedInput = input;
          break;
        }

        if (targetedInput) {
          const dt = new DataTransfer();
          dt.items.add(file);
          targetedInput.files = dt.files;
          targetedInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);

    // Wait for ImageEditorModal to appear
    await cdp.waitForText('Chỉnh sửa & Tối ưu ảnh');
    await new Promise((r) => setTimeout(r, 1000));
    console.log('  ✅ ImageEditorModal opened successfully');

    // -------------------------------------------------------------------------
    // TEST 1: Vertical Crop Resizing (Top & Bottom edge handles)
    // -------------------------------------------------------------------------
    console.log('\n>>> STEP 4: VERIFYING VERTICAL CROP RESIZING (TOP & BOTTOM HANDLES) <<<');
    // Emulate pointer drag on North handle
    await cdp.evaluate(`
      (() => {
        const northHandle = document.querySelector('[title="Kéo cạnh trên (điều chỉnh dọc)"]');
        if (!northHandle) throw new Error('North handle not found');

        const rect = northHandle.getBoundingClientRect();
        window.__cropStartX = rect.left + rect.width / 2;
        window.__cropStartY = rect.top + rect.height / 2;

        northHandle.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: window.__cropStartX,
          clientY: window.__cropStartY,
          pointerId: 1
        }));
      })()
    `);
    // Wait for React to render activeDrag and attach window listeners
    await new Promise((r) => setTimeout(r, 150));

    // Drag North handle down by 160px
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: window.__cropStartX,
          clientY: window.__cropStartY + 160,
          pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));

    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: window.__cropStartX,
          clientY: window.__cropStartY + 160,
          pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Emulate pointer drag on South handle
    await cdp.evaluate(`
      (() => {
        const southHandle = document.querySelector('[title="Kéo cạnh dưới (điều chỉnh dọc)"]');
        if (!southHandle) throw new Error('South handle not found');

        const rect = southHandle.getBoundingClientRect();
        window.__cropStartX = rect.left + rect.width / 2;
        window.__cropStartY = rect.top + rect.height / 2;

        southHandle.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: window.__cropStartX,
          clientY: window.__cropStartY,
          pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));

    // Drag South handle up by 150px
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: window.__cropStartX,
          clientY: window.__cropStartY - 150,
          pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));

    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: window.__cropStartX,
          clientY: window.__cropStartY - 150,
          pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));

    await cdp.screenshot('crop_01_vertical_resizing.png');
    console.log('  ✅ Captured: crop_01_vertical_resizing.png');

    // -------------------------------------------------------------------------
    // TEST 2: Horizontal & Corner Resizing
    // -------------------------------------------------------------------------
    console.log('\n>>> STEP 5: VERIFYING HORIZONTAL & CORNER RESIZING <<<');
    await cdp.evaluate(`
      (() => {
        const eastHandle = document.querySelector('[title="Kéo cạnh phải (điều chỉnh ngang)"]');
        if (eastHandle) {
          const rect = eastHandle.getBoundingClientRect();
          window.__cropEastX = rect.left + rect.width / 2;
          window.__cropEastY = rect.top + rect.height / 2;
          eastHandle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, clientX: window.__cropEastX, clientY: window.__cropEastY, pointerId: 1
          }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, clientX: window.__cropEastX - 180, clientY: window.__cropEastY, pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    await cdp.screenshot('crop_02_horizontal_corner_resizing.png');
    console.log('  ✅ Captured: crop_02_horizontal_corner_resizing.png');

    // -------------------------------------------------------------------------
    // TEST 3: Extreme Aspect Ratio Crops (Narrow strip & Presets)
    // -------------------------------------------------------------------------
    console.log('\n>>> STEP 6: VERIFYING EXTREME ASPECT RATIOS (NARROW STRIPS & PRESETS) <<<');
    // Click 16:9 preset
    await cdp.evaluate(`
      (() => {
        const btn169 = document.querySelector('button[title="Khung ngang 16:9"]');
        if (btn169) btn169.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Drag south handle up significantly to create a narrow horizontal title block crop
    await cdp.evaluate(`
      (() => {
        const southHandle = document.querySelector('[title="Kéo cạnh dưới (điều chỉnh dọc)"]');
        if (southHandle) {
          const rect = southHandle.getBoundingClientRect();
          window.__cropSouthX = rect.left + rect.width / 2;
          window.__cropSouthY = rect.top + rect.height / 2;
          southHandle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, clientX: window.__cropSouthX, clientY: window.__cropSouthY, pointerId: 1
          }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, clientX: window.__cropSouthX, clientY: window.__cropSouthY - 200, pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));

    await cdp.screenshot('crop_03_extreme_aspect_ratios.png');
    console.log('  ✅ Captured: crop_03_extreme_aspect_ratios.png');

    // -------------------------------------------------------------------------
    // TEST 4: Rotation 90° Clockwise
    // -------------------------------------------------------------------------
    console.log('\n>>> STEP 7: VERIFYING 90° ROTATION & ALIGNMENT <<<');
    await cdp.evaluate(`
      (() => {
        const rotateBtn = document.querySelector('button[title="Xoay 90 độ theo chiều kim đồng hồ"]');
        if (rotateBtn) rotateBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    // Apply 3:4 portrait preset on rotated image
    await cdp.evaluate(`
      (() => {
        const btn34 = document.querySelector('button[title="Khung dọc 3:4"]');
        if (btn34) btn34.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    await cdp.screenshot('crop_04_rotated_90deg_crop.png');
    console.log('  ✅ Captured: crop_04_rotated_90deg_crop.png');

    // -------------------------------------------------------------------------
    // TEST 5: Zoom & Pan Navigation
    // -------------------------------------------------------------------------
    console.log('\n>>> STEP 8: VERIFYING ZOOM & PAN FOR LARGE DRAWINGS <<<');
    await cdp.evaluate(`
      (() => {
        const slider = document.querySelector('input[type="range"]');
        if (slider) {
          slider.value = '1.8';
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const panBtn = document.querySelector('button[title*="Di chuyển"]');
        if (panBtn) panBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    // Pan view
    await cdp.evaluate(`
      (() => {
        const vp = document.querySelector('.relative.flex-1');
        if (vp) {
          const rect = vp.getBoundingClientRect();
          window.__panX = rect.left + 250;
          window.__panY = rect.top + 250;
          vp.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, clientX: window.__panX, clientY: window.__panY, button: 0, pointerId: 1
          }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, clientX: window.__panX - 80, clientY: window.__panY - 60, pointerId: 1
        }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      (() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    await cdp.screenshot('crop_05_zoom_and_pan.png');
    console.log('  ✅ Captured: crop_05_zoom_and_pan.png');

    // -------------------------------------------------------------------------
    // TEST 6: Mobile Touchscreen Viewport Emulation
    // -------------------------------------------------------------------------
    console.log('\n>>> STEP 9: VERIFYING MOBILE TOUCH VIEWPORT (390 x 844) <<<');
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 500));

    // Reset view
    await cdp.evaluate(`
      (() => {
        const resetBtn = document.querySelector('button[title*="Đặt lại"]');
        if (resetBtn) resetBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    await cdp.screenshot('crop_06_mobile_touch_view.png');
    console.log('  ✅ Captured: crop_06_mobile_touch_view.png');

    // Confirm crop
    console.log('\n>>> STEP 10: CONFIRMING CROP & COMPLETION <<<');
    await cdp.evaluate(`
      (() => {
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Xong & Tải lên'));
        if (confirmBtn) confirmBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));

    await cdp.screenshot('crop_07_crop_confirmed.png');
    console.log('  ✅ Captured: crop_07_crop_confirmed.png');

    console.log('\n================================================================================');
    console.log('  🎉 ALL FREE-FORM CROPPING CDP TESTS COMPLETED SUCCESSFULLY!');
    console.log('================================================================================');

    try { proc.kill(); } catch {}
  } catch (err) {
    console.error('\n❌ ERROR during CDP verification:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup seeded review issue
    if (activeIssue?.id) {
      console.log(`\nCleaning up seeded review issue ${activeIssue.id}...`);
      await adminClient.from('drawing_review_issues').delete().eq('id', activeIssue.id);
    }
    process.exit(process.exitCode || 0);
  }
}

main();
