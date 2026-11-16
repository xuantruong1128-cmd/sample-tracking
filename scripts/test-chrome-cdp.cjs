const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = path.resolve(__dirname, '../backups/chrome-test-profile');

if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

console.log('Launching Chrome with remote debugging on port 9222...');
const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

function checkPort(retries = 20) {
  return new Promise((resolve, reject) => {
    const tryConnect = (remaining) => {
      http.get('http://127.0.0.1:9222/json/version', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', (err) => {
        if (remaining <= 0) return reject(err);
        setTimeout(() => tryConnect(remaining - 1), 300);
      });
    };
    tryConnect(retries);
  });
}

async function test() {
  try {
    const version = await checkPort();
    console.log('Chrome remote debugging connected!');
    console.log('Browser:', version.Browser);
    console.log('Protocol Version:', version['Protocol-Version']);
    console.log('WebSocket Debugger URL:', version.webSocketDebuggerUrl);
  } finally {
    console.log('Killing Chrome process...');
    chrome.kill();
  }
}

test().catch(err => {
  console.error('Failed to connect to Chrome:', err);
  chrome.kill();
  process.exit(1);
});
