# SAMPLE TRACKING V1.0 — HISTORICAL MIGRATION ARCHIVE (R1–R9)

This directory contains the historical incremental migrations applied during audit remediations R1 through R9:
- `00001_initial_schema.sql` (Initial prototype schema)
- `00002_rls_policies.sql` (Initial RLS setup)
- `00003_reference_catalogs.sql` (Defect catalog initialization)
- `00004_security_remediation_r1.sql` (Remediation R1)
- `00005_security_remediation_r2.sql` (Remediation R2)
- `00006_security_remediation_r3.sql` (Remediation R3)
- `00007_security_business_workflow_r4.sql` (Remediation R4 - PE-owned workflow introduction)
- `00008_security_remediation_r5.sql` (Remediation R5 - Reopen metadata & disposition hardening)
- `00009_storage_disposition_security_r6.sql` (Remediation R6 - Storage binding)
- `00010_security_remediation_r7.sql` (Remediation R7 - Monotonic QA event_seq & PENDING lifecycle)
- `00011_security_remediation_r8.sql` (Remediation R8 - Unique sequences & upload retry)
- `00012_security_stabilization_r9.sql` (Remediation R9 - Unforgeable internal contexts & hash constraints)

## ARCHIVAL REASON
Per Owner Decision (Phase B1 Approval):
These migrations are archived to prevent sequential execution during fresh project installations, eliminating known migration-ordering deadlocks on closed jobs and obsolete enum values.

All historical evidence, git commit history, and audit trails remain preserved.
The active baseline migration is located at `supabase/migrations/00001_v1_clean_baseline.sql`.
