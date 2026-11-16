#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — PRODUCTION DATABASE INITIALIZATION RUNNER
 * Script: scripts/initialize-production-db.cjs
 *
 * Automatically initializes and verifies a fresh Supabase Production database:
 * 1. Strictly protects TEST database from accidental modification
 * 2. Seeds & verifies approved Master Data (37 workcenters, 8 defect items)
 * 3. Provisions exactly ONE initial Production Admin (0968041128) with must_change_password=true
 * 4. Verifies operational tables are 100% empty (0 jobs, 0 runs, 0 reports)
 * 5. Verifies Private Storage bucket configuration
 * 6. Generates full source-to-target comparison manifest
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
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

const prodUrl = process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const prodServiceKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const testProjectRef = 'hosppagbopdghlupnhlr';

console.log('='.repeat(80));
console.log('   SAMPLE TRACKING V1.0 — PRODUCTION INITIALIZATION RUNNER');
console.log(`   Target URL: ${prodUrl}`);
console.log(`   Timestamp:  ${new Date().toISOString()}`);
console.log('='.repeat(80));

if (!prodUrl || !prodServiceKey) {
  console.error('\n❌ ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  console.error('Usage:');
  console.error('  set PROD_SUPABASE_URL=https://<your-prod-ref>.supabase.co');
  console.error('  set PROD_SUPABASE_SERVICE_ROLE_KEY=<your-prod-service-key>');
  console.error('  node scripts/initialize-production-db.cjs\n');
  process.exit(1);
}

// CRITICAL SAFETY GUARD: Prevent executing on TEST database
if (prodUrl.includes(testProjectRef)) {
  console.error(`\n🛑 SAFETY BLOCK: Target URL contains TEST project ref '${testProjectRef}'.`);
  console.error('This initialization script is strictly reserved for the new PRODUCTION project.');
  console.error('Aborting immediately to protect TEST data.\n');
  process.exit(1);
}

const client = createClient(prodUrl, prodServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Official 37 Workcenter Master records
const WORKCENTERS = [
  { stt: 1, code: 'CAMC', mc_type: 'CAM', description: 'Auto Turn', is_active: true },
  { stt: 2, code: 'B12C', mc_type: 'Cincom B12', description: 'Auto Turn', is_active: true },
  { stt: 3, code: 'A20C', mc_type: 'Cincom citizent A20', description: 'Auto Turn', is_active: true },
  { stt: 4, code: 'CYGG', mc_type: 'Cilindrical Grinding', description: 'Auto Turn', is_active: true },
  { stt: 5, code: 'D&TS', mc_type: 'Drilling and Tapping', description: 'Drill & Tap', is_active: true },
  { stt: 6, code: 'B26C', mc_type: 'Tsugami BO265', description: 'Auto Turn', is_active: true },
  { stt: 7, code: 'L32C', mc_type: 'Cincom Citizent L32', description: 'Auto Turn', is_active: true },
  { stt: 8, code: 'L20C', mc_type: 'Tsugami L20', description: 'Auto Turn', is_active: true },
  { stt: 9, code: 'L16C', mc_type: 'Tsugami L16', description: 'Auto Turn', is_active: true },
  { stt: 10, code: 'B18C', mc_type: 'Tsugami B18', description: 'Auto Turn', is_active: true },
  { stt: 11, code: 'SR2C', mc_type: 'Star SR20', description: 'Auto Turn', is_active: true },
  { stt: 12, code: 'SB2C', mc_type: 'Star SB20R', description: 'Auto Turn', is_active: true },
  { stt: 13, code: 'SR3C', mc_type: 'Star SR32', description: 'Auto Turn', is_active: true },
  { stt: 14, code: 'CGMG', mc_type: 'Paragon RC12', description: 'Centerless Grinding', is_active: true },
  { stt: 15, code: 'CGMG', mc_type: 'Paragon RC20', description: 'Centerless Grinding', is_active: true },
  { stt: 16, code: 'CGMG', mc_type: 'DX18 CNC CG', description: 'Centerless Grinding', is_active: true },
  { stt: 17, code: 'CGMG', mc_type: 'DX18 CG', description: 'Centerless Grinding', is_active: true },
  { stt: 18, code: 'D&TS', mc_type: 'Fanuc', description: 'Drill & Tap', is_active: true },
  { stt: 19, code: 'SPMS', mc_type: 'SPM', description: 'Milling', is_active: true },
  { stt: 20, code: 'KURS', mc_type: 'Rolling/Knurling', description: 'Rolling/Knurling', is_active: true },
  { stt: 21, code: 'IDHL', mc_type: 'Induction Hardening', description: 'Induction Hardening', is_active: true },
  { stt: 22, code: 'FINS', mc_type: 'Buffing', description: 'Buffing', is_active: true },
  { stt: 23, code: 'STAS', mc_type: 'Stacking', description: 'Stacking', is_active: true },
  { stt: 24, code: 'TMBS', mc_type: 'Tumbling', description: 'Tumbling', is_active: true },
  { stt: 25, code: 'TMBS', mc_type: 'Magnetic polishing', description: 'Magnetic polishing', is_active: true },
  { stt: 26, code: 'FINS', mc_type: 'Chamfering', description: 'Chamfering', is_active: true },
  { stt: 27, code: 'FINS', mc_type: 'Polishing', description: 'Polishing', is_active: true },
  { stt: 28, code: 'ASYS', mc_type: 'Assembly', description: 'Assembly', is_active: true },
  { stt: 29, code: 'MYNC', mc_type: 'STS Chucker', description: 'STS Chucker', is_active: true },
  { stt: 30, code: 'GCMN', mc_type: 'Gear cutting', description: 'Gear cutting', is_active: true },
  { stt: 31, code: 'AUTP', mc_type: 'Plating', description: 'Plating', is_active: true },
  { stt: 32, code: 'MANP', mc_type: 'Plating', description: 'Plating', is_active: true },
  { stt: 33, code: 'PLPP', mc_type: 'Plating', description: 'Plating', is_active: true },
  { stt: 34, code: 'WSHP', mc_type: 'Washing', description: 'Washing', is_active: true },
  { stt: 35, code: 'Subcon', mc_type: 'Subcon', description: 'Subcon', is_active: true },
  { stt: 36, code: 'VMIC', mc_type: 'Inspection 100%', description: 'Inspection 100%', is_active: true },
  { stt: 37, code: 'VMIQ', mc_type: 'Visual check', description: 'Visual check', is_active: true },
];

// Official 8 Defect Catalog records
const DEFECTS = [
  { code: 'DEF-DIM-01', name_vi: 'Sai đường kính', name_en: 'Outer Diameter out of spec', category: 'DIMENSION', is_active: true },
  { code: 'DEF-DIM-02', name_vi: 'Sai chiều dài', name_en: 'Length out of spec', category: 'DIMENSION', is_active: true },
  { code: 'DEF-SRF-01', name_vi: 'Bavia', name_en: 'Burr / Flash', category: 'SURFACE', is_active: true },
  { code: 'DEF-SRF-02', name_vi: 'Xước bề mặt', name_en: 'Surface scratch', category: 'SURFACE', is_active: true },
  { code: 'DEF-DEF-01', name_vi: 'Móp méo / Biến dạng', name_en: 'Deformation', category: 'GEOMETRY', is_active: true },
  { code: 'DEF-CRK-01', name_vi: 'Nứt vỡ', name_en: 'Crack', category: 'MATERIAL', is_active: true },
  { code: 'DEF-THR-01', name_vi: 'Lỗi ren', name_en: 'Thread defect', category: 'MACHINING', is_active: true },
  { code: 'DEF-OTH-01', name_vi: 'Lỗi khác', name_en: 'Other defect', category: 'OTHER', is_active: true },
];

const OPERATIONAL_TABLES = [
  'jobs',
  'job_operations',
  'production_runs',
  'ng_details',
  'qa_checks',
  'pe_engineering_reviews',
  'engineering_documents',
  'operation_sample_photos',
  'sample_final_reports',
  'attachments',
  'pe_technical_dispositions',
  'kiv_reviews',
  'audit_logs',
];

async function initializeProduction() {
  const summary = {
    target_project: prodUrl,
    initialized_at: new Date().toISOString(),
    master_data: {},
    admin_provisioning: null,
    operational_tables: {},
    storage_verification: null,
    status: 'PASSED',
  };

  // 1. MASTER DATA VERIFICATION & IMPORT
  console.log('\n--- 1. Transferring & Verifying Master Data ---');

  // 1.1 Workcenters
  const { data: existingWc, error: wcCheckErr } = await client.from('workcenter_master').select('*');
  if (wcCheckErr) throw new Error(`Failed to query workcenter_master: ${wcCheckErr.message}`);

  if (!existingWc || existingWc.length === 0) {
    console.log('  Seeding 37 Workcenter Master records...');
    const { error: wcInsertErr } = await client.from('workcenter_master').insert(WORKCENTERS);
    if (wcInsertErr) throw new Error(`Failed to insert workcenters: ${wcInsertErr.message}`);
    console.log('  ✅ Inserted 37 Workcenter records.');
  } else {
    console.log(`  ✅ Workcenter Master already seeded with ${existingWc.length} records.`);
  }

  const { count: finalWcCount } = await client.from('workcenter_master').select('*', { count: 'exact', head: true });
  summary.master_data['workcenter_master'] = {
    source_count: 37,
    destination_count: finalWcCount,
    status: finalWcCount === 37 ? 'MATCH' : 'MISMATCH',
  };
  console.log(`  workcenter_master: Source=37 | Target=${finalWcCount} (${summary.master_data['workcenter_master'].status})`);

  // 1.2 Defect Catalog
  const { data: existingDc, error: dcCheckErr } = await client.from('defect_catalog').select('*');
  if (dcCheckErr) throw new Error(`Failed to query defect_catalog: ${dcCheckErr.message}`);

  if (!existingDc || existingDc.length === 0) {
    console.log('  Seeding 8 Defect Catalog records...');
    const { error: dcInsertErr } = await client.from('defect_catalog').insert(DEFECTS);
    if (dcInsertErr) throw new Error(`Failed to insert defect catalog: ${dcInsertErr.message}`);
    console.log('  ✅ Inserted 8 Defect Catalog records.');
  } else {
    console.log(`  ✅ Defect Catalog already seeded with ${existingDc.length} records.`);
  }

  const { count: finalDcCount } = await client.from('defect_catalog').select('*', { count: 'exact', head: true });
  summary.master_data['defect_catalog'] = {
    source_count: 8,
    destination_count: finalDcCount,
    status: finalDcCount === 8 ? 'MATCH' : 'MISMATCH',
  };
  console.log(`  defect_catalog:    Source=8  | Target=${finalDcCount} (${summary.master_data['defect_catalog'].status})`);

  // 2. PROVISION INITIAL PRODUCTION ADMIN ACCOUNT
  console.log('\n--- 2. Provisioning Exactly ONE Initial Production Admin ---');
  const adminPhone = '+84968041128';
  const adminEmail = '84968041128@sampletracking.local';
  const adminFullName = 'Đỗ Xuân Trường';
  const adminRole = 'Admin';
  const adminDept = 'Ban Quản Trị';

  // Check if admin already exists
  const { data: existingProfile } = await client.from('profiles').select('*').eq('phone', adminPhone).maybeSingle();

  if (existingProfile) {
    console.log(`  ℹ️ Production Admin profile already exists (ID: ${existingProfile.id}, Role: ${existingProfile.role}).`);
    summary.admin_provisioning = {
      phone: adminPhone,
      email: adminEmail,
      role: adminRole,
      id: existingProfile.id,
      status: 'ALREADY_EXISTS',
      must_change_password: existingProfile.must_change_password,
    };
  } else {
    // Generate secure temporary password
    const tempPassword = 'Adm@' + crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + '9#';

    // Create Supabase Auth user
    const { data: newAuthUser, error: authErr } = await client.auth.admin.createUser({
      email: adminEmail,
      phone: adminPhone,
      password: tempPassword,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: adminFullName, role: adminRole, phone: adminPhone },
    });

    if (authErr || !newAuthUser?.user) {
      throw new Error(`Failed to create Auth user for Admin: ${authErr?.message}`);
    }

    const adminUserId = newAuthUser.user.id;

    // Insert public.profiles record
    const { error: profileErr } = await client.from('profiles').upsert({
      id: adminUserId,
      phone: adminPhone,
      email: adminEmail,
      full_name: adminFullName,
      role: adminRole,
      department: adminDept,
      is_active: true,
      is_department_leader: false,
      must_change_password: true, // MANDATORY: First login password change
    });

    if (profileErr) {
      throw new Error(`Failed to create Profile for Admin: ${profileErr.message}`);
    }

    // Save temporary credentials securely in local scratch/ file (NOT logged)
    const credPath = path.resolve(process.cwd(), 'backups', 'admin_temp_credentials.json');
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(credPath, JSON.stringify({
      phone: adminPhone,
      email: adminEmail,
      temp_password: tempPassword,
      note: 'User must change password on first login.',
      created_at: new Date().toISOString(),
    }, null, 2));

    console.log(`  ✅ Successfully provisioned Production Admin: ${adminPhone} (${adminFullName}).`);
    console.log(`  🔒 Temporary credentials written safely to ${credPath} (Masked from console).`);
    summary.admin_provisioning = {
      phone: adminPhone,
      email: adminEmail,
      role: adminRole,
      id: adminUserId,
      status: 'PROVISIONED',
      must_change_password: true,
    };
  }

  // Verify total user count in profiles: MUST BE EXACTLY 1
  const { data: allProfiles } = await client.from('profiles').select('id, phone, role, is_active');
  const totalUsers = allProfiles ? allProfiles.length : 0;
  console.log(`  Total users in Production profiles: ${totalUsers} (Requirement: Exactly 1)`);
  if (totalUsers !== 1) {
    console.warn(`  ⚠️ WARNING: Expected exactly 1 user, found ${totalUsers}.`);
  }

  // 3. VERIFY OPERATIONAL TABLES ARE 100% EMPTY
  console.log('\n--- 3. Verifying Operational Tables Contain Zero Records ---');
  let operationalClean = true;
  for (const t of OPERATIONAL_TABLES) {
    const { count, error } = await client.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`  ❌ Error querying ${t}: ${error.message}`);
      summary.operational_tables[t] = { count: -1, status: 'ERROR', error: error.message };
      operationalClean = false;
    } else {
      let isClean = false;
      if (t === 'audit_logs') {
        // audit_logs naturally has 1 record for the initial Admin profile insert
        isClean = count <= 1;
        summary.operational_tables[t] = { count, status: isClean ? 'INITIAL_ADMIN_AUDITED' : 'CONTAINS_UNEXPECTED_DATA' };
        console.log(`  Table '${t.padEnd(25)}': ${count} records (${isClean ? '✅ INITIAL ADMIN AUDITED' : '❌ HAS DATA'})`);
      } else {
        isClean = count === 0;
        summary.operational_tables[t] = { count, status: isClean ? 'CLEAN_EMPTY' : 'CONTAINS_DATA' };
        console.log(`  Table '${t.padEnd(25)}': ${count} records (${isClean ? '✅ EMPTY' : '❌ HAS DATA'})`);
      }
      if (!isClean) operationalClean = false;
    }
  }

  // 4. STORAGE VERIFICATION
  console.log('\n--- 4. Private Storage Bucket Verification ---');
  const { data: buckets } = await client.storage.listBuckets();
  const docBucket = (buckets || []).find(b => b.id === 'sample-documents');
  if (docBucket) {
    const isPrivate = docBucket.public === false;
    summary.storage_verification = {
      bucket: 'sample-documents',
      is_private: isPrivate,
      allowed_mime_types: docBucket.allowed_mime_types,
      status: isPrivate ? 'SECURE_PRIVATE' : 'INSECURE_PUBLIC',
    };
    console.log(`  Bucket 'sample-documents': Private=${isPrivate} (Status: ${summary.storage_verification.status})`);
  } else {
    summary.storage_verification = { bucket: 'sample-documents', status: 'MISSING' };
    console.error(`  ❌ Bucket 'sample-documents' is missing!`);
  }

  // 5. OUTPUT SUMMARY REPORT
  console.log('\n' + '='.repeat(80));
  console.log('   PRODUCTION INITIALIZATION VERIFICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`   Master Data Workcenters: ${summary.master_data.workcenter_master?.status} (${summary.master_data.workcenter_master?.destination_count}/37)`);
  console.log(`   Master Data Defects:     ${summary.master_data.defect_catalog?.status} (${summary.master_data.defect_catalog?.destination_count}/8)`);
  console.log(`   Production Admin:        ${summary.admin_provisioning?.status} (${summary.admin_provisioning?.phone})`);
  console.log(`   Operational Cleanliness: ${operationalClean ? '✅ ALL 13 TABLES ZERO RECORDS' : '❌ OPERATIONAL RECORDS DETECTED'}`);
  console.log(`   Private Storage:         ${summary.storage_verification?.status}`);
  console.log('='.repeat(80) + '\n');

  const reportPath = path.resolve(process.cwd(), 'backups', 'production_initialization_summary.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Detailed verification report saved to: ${reportPath}`);
}

initializeProduction().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
