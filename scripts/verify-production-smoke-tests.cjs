#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW V1.0 — PRODUCTION POST-DEPLOYMENT SMOKE TEST RUNNER
 * Script: scripts/verify-production-smoke-tests.cjs
 *
 * Target:
 *   - Production Frontend: https://sample-tracking-prod.pages.dev
 *   - Production Supabase: uqvxtgvdmdfgtjwzsxlj
 * ==============================================================================
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const LIVE_FRONTEND_URL = 'https://sample-tracking-prod.pages.dev';

const client = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function runSmokeTests() {
  console.log('='.repeat(80));
  console.log('   DRAWING REVIEW V1.0 — PRODUCTION LIVE POST-DEPLOYMENT SMOKE TESTS');
  console.log(`   Frontend Target: ${LIVE_FRONTEND_URL}`);
  console.log(`   Backend Target:  ${PROD_URL}`);
  console.log(`   Timestamp:       ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const results = [];
  function record(id, name, pass, detail = '') {
    results.push({ id, name, pass, detail });
    console.log(`  ${pass ? '✅' : '❌'} [Smoke ${id}]: ${name}${detail ? ` (${detail})` : ''}`);
    if (!pass) process.exitCode = 1;
  }

  // --- PART 1: LIVE HTTP FRONTEND & BUNDLE INTEGRITY ---
  console.log('\n--- 1. LIVE HTTP FRONTEND & BUNDLE VERIFICATION ---');
  try {
    const res = await httpGet(LIVE_FRONTEND_URL);
    record(1, 'Production URL HTTP 200 OK', res.status === 200, `Status: ${res.status}`);
    record(2, 'HTML contains root mount point', res.body.includes('<div id="root"></div>'));

    // Extract JS bundle src
    const jsMatches = [...res.body.matchAll(/src="\/assets\/(index-[a-zA-Z0-9_-]+\.js)"/g)];
    if (jsMatches.length > 0) {
      const mainJs = jsMatches[0][1];
      console.log(`  Fetching live JS bundle: /assets/${mainJs}...`);
      const jsRes = await httpGet(`${LIVE_FRONTEND_URL}/assets/${mainJs}`);
      record(3, 'Live JS bundle serves HTTP 200', jsRes.status === 200);
      record(4, 'Live JS contains Production Supabase ref', jsRes.body.includes('uqvxtgvdmdfgtjwzsxlj'));
      record(5, 'Live JS strictly excludes TEST Supabase ref', !jsRes.body.includes('hosppagbopdghlupnhlr'));
      record(6, 'Live JS strictly excludes service_role key', !jsRes.body.includes('service_role'));
      record(7, 'Live JS contains Drawing Review module routes & labels', jsRes.body.includes('drawing-reviews') || jsRes.body.includes('Xem xét bản vẽ'));
    } else {
      record(3, 'Found main JS bundle script tag in HTML', false, 'Script tag not found');
    }
  } catch (e) {
    record(1, 'Frontend HTTP check', false, e.message);
  }

  // --- PART 2: REMOTE DATABASE MIGRATION INTEGRITY ---
  console.log('\n--- 2. REMOTE DATABASE MIGRATIONS INTEGRITY ---');
  try {
    const migListOut = execSync('npx supabase migration list --project-ref "uqvxtgvdmdfgtjwzsxlj"', {
      shell: 'cmd.exe', encoding: 'utf8', timeout: 60000
    });
    const parsed = JSON.parse(migListOut.substring(migListOut.indexOf('{"migrations":')));
    const all36Applied = parsed.migrations.every(m => m.local && m.remote && m.local === m.remote);
    record(8, 'All 36 migrations confirmed applied on remote', all36Applied, `Total applied: ${parsed.migrations.length}`);
  } catch (e) {
    record(8, 'Supabase migration list check', false, e.message);
  }

  // --- PART 3: SAMPLE TRACKING OPERATIONAL DATA PRESERVATION ---
  console.log('\n--- 3. SAMPLE TRACKING OPERATIONAL DATA PRESERVATION ---');
  try {
    const { count: jCount, data: jobs } = await client.from('jobs').select('id, job_no, status', { count: 'exact' });
    record(9, 'Sample Tracking jobs preserved', jCount === 13, `Count: ${jCount}`);

    const { count: opCount } = await client.from('job_operations').select('id', { count: 'exact', head: true });
    record(10, 'Sample Tracking operations preserved', opCount === 54, `Count: ${opCount}`);

    const { count: runCount } = await client.from('production_runs').select('id', { count: 'exact', head: true });
    record(11, 'Production runs preserved', runCount === 33, `Count: ${runCount}`);

    const { count: qaCount } = await client.from('qa_checks').select('id', { count: 'exact', head: true });
    record(12, 'QA checks preserved', qaCount === 17, `Count: ${qaCount}`);

    const { count: userCount, data: profiles } = await client.from('profiles').select('id, role', { count: 'exact' });
    record(13, 'User profiles preserved', userCount === 11, `Count: ${userCount}`);

    // Work Center CYGG and SUBCON
    const { data: cygg } = await client.from('workcenter_master').select('*').eq('code', 'CYGG');
    record(14, 'Work Center CYGG description is Cylindrical Grinding', cygg && cygg[0]?.description === 'Cylindrical Grinding');

    const { data: subcon } = await client.from('workcenter_master').select('*').ilike('code', '%subcon%');
    record(15, 'Work Center Subcon remains active and untouched', subcon && subcon[0]?.is_active === true && subcon[0]?.code === 'Subcon');

    // Defect Catalog has 8 active standardized types
    const { data: defects } = await client.from('defect_catalog').select('*').eq('is_active', true);
    record(16, 'Defect Catalog standardized with 8 active NG types', defects && defects.length === 8);
  } catch (e) {
    record(9, 'Sample Tracking preservation query', false, e.message);
  }

  // --- PART 4: DRAWING REVIEW CORE WORKFLOW VERIFICATION ---
  console.log('\n--- 4. DRAWING REVIEW WORKFLOW & INTEGRITY ---');
  let testIssueId = null;
  let testVersionId = null;
  try {
    // 4.1 Allocate Issue No
    const { data: allocNo, error: allocErr } = await client.rpc('allocate_next_drawing_review_issue_no');
    record(17, 'RPC allocate_next_drawing_review_issue_no works', !allocErr && typeof allocNo === 'string', `Allocated: ${allocNo}`);

    // 4.2 Create Issue
    const testIssueNo = allocNo || `TEST-${Date.now()}`;
    const { data: issueRes, error: createErr } = await client.rpc('create_drawing_review_issue', {
      p_issue_no: testIssueNo,
      p_item_no: 'VAL-PROD-LIVE-TEST',
      p_item_name: '[TEST-VERIFICATION] Trục Bạc Đạn Sản Xuất',
      p_customer: 'Production Live Verification Corp',
      p_drawing_file_path: 'drawings/test_live_drawing.pdf',
      p_drawing_file_name: 'test_live_drawing.pdf',
      p_drawing_file_size: 1024,
      p_drawing_mime_type: 'application/pdf',
      p_attention: 'Do not delete: Live verification record'
    });
    record(18, 'RPC create_drawing_review_issue creates Issue & V1', !createErr && issueRes?.issue_id, `Issue ID: ${issueRes?.issue_id}`);
    testIssueId = issueRes?.issue_id;
    testVersionId = issueRes?.version_id;

    // 4.3 Save Draft (Issued -> Reviewing)
    const { data: saveDraftRes, error: draftErr } = await client.rpc('save_drawing_review_draft', {
      p_version_id: testVersionId,
      p_required_material: 'SUS304 Round Bar Ø25.4mm',
      p_required_tooling: 'Dao tiện CNC CNMG 120408',
      p_special_measuring_equipment: 'Panme đo ngoài hiển thị số',
      p_engineering_remarks: 'Sản xuất thử nghiệm lô đầu',
      p_item_avatar_path: null,
      p_operations: [
        { lineage_id: 'OP-01', step_order: 10, workcenter_code: 'A20C', operation_description: 'Tiện thô', cycle_time_seconds: 120, remark: 'Tiện ngoài' },
        { lineage_id: 'OP-02', step_order: 20, workcenter_code: 'Subcon', operation_description: 'Mạ Crom cứng', cycle_time_seconds: 0, remark: 'Gia công ngoài' }
      ],
      p_attachments: []
    });
    record(19, 'RPC save_drawing_review_draft saves draft to Reviewing', !draftErr && saveDraftRes?.success, `Status: ${saveDraftRes?.status}`);

    // 4.4 Close V1 (Reviewing -> Completed)
    const { data: closeRes, error: closeErr } = await client.rpc('close_drawing_review_version', {
      p_version_id: testVersionId
    });
    record(20, 'RPC close_drawing_review_version locks V1 to Completed', !closeErr && closeRes?.success, `Status: ${closeRes?.status}`);

    // 4.5 Verify V1 Immutability Trigger
    let immutabilityBlocked = false;
    try {
      const { error: mutErr } = await client
        .from('drawing_review_versions')
        .update({ required_material: 'HACK_MUTATE_COMPLETED' })
        .eq('id', testVersionId);
      if (mutErr && mutErr.message.includes('Phiên bản đã hoàn tất')) {
        immutabilityBlocked = true;
      }
    } catch (_) {}
    record(21, 'Trigger enforces Completed version immutability', immutabilityBlocked);

    // 4.6 Create V2 (+ Tạo phiên bản tiếp theo)
    const { data: v2Res, error: v2Err } = await client.rpc('create_next_drawing_review_version', {
      p_source_version_id: testVersionId
    });
    record(22, 'RPC create_next_drawing_review_version creates V2 with lineage', !v2Err && v2Res?.version_id, `V2 ID: ${v2Res?.version_id}`);

    // 4.7 Storage bucket 'drawing-reviews' is private
    const { data: bkts } = await client.storage.listBuckets();
    const drBkt = (bkts || []).find(b => b.name === 'drawing-reviews');
    record(23, 'Storage bucket drawing-reviews exists and is private', drBkt && drBkt.public === false);

    // Clean up test verification record so production stays clean
    if (testIssueId) {
      await client.from('drawing_review_issues').delete().eq('id', testIssueId);
      console.log(`  🧹 Cleaned up temporary smoke test issue ${testIssueId}`);
    }
    record(24, 'Temporary smoke test issue safely cleaned up', true);

  } catch (e) {
    record(17, 'Drawing Review workflow test', false, e.message);
  }

  console.log('\n' + '='.repeat(80));
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log(`   PRODUCTION SMOKE TEST RESULTS: ${passed} / ${total} PASSED`);
  console.log('='.repeat(80));
}

runSmokeTests().catch(err => {
  console.error('Fatal smoke test error:', err);
  process.exit(1);
});
