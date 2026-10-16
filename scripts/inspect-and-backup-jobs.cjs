const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...rest] = trimmed.split('=');
    const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
    if (!process.env[key.trim()]) {
      process.env[key.trim()] = val;
    }
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function inspectAndBackup() {
  console.log('--- Connecting to Supabase and querying all jobs ---');
  const { data: jobs, error: jErr } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: true });

  if (jErr) {
    console.error('Error fetching jobs:', jErr);
    return;
  }

  console.log(`Found ${jobs.length} jobs.`);

  // Get all profiles for mapping created_by
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, role, phone');
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  const fullData = [];

  for (const job of jobs) {
    const { data: ops } = await supabase
      .from('job_operations')
      .select('*')
      .eq('job_id', job.id)
      .order('step_order', { ascending: true });

    const opIds = (ops || []).map(o => o.id);
    let runs = [];
    let ngs = [];
    let qas = [];

    if (opIds.length > 0) {
      const { data: r } = await supabase
        .from('production_runs')
        .select('*')
        .in('operation_id', opIds);
      runs = r || [];

      const runIds = runs.map(x => x.id);
      if (runIds.length > 0) {
        const { data: n } = await supabase
          .from('ng_details')
          .select('*')
          .in('production_run_id', runIds);
        ngs = n || [];
      }

      const { data: q } = await supabase
        .from('qa_checks')
        .select('*')
        .in('operation_id', opIds);
      qas = q || [];
    }

    const { data: atts } = await supabase
      .from('attachments')
      .select('*')
      .eq('job_id', job.id);

    const { data: audits } = await supabase
      .from('audit_logs')
      .select('*')
      .or(`entity_id.eq.${job.id}`)
      .order('timestamp', { ascending: true });

    const creator = profileMap.get(job.created_by);

    fullData.push({
      job,
      creator: creator || { id: job.created_by, full_name: 'Unknown / System', role: 'Unknown', phone: 'Unknown' },
      operations: ops || [],
      production_runs: runs,
      ng_details: ngs,
      qa_checks: qas,
      attachments: atts || [],
      audit_logs: audits || [],
      summary: {
        has_production_runs: runs.length > 0,
        has_qa_checks: qas.length > 0,
        has_attachments: (atts || []).length > 0,
        is_closed: job.status === 'CLOSE',
        is_clean_candidate: runs.length === 0 && qas.length === 0,
      }
    });
  }

  // Ensure backups directory exists
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonBackupFile = path.join(backupDir, `backup_jobs_preview_${timestamp}.json`);
  const latestBackupFile = path.join(backupDir, 'backup_jobs_preview_latest.json');

  fs.writeFileSync(jsonBackupFile, JSON.stringify(fullData, null, 2), 'utf8');
  fs.writeFileSync(latestBackupFile, JSON.stringify(fullData, null, 2), 'utf8');

  console.log(`\n✅ Backup saved to: ${jsonBackupFile}`);
  console.log(`✅ Latest pointer saved to: ${latestBackupFile}\n`);

  // Print summary preview table
  console.log('================================================================================');
  console.log('   JOB INVENTORY & AUDIT SUMMARY (SUPABASE TEST)');
  console.log('================================================================================');
  fullData.forEach((item, index) => {
    const j = item.job;
    const c = item.creator;
    console.log(`\n[#${index + 1}] JOB Ticket: ${j.job_no} | ID: ${j.id}`);
    console.log(`     Item No.   : ${j.part_no} | Item Name: ${j.part_name || 'N/A'}`);
    console.log(`     Customer   : ${j.customer} | Qty: ${j.target_qty}`);
    console.log(`     Status     : ${j.status} | Created At: ${j.created_at}`);
    console.log(`     Created By : ${c.full_name} (${c.role}, Phone: ${c.phone})`);
    console.log(`     Ops: ${item.operations.length} | Runs: ${item.production_runs.length} | NG: ${item.ng_details.length} | QA: ${item.qa_checks.length} | Attachments: ${item.attachments.length}`);
    console.log(`     Category   : ${item.summary.is_closed ? '🔒 CLOSED' : item.summary.has_production_runs || item.summary.has_qa_checks ? '⚠️ CONTAINS PROD/QA DATA' : '🟢 CLEAN (NO PROD/QA DATA)'}`);
  });
  console.log('\n================================================================================\n');
}

inspectAndBackup().catch(err => {
  console.error('Fatal error in inspectAndBackup:', err);
  process.exit(1);
});
