#!/usr/bin/env node
/**
 * PHYSICAL STORAGE BACKUP FOR PRODUCTION
 * Downloads all physical files from 'sample-documents' bucket to disk.
 * Strictly READ-ONLY. Modifies zero production files.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const client = createClient(PROD_URL, PROD_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STORAGE_BACKUP_DIR = path.resolve(__dirname, '..', 'backups', 'storage_production_backup_2026-11-03');

async function runStorageBackup() {
  console.log('='.repeat(80));
  console.log('   PRODUCTION PHYSICAL STORAGE BACKUP (READ-ONLY)');
  console.log(`   Source:      ${PROD_URL} -> bucket 'sample-documents'`);
  console.log(`   Destination: ${STORAGE_BACKUP_DIR}`);
  console.log('='.repeat(80));

  fs.mkdirSync(STORAGE_BACKUP_DIR, { recursive: true });

  // Get list of file paths from database tables
  const { data: atts, error: aErr } = await client.from('attachments').select('id, file_path, file_name');
  const { data: photos, error: pErr } = await client.from('operation_sample_photos').select('id, file_path, file_name');
  const { data: reports, error: rErr } = await client.from('sample_final_reports').select('id, pdf_file_path, zip_file_path');

  const fileList = [];
  (atts || []).forEach(a => { if (a.file_path) fileList.push({ type: 'attachment', path: a.file_path, name: a.file_name }); });
  (photos || []).forEach(p => { if (p.file_path) fileList.push({ type: 'sample_photo', path: p.file_path, name: p.file_name }); });
  (reports || []).forEach(r => {
    if (r.pdf_file_path) fileList.push({ type: 'report_pdf', path: r.pdf_file_path, name: path.basename(r.pdf_file_path) });
    if (r.zip_file_path) fileList.push({ type: 'report_zip', path: r.zip_file_path, name: path.basename(r.zip_file_path) });
  });

  console.log(`Total files cataloged from database: ${fileList.length}`);

  let downloaded = 0;
  let failed = 0;

  for (const item of fileList) {
    try {
      const { data: blob, error: dlErr } = await client.storage
        .from('sample-documents')
        .download(item.path);

      if (dlErr || !blob) {
        console.warn(`  ⚠️ Failed to download '${item.path}': ${dlErr?.message || 'No data'}`);
        failed++;
        continue;
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const localFilePath = path.join(STORAGE_BACKUP_DIR, item.path.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
      fs.writeFileSync(localFilePath, buffer);
      downloaded++;
      console.log(`  💾 Downloaded [${item.type}] ${item.path} (${buffer.length} bytes)`);
    } catch (e) {
      console.error(`  ❌ Error processing ${item.path}:`, e.message);
      failed++;
    }
  }

  console.log('\n--- STORAGE PHYSICAL BACKUP SUMMARY ---');
  console.log(`Downloaded: ${downloaded} files`);
  console.log(`Failed:     ${failed} files`);
  console.log(`Saved to:   ${STORAGE_BACKUP_DIR}`);
}

runStorageBackup().catch(err => {
  console.error('Fatal storage backup error:', err);
  process.exit(1);
});
