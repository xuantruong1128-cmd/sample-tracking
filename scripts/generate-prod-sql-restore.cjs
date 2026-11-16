#!/usr/bin/env node
/**
 * Converts the latest production JSON backup into an executable SQL restore file.
 * Generates transactions with foreign key safe insertion order.
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.resolve(__dirname, '..', 'backups', 'backup_prod_pre_r2_2026-11-03T16-27-34-425Z');
const OUT_SQL = path.resolve(__dirname, '..', 'backups', 'production_data_restore_2026-11-03.sql');

if (!fs.existsSync(BACKUP_DIR)) {
  console.error('Backup dir not found:', BACKUP_DIR);
  process.exit(1);
}

function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return v.toString();
  if (Array.isArray(v)) {
    if (v.length === 0) return "'{}'::TEXT[]";
    const escaped = v.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(',');
    return `'${escaped}'::TEXT[]`;
  }
  if (typeof v === 'object') {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::JSONB`;
  }
  return `'${v.toString().replace(/'/g, "''")}'`;
}

// Foreign-key safe insertion order:
const TABLE_ORDER = [
  'profiles',
  'workcenter_master',
  'defect_catalog',
  'jobs',
  'job_operations',
  'production_runs',
  'ng_details',
  'qa_checks',
  'qa_ng_details',
  'pe_engineering_reviews',
  'pe_technical_dispositions',
  'kiv_reviews',
  'engineering_documents',
  'operation_sample_photos',
  'sample_final_reports',
  'attachments',
  'audit_logs'
];

let sql = `-- ==============================================================================
-- PRODUCTION DATA RESTORE FILE
-- Generated: ${new Date().toISOString()}
-- Source: ${BACKUP_DIR}
-- Target: Supabase Production (uqvxtgvdmdfgtjwzsxlj)
-- ==============================================================================

BEGIN;

-- Temporarily defer or disable foreign key triggers if necessary during emergency recovery
SET CONSTRAINTS ALL DEFERRED;

`;

let totalRows = 0;

for (const table of TABLE_ORDER) {
  const jsonFile = path.join(BACKUP_DIR, `${table}.json`);
  if (!fs.existsSync(jsonFile)) continue;

  const rows = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) continue;

  sql += `-- -----------------------------------------------------------------------------\n`;
  sql += `-- TABLE: public.${table} (${rows.length} rows)\n`;
  sql += `-- -----------------------------------------------------------------------------\n`;

  const columns = Object.keys(rows[0]);
  const colList = columns.map(c => `"${c}"`).join(', ');

  for (const row of rows) {
    totalRows++;
    const valList = columns.map(c => sqlVal(row[c])).join(', ');
    sql += `INSERT INTO public.${table} (${colList}) VALUES (${valList}) ON CONFLICT ("id") DO NOTHING;\n`;
  }
  sql += '\n';
}

sql += `COMMIT;\n`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`✅ Generated executable SQL restore file: ${OUT_SQL}`);
console.log(`   Total INSERT statements: ${totalRows}`);
