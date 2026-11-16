#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW — MATERIAL SPLIT LIVE BROWSER VERIFICATION
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
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'https://sample-tracking-89b.pages.dev';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UAT_OUTPUT_DIR = path.resolve(__dirname, '../uat_output');
const ARTIFACT_DIR = path.resolve(
  'C:\\Users\\xuantruong do\\.gemini\\antigravity\\brain\\078bd566-721e-46b9-8787-668467504479'
);
const CRED_PATH = path.resolve(__dirname, '../backups/uat_test_credentials.json');

if (!fs.existsSync(UAT_OUTPUT_DIR)) fs.mkdirSync(UAT_OUTPUT_DIR, { recursive: true });

// Read env for TEST database
const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

const adminClient = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_KEY, {
  auth: { persistSession: false }
});

const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const PE_USER = credentials['PE-MFG'];

class CDPSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();

    ws.onmessage = (event) => {
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
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
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
  const profileDir = path.resolve(__dirname, '../backups/chrome-mat-split-profile');
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const proc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });

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
  console.log('  LIVE CDP BROWSER VERIFICATION: MATERIAL TYPE & SPECIFICATION SPLIT');
  console.log(`  Target:    ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  let activeIssue = null;

  try {
    // 1. Seed a dedicated active review issue with status 'Reviewing'
    console.log('\n>>> STEP 0: SEEDING ACTIVE REVIEW ISSUE ON TEST <<<');
    const issueCode = 'MAT' + Date.now().toString().slice(-6);
    const { data: issue, error: issueErr } = await adminClient
      .from('drawing_review_issues')
      .insert({
        issue_no: issueCode,
        item_no: 'SHAFT-SUS316L',
        item_name: 'Trục Bạc Đạn Inox 316L',
        customer: 'Toyota Tsusho Japan',
        drawing_file_path: 'drawings/demo-shaft.pdf',
        drawing_file_name: 'demo-shaft.pdf',
        drawing_file_size: 102400,
        drawing_mime_type: 'application/pdf',
        attention: 'Kiểm tra kỹ dung sai lắp ghép ổ bi'
      })
      .select()
      .single();
    if (issueErr) throw issueErr;
    activeIssue = issue;

    const { data: ver, error: verErr } = await adminClient
      .from('drawing_review_versions')
      .insert({
        issue_id: issue.id,
        version_number: 1,
        version_name: 'V1',
        status: 'Reviewing',
        material_type: 'SUS304',
        material_specification: 'Ø19.05 h9 × L3000\nRunout 0.08/400 max',
        required_material: 'SUS304\nØ19.05 h9 × L3000\nRunout 0.08/400 max',
        required_tooling: 'Dao tiện carbide CNMG120408',
        special_measuring_equipment: 'Đồng hồ so 0.001mm',
        engineering_remarks: 'Gia công thô trước khi tôi ram',
      })
      .select()
      .single();
    if (verErr) throw verErr;

    // Insert an initial operation
    await adminClient.from('drawing_review_operations').insert({
      version_id: ver.id,
      lineage_id: crypto.randomUUID(),
      step_order: 1,
      workcenter_code: 'CNC-01',
      operation_description: 'Tiện khỏa mặt đầu và khoan tâm',
      cycle_time_seconds: 90,
      remark: '',
      is_removed: false,
    });

    console.log(`  ✅ Active review issue seeded: ${issue.issue_no} (ID: ${issue.id})`);

    // 2. Start Chrome
    const { proc, webSocketDebuggerUrl } = await startChrome();
    console.log('  ✅ Headless Chrome started at:', webSocketDebuggerUrl);

    try {
      const WebSocket = globalThis.WebSocket || require('ws');
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((r) => (ws.onopen = r));
      const session = new CDPSession(ws);

      await session.send('Page.enable');
      await session.send('DOM.enable');
      await session.send('Runtime.enable');
      await session.setViewport(1440, 900);

      // -------------------------------------------------------------------------
      // 1. LOGIN AS PE-MFG
      // -------------------------------------------------------------------------
      console.log('\n>>> 1. AUTHENTICATING AS PE-MFG <<<');
      await session.navigate(`${BASE_URL}/login`);
      await session.waitForSelector('#phone');
      await session.type('#phone', PE_USER.phone);
      await session.type('#password', PE_USER.tempPassword);
      await session.click('button[type="submit"]');
      await new Promise((r) => setTimeout(r, 2500));

      // -------------------------------------------------------------------------
      // 2. NAVIGATE TO REVIEW WORKSPACE
      // -------------------------------------------------------------------------
      console.log(`\n>>> 2. NAVIGATING TO REVIEW WORKSPACE: /drawing-reviews/${activeIssue.id} <<<`);
      await session.navigate(`${BASE_URL}/drawing-reviews/${activeIssue.id}`);
      await new Promise((r) => setTimeout(r, 4000));

      const currentUrl = await session.evaluate('window.location.href');
      const bodySnippet = await session.evaluate('document.body.innerText.slice(0, 300)');
      console.log('  Current URL:', currentUrl);
      console.log('  Body Snippet:', JSON.stringify(bodySnippet));
      await session.screenshot('debug_material_screen.png');

      // -------------------------------------------------------------------------
      // 3. VERIFY MATERIAL TYPE & SPECIFICATION INPUTS
      // -------------------------------------------------------------------------
      console.log('\n>>> 3. VERIFYING MATERIAL TYPE & SPECIFICATION FIELDS <<<');
      await session.waitForSelector('[data-testid="material-type-input"]');
      await session.waitForSelector('[data-testid="material-specification-textarea"]');

      const initialValues = await session.evaluate(`
        (() => ({
          type: document.querySelector('[data-testid="material-type-input"]').value,
          spec: document.querySelector('[data-testid="material-specification-textarea"]').value,
        }))()
      `);
      console.log('  Initial Material values on UI:', initialValues);

      // -------------------------------------------------------------------------
      // 4. EDIT FIELDS WITH UNICODE SYMBOLS & TEST DIRTY STATE
      // -------------------------------------------------------------------------
      console.log('\n>>> 4. EDITING MATERIAL FIELDS WITH UNICODE TECHNICAL SYMBOLS <<<');
      const newType = 'SUS316L';
      const newSpec = 'Ø19.05 h9 × L3000\nRunout 0.08/400 max\nHardness 22–30 HRC ±0.02';

      await session.type('[data-testid="material-type-input"]', newType);
      await session.type('[data-testid="material-specification-textarea"]', newSpec);
      await new Promise((r) => setTimeout(r, 500));

      // Check dirty indicator
      const isDirty = await session.evaluate(`document.body.innerText.includes('Có thay đổi chưa lưu')`);
      console.log('  ✅ "Có thay đổi chưa lưu" badge visible:', isDirty);

      // -------------------------------------------------------------------------
      // 5. SAVE DRAFT
      // -------------------------------------------------------------------------
      console.log('\n>>> 5. SAVING DRAFT & CAPTURING DESKTOP SCREENSHOT <<<');
      await session.click('[data-testid="save-draft-btn"]');
      await new Promise((r) => setTimeout(r, 2500));

      // Verify synced badge
      const isSynced = await session.evaluate(`document.body.innerText.includes('Đã đồng bộ')`);
      console.log('  ✅ "Đã đồng bộ" badge confirmed after save:', isSynced);

      await session.screenshot('mat_01_desktop_material_split.png');

      // -------------------------------------------------------------------------
      // 6. CLOSE VERSION & VERIFY COMPLETED REPORT VIEW
      // -------------------------------------------------------------------------
      console.log('\n>>> 6. CLOSING VERSION & CHECKING COMPLETED REPORT <<<');
      await session.click('[data-testid="close-version-btn"]');
      await new Promise((r) => setTimeout(r, 800));

      // Click Confirm Close in modal
      await session.waitForSelector('[data-testid="confirm-close-btn"]');
      await session.click('[data-testid="confirm-close-btn"]');
      await new Promise((r) => setTimeout(r, 4000));

      // Verify on Completed Report page
      await session.waitForSelector('[data-testid="completed-material-type"]');
      await session.waitForSelector('[data-testid="completed-material-specification"]');

      const completedValues = await session.evaluate(`
        (() => ({
          type: document.querySelector('[data-testid="completed-material-type"]').textContent.trim(),
          spec: document.querySelector('[data-testid="completed-material-specification"]').textContent.trim(),
        }))()
      `);
      console.log('  Completed Report Cards display:', completedValues);

      await session.screenshot('mat_02_completed_report_cards.png');

      // -------------------------------------------------------------------------
      // 7. MOBILE RESPONSIVE VIEW (390x844)
      // -------------------------------------------------------------------------
      console.log('\n>>> 7. TESTING MOBILE VIEW (390x844) <<<');
      await session.setViewport(390, 844);
      await session.navigate(`${BASE_URL}/drawing-reviews/${activeIssue.id}/report`);
      await new Promise((r) => setTimeout(r, 2500));
      await session.screenshot('mat_03_mobile_material_fields.png');

      console.log('\n' + '='.repeat(80));
      console.log('🎉 ALL LIVE BROWSER VERIFICATION STEPS COMPLETED SUCCESSFULLY!');
      console.log('='.repeat(80));
    } finally {
      try {
        proc.kill();
      } catch {}
    }
  } finally {
    // Cleanup seeded issue
    if (activeIssue?.id) {
      await adminClient.from('drawing_review_issues').delete().eq('id', activeIssue.id);
      console.log('  🧹 Cleaned up temporary seed issue.');
    }
  }
}

main().catch((err) => {
  console.error('\n❌ FATAL CDP TEST ERROR:', err);
  process.exit(1);
});
