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

async function audit() {
  console.log('================================================================================');
  console.log('   SAMPLE TRACKING — WORKFLOW V2: LIVE DATABASE AUDIT');
  console.log('================================================================================\n');

  // 1. Profiles columns & current users
  console.log('--- 1. PROFILES & USERS ---');
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
  if (pErr) console.error('Profiles err:', pErr);
  else {
    console.log(`Found ${profiles.length} profiles.`);
    if (profiles.length > 0) {
      console.log('Columns:', Object.keys(profiles[0]));
      console.log('Users list:');
      profiles.forEach(p => {
        console.log(`  - ${p.phone} | ${p.full_name} | Role: ${p.role} | Dept: ${p.department} | Active: ${p.is_active} | MustChangePass: ${p.must_change_password} | CanMakePEDecisions: ${p.can_make_pe_decisions}`);
      });
    }
  }

  // 2. Jobs status & structure
  console.log('\n--- 2. JOBS ---');
  const { data: jobs, error: jErr } = await supabase.from('jobs').select('*');
  if (jErr) console.error('Jobs err:', jErr);
  else {
    console.log(`Found ${jobs.length} jobs.`);
    if (jobs.length > 0) {
      console.log('Columns:', Object.keys(jobs[0]));
      jobs.forEach(j => {
        console.log(`  - ${j.job_no} | Status: ${j.status} | Created By: ${j.created_by} | Created At: ${j.created_at}`);
      });
    }
  }

  // 3. Job Operations status & structure
  console.log('\n--- 3. JOB OPERATIONS ---');
  const { data: ops, error: oErr } = await supabase.from('job_operations').select('*');
  if (oErr) console.error('Ops err:', oErr);
  else {
    console.log(`Found ${ops.length} operations across all jobs.`);
    if (ops.length > 0) {
      console.log('Columns:', Object.keys(ops[0]));
      const statusCounts = {};
      ops.forEach(o => {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
      });
      console.log('Operation Status Counts:', statusCounts);
    }
  }

  // 4. Production Runs structure
  console.log('\n--- 4. PRODUCTION RUNS ---');
  const { data: runs, error: rErr } = await supabase.from('production_runs').select('*');
  if (rErr) console.error('Runs err:', rErr);
  else {
    console.log(`Found ${runs.length} production runs.`);
    if (runs.length > 0) {
      console.log('Columns:', Object.keys(runs[0]));
    }
  }

  // 5. NG Details structure
  console.log('\n--- 5. NG DETAILS ---');
  const { data: ngs, error: ngErr } = await supabase.from('ng_details').select('*');
  if (ngErr) console.error('NG err:', ngErr);
  else {
    console.log(`Found ${ngs.length} NG details.`);
    if (ngs.length > 0) {
      console.log('Columns:', Object.keys(ngs[0]));
    }
  }

  // 6. QA Checks structure
  console.log('\n--- 6. QA CHECKS ---');
  const { data: qas, error: qaErr } = await supabase.from('qa_checks').select('*');
  if (qaErr) console.error('QA err:', qaErr);
  else {
    console.log(`Found ${qas.length} QA checks.`);
    if (qas.length > 0) {
      console.log('Columns:', Object.keys(qas[0]));
    }
  }

  // 7. Attachments structure
  console.log('\n--- 7. ATTACHMENTS ---');
  const { data: atts, error: aErr } = await supabase.from('attachments').select('*');
  if (aErr) console.error('Attachments err:', aErr);
  else {
    console.log(`Found ${atts.length} attachments.`);
    if (atts.length > 0) {
      console.log('Columns:', Object.keys(atts[0]));
    }
  }

  // 8. Audit logs structure
  console.log('\n--- 8. AUDIT LOGS ---');
  const { data: audits, error: auErr } = await supabase.from('audit_logs').select('*').limit(3);
  if (auErr) console.error('Audit err:', auErr);
  else {
    console.log(`Found audit logs.`);
    if (audits.length > 0) {
      console.log('Columns:', Object.keys(audits[0]));
    }
  }

  // 9. Inspect check_job_active_status and other triggers
  console.log('\n--- 9. CHECK FOR KIV REVIEW TABLE ---');
  const { data: kivTables, error: kivErr } = await supabase.from('kiv_reviews').select('*').limit(1);
  if (kivErr) {
    console.log('Table kiv_reviews does not exist yet:', kivErr.message);
  } else {
    console.log('Table kiv_reviews exists, columns:', Object.keys(kivTables[0] || {}));
  }

  console.log('\n================================================================================');
  console.log('   AUDIT COMPLETE');
  console.log('================================================================================\n');
}

audit().catch(console.error);
