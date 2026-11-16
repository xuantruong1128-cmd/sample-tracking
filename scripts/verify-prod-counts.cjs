const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const supa = createClient(PROD_URL, PROD_KEY);

async function check() {
  const [jobs, ops, runs, ng, qa, prof, wc, issues] = await Promise.all([
    supa.from('jobs').select('id', { count: 'exact', head: true }),
    supa.from('job_operations').select('id', { count: 'exact', head: true }),
    supa.from('production_runs').select('id', { count: 'exact', head: true }),
    supa.from('qa_ng_details').select('id', { count: 'exact', head: true }),
    supa.from('qa_checks').select('id', { count: 'exact', head: true }),
    supa.from('profiles').select('id', { count: 'exact', head: true }),
    supa.from('work_centers').select('id', { count: 'exact', head: true }),
    supa.from('drawing_review_issues').select('id', { count: 'exact', head: true })
  ]);

  console.log(JSON.stringify({
    jobs: jobs.count,
    ops: ops.count,
    runs: runs.count,
    ng: ng.count,
    qa: qa.count,
    profiles: prof.count,
    work_centers: wc.count,
    drawing_issues: issues.count
  }, null, 2));
}

check();
