const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://sample-tracking-prod.pages.dev';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:/Users/xuantruong do/.gemini/antigravity/brain/078bd566-721e-46b9-8787-668467504479';

class CDPSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
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

  async screenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    const artifactPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(artifactPath, buf);
    console.log(`  📸 Captured: ${filename}`);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 2500));
  }

  async waitForText(text, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await this.send('Runtime.evaluate', {
        expression: `document.body.innerText.includes('${text}')`,
        returnByValue: true,
      });
      if (res.result?.value) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for text: ${text}`);
  }

  async type(selector, value) {
    await this.send('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${selector}');
          el.value = '${value}';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `,
    });
    await new Promise((r) => setTimeout(r, 200));
  }

  async click(selector) {
    await this.send('Runtime.evaluate', {
      expression: `document.querySelector('${selector}').click()`,
    });
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function capture() {
  const profileDir = path.resolve(__dirname, '../backups/chrome-prod-verify-profile');
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
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
      if (pageTarget?.webSocketDebuggerUrl) {
        const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((res) => { ws.onopen = res; ws.addEventListener?.('open', res); });
        const session = new CDPSession(ws);

        await session.send('Page.enable');
        await session.send('Runtime.enable');
        await session.send('DOM.enable');

        // Log in as Admin Đỗ Xuân Trường (+84968041128) using temp/standard password
        await session.navigate(`${BASE_URL}/login`);
        await session.waitForText('Đăng nhập');

        // Check login credentials from admin_temp_credentials.json if exists
        const adminCredPath = path.resolve(__dirname, '../backups/admin_temp_credentials.json');
        let adminPass = '123456';
        if (fs.existsSync(adminCredPath)) {
          const creds = JSON.parse(fs.readFileSync(adminCredPath, 'utf8'));
          if (creds.password) adminPass = creds.password;
        }

        await session.type('input[name="phone"], input[type="tel"], input[type="text"]', '0968041128');
        await session.type('input[type="password"]', adminPass);
        await session.click('button[type="submit"]');

        await session.navigate(`${BASE_URL}/drawing-reviews`);
        await session.waitForText('Drawing Review');
        await new Promise((r) => setTimeout(r, 1500));

        await session.screenshot('prod_clean_dashboard.png');
        console.log('✅ Screenshot captured: prod_clean_dashboard.png');

        proc.kill();
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

capture().catch(err => {
  console.error('Error capturing dashboard:', err);
  process.exit(1);
});
