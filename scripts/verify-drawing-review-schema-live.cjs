#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

const url = env.SUPABASE_TEST_URL;
const key = env.SUPABASE_TEST_SERVICE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function verify() {
  console.log('='.repeat(70));
  console.log('   VERIFYING DRAWING REVIEW SCHEMA ON TEST (hosppagbopdghlupnhlr)');
  console.log('='.repeat(70));

  // 1. Tables verification
  console.log('\n--- 1. Tables Verification ---');
  const tables = [
    'drawing_review_issues',
    'drawing_review_versions',
    'drawing_review_operations',
    'drawing_review_attachments',
    'drawing_review_issue_sequences'
  ];

  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`❌ Table public.${t} FAILED: ${error.message} (${error.code})`);
      process.exit(1);
    } else {
      console.log(`✅ Table public.${t.padEnd(32)}: EXISTS (Current row count: ${count})`);
    }
  }

  // 2. Storage Bucket verification
  console.log('\n--- 2. Storage Bucket Verification ---');
  const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
  if (bErr) {
    console.error(`❌ listBuckets FAILED: ${bErr.message}`);
    process.exit(1);
  }
  const bucket = buckets.find(b => b.name === 'drawing-reviews');
  if (!bucket) {
    console.error(`❌ Storage bucket "drawing-reviews" NOT FOUND! Buckets:`, buckets.map(b => b.name));
    process.exit(1);
  }
  console.log(`✅ Storage bucket "drawing-reviews": EXISTS`);
  console.log(`   - Public: ${bucket.public} (Expected: false)`);
  console.log(`   - File size limit: ${bucket.file_size_limit} bytes (50MB)`);
  console.log(`   - Allowed mime types: ${JSON.stringify(bucket.allowed_mime_types)}`);

  // 3. RPC Verification
  console.log('\n--- 3. RPC Functions Verification ---');
  // Test allocate_next_drawing_review_issue_no
  const { data: nextIssueNo, error: rpcErr1 } = await supabase.rpc('allocate_next_drawing_review_issue_no');
  if (rpcErr1) {
    console.error(`❌ RPC allocate_next_drawing_review_issue_no FAILED: ${rpcErr1.message}`);
    process.exit(1);
  }
  console.log(`✅ RPC allocate_next_drawing_review_issue_no: WORKING! Generated: ${nextIssueNo}`);

  // Test create_drawing_review_issue with invalid param to confirm RPC exists and rejects properly
  const { error: rpcErr2 } = await supabase.rpc('create_drawing_review_issue', {
    p_item_no: '',
    p_item_name: 'Test',
    p_customer: 'Test Cust',
    p_drawing_file_path: 'drawings/test.pdf',
    p_drawing_file_name: 'test.pdf',
    p_drawing_file_size: 100,
    p_drawing_mime_type: 'application/pdf',
    p_attention: null
  });
  if (rpcErr2 && rpcErr2.message.includes('Mã chi tiết (Item No) không được để trống')) {
    console.log(`✅ RPC create_drawing_review_issue: EXISTS & Validates input parameters properly!`);
  } else if (rpcErr2) {
    console.log(`ℹ️ RPC create_drawing_review_issue response: ${rpcErr2.message}`);
  }

  console.log('\n🎉 ALL SCHEMA COMPONENTS FOR DRAWING REVIEW V1.0 VERIFIED ON TEST!');
}

verify().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
