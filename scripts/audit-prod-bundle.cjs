const fs = require('fs');
const path = require('path');

const distAssetsDir = path.resolve(__dirname, '../dist/assets');
if (!fs.existsSync(distAssetsDir)) {
  console.error('dist/assets not found!');
  process.exit(1);
}

let totalChars = 0;
let prodMatches = 0;
let testMatches = 0;
let serviceKeyMatches = 0;
const PROD_REF = 'uqvxtgvdmdfgtjwzsxlj';
const TEST_REF = 'hosppagbopdghlupnhlr';

const files = fs.readdirSync(distAssetsDir);
for (const file of files) {
  if (!file.endsWith('.js')) continue;
  const content = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
  totalChars += content.length;

  const pMatches = content.match(new RegExp(PROD_REF, 'g'));
  if (pMatches) prodMatches += pMatches.length;

  const tMatches = content.match(new RegExp(TEST_REF, 'g'));
  if (tMatches) testMatches += tMatches.length;

  const sMatches = content.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  for (const token of sMatches) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      if (payload.role === 'service_role') {
        serviceKeyMatches++;
      }
    } catch {}
  }
}

console.log('='.repeat(60));
console.log('  PRODUCTION BUNDLE AUDIT REPORT');
console.log('='.repeat(60));
console.log(`Total JS Files Audited:         ${files.filter((f) => f.endsWith('.js')).length}`);
console.log(`Total Bundle Size (chars):      ${totalChars.toLocaleString()}`);
console.log(`Production Supabase Ref (${PROD_REF}): ${prodMatches} occurrence(s)`);
console.log(`TEST Supabase Ref (${TEST_REF}):       ${testMatches} occurrence(s)`);
console.log(`Leaked Service Role Tokens:     ${serviceKeyMatches} occurrence(s)`);
console.log('='.repeat(60));

if (prodMatches === 0) {
  console.error('❌ FAIL: Production Supabase reference not found in bundle!');
  process.exit(1);
}
if (testMatches > 0) {
  console.error('❌ FAIL: TEST Supabase reference leaked into Production bundle!');
  process.exit(1);
}
if (serviceKeyMatches > 0) {
  console.error('❌ FAIL: Service role key leaked into Production bundle!');
  process.exit(1);
}

console.log('✅ PASS: Bundle is 100% clean, correctly points to Production, and has zero secret leaks.');
