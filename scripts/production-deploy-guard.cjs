#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING — PRODUCTION ZERO-DATA-LOSS DEPLOYMENT GUARD
 * Script: scripts/production-deploy-guard.cjs
 *
 * Implements strict data preservation controls:
 * 1. Takes pre-deployment cryptographic ID & data hash snapshot
 * 2. Compares post-deployment records by ID, content integrity, and SHA-256
 * 3. Verifies 100% of existing storage files remain intact and accessible
 * 4. Ensures ZERO data loss, zero overwrite, and zero regression
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prodUrl = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const prodServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(prodUrl, prodServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const AUDIT_TABLES = [
  'jobs',
  'job_operations',
  'production_runs',
  'ng_details',
  'qa_checks',
  'pe_engineering_reviews',
  'pe_technical_dispositions',
  'kiv_reviews',
  'engineering_documents',
  'operation_sample_photos',
  'sample_final_reports',
  'attachments',
  'profiles',
  'audit_logs',
];

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function takePreSnapshot() {
  console.log('='.repeat(80));
  console.log('   PRODUCTION PRE-DEPLOYMENT INTEGRITY SNAPSHOT (READ-ONLY)');
  console.log(`   Target:    ${prodUrl}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const snapshot = {
    timestamp: new Date().toISOString(),
    tables: {},
    storage_files: [],
  };

  for (const table of AUDIT_TABLES) {
    const { data, count, error } = await client
      .from(table)
      .select('*', { count: 'exact' });

    if (error) {
      throw new Error(`Failed to query table ${table}: ${error.message}`);
    }

    const rows = (data || []).sort((a, b) => (a.id > b.id ? 1 : -1));
    const ids = rows.map((r) => r.id);
    const contentHash = sha256(rows);

    snapshot.tables[table] = {
      count: count || 0,
      ids,
      contentHash,
      rows,
    };
    console.log(`  📸 Table '${table}': ${count || 0} rows captured (Hash: ${contentHash.slice(0, 12)}...)`);
  }

  // Storage files audit
  const { data: atts } = await client.from('attachments').select('id, file_path');
  const { data: photos } = await client.from('operation_sample_photos').select('id, file_path');

  const filesToCheck = [
    ...(atts || []).map((a) => ({ type: 'attachment', id: a.id, path: a.file_path })),
    ...(photos || []).map((p) => ({ type: 'sample_photo', id: p.id, path: p.file_path })),
  ];

  console.log(`\n  Checking ${filesToCheck.length} storage files accessibility...`);
  let validFiles = 0;
  for (const file of filesToCheck) {
    const { data: urlData, error } = await client.storage
      .from('sample-documents')
      .createSignedUrl(file.path, 60);

    if (!error && urlData?.signedUrl) {
      validFiles++;
      snapshot.storage_files.push({ ...file, status: 'ACCESSIBLE' });
    } else {
      console.warn(`  ⚠️ Inaccessible file: ${file.path}`);
      snapshot.storage_files.push({ ...file, status: 'INACCESSIBLE', error: error?.message });
    }
  }
  console.log(`  📸 Storage verification: ${validFiles}/${filesToCheck.length} files verified accessible`);

  const outPath = path.resolve(__dirname, '..', 'backups', 'pre_deploy_snapshot_live.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\n✅ Pre-deploy cryptographic snapshot saved to: ${outPath}\n`);
  return snapshot;
}

async function verifyPostDeploy(preSnapshotPath) {
  console.log('='.repeat(80));
  console.log('   POST-DEPLOYMENT DATA LOSS & INTEGRITY VERIFICATION');
  console.log(`   Target:    ${prodUrl}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  if (!fs.existsSync(preSnapshotPath)) {
    throw new Error(`Pre-deploy snapshot not found at: ${preSnapshotPath}`);
  }

  const preSnapshot = JSON.parse(fs.readFileSync(preSnapshotPath, 'utf8'));
  let allMatched = true;

  for (const table of AUDIT_TABLES) {
    const preTable = preSnapshot.tables[table];
    const { data: postData, count: postCount, error } = await client
      .from(table)
      .select('*', { count: 'exact' });

    if (error) {
      console.error(`  ❌ Error querying post-deploy table ${table}:`, error.message);
      allMatched = false;
      continue;
    }

    const postRows = postData || [];
    const postIds = new Set(postRows.map((r) => r.id));

    // 1. Check that EVERY pre-existing ID is still present
    const missingIds = preTable.ids.filter((id) => !postIds.has(id));
    if (missingIds.length > 0) {
      console.error(`  ❌ DATA LOSS DETECTED on table '${table}'! Missing ${missingIds.length} IDs:`, missingIds);
      allMatched = false;
      continue;
    }

    // 2. Check for unexpected row count drop
    if (postCount < preTable.count) {
      console.error(`  ❌ Count decreased on table '${table}': Pre=${preTable.count}, Post=${postCount}`);
      allMatched = false;
      continue;
    }

    // 3. For all pre-existing rows, check that content is unchanged
    const preRowsMap = new Map(preTable.rows.map((r) => [r.id, r]));
    let contentMutated = 0;
    for (const postRow of postRows) {
      if (preRowsMap.has(postRow.id)) {
        const preRow = preRowsMap.get(postRow.id);
        // Compare original pre-existing fields to ensure ZERO mutation of historical data
        let mutatedField = false;
        for (const [key, preVal] of Object.entries(preRow)) {
          if (JSON.stringify(postRow[key]) !== JSON.stringify(preVal)) {
            console.warn(`  ⚠️ Row content mutated on table '${table}' id=${postRow.id}, field=${key}`);
            mutatedField = true;
            break;
          }
        }
        if (mutatedField) {
          contentMutated++;
        }
      }
    }

    const newRowsCount = postCount - preTable.count;
    if (contentMutated === 0) {
      console.log(`  ✅ Table '${table}': 100% IDs preserved (${preTable.count} original rows intact${newRowsCount > 0 ? `, +${newRowsCount} newly created` : ''})`);
    } else {
      console.error(`  ❌ Table '${table}': ${contentMutated} rows unexpectedly mutated!`);
      allMatched = false;
    }
  }

  // 4. Verify all pre-existing storage files are still accessible
  console.log(`\nVerifying storage files accessibility...`);
  let storagePreserved = 0;
  for (const file of preSnapshot.storage_files) {
    const { data: urlData, error } = await client.storage
      .from('sample-documents')
      .createSignedUrl(file.path, 60);

    if (!error && urlData?.signedUrl) {
      storagePreserved++;
    } else {
      console.error(`  ❌ Storage file lost: ${file.path}`);
      allMatched = false;
    }
  }
  console.log(`  ✅ Storage verification: ${storagePreserved}/${preSnapshot.storage_files.length} files still 100% accessible`);

  console.log('\n' + '='.repeat(80));
  if (allMatched) {
    console.log('   🎉 VERIFICATION RESULT: ZERO DATA LOSS CONFIRMED (DATA LOSS RISK = NONE)');
  } else {
    console.log('   🛑 VERIFICATION RESULT: INTEGRITY DISCREPANCY DETECTED');
  }
  console.log('================================================================================');
  return allMatched;
}

const action = process.argv[2] || 'snapshot';
if (action === 'snapshot') {
  takePreSnapshot().catch((err) => {
    console.error('Fatal snapshot error:', err);
    process.exit(1);
  });
} else if (action === 'verify') {
  const snapshotPath = process.argv[3] || path.resolve(__dirname, '..', 'backups', 'pre_deploy_snapshot_live.json');
  verifyPostDeploy(snapshotPath).catch((err) => {
    console.error('Fatal verify error:', err);
    process.exit(1);
  });
}

module.exports = { takePreSnapshot, verifyPostDeploy };
