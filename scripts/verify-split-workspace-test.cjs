#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW UX HOTFIX R3: SPLIT WORKSPACE LIVE TEST VERIFICATION
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

const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const PE_USER = credentials['PE-MFG'];

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
      throw new Error(`Eval error: ${res.exceptionDetails.text} (${expression})`);
    }
    return res.result?.value;
  }

  async waitForSelector(selector, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  async click(selector) {
    await this.waitForSelector(selector);
    await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) throw new Error('Element not found: ${selector}');
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
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
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await new Promise((r) => setTimeout(r, 300));
  }

  async screenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const fullPath = path.join(UAT_OUTPUT_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(res.data, 'base64'));
    console.log(`  📸 Captured: ${filename}`);

    // Also copy to artifacts directory
    if (fs.existsSync(ARTIFACT_DIR)) {
      const artifactPath = path.join(ARTIFACT_DIR, filename);
      fs.copyFileSync(fullPath, artifactPath);
    }
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 2500));
  }
}

async function startChrome() {
  const profileDir = path.resolve(__dirname, '../backups/chrome-split-test-profile');
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
  console.log('  DRAWING REVIEW UX HOTFIX R3: SPLIT WORKSPACE TEST VERIFICATION');
  console.log(`  Target URL: ${BASE_URL}`);
  console.log(`  Timestamp:  ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const { proc, webSocketDebuggerUrl } = await startChrome();
  console.log('  ✅ Headless Chrome started with CDP at:', webSocketDebuggerUrl);

  try {
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const session = new CDPSession(ws);

    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Runtime.enable');

    // Desktop 1440x900 viewport
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
    // 2. NAVIGATE TO DRAWING REVIEWS
    // -------------------------------------------------------------------------
    console.log('\n>>> 2. NAVIGATING TO DRAWING REVIEW LIST <<<');
    await session.navigate(`${BASE_URL}/drawing-reviews`);
    await session.waitForSelector('h1');

    // Find and click an issue
    const hasItems = await session.evaluate(`Boolean(document.querySelector('a[href^="/drawing-reviews/"]'))`);
    if (!hasItems) {
      throw new Error('No drawing review items found in list!');
    }

    const detailHref = await session.evaluate(`
      (() => {
        const link = document.querySelector('a[href^="/drawing-reviews/"]');
        return link ? link.getAttribute('href') : null;
      })()
    `);
    const detailUrl = detailHref.replace(/\/report$/, '');
    console.log(`  Opening Drawing Review Workspace: ${detailUrl}`);
    await session.navigate(`${BASE_URL}${detailUrl}`);
    await new Promise((r) => setTimeout(r, 3000));

    // -------------------------------------------------------------------------
    // 3. VERIFY DESKTOP SPLIT WORKSPACE LAYOUT
    // -------------------------------------------------------------------------
    console.log('\n>>> 3. VERIFYING DESKTOP SPLIT WORKSPACE LAYOUT <<<');
    await session.waitForSelector('[data-testid="desktop-drawing-panel"]');
    await session.waitForSelector('[data-testid="desktop-review-panel"]');
    await session.waitForSelector('[data-testid="split-workspace-divider"]');

    const panelMetrics = await session.evaluate(`
      (() => {
        const drawing = document.querySelector('[data-testid="desktop-drawing-panel"]');
        const review = document.querySelector('[data-testid="desktop-review-panel"]');
        return {
          drawingWidth: drawing.offsetWidth,
          reviewWidth: review.offsetWidth,
          drawingStyle: drawing.style.width,
          reviewStyle: review.style.width
        };
      })()
    `);
    console.log('  Panel dimensions:', panelMetrics);
    await session.screenshot('split_01_desktop_workspace.png');

    // -------------------------------------------------------------------------
    // 4. VERIFY INDEPENDENT SCROLLING (DRAWING REMAINS VISIBLE)
    // -------------------------------------------------------------------------
    console.log('\n>>> 4. TESTING INDEPENDENT SCROLLING <<<');
    // Scroll the review panel down by 450px
    await session.evaluate(`
      (() => {
        const scrollContainer = document.querySelector('[data-testid="desktop-review-panel"] .overflow-y-auto');
        if (scrollContainer) scrollContainer.scrollTop = 450;
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const scrollCheck = await session.evaluate(`
      (() => {
        const scrollContainer = document.querySelector('[data-testid="desktop-review-panel"] .overflow-y-auto');
        const drawingPanel = document.querySelector('[data-testid="desktop-drawing-panel"]');
        return {
          reviewScrollTop: scrollContainer ? scrollContainer.scrollTop : 0,
          drawingVisible: drawingPanel && drawingPanel.offsetHeight > 400
        };
      })()
    `);
    console.log(`  Review panel scrolled to: ${scrollCheck.reviewScrollTop}px, Drawing panel stays fully visible: ${scrollCheck.drawingVisible}`);
    await session.screenshot('split_02_independent_scroll.png');

    // -------------------------------------------------------------------------
    // 5. TEST CAD CONTROLS & CURSOR ZOOM
    // -------------------------------------------------------------------------
    console.log('\n>>> 5. TESTING CAD NAVIGATION & ZOOM CONTROLS <<<');
    await session.waitForSelector('[data-testid="zoom-in-btn"]');
    await session.click('[data-testid="zoom-in-btn"]');
    await new Promise((r) => setTimeout(r, 400));

    const zoomTextAfterIn = await session.evaluate(`document.querySelector('[data-testid="zoom-percentage-label"]')?.innerText`);
    console.log(`  Zoom percentage after Zoom In: ${zoomTextAfterIn}`);

    // Toggle Pan Tool
    await session.click('[data-testid="pan-mode-toggle-btn"]');
    await session.screenshot('split_03_cad_controls_and_zoom.png');

    // Reset Zoom
    await session.click('[data-testid="reset-view-btn"]');

    // -------------------------------------------------------------------------
    // 6. TEST PANEL DIVIDER DRAGGING
    // -------------------------------------------------------------------------
    console.log('\n>>> 6. TESTING PANEL DIVIDER RESIZING <<<');
    await session.evaluate(`
      (() => {
        const divider = document.querySelector('[data-testid="split-workspace-divider"]');
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        divider.dispatchEvent(mousedown);

        // Move to 60% of window
        const mousemove = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 864 });
        window.dispatchEvent(mousemove);

        const mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
        window.dispatchEvent(mouseup);
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const resizedMetrics = await session.evaluate(`
      (() => {
        const drawing = document.querySelector('[data-testid="desktop-drawing-panel"]');
        const review = document.querySelector('[data-testid="desktop-review-panel"]');
        return {
          drawingStyle: drawing.style.width,
          reviewStyle: review.style.width,
          savedStorage: localStorage.getItem('drawing_review_split_width')
        };
      })()
    `);
    console.log('  Metrics after divider drag:', resizedMetrics);
    await session.screenshot('split_04_panel_resized.png');

    // -------------------------------------------------------------------------
    // 7. TEST MOBILE PORTRAIT VIEWPORT & VIEW SWITCHING
    // -------------------------------------------------------------------------
    console.log('\n>>> 7. TESTING MOBILE RESPONSIVE LAYOUT & TABS <<<');
    await session.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 1000));

    // Verify Review tab active
    await session.waitForSelector('[data-testid="mobile-tab-review-btn"]');
    await session.waitForSelector('[data-testid="mobile-floating-toggle-btn"]');
    await session.screenshot('split_05_mobile_review_tab.png');

    // Switch to Drawing Tab
    await session.click('[data-testid="mobile-tab-drawing-btn"]');
    await new Promise((r) => setTimeout(r, 800));
    await session.screenshot('split_06_mobile_drawing_tab.png');

    // -------------------------------------------------------------------------
    // 8. SAMPLE TRACKING REGRESSION CHECK
    // -------------------------------------------------------------------------
    console.log('\n>>> 8. TESTING SAMPLE TRACKING REGRESSION <<<');
    await session.setViewport(1440, 900);
    await session.navigate(`${BASE_URL}/`);
    await session.waitForSelector('h1');
    await new Promise((r) => setTimeout(r, 2000));
    await session.screenshot('split_07_sample_tracking_regression.png');

    console.log('\n' + '='.repeat(80));
    console.log('  🎉 LIVE BROWSER VERIFICATION COMPLETE! ALL 7 SCREENSHOTS CAPTURED.');
    console.log('='.repeat(80));

    ws.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error('\n❌ FATAL TEST VERIFICATION ERROR:', err);
  process.exit(1);
});
