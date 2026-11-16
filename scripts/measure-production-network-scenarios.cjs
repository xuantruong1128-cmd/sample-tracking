#!/usr/bin/env node
/**
 * AUTOMATED CONTROLLED NETWORK MEASUREMENT FOR PRODUCTION (M1)
 * Target: https://sample-tracking-prod.pages.dev
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROD_URL = 'https://sample-tracking-prod.pages.dev';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CRED_PATH = path.resolve(__dirname, '../backups/uat_test_credentials.json');

const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const ADMIN_USER = credentials.Admin;

class CDPSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { resolve, reject } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        } else if (data.method && this.eventListeners.has(data.method)) {
          for (const listener of this.eventListeners.get(data.method)) {
            listener(data.params);
          }
        }
      } catch (err) {
        console.error('CDP parse err:', err);
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

  on(method, callback) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(callback);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getWsUrl(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/list`, (r) => {
          let data = '';
          r.on('data', (c) => (data += c));
          r.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error('Could not connect to Chrome debugging port');
}

function sanitizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.searchParams.has('token')) {
      u.searchParams.set('token', 'REDACTED');
    }
    return u.toString();
  } catch {
    return rawUrl.split('?')[0];
  }
}

function categorizeUrl(url) {
  if (url.includes('uqvxtgvdmdfgtjwzsxlj.supabase.co/rest/v1/')) return 'Supabase REST';
  if (url.includes('uqvxtgvdmdfgtjwzsxlj.supabase.co/storage/v1/')) return 'Supabase Storage';
  if (url.includes('uqvxtgvdmdfgtjwzsxlj.supabase.co/auth/v1/')) return 'Supabase Auth';
  if (url.includes('uqvxtgvdmdfgtjwzsxlj.supabase.co/functions/v1/')) return 'Supabase Functions';
  if (url.includes('sample-tracking-prod.pages.dev/assets/') || url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.html') || url === PROD_URL || url === PROD_URL + '/') {
    return 'Cloudflare Static';
  }
  return 'Other';
}

async function main() {
  const port = 9231;
  const tmpProfile = path.resolve(__dirname, '../.tmp/measure-chrome-profile-' + Date.now());
  fs.mkdirSync(tmpProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--headless=new',
    '--disable-gpu',
    'about:blank',
  ]);

  try {
    const wsUrl = await getWsUrl(port);
    const WebSocket = globalThis.WebSocket;
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener('open', r));

    const cdp = new CDPSession(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const allRequests = new Map();
    let currentScenario = 'INIT';
    const scenarioItems = new Map();

    function switchScenario(name) {
      currentScenario = name;
      if (!scenarioItems.has(name)) scenarioItems.set(name, []);
      console.log(`\n============================================================`);
      console.log(`>>> SCENARIO: ${name}`);
      console.log(`============================================================`);
    }

    cdp.on('Network.requestWillBeSent', (p) => {
      const obj = {
        id: p.requestId,
        url: p.request.url,
        cleanUrl: sanitizeUrl(p.request.url),
        method: p.request.method,
        category: categorizeUrl(p.request.url),
        scenario: currentScenario,
        status: null,
        encodedBytes: 0,
        decodedBytes: 0,
      };
      allRequests.set(p.requestId, obj);
      if (scenarioItems.has(currentScenario)) {
        scenarioItems.get(currentScenario).push(p.requestId);
      }
      console.log(` [REQ] [${currentScenario}] ${p.request.method} ${obj.cleanUrl.slice(0, 85)} (${obj.category})`);
    });

    cdp.on('Network.responseReceived', (p) => {
      const req = allRequests.get(p.requestId);
      if (req) {
        req.status = p.response.status;
        const cl = p.response.headers['content-length'] || p.response.headers['Content-Length'];
        if (cl) req.decodedBytes = Math.max(req.decodedBytes, parseInt(cl, 10));
        if (p.response.encodedDataLength) req.encodedBytes = Math.max(req.encodedBytes, p.response.encodedDataLength);
      }
    });

    cdp.on('Network.dataReceived', (p) => {
      const req = allRequests.get(p.requestId);
      if (req) {
        req.decodedBytes += (p.dataLength || 0);
        req.encodedBytes += (p.encodedDataLength || p.dataLength || 0);
      }
    });

    cdp.on('Network.loadingFinished', (p) => {
      const req = allRequests.get(p.requestId);
      if (req && p.encodedDataLength) {
        req.encodedBytes = Math.max(req.encodedBytes, p.encodedDataLength);
        if (req.decodedBytes === 0) req.decodedBytes = req.encodedBytes;
      }
    });

    // 1. Scenario: Login
    switchScenario('Login');
    await cdp.send('Page.navigate', { url: PROD_URL + '/login' });
    await sleep(4000);

    const submitRes = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const phone = document.querySelector('#phone');
          const pass = document.querySelector('#password');
          const btn = document.querySelector('button[type="submit"]');
          if (!phone || !pass || !btn) return 'INPUTS_NOT_FOUND';
          const setVal = (el, val) => {
            const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            s.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          setVal(phone, '${ADMIN_USER.phone}');
          setVal(pass, '${ADMIN_USER.tempPassword}');
          btn.click();
          return 'SUBMITTED';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Login form submitted:', submitRes.result?.value);
    await sleep(5000);

    // 2. Scenario: Idle 5 minutes (measured 60s empirical live)
    switchScenario('Idle 5 minutes');
    console.log('  Measuring 60s live idle on active tab...');
    await sleep(60000);

    // 3. Scenario: Switch focus 10 times
    switchScenario('Switch focus 10 times');
    for (let i = 0; i < 10; i++) {
      await cdp.send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("focus"));' });
      await sleep(300);
    }
    await sleep(1000);

    // 4. Scenario: Open Jobs homepage
    switchScenario('Open Jobs homepage');
    const jobsClick = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const link = Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.includes('Lệnh sản xuất') || el.href?.endsWith('/'));
          if (link) { link.click(); return 'CLICKED_JOBS'; }
          return 'NO_JOBS_LINK';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Open jobs result:', jobsClick.result?.value);
    await sleep(4000);

    // 5. Scenario: Refresh Jobs homepage
    switchScenario('Refresh Jobs homepage');
    const refClick = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const refBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Thử lại') || b.querySelector('svg.lucide-refresh-cw'));
          if (refBtn) { refBtn.click(); return 'CLICKED_REFRESH_BUTTON'; }
          const jobsLink = Array.from(document.querySelectorAll('a')).find(a => a.href && a.href.includes('/jobs'));
          if (jobsLink) { jobsLink.click(); return 'CLICKED_NAV_REFRESH'; }
          return 'NO_REFRESH';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Refresh jobs result:', refClick.result?.value);
    await sleep(3000);

    // 6. Scenario: Open Job Detail
    switchScenario('Open Job Detail');
    const jobClick = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const row = document.querySelector('a[data-testid^="job-row-"]') || document.querySelector('a[href^="/jobs/"]');
          if (row) { row.click(); return 'CLICKED: ' + row.getAttribute('href'); }
          return 'NO_JOB_ROW';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Open job detail result:', jobClick.result?.value);
    await sleep(5000);

    // 7. Scenario: Return to Jobs
    switchScenario('Return to Jobs');
    const backClick = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const backBtn = document.querySelector('a[href="/"]') || document.querySelector('a[href="/jobs"]') || Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.includes('Về danh sách') || el.textContent.includes('Lệnh sản xuất'));
          if (backBtn) { backBtn.click(); return 'CLICKED_BACK'; }
          return 'NO_BACK_BTN';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Return to jobs result:', backClick.result?.value);
    await sleep(4000);

    // 8. Scenario: Open Drawing Reviews
    switchScenario('Open Drawing Reviews');
    const drClick = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const link = Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.includes('Đánh giá bản vẽ') || el.href?.includes('/drawing-reviews'));
          if (link) { link.click(); return 'CLICKED_DR_LINK'; }
          return 'NO_DR_LINK';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Open Drawing Reviews result:', drClick.result?.value);
    await sleep(5000);

    // 9. Scenario: Open existing Drawing Review
    switchScenario('Open existing Drawing Review');
    const openDrRow = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const row = document.querySelector('[data-testid^="issue-row-"]') || document.querySelector('a[href^="/drawing-reviews/"]');
          if (row) { row.click(); return 'CLICKED_ISSUE'; }
          return 'NO_ISSUE';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Open Drawing Review item result:', openDrRow.result?.value);
    await sleep(5000);

    // 10. Scenario: Open existing drawing
    switchScenario('Open existing drawing');
    const drawBtnClick = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.includes('Mở tệp gốc') || el.textContent.includes('Bản vẽ') || el.textContent.includes('.pdf'));
          if (btn) { btn.click(); return 'CLICKED_DRAWING_BTN'; }
          return 'NO_DRAW_BTN';
        })()
      `,
      returnByValue: true,
    });
    console.log('  Open drawing file result:', drawBtnClick.result?.value);
    await sleep(4000);

    // Summarize
    console.log('\n' + '='.repeat(85));
    console.log('  CONTROLLED PRODUCTION NETWORK MEASUREMENT SUMMARY TABLE');
    console.log('='.repeat(85));

    const finalReport = [];
    for (const [name, reqIds] of scenarioItems.entries()) {
      if (name === 'INIT') continue;
      const items = reqIds.map(id => allRequests.get(id)).filter(Boolean);
      const totalTransferred = items.reduce((s, i) => s + (i.encodedBytes || 0), 0);
      const totalDecoded = items.reduce((s, i) => s + (i.decodedBytes || 0), 0);
      const restReqs = items.filter(i => i.category === 'Supabase REST');
      const storageReqs = items.filter(i => i.category === 'Supabase Storage');
      const authReqs = items.filter(i => i.category === 'Supabase Auth');
      const staticReqs = items.filter(i => i.category === 'Cloudflare Static');

      finalReport.push({
        scenario: name,
        requests: items.length,
        responseBytes: totalDecoded,
        transferredBytes: totalTransferred,
        breakdown: {
          rest: { count: restReqs.length, bytes: restReqs.reduce((s, i) => s + i.decodedBytes, 0) },
          storage: { count: storageReqs.length, bytes: storageReqs.reduce((s, i) => s + i.decodedBytes, 0) },
          auth: { count: authReqs.length, bytes: authReqs.reduce((s, i) => s + i.decodedBytes, 0) },
          static: { count: staticReqs.length, bytes: staticReqs.reduce((s, i) => s + i.encodedBytes, 0) },
        },
        items: items.map(i => ({
          method: i.method,
          url: i.cleanUrl,
          category: i.category,
          status: i.status,
          transferredBytes: i.encodedBytes,
          responseBytes: i.decodedBytes,
        })),
      });

      console.log(`| ${name.padEnd(28)} | ${String(items.length).padStart(4)} req | ${(totalDecoded / 1024).toFixed(1).padStart(7)} KB dec | ${(totalTransferred / 1024).toFixed(1).padStart(7)} KB wire | (REST: ${restReqs.length}, Storage: ${storageReqs.length}, Auth: ${authReqs.length}, CF: ${staticReqs.length}) |`);
    }

    const outPath = path.resolve(__dirname, '../.tmp/production-network-measurement-final.json');
    fs.writeFileSync(outPath, JSON.stringify(finalReport, null, 2), 'utf8');
    console.log('\nFinal Results written to:', outPath);

  } finally {
    try {
      chromeProc.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('Fatal measurement error:', err);
  process.exit(1);
});
