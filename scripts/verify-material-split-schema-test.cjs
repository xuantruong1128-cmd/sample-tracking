#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

if (!env.SUPABASE_TEST_URL.includes('hosppagbopdghlupnhlr')) {
  console.error('FATAL: Target is NOT TEST project hosppagbopdghlupnhlr!');
  process.exit(1);
}

const client = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function main() {
  console.log('=== VERIFYING MATERIAL SPLIT SCHEMA (MIGRATION 00037) ON TEST ===');

  // 1. Query drawing_review_versions including new columns
  const { data: versions, error: verErr } = await client
    .from('drawing_review_versions')
    .select('id, version_name, status, required_material, material_type, material_specification')
    .order('created_at', { ascending: false })
    .limit(10);

  if (verErr) {
    console.error('❌ Failed selecting material_type / material_specification:', verErr.message);
    process.exit(1);
  }

  console.log(`✅ Queried ${versions.length} versions with material_type & material_specification columns!`);
  for (const v of versions) {
    console.log(`   - Version ${v.version_name} (${v.status}):`);
    console.log(`     material_type: ${JSON.stringify(v.material_type)}`);
    console.log(`     material_specification: ${JSON.stringify(v.material_specification)}`);
    console.log(`     required_material (legacy): ${JSON.stringify(v.required_material)}`);
  }

  // 2. Test immutability trigger is still active
  const completedVer = versions.find(v => v.status === 'Completed');
  if (completedVer) {
    const { error: immErr } = await client
      .from('drawing_review_versions')
      .update({ engineering_remarks: 'Testing immutability' })
      .eq('id', completedVer.id);

    if (immErr && immErr.message.includes('bất biến')) {
      console.log('✅ Immutability trigger is ACTIVE and correctly protected completed version:', immErr.message);
    } else {
      console.error('❌ Immutability trigger check failed. Expected error with "bất biến", got:', immErr);
      process.exit(1);
    }
  }

  console.log('\n🎉 ALL SCHEMA VERIFICATION CHECKS PASSED ON TEST (hosppagbopdghlupnhlr)!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
