const { createClient } = require('@supabase/supabase-js');
const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const supa = createClient(PROD_URL, PROD_KEY);

function getByteSize(data) {
  return Buffer.byteLength(JSON.stringify(data), 'utf8');
}

async function main() {
  console.log('='.repeat(70));
  console.log('  EXACT PRODUCTION PAYLOAD MEASUREMENTS (READ-ONLY)');
  console.log('='.repeat(70));

  // 1. JobListPage Mega-Query
  const qJobs = await supa
    .from('jobs')
    .select(`
      *,
      operations:job_operations(
        *,
        production_runs(*),
        qa_checks(*)
      )
    `)
    .order('created_at', { ascending: false });

  const jobsData = qJobs.data || [];
  const jobsSize = getByteSize(jobsData);
  console.log(`1. JobListPage Mega-Query:`);
  console.log(`   Rows: ${jobsData.length} jobs`);
  console.log(`   Decoded Payload: ${jobsSize} bytes (~${(jobsSize / 1024).toFixed(2)} KB)`);

  // 2. JobDetailPage Full Query
  let jobDetailSize = 0;
  if (jobsData.length > 0) {
    const firstJobId = jobsData[0].id;
    const qDetail = await supa
      .from('jobs')
      .select(`
        *,
        operations:job_operations(
          *,
          production_runs(
            *,
            ng_details(*)
          ),
          qa_checks(
            *,
            qa_ng_details(*)
          )
        )
      `)
      .eq('id', firstJobId)
      .single();

    jobDetailSize = getByteSize(qDetail.data);
    console.log(`2. JobDetailPage Query (Job ID: ${firstJobId}):`);
    console.log(`   Decoded Payload: ${jobDetailSize} bytes (~${(jobDetailSize / 1024).toFixed(2)} KB)`);
  }

  // 3. JobDetailPage Prev/Next Scan
  const qNav = await supa.from('jobs').select('id, job_no').order('created_at', { ascending: false });
  const navSize = getByteSize(qNav.data);
  console.log(`3. JobDetailPage Prev/Next Full Scan:`);
  console.log(`   Rows: ${qNav.data?.length}`);
  console.log(`   Decoded Payload: ${navSize} bytes (~${(navSize / 1024).toFixed(2)} KB)`);

  // 4. DrawingReviewListPage Query
  const qReviews = await supa
    .from('drawing_review_issues')
    .select(`
      *,
      versions:drawing_review_versions(
        *,
        operations:drawing_review_operations(*)
      )
    `)
    .order('created_at', { ascending: false });

  const drData = qReviews.data || [];
  const drSize = getByteSize(drData);
  console.log(`4. DrawingReviewListPage Query:`);
  console.log(`   Rows: ${drData.length} issues`);
  console.log(`   Decoded Payload: ${drSize} bytes (~${(drSize / 1024).toFixed(2)} KB)`);

  // 5. DrawingReviewDetailPage Query
  let drDetailSize = 0;
  if (drData.length > 0) {
    const firstIssueId = drData[0].id;
    const qDrDetail = await supa
      .from('drawing_review_issues')
      .select(`
        *,
        versions:drawing_review_versions(
          *,
          operations:drawing_review_operations(*),
          attachments:drawing_review_attachments(*)
        )
      `)
      .eq('id', firstIssueId)
      .single();

    drDetailSize = getByteSize(qDrDetail.data);
    console.log(`5. DrawingReviewDetailPage Query (Issue ID: ${firstIssueId}):`);
    console.log(`   Decoded Payload: ${drDetailSize} bytes (~${(drDetailSize / 1024).toFixed(2)} KB)`);
  }

  // 6. Reference Catalogs
  const qDefects = await supa.from('defect_catalog').select('*').eq('is_active', true).order('code');
  const defectSize = getByteSize(qDefects.data);
  console.log(`6. defect_catalog: ${qDefects.data?.length} rows, ${defectSize} bytes (~${(defectSize / 1024).toFixed(2)} KB)`);

  const qWorkcenters = await supa.from('workcenter_master').select('code, description').eq('is_active', true).order('code');
  const wcSize = getByteSize(qWorkcenters.data);
  console.log(`7. workcenter_master: ${qWorkcenters.data?.length} rows, ${wcSize} bytes (~${(wcSize / 1024).toFixed(2)} KB)`);

  // 8. Profiles (Auth)
  const qProfiles = await supa.from('profiles').select('*').limit(1);
  const singleProfileSize = getByteSize(qProfiles.data);
  console.log(`8. Single Profile query: ${singleProfileSize} bytes (~${(singleProfileSize / 1024).toFixed(2)} KB)`);
}

main().catch(console.error);
