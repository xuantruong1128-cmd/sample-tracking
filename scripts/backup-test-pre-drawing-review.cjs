#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [k, ...v] = trimmed.split('=');
      const val = v.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[k.trim()]) process.env[k.trim()] = val;
    }
  }
}

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SERVICE_KEY;

if (!url || !key) {
  console.error('ERROR: SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_KEY is missing.');
  process.exit(1);
}

// STRICT SAFETY GUARD
if (url.includes('uqvxtgvdmdfgtjwzsxlj')) {
  console.error('FATAL SAFETY VIOLATION: URL matches PRODUCTION!');
  process.exit(1);
}

if (!url.includes('hosppagbopdghlupnhlr')) {
  console.error('FATAL SAFETY VIOLATION: URL does not match TEST project ref hosppagbopdghlupnhlr!');
  process.exit(1);
}

console.log('='.repeat(70));
console.log('   TAKING PRE-MIGRATION SNAPSHOT OF TEST DATABASE (hosppagbopdghlupnhlr)');
console.log('   Timestamp: ' + new Date().toISOString());
console.log('='.repeat(70));

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function backup() {
  const tables = [
    'jobs',
    'job_operations',
    'production_runs',
    'qa_checks',
    'job_final_reports',
    'workcenter_master',
    'defect_items',
    'profiles'
  ];

  const snapshot = {
    project: 'hosppagbopdghlupnhlr',
    timestamp: new Date().toISOString(),
    counts: {},
    data: {}
  };

  for (const t of tables) {
    const { data, error, count } = await supabase.from(t).select('*', { count: 'exact' });
    if (error) {
      console.warn(`Warning reading table ${t}: ${error.message}`);
      snapshot.counts[t] = -1;
      snapshot.data[t] = [];
    } else {
      console.log(`Table public.${t.padEnd(20)}: ${data.length} records`);
      snapshot.counts[t] = data.length;
      snapshot.data[t] = data;
    }
  }

  const outDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'test_pre_drawing_review_snapshot.json');
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log('\n✅ TEST Database snapshot saved successfully to:');
  console.log('   ' + outFile);
}

backup().catch(err => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
