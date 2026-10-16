# R6 targeted security patch — NOT YET ACCEPTED

Changed files:
- `supabase/migrations/00009_storage_disposition_security_r6.sql`
- `supabase/functions/create-signed-url/index.ts`
- `src/lib/storageUtils.ts`

## Changes
1. Storage SELECT now requires an exact registered attachment path and a non-purged JOB. Storage INSERT requires a pre-registered attachment whose uploader and owning department match the authenticated user. Historical broad policies and Admin object UPDATE/DELETE policies are dropped. Files are immutable via ordinary authenticated Storage APIs.
2. Attachment INSERT path must match `job_id/file_type/filename`, and an operation reference must belong to the same JOB. `file_path` is unique. Attachment changes are blocked by a trigger.
3. Operation completion after latest QA NG/KIV requires a disposition explicitly referencing that exact QA check. The previous `OR decision_timestamp >= inspection_time` bypass is removed. QA ordering uses database-created timestamps, with new QA inserts stamped server-side.
4. Frontend requests signed URLs through the Edge Function. The Edge Function checks a registered attachment and role, and caps URLs it issues to 300 seconds.

## Important limitations / release blockers
- **NOT TESTED against PostgreSQL, Auth or Supabase Storage.** Gate B remains BLOCKED. No claim of full remediation.
- Supabase Storage may permit direct authenticated signed URL creation for objects authorized by SELECT RLS. Therefore the 300-second maximum is **gateway-only**, not a universal hard limit. Universal TTL enforcement requires a separate access architecture/provider control.
- The Phase 1 read policy deliberately allows active internal Planning, PE-MFG, QA and Admin users to read registered JOB documents; per-JOB membership is not modeled. If JOB-specific confidentiality is required, add a membership/assignment authorization table and enforce it both in RLS and the Edge Function.
- The upload order is now **attachment metadata INSERT first, then Storage object INSERT**. Existing upload clients must follow that sequence. Orphaned metadata must be reconciled safely.
- The unique `file_path` index will fail if duplicate historical attachment paths exist. Check duplicates before migration.
- Historical QA `created_at` values are not rewritten; migration cannot independently establish historical chronological truth.
- This patch does not prove all R5 findings closed. Require independent Codex R6 Gate A and disposable Supabase Gate B.

## Mandatory live checks
- Apply migrations 00001–00009 in a disposable Supabase project.
- Test direct Storage list/download/sign/upload/move/copy/delete with QA, PE-MFG, Planning, Admin, inactive users.
- Verify registration-first upload, cross-JOB and wrong-department rejection, CLOSED immutability, signed URL expiry behavior.
- Test QA NG/KIV completion with exact QA-linked disposition, unrelated QA ID, old disposition, forged inspection_time, and later QA NG.
