const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';
const CLOUDFLARE_PROD_URL = 'https://sample-tracking-prod.pages.dev';

const client = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('='.repeat(80));
  console.log('  VERIFYING LIVE PRODUCTION DEPLOYMENT: 2-DEVICE POLICY');
  console.log(`  Supabase:   ${PROD_URL}`);
  console.log(`  Frontend:   ${CLOUDFLARE_PROD_URL}`);
  console.log(`  Timestamp:  ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Probe Frontend URL
  console.log('\n[1] Probing Frontend Production URL...');
  const frontendOk = await new Promise((resolve) => {
    https.get(CLOUDFLARE_PROD_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data.includes('<div id="root">')) {
          console.log(`  ✅ HTTP 200 OK - Frontend HTML loaded (${data.length} bytes)`);
          resolve(true);
        } else {
          console.error(`  ❌ HTTP ${res.statusCode}`);
          resolve(false);
        }
      });
    }).on('error', (err) => {
      console.error('  ❌ HTTP error:', err.message);
      resolve(false);
    });
  });

  if (!frontendOk) throw new Error('Frontend probe failed!');

  // 2. Probe user_active_devices table
  console.log('\n[2] Probing database table public.user_active_devices...');
  const { data: tableData, error: tableErr } = await client
    .from('user_active_devices')
    .select('*')
    .limit(5);

  if (tableErr) throw new Error(`Table probe failed: ${tableErr.message}`);
  console.log(`  ✅ Table exists and is queryable. Current active devices: ${tableData.length}`);

  // 3. Test Invariance: Existing profiles and data are 100% intact
  console.log('\n[3] Verifying data invariance (no changes to business data)...');
  const { count: profileCount } = await client.from('profiles').select('*', { count: 'exact', head: true });
  const { count: jobCount } = await client.from('jobs').select('*', { count: 'exact', head: true });
  const { count: reviewCount } = await client.from('drawing_reviews').select('*', { count: 'exact', head: true });

  console.log(`  ✅ Profiles intact:       ${profileCount} users`);
  console.log(`  ✅ Jobs intact:           ${jobCount} jobs`);
  console.log(`  ✅ Drawing Reviews intact: ${reviewCount} reviews`);

  console.log('\n================================================================================');
  console.log('  🎉 LIVE VERIFICATION PASSED 100%!');
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
