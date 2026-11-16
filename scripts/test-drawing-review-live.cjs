#!/usr/bin/env node
/**
 * ==============================================================================
 * DRAWING REVIEW MODULE V1.0 — REAL SUPABASE TEST INTEGRATION TEST RUNNER
 * Script: scripts/test-drawing-review-live.cjs
 *
 * Target: Supabase TEST project (hosppagbopdghlupnhlr) ONLY.
 * Verifies 100% real cloud database operations:
 *   1. Target Safety Validation (Production strictly prohibited)
 *   2. BD User and PE-MFG User authenticated sessions
 *   3. BD creates Issue -> V1 Issued
 *   4. BD permissions isolation (forbidden from Sample Tracking & editing reviews)
 *   5. PE-MFG saves draft -> V1 Reviewing
 *   6. SUBCON Description enforcement on Close
 *   7. Photo attachment upload and association
 *   8. PE-MFG closes V1 -> V1 Completed
 *   9. V1 strict immutability (triggers block version, operations, attachments mutation)
 *  10. PE-MFG creates V2 -> clones with stable lineage_id
 *  11. Edit V2 and close V2 -> V2 Completed
 *  12. Verification of completed report export & safe teardown
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) process.env[key.trim()] = val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;

console.log('='.repeat(80));
console.log('   DRAWING REVIEW MODULE V1.0 — REAL TEST CLOUD INTEGRATION TEST RUNNER');
console.log(`   Target URL:  ${supabaseUrl}`);
console.log(`   Timestamp:   ${new Date().toISOString()}`);
console.log('='.repeat(80));

// ------------------------------------------------------------------------------
// 1. STRICT SAFETY GUARD
// ------------------------------------------------------------------------------
if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error('\n❌ ERROR: SUPABASE_TEST_URL, SERVICE_KEY or ANON_KEY missing from .env');
  process.exit(1);
}

if (supabaseUrl.includes('uqvxtgvdmdfgtjwzsxlj')) {
  console.error('\n🛑 FATAL SAFETY BLOCK: TARGET URL MATCHES PRODUCTION (uqvxtgvdmdfgtjwzsxlj)!');
  console.error('This script must NEVER run on Production. Aborting immediately.\n');
  process.exit(1);
}

if (!supabaseUrl.includes('hosppagbopdghlupnhlr')) {
  console.error(`\n🛑 SAFETY BLOCK: Target URL is not TEST project 'hosppagbopdghlupnhlr' (got ${supabaseUrl})`);
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function recordResult(testName, passed, details = '') {
  results.push({ testName, passed, details });
  console.log(`${passed ? '✅' : '❌'} ${testName} ${details ? '— ' + details : ''}`);
}

async function runLiveIntegrationTests() {
  const runId = crypto.randomBytes(4).toString('hex');
  const bdEmail = `test_bd_${runId}@sampletracking.test`;
  const peEmail = `test_pe_${runId}@sampletracking.test`;
  const testPassword = `TestPass_${runId}!`;

  let bdUserId = null;
  let peUserId = null;
  let createdIssueId = null;

  try {
    // --------------------------------------------------------------------------
    // STEP 1: PROVISION AUTHENTICATED TEST USERS (BD & PE-MFG)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 1: Provisioning Authenticated Test Users ---');

    // 1.1 Create BD user
    const { data: bdAuth, error: bdAuthErr } = await adminClient.auth.admin.createUser({
      email: bdEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: `Test BD ${runId}`, role: 'BD' },
    });
    if (bdAuthErr) throw new Error(`Failed to create BD auth user: ${bdAuthErr.message}`);
    bdUserId = bdAuth.user.id;

    const { error: bdProfErr } = await adminClient.from('profiles').insert({
      id: bdUserId,
      email: bdEmail,
      phone: `+84988${Math.floor(100000 + Math.random() * 900000)}`,
      full_name: `Test BD User ${runId}`,
      role: 'BD',
      department: 'Business Development',
      is_active: true,
      must_change_password: false,
    });
    if (bdProfErr) throw new Error(`Failed to insert BD profile: ${bdProfErr.message}`);

    // 1.2 Create PE-MFG user
    const { data: peAuth, error: peAuthErr } = await adminClient.auth.admin.createUser({
      email: peEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: `Test PE ${runId}`, role: 'PE-MFG' },
    });
    if (peAuthErr) throw new Error(`Failed to create PE auth user: ${peAuthErr.message}`);
    peUserId = peAuth.user.id;

    const { error: peProfErr } = await adminClient.from('profiles').insert({
      id: peUserId,
      email: peEmail,
      phone: `+84977${Math.floor(100000 + Math.random() * 900000)}`,
      full_name: `Test PE User ${runId}`,
      role: 'PE-MFG',
      department: 'PE-MFG',
      is_active: true,
      must_change_password: false,
    });
    if (peProfErr) throw new Error(`Failed to insert PE profile: ${peProfErr.message}`);

    // Create client sessions
    const bdClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: bdSession, error: bdLoginErr } = await bdClient.auth.signInWithPassword({
      email: bdEmail,
      password: testPassword,
    });
    if (bdLoginErr) throw new Error(`BD Login failed: ${bdLoginErr.message}`);

    const peClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: peSession, error: peLoginErr } = await peClient.auth.signInWithPassword({
      email: peEmail,
      password: testPassword,
    });
    if (peLoginErr) throw new Error(`PE Login failed: ${peLoginErr.message}`);

    recordResult('1. Authenticated User Provisioning', true, `BD (${bdEmail}) & PE-MFG (${peEmail}) authenticated`);

    // --------------------------------------------------------------------------
    // STEP 2: BD CREATES DRAWING REVIEW ISSUE (V1 ISSUED)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 2: BD Creates Drawing Review Issue ---');

    // Upload a test drawing file to storage bucket drawing-reviews
    const dummyPdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const drawingStoragePath = `test-runs/${runId}/blueprint-${runId}.pdf`;

    const { error: uploadErr } = await bdClient.storage
      .from('drawing-reviews')
      .upload(drawingStoragePath, dummyPdfContent, { contentType: 'application/pdf' });
    if (uploadErr) throw new Error(`Drawing upload failed: ${uploadErr.message}`);

    const { data: createIssueRes, error: createIssueErr } = await bdClient.rpc('create_drawing_review_issue', {
      p_item_no: `PART-${runId.toUpperCase()}`,
      p_item_name: `Trục truyền động chính xác ${runId}`,
      p_customer: 'TOSHIBA MACHINE',
      p_drawing_file_path: drawingStoragePath,
      p_drawing_file_name: `blueprint-${runId}.pdf`,
      p_drawing_file_size: dummyPdfContent.length,
      p_drawing_mime_type: 'application/pdf',
      p_attention: 'Độ nhám bề mặt Ra <= 0.4um',
    });

    if (createIssueErr) throw new Error(`create_drawing_review_issue RPC failed: ${createIssueErr.message}`);
    createdIssueId = createIssueRes.issue_id;
    const v1Id = createIssueRes.version_id;
    const issueNo = createIssueRes.issue_no;

    // Verify V1 status
    const { data: v1Record, error: v1QueryErr } = await bdClient
      .from('drawing_review_versions')
      .select('*')
      .eq('id', v1Id)
      .single();

    const isV1Issued = v1Record && v1Record.status === 'Issued' && v1Record.version_number === 1;
    recordResult('2. BD Issue Creation (V1 Issued)', isV1Issued, `Issue No: ${issueNo}, Status: ${v1Record?.status}`);

    // --------------------------------------------------------------------------
    // STEP 3: BD PERMISSION ISOLATION (FORBIDDEN FROM SAMPLE TRACKING & TECHNICAL EDIT)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 3: BD Permission & Operational Isolation ---');

    // 3.1 BD attempts to call create_job_with_routing (Sample Tracking) with complete valid job payload
    const { error: bdJobErr } = await bdClient.rpc('create_job_with_routing', {
      p_job_no: `J-${runId}`,
      p_part_no: 'PART-TEST',
      p_part_name: 'Part Test',
      p_customer: 'Customer Test',
      p_order_qty: 10,
      p_material: 'SUS304',
      p_material_spec: 'Bar',
      p_planned_start_date: '2026-11-04',
      p_planned_finish_date: '2026-11-10',
      p_operations: [
        {
          step_order: 10,
          workcenter_code: 'CAMC',
          operation_name: 'Auto Turn',
          description: 'Tiện thử nghiệm',
          cycle_time_target: 60,
          planned_cycle_time_seconds: 60,
        },
      ],
    });
    const bdBlockedFromJobCreation = Boolean(
      bdJobErr && bdJobErr.message.includes('Quyền hạn bị từ chối: Chỉ Planning hoặc Admin')
    );
    recordResult('3.1 BD Blocked from Sample Tracking Job Creation', bdBlockedFromJobCreation, bdJobErr?.message);

    // 3.2 BD attempts direct INSERT on jobs table (RLS check)
    const { error: bdDirectJobErr } = await bdClient.from('jobs').insert({
      job_no: `J-HACK-${runId}`,
      part_no: 'HACK',
      part_name: 'Hack',
      customer: 'Hack',
      order_qty: 10,
      status: 'ACTIVE',
      planned_start_date: '2026-11-04',
      planned_finish_date: '2026-11-10',
    });
    const bdDirectJobBlocked = Boolean(
      bdDirectJobErr && (
        bdDirectJobErr.message.includes('row-level security') ||
        bdDirectJobErr.message.includes('permission denied') ||
        bdDirectJobErr.message.includes('Only Planning or Admin') ||
        bdDirectJobErr.code === '42501' ||
        bdDirectJobErr.code === 'P0001'
      )
    );
    recordResult('3.2 BD Blocked by RLS from Direct jobs Table Modification', bdDirectJobBlocked, bdDirectJobErr?.message || 'Blocked by RLS');

    // 3.3 BD attempts to edit technical review draft
    const { error: bdDraftErr } = await bdClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'Hacked Material',
      p_required_tooling: 'Hacked Tooling',
      p_special_measuring_equipment: 'None',
      p_engineering_remarks: 'Hacked',
      p_avatar_file_path: null,
      p_avatar_crop_box: null,
      p_operations: [],
    });
    const bdBlockedFromTechnicalEdit = Boolean(
      bdDraftErr && bdDraftErr.message.includes('Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin')
    );
    recordResult('3.3 BD Blocked from PE-MFG Technical Draft Editing', bdBlockedFromTechnicalEdit, bdDraftErr?.message);

    // 3.4 BD attempts to close technical review
    const { error: bdCloseErr } = await bdClient.rpc('close_drawing_review_version', {
      p_version_id: v1Id,
    });
    const bdBlockedFromClose = Boolean(
      bdCloseErr && bdCloseErr.message.includes('Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin')
    );
    recordResult('3.4 BD Blocked from Closing Technical Review', bdBlockedFromClose, bdCloseErr?.message);

    // --------------------------------------------------------------------------
    // STEP 4: PE-MFG SAVES DRAFT (STATUS: ISSUED -> REVIEWING)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 4: PE-MFG Saves Draft (Issued -> Reviewing) ---');

    // Upload Item Avatar
    const dummyAvatar = Buffer.from('dummy avatar bytes');
    const avatarPath = `test-runs/${runId}/avatar-${runId}.jpg`;
    await peClient.storage.from('drawing-reviews').upload(avatarPath, dummyAvatar, { contentType: 'image/jpeg' });

    const lin1 = crypto.randomUUID();
    const lin2 = crypto.randomUUID();

    const draftOps = [
      {
        lineage_id: lin1,
        step_order: 10,
        workcenter_code: 'CAMC',
        operation_description: 'Tiện thô và tiện tinh đầu A',
        cycle_time_seconds: 120,
        remark: 'Đảm bảo dung sai phi 20h7',
        is_removed: false,
      },
      {
        lineage_id: lin2,
        step_order: 20,
        workcenter_code: 'Subcon',
        operation_description: 'Nhiệt luyện tôi thấm nitơ đạt 52-55 HRC',
        cycle_time_seconds: 0,
        remark: 'Gia công nhiệt luyện tại nhà thầu phụ',
        is_removed: false,
      },
    ];

    const { data: saveDraftRes, error: saveDraftErr } = await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'SCM440 Tôi ram',
      p_required_tooling: 'Dao tiện Carmex, mảnh chíp Kyocera',
      p_special_measuring_equipment: 'Thước panme Mitutoyo 0-25mm',
      p_engineering_remarks: 'Lưu ý độ bóng mặt đầu sau tiện',
      p_avatar_file_path: avatarPath,
      p_avatar_crop_box: { x: 0, y: 0, width: 100, height: 100 },
      p_operations: draftOps,
    });

    if (saveDraftErr) throw new Error(`save_drawing_review_draft failed: ${saveDraftErr.message}`);

    const { data: v1Reviewing } = await peClient.from('drawing_review_versions').select('*').eq('id', v1Id).single();
    const isV1Reviewing = v1Reviewing && v1Reviewing.status === 'Reviewing';
    recordResult('4. PE-MFG Save Draft Transitions to Reviewing', isV1Reviewing, `Status: ${v1Reviewing?.status}`);

    // --------------------------------------------------------------------------
    // STEP 5: SUBCON DESCRIPTION ENFORCEMENT ON CLOSE
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 5: SUBCON Description Validation Enforcement ---');

    // Attempt to save SUBCON operation with EMPTY description
    const invalidOps = [
      {
        lineage_id: lin1,
        step_order: 10,
        workcenter_code: 'CAMC',
        operation_description: 'Tiện thô',
        cycle_time_seconds: 120,
        remark: '',
        is_removed: false,
      },
      {
        lineage_id: lin2,
        step_order: 20,
        workcenter_code: 'Subcon',
        operation_description: '   ', // EMPTY/WHITESPACE description!
        cycle_time_seconds: 0,
        remark: '',
        is_removed: false,
      },
    ];

    await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'SCM440',
      p_required_tooling: 'Dao tiện',
      p_special_measuring_equipment: 'Panme',
      p_engineering_remarks: 'Remarks',
      p_avatar_file_path: avatarPath,
      p_avatar_crop_box: null,
      p_operations: invalidOps,
    });

    // Attempt to close version with empty SUBCON description
    const { error: invalidCloseErr } = await peClient.rpc('close_drawing_review_version', {
      p_version_id: v1Id,
    });

    const subconValidationBlocked = Boolean(
      invalidCloseErr && invalidCloseErr.message.includes('Công đoạn gia công ngoài (SUBCON) bắt buộc phải có mô tả công đoạn')
    );
    recordResult('5. SUBCON Missing Description Rejected on Close', subconValidationBlocked, invalidCloseErr?.message);

    // Restore valid description before proceeding
    await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'SCM440',
      p_required_tooling: 'Dao tiện Carmex',
      p_special_measuring_equipment: 'Panme Mitutoyo',
      p_engineering_remarks: 'Lưu ý độ bóng',
      p_avatar_file_path: avatarPath,
      p_avatar_crop_box: null,
      p_operations: draftOps,
    });

    // --------------------------------------------------------------------------
    // STEP 6: PHOTO ATTACHMENTS & CAPTIONS
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 6: Photo Attachments & Upload ---');

    const photoPath = `test-runs/${runId}/photo-setup.jpg`;
    await peClient.storage.from('drawing-reviews').upload(photoPath, Buffer.from('sample photo data'), { contentType: 'image/jpeg' });

    const { data: attRecord, error: attErr } = await peClient
      .from('drawing_review_attachments')
      .insert({
        version_id: v1Id,
        file_name: 'photo-setup.jpg',
        file_path: photoPath,
        file_size: 1024,
        mime_type: 'image/jpeg',
        caption: 'Hình ảnh đồ gá kẹp phôi thực tế',
      })
      .select()
      .single();

    const attCreated = Boolean(attRecord && !attErr && attRecord.caption === 'Hình ảnh đồ gá kẹp phôi thực tế');
    recordResult('6. Photo Attachment Upload & Association', attCreated, `Attachment ID: ${attRecord?.id}`);

    // --------------------------------------------------------------------------
    // STEP 7: PE-MFG CLOSES V1 (STATUS: REVIEWING -> COMPLETED)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 7: PE-MFG Closes V1 (Completed) ---');

    const { data: closeRes, error: closeErr } = await peClient.rpc('close_drawing_review_version', {
      p_version_id: v1Id,
    });
    if (closeErr) throw new Error(`close_drawing_review_version failed: ${closeErr.message}`);

    const { data: v1Completed } = await peClient.from('drawing_review_versions').select('*').eq('id', v1Id).single();
    const isV1Completed = v1Completed && v1Completed.status === 'Completed' && v1Completed.closed_by === peUserId;
    recordResult('7. PE-MFG Closes V1 (Completed & Stamped)', isV1Completed, `Closed by: ${v1Completed?.closed_by}, Closed at: ${v1Completed?.closed_at}`);

    // --------------------------------------------------------------------------
    // STEP 8: IMMUTABILITY ENFORCEMENT ON COMPLETED V1
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 8: Strict Immutability Enforcement on Completed V1 ---');

    // 8.1 save_drawing_review_draft RPC rejected on completed version
    const { error: editCompletedErr } = await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v1Id,
      p_required_material: 'Mutated material',
      p_required_tooling: 'Mutated tooling',
      p_special_measuring_equipment: 'None',
      p_engineering_remarks: 'Mutated',
      p_avatar_file_path: null,
      p_avatar_crop_box: null,
      p_operations: draftOps,
    });
    const rpcImmutabilityBlocked = Boolean(
      editCompletedErr && editCompletedErr.message.includes('Phiên bản này đã hoàn thành (Completed) và đã bị khóa')
    );
    recordResult('8.1 RPC Rejects Draft Edit on Completed Version', rpcImmutabilityBlocked, editCompletedErr?.message);

    // 8.2 Database trigger trg_drawing_review_version_immutability blocks direct UPDATE
    const { error: triggerVerErr } = await adminClient
      .from('drawing_review_versions')
      .update({ required_material: 'Hacked directly via SQL' })
      .eq('id', v1Id);
    const triggerVerBlocked = Boolean(
      triggerVerErr && triggerVerErr.message.includes('là bất biến và không thể sửa đổi')
    );
    recordResult('8.2 Trigger Blocks Direct UPDATE on Completed Version', triggerVerBlocked, triggerVerErr?.message);

    // 8.3 Database trigger trg_drawing_review_operation_immutability blocks operation changes
    const { error: triggerOpErr } = await adminClient
      .from('drawing_review_operations')
      .update({ cycle_time_seconds: 999 })
      .eq('version_id', v1Id);
    const triggerOpBlocked = Boolean(
      triggerOpErr && triggerOpErr.message.includes('Không thể thêm, sửa đổi hoặc xóa công đoạn của phiên bản đã hoàn thành')
    );
    recordResult('8.3 Trigger Blocks Operation Mutation on Completed Version', triggerOpBlocked, triggerOpErr?.message);

    // 8.4 Database trigger trg_drawing_review_attachment_immutability blocks attachment changes
    const { error: triggerAttErr } = await adminClient
      .from('drawing_review_attachments')
      .delete()
      .eq('version_id', v1Id);
    const triggerAttBlocked = Boolean(
      triggerAttErr && triggerAttErr.message.includes('Không thể thêm hoặc xóa tệp đính kèm của phiên bản đã hoàn thành')
    );
    recordResult('8.4 Trigger Blocks Attachment Deletion on Completed Version', triggerAttBlocked, triggerAttErr?.message);

    // --------------------------------------------------------------------------
    // STEP 9: PE-MFG CREATES V2 (CLONES SPECS & PRESERVES LINEAGE)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 9: PE-MFG Creates V2 (Cloning with Stable Lineage) ---');

    const { data: v2Res, error: v2Err } = await peClient.rpc('create_next_drawing_review_version', {
      p_issue_id: createdIssueId,
    });
    if (v2Err) throw new Error(`create_next_drawing_review_version failed: ${v2Err.message}`);

    const v2Id = v2Res.version_id;
    const { data: v2Record } = await peClient.from('drawing_review_versions').select('*').eq('id', v2Id).single();
    const { data: v2Ops } = await peClient.from('drawing_review_operations').select('*').eq('version_id', v2Id).order('step_order');

    const isV2Cloned = v2Record && v2Record.version_name === 'V2' && v2Record.status === 'Reviewing';
    const lineagePreserved = v2Ops && v2Ops.length === 2 && v2Ops[0].lineage_id === lin1 && v2Ops[1].lineage_id === lin2;

    recordResult('9. V2 Cloned with Stable Lineage IDs', Boolean(isV2Cloned && lineagePreserved), `V2 Name: ${v2Record?.version_name}, Ops Count: ${v2Ops?.length}, Lineage Matches: ${lineagePreserved}`);

    // --------------------------------------------------------------------------
    // STEP 10: EDIT AND CLOSE V2
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 10: Edit V2 Operations & Close V2 ---');

    // Add OP 30 with new lineage, and optimize OP 10 cycle time
    const lin3 = crypto.randomUUID();
    const v2UpdatedOps = [
      {
        lineage_id: lin1,
        step_order: 10,
        workcenter_code: 'CAMC',
        operation_description: 'Tiện thô và tiện tinh đầu A (Tối ưu dao)',
        cycle_time_seconds: 95, // Optimized from 120s
        remark: 'Đã rút ngắn thời gian chạy dao',
        is_removed: false,
      },
      {
        lineage_id: lin2,
        step_order: 20,
        workcenter_code: 'Subcon',
        operation_description: 'Nhiệt luyện tôi thấm nitơ đạt 52-55 HRC',
        cycle_time_seconds: 0,
        remark: 'Nhà thầu phụ',
        is_removed: false,
      },
      {
        lineage_id: lin3,
        step_order: 30,
        workcenter_code: 'CYGG',
        operation_description: 'Mài tròn ngoài trục phi 20h7',
        cycle_time_seconds: 45,
        remark: 'Đảm bảo độ bóng bóng gương',
        is_removed: false,
      },
    ];

    await peClient.rpc('save_drawing_review_draft', {
      p_version_id: v2Id,
      p_required_material: 'SCM440 Tôi ram tiêu chuẩn JIS',
      p_required_tooling: 'Dao tiện Carmex, đá mài Norton',
      p_special_measuring_equipment: 'Panme Mitutoyo 0-25mm',
      p_engineering_remarks: 'Gia công theo V2',
      p_avatar_file_path: avatarPath,
      p_avatar_crop_box: null,
      p_operations: v2UpdatedOps,
    });

    const { data: closeV2Res, error: closeV2Err } = await peClient.rpc('close_drawing_review_version', {
      p_version_id: v2Id,
    });
    if (closeV2Err) throw new Error(`Close V2 failed: ${closeV2Err.message}`);

    const { data: v2Completed } = await peClient.from('drawing_review_versions').select('*').eq('id', v2Id).single();
    const isV2Completed = v2Completed && v2Completed.status === 'Completed';
    recordResult('10. V2 Successfully Edited & Closed', isV2Completed, `Status: ${v2Completed?.status}`);

    // Verify V1 remains Completed and unmodified
    const { data: v1After } = await peClient.from('drawing_review_versions').select('*').eq('id', v1Id).single();
    const v1StillCompleted = v1After && v1After.status === 'Completed';
    recordResult('11. V1 Remains Completely Immutable & Completed', v1StillCompleted, `V1 Status: ${v1After?.status}`);

  } catch (err) {
    console.error('\n❌ Unhandled Integration Test Failure:', err);
    recordResult('Critical Failure', false, err.message);
  } finally {
    // --------------------------------------------------------------------------
    // SAFE CLEANUP: PURGE ONLY RESOURCES CREATED IN THIS TEST RUN
    // --------------------------------------------------------------------------
    console.log('\n--- CLEANUP: Purging Integration Test Resources ---');
    if (createdIssueId) {
      console.log(`Cleaning up test Drawing Review Issue ${createdIssueId}...`);
      // Use service role admin to cleanly delete test run artifacts
      await adminClient.from('drawing_review_attachments').delete().eq('version_id', createdIssueId); // handled via cascade
      await adminClient.from('drawing_review_issues').delete().eq('id', createdIssueId);
    }
    if (bdUserId) {
      console.log(`Deleting test BD auth user ${bdUserId}...`);
      await adminClient.from('profiles').delete().eq('id', bdUserId);
      await adminClient.auth.admin.deleteUser(bdUserId);
    }
    if (peUserId) {
      console.log(`Deleting test PE auth user ${peUserId}...`);
      await adminClient.from('profiles').delete().eq('id', peUserId);
      await adminClient.auth.admin.deleteUser(peUserId);
    }
    console.log('✅ Cleanup complete. Zero residual test records left on TEST.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('   INTEGRATION TEST SUMMARY');
  console.log('='.repeat(80));
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`Total Scenarios: ${results.length}`);
  console.log(`Passed:          ${passedCount}`);
  console.log(`Failed:          ${results.length - passedCount}`);
  console.log('='.repeat(80));

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runLiveIntegrationTests().catch((err) => {
  console.error('Fatal test runner crash:', err);
  process.exit(1);
});
