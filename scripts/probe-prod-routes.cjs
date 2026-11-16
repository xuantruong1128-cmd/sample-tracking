#!/usr/bin/env node
const http = require('http');
const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
  });
}

async function testRoutes() {
  const routes = [
    'https://sample-tracking-prod.pages.dev/',
    'https://sample-tracking-prod.pages.dev/jobs',
    'https://sample-tracking-prod.pages.dev/drawing-reviews',
    'https://sample-tracking-prod.pages.dev/assets/index-3Wf_q7rS.js',
    'https://sample-tracking-prod.pages.dev/assets/index-BEIiXDff.css',
  ];

  console.log('='.repeat(60));
  console.log('  PROBING PRODUCTION ROUTES & STATIC CHUNKS');
  console.log('='.repeat(60));

  for (const r of routes) {
    const res = await fetchUrl(r);
    console.log(`  ${res.status} OK | ${r.replace('https://sample-tracking-prod.pages.dev', '') || '/'}`);
  }
}

testRoutes().catch(console.error);
