const fs = require('fs');
const path = require('path');

const jsonPath = path.resolve(__dirname, '../backups/backup_jobs_preview_latest.json');
const sqlPath = path.resolve(__dirname, '../backups/backup_jobs_preview_latest.sql');

if (!fs.existsSync(jsonPath)) {
  console.error('JSON backup file not found.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

let sql = `-- ==============================================================================
-- SAMPLE TRACKING V1.0 — BACKUP OF 7 EXISTING JOBS BEFORE CLEANUP
-- Exported at: ${new Date().toISOString()}
-- Database: Supabase TEST (hosppagbopdghlupnhlr)
-- ==============================================================================

BEGIN;

`;

function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return v.toString();
  if (Array.isArray(v)) {
    const escaped = v.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',');
    return `'${escaped}'::TEXT[]`;
  }
  return `'${v.toString().replace(/'/g, "''")}'`;
}

for (const item of data) {
  const j = item.job;
  sql += `-- ------------------------------------------------------------------------------\n`;
  sql += `-- JOB: ${j.job_no} (ID: ${j.id})\n`;
  sql += `-- ------------------------------------------------------------------------------\n`;
  sql += `INSERT INTO public.jobs (id, job_no, part_no, part_name, customer, target_qty, status, created_by, created_at, updated_at)\n`;
  sql += `VALUES (${sqlVal(j.id)}, ${sqlVal(j.job_no)}, ${sqlVal(j.part_no)}, ${sqlVal(j.part_name)}, ${sqlVal(j.customer)}, ${sqlVal(j.target_qty)}, ${sqlVal(j.status)}, ${sqlVal(j.created_by)}, ${sqlVal(j.created_at)}, ${sqlVal(j.updated_at)})\n`;
  sql += `ON CONFLICT (id) DO NOTHING;\n\n`;

  for (const op of item.operations) {
    sql += `INSERT INTO public.job_operations (id, job_id, step_order, operation_name, workcenter_code, description, cycle_time_target, machine_id, remark, status, created_at, updated_at)\n`;
    sql += `VALUES (${sqlVal(op.id)}, ${sqlVal(op.job_id)}, ${sqlVal(op.step_order)}, ${sqlVal(op.operation_name)}, ${sqlVal(op.workcenter_code)}, ${sqlVal(op.description)}, ${sqlVal(op.cycle_time_target)}, ${sqlVal(op.machine_id)}, ${sqlVal(op.remark)}, ${sqlVal(op.status)}, ${sqlVal(op.created_at)}, ${sqlVal(op.updated_at)})\n`;
    sql += `ON CONFLICT (id) DO NOTHING;\n`;
  }
  if (item.operations.length > 0) sql += '\n';

  for (const r of item.production_runs) {
    sql += `INSERT INTO public.production_runs (id, operation_id, machine_id, operator_id, operator_name, start_time, end_time, cycle_time_seconds, ok_qty, ng_qty, kiv_qty, production_date, remarks, created_at, updated_at)\n`;
    sql += `VALUES (${sqlVal(r.id)}, ${sqlVal(r.operation_id)}, ${sqlVal(r.machine_id)}, ${sqlVal(r.operator_id)}, ${sqlVal(r.operator_name)}, ${sqlVal(r.start_time)}, ${sqlVal(r.end_time)}, ${sqlVal(r.cycle_time_seconds)}, ${sqlVal(r.ok_qty)}, ${sqlVal(r.ng_qty)}, ${sqlVal(r.kiv_qty)}, ${sqlVal(r.production_date)}, ${sqlVal(r.remarks)}, ${sqlVal(r.created_at)}, ${sqlVal(r.updated_at)})\n`;
    sql += `ON CONFLICT (id) DO NOTHING;\n`;
  }
  if (item.production_runs.length > 0) sql += '\n';

  for (const ng of item.ng_details) {
    sql += `INSERT INTO public.ng_details (id, production_run_id, defect_name, defect_code, ng_qty, defect_description, cause, remark, photo_urls, created_at)\n`;
    sql += `VALUES (${sqlVal(ng.id)}, ${sqlVal(ng.production_run_id)}, ${sqlVal(ng.defect_name)}, ${sqlVal(ng.defect_code)}, ${sqlVal(ng.ng_qty)}, ${sqlVal(ng.defect_description)}, ${sqlVal(ng.cause)}, ${sqlVal(ng.remark)}, ${sqlVal(ng.photo_urls)}, ${sqlVal(ng.created_at)})\n`;
    sql += `ON CONFLICT (id) DO NOTHING;\n`;
  }
  if (item.ng_details.length > 0) sql += '\n';

  for (const qa of item.qa_checks) {
    sql += `INSERT INTO public.qa_checks (id, operation_id, inspector_id, inspector_name, inspection_time, sample_size, ok_qty, ng_qty, result, event_seq, notes, created_at)\n`;
    sql += `VALUES (${sqlVal(qa.id)}, ${sqlVal(qa.operation_id)}, ${sqlVal(qa.inspector_id)}, ${sqlVal(qa.inspector_name)}, ${sqlVal(qa.inspection_time)}, ${sqlVal(qa.sample_size)}, ${sqlVal(qa.ok_qty)}, ${sqlVal(qa.ng_qty)}, ${sqlVal(qa.result)}, ${sqlVal(qa.event_seq)}, ${sqlVal(qa.notes)}, ${sqlVal(qa.created_at)})\n`;
    sql += `ON CONFLICT (id) DO NOTHING;\n`;
  }
  if (item.qa_checks.length > 0) sql += '\n';

  for (const att of item.attachments) {
    sql += `INSERT INTO public.attachments (id, job_id, operation_id, file_name, file_size, mime_type, file_path, upload_status, content_hash, owning_department, uploaded_by, created_at)\n`;
    sql += `VALUES (${sqlVal(att.id)}, ${sqlVal(att.job_id)}, ${sqlVal(att.operation_id)}, ${sqlVal(att.file_name)}, ${sqlVal(att.file_size)}, ${sqlVal(att.mime_type)}, ${sqlVal(att.file_path)}, ${sqlVal(att.upload_status)}, ${sqlVal(att.content_hash)}, ${sqlVal(att.owning_department)}, ${sqlVal(att.uploaded_by)}, ${sqlVal(att.created_at)})\n`;
    sql += `ON CONFLICT (id) DO NOTHING;\n`;
  }
  if (item.attachments.length > 0) sql += '\n';
}

sql += `\nCOMMIT;\n`;

fs.writeFileSync(sqlPath, sql, 'utf8');
console.log(`✅ SQL backup successfully written to: ${sqlPath}`);
