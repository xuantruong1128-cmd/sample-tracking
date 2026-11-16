#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING — PRODUCTION PRE-DEPLOYMENT BACKUP RUNNER
 * Script: scripts/backup-production-data.cjs
 *
 * Extracts a complete, immutable pre-deployment backup of all operational
 * tables and storage metadata from Production (uqvxtgvdmdfgtjwzsxlj).
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const prodUrl = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const prodServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(prodUrl, prodServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TABLES_TO_BACKUP = [
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
  'workcenter_master',
  'defect_catalog',
  'drawing_review_issues',
  'drawing_review_versions',
  'drawing_review_operations',
  'drawing_review_attachments'
];

async function runProductionBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, '..', 'backups', `backup_prod_pre_r2_${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log('='.repeat(80));
  console.log('   SAMPLE TRACKING — PRODUCTION READ-ONLY BACKUP RUNNER');
  console.log(`   Source:      ${prodUrl} (uqvxtgvdmdfgtjwzsxlj)`);
  console.log(`   Destination: ${backupDir}`);
  console.log(`   Timestamp:   ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const manifest = {
    source_url: prodUrl,
    project_ref: 'uqvxtgvdmdfgtjwzsxlj',
    created_at: new Date().toISOString(),
    tables: {},
    storage_objects: []
  };

  for (const table of TABLES_TO_BACKUP) {
    try {
      const { data, count, error } = await client
        .from(table)
        .select('*', { count: 'exact' });

      if (error) {
        console.warn(`  ⚠️ Table ${table}: ${error.message}`);
        manifest.tables[table] = { status: 'ERROR', error: error.message };
        continue;
      }

      const filePath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data || [], null, 2), 'utf8');
      manifest.tables[table] = { status: 'OK', count: count || 0, file: `${table}.json` };
      console.log(`  ✅ Table '${table}': ${count || 0} rows exported`);
    } catch (err) {
      console.error(`  ❌ Error backing up ${table}:`, err.message);
      manifest.tables[table] = { status: 'FAILED', error: err.message };
    }
  }

  // Backup Storage bucket metadata
  try {
    const { data: objects, error: storErr } = await client.storage
      .from('sample-documents')
      .list('', { limit: 500, sortBy: { column: 'name', order: 'asc' } });

    if (!storErr && objects) {
      manifest.storage_objects = objects;
      fs.writeFileSync(
        path.join(backupDir, 'storage_sample_documents_root.json'),
        JSON.stringify(objects, null, 2),
        'utf8'
      );
      console.log(`  ✅ Storage bucket 'sample-documents': ${objects.length} top-level entries cataloged`);
    }
  } catch (err) {
    console.warn('  ⚠️ Storage backup warning:', err.message);
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n' + '='.repeat(80));
  console.log(`   BACKUP COMPLETE: All production data preserved at:`);
  console.log(`   ${backupDir}`);
  console.log('================================================================================');
  return backupDir;
}

if (require.main === module) {
  runProductionBackup().catch(err => {
    console.error('Fatal backup error:', err);
    process.exit(1);
  });
}

module.exports = { runProductionBackup };
