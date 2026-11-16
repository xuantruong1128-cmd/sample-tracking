const { createClient } = require('@supabase/supabase-js');

const PROD_URL = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';

const supa = createClient(PROD_URL, PROD_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function listAllFiles(bucketName, folder = '') {
  let allFiles = [];
  const { data, error } = await supa.storage.from(bucketName).list(folder, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    console.error(`Error listing folder "${folder}" in bucket "${bucketName}":`, error.message);
    return allFiles;
  }

  for (const item of (data || [])) {
    const itemPath = folder ? `${folder}/${item.name}` : item.name;
    if (item.id === null || !item.metadata) {
      // It's a folder / subfolder
      const subFiles = await listAllFiles(bucketName, itemPath);
      allFiles = allFiles.concat(subFiles);
    } else {
      // It's a file
      allFiles.push({
        bucket: bucketName,
        path: itemPath,
        name: item.name,
        size: item.metadata?.size || 0,
        mimetype: item.metadata?.mimetype || 'unknown',
        created_at: item.created_at,
        updated_at: item.updated_at,
      });
    }
  }

  return allFiles;
}

async function audit() {
  console.log('='.repeat(80));
  console.log('           SUPABASE PRODUCTION CAPACITY & HEALTH AUDIT');
  console.log(`           Instance: ${PROD_URL}`);
  console.log(`           Time:     ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Audit Database Tables & Row Counts
  console.log('\n[1] AUDITING DATABASE TABLES & ROW COUNTS...');
  const tables = [
    'jobs',
    'job_operations',
    'production_runs',
    'qa_checks',
    'drawing_review_issues',
    'drawing_review_versions',
    'drawing_review_operations',
    'drawing_review_attachments',
    'attachments',
    'operation_sample_photos',
    'sample_final_reports',
    'profiles',
  ];

  const tableStats = {};
  for (const t of tables) {
    try {
      const { count, error } = await supa.from(t).select('*', { count: 'exact', head: true });
      if (error) {
        tableStats[t] = { count: 'Error: ' + error.message };
      } else {
        tableStats[t] = { count };
      }
    } catch (e) {
      tableStats[t] = { count: 'Exception: ' + e.message };
    }
  }

  console.table(tableStats);

  // 2. Audit Storage Buckets
  console.log('\n[2] AUDITING STORAGE BUCKETS & PHYSICAL FILES...');
  const { data: buckets, error: bErr } = await supa.storage.listBuckets();
  if (bErr) {
    console.error('Failed to list buckets:', bErr.message);
    return;
  }

  console.log(`Discovered ${buckets.length} storage buckets:`);
  buckets.forEach(b => console.log(`  - Bucket: "${b.name}" (id: ${b.id}, public: ${b.public})`));

  let totalStorageBytes = 0;
  let totalFilesCount = 0;
  const allStorageFiles = [];
  const bucketBreakdown = {};

  for (const b of buckets) {
    const files = await listAllFiles(b.name);
    const bBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
    bucketBreakdown[b.name] = {
      fileCount: files.length,
      totalSize: formatBytes(bBytes),
      rawBytes: bBytes,
    };
    totalStorageBytes += bBytes;
    totalFilesCount += files.length;
    allStorageFiles.push(...files);
  }

  console.log('\nStorage Buckets Breakdown:');
  console.table(bucketBreakdown);
  console.log(`Total Physical Storage Used: ${formatBytes(totalStorageBytes)} (${totalStorageBytes.toLocaleString()} bytes) across ${totalFilesCount} files.`);

  // 3. File Type Analysis
  console.log('\n[3] FILE TYPE DISTRIBUTION:');
  const typeMap = {};
  for (const f of allStorageFiles) {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : 'no-ext';
    if (!typeMap[ext]) typeMap[ext] = { count: 0, totalBytes: 0 };
    typeMap[ext].count++;
    typeMap[ext].totalBytes += f.size;
  }

  const typeSummary = Object.entries(typeMap).map(([ext, data]) => ({
    extension: ext,
    files: data.count,
    totalSize: formatBytes(data.totalBytes),
    rawBytes: data.totalBytes,
    pct: ((data.totalBytes / (totalStorageBytes || 1)) * 100).toFixed(1) + '%',
  })).sort((a, b) => b.rawBytes - a.rawBytes);

  console.table(typeSummary);

  // 4. Largest Files Analysis
  console.log('\n[4] TOP 10 LARGEST FILES IN STORAGE:');
  const largestFiles = [...allStorageFiles]
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(f => ({
      bucket: f.bucket,
      path: f.path,
      size: formatBytes(f.size),
      created_at: f.created_at,
    }));
  console.table(largestFiles);

  // 5. Cross-Check Database References vs Storage Files (Orphaned / Missing)
  console.log('\n[5] CROSS-CHECKING INTEGRITY (ORPHANS & MISSING FILES)...');
  const { data: atts } = await supa.from('attachments').select('id, file_path');
  const { data: photos } = await supa.from('operation_sample_photos').select('id, file_path');
  const { data: reports } = await supa.from('sample_final_reports').select('id, pdf_file_path, zip_file_path');
  const { data: drIssues } = await supa.from('drawing_review_issues').select('id, drawing_file_path');
  const { data: drVers } = await supa.from('drawing_review_versions').select('id, avatar_file_path');
  const { data: drAtts } = await supa.from('drawing_review_attachments').select('id, file_path');

  const dbReferencedPaths = new Set();
  (atts || []).forEach(r => r.file_path && dbReferencedPaths.add(r.file_path));
  (photos || []).forEach(r => r.file_path && dbReferencedPaths.add(r.file_path));
  (reports || []).forEach(r => {
    r.pdf_file_path && dbReferencedPaths.add(r.pdf_file_path);
    r.zip_file_path && dbReferencedPaths.add(r.zip_file_path);
  });
  (drIssues || []).forEach(r => r.drawing_file_path && dbReferencedPaths.add(r.drawing_file_path));
  (drVers || []).forEach(r => r.avatar_file_path && dbReferencedPaths.add(r.avatar_file_path));
  (drAtts || []).forEach(r => r.file_path && dbReferencedPaths.add(r.file_path));

  const storagePathSet = new Set(allStorageFiles.map(f => f.path));

  // Missing files (in DB but not in Storage)
  const missingFiles = [];
  for (const dbPath of dbReferencedPaths) {
    if (!storagePathSet.has(dbPath)) {
      missingFiles.push(dbPath);
    }
  }

  // Orphaned files (in Storage but not in DB)
  const orphanedFiles = [];
  for (const sFile of allStorageFiles) {
    if (!dbReferencedPaths.has(sFile.path)) {
      orphanedFiles.push({
        path: sFile.path,
        size: formatBytes(sFile.size),
        created_at: sFile.created_at,
      });
    }
  }

  console.log(`Total Database File References: ${dbReferencedPaths.size}`);
  console.log(`Missing Files (referenced in DB but missing from Storage): ${missingFiles.length}`);
  if (missingFiles.length > 0) {
    console.log('Sample missing files:', missingFiles.slice(0, 5));
  }

  console.log(`Orphaned Files (in Storage but not referenced in any DB table): ${orphanedFiles.length}`);
  if (orphanedFiles.length > 0) {
    console.table(orphanedFiles.slice(0, 10));
  }

  // 6. Tier Quota Comparison
  console.log('\n[6] SUPABASE QUOTA & USAGE COMPARISON:');
  const FREE_STORAGE_LIMIT = 1 * 1024 * 1024 * 1024; // 1 GB
  const PRO_STORAGE_LIMIT = 100 * 1024 * 1024 * 1024; // 100 GB

  console.log(`Storage used: ${formatBytes(totalStorageBytes)}`);
  console.log(`  - Free Tier Quota (1 GB): ${((totalStorageBytes / FREE_STORAGE_LIMIT) * 100).toFixed(2)}% used (${formatBytes(FREE_STORAGE_LIMIT - totalStorageBytes)} remaining)`);
  console.log(`  - Pro Tier Quota (100 GB): ${((totalStorageBytes / PRO_STORAGE_LIMIT) * 100).toFixed(4)}% used`);

  console.log('\n' + '='.repeat(80));
  console.log('                      AUDIT COMPLETED');
  console.log('='.repeat(80));
}

audit().catch(console.error);
