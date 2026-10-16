const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function verifyLive() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — VERIFY OPERATION UI & ENGINEERING DOCUMENTS R1 LIVE');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;
  function assert(condition, name, details) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ PASS [Check ${total}]: ${name}`);
    } else {
      console.error(`  ❌ FAIL [Check ${total}]: ${name}${details ? ` -> ${details}` : ''}`);
    }
  }

  // 1. Verify Storage bucket configuration
  console.log('--- 1. Storage Bucket Verification ---');
  const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
  assert(!bErr, 'Buckets listed without error', bErr?.message);
  const sampleDocBucket = buckets?.find((b) => b.id === 'sample-documents');
  assert(Boolean(sampleDocBucket), 'Bucket sample-documents exists');
  assert(sampleDocBucket?.public === false, 'Bucket sample-documents is private');
  const mimes = sampleDocBucket?.allowed_mime_types || [];
  assert(mimes.includes('image/webp'), 'Allowed MIME includes image/webp');
  assert(
    mimes.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'Allowed MIME includes XLSX spreadsheet'
  );

  // 2. Verify Table: operation_sample_photos
  console.log('\n--- 2. Table: operation_sample_photos ---');
  const { data: samplePhotos, error: spErr } = await adminClient
    .from('operation_sample_photos')
    .select('*')
    .limit(1);
  assert(!spErr, 'Table operation_sample_photos exists and queryable', spErr?.message);

  // 3. Verify Table: pe_engineering_reviews
  console.log('\n--- 3. Table: pe_engineering_reviews ---');
  const { data: peReviews, error: prErr } = await adminClient
    .from('pe_engineering_reviews')
    .select('*')
    .limit(1);
  assert(!prErr, 'Table pe_engineering_reviews exists and queryable', prErr?.message);

  // 4. Verify Table: engineering_documents
  console.log('\n--- 4. Table: engineering_documents ---');
  const { data: engDocs, error: edErr } = await adminClient
    .from('engineering_documents')
    .select('*')
    .limit(1);
  assert(!edErr, 'Table engineering_documents exists and queryable', edErr?.message);

  // 5. Verify existing production data integrity (Job 202610-024)
  console.log('\n--- 5. Existing Data Integrity ---');
  const { data: existingJobs, error: jErr } = await adminClient
    .from('jobs')
    .select('id, job_no, status, part_no, job_operations(id, step_order, operation_name, status, production_runs(id, ok_qty, ng_qty, kiv_qty))');
  assert(!jErr, 'Jobs queryable without error', jErr?.message);
  assert(existingJobs && existingJobs.length > 0, `Jobs exist in database (Count: ${existingJobs?.length})`);
  const job24 = existingJobs?.find((j) => j.job_no === '202610-024');
  assert(Boolean(job24), 'Job 202610-024 is intact in database');
  if (job24) {
    console.log(`     Job 202610-024: status=${job24.status}, customer=${job24.customer_code}, operations=${job24.operations?.length}`);
  }

  // 6. Test Role Drawing in Enum
  console.log('\n--- 6. Role Drawing in Profiles / Auth ---');
  // Check if we can select profiles with role column
  const { data: profiles, error: pErr } = await adminClient.from('profiles').select('id, role, full_name, phone');
  assert(!pErr, 'Profiles queryable with role column', pErr?.message);
  console.log(`     Active profiles count: ${profiles?.length}`);

  console.log('\n' + '='.repeat(80));
  console.log(`   LIVE VERIFICATION SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('='.repeat(80) + '\n');
}

verifyLive().catch(console.error);
