# SAMPLE TRACKING V1.0 — PHASE B2 TARGETED REMEDIATION R3 REPORT

**Project:** `C:\Sample report - AI`  
**Role:** Senior Supabase/PostgreSQL Security Engineer & Manufacturing Systems Architect  
**Date:** October 11, 2026  
**Status:** REMEDIATION COMPLETE — AWAITING INDEPENDENT CODEX RE-AUDIT  
**Previous Independent Verdict (Codex R2):** Gate A FAIL, Gate B BLOCKED  
**Current Honest Posture:** Gate A PENDING CODEX RE-AUDIT, Gate B BLOCKED (Awaiting live disposable Supabase instance)  

---

## 1. EXECUTIVE SUMMARY

The Phase B2 Targeted Remediation R3 cycle directly addresses all six findings identified in the independent Codex R2 audit (**B2-R2-01 through B2-R2-06**). All fixes have been implemented at root cause within the active V1 clean baseline (`supabase/migrations/00001_v1_clean_baseline.sql`), application services, test runners, and test suites.

### Key Architectural Invariants Preserved
1. **PE Ownership:** PE remains the final decision-maker for sample operations, holds, and dispositions.
2. **QA Optionality:** First runs and operation completions never mandate QA checks; QA remains an independent quality evaluator.
3. **Option A Document Visibility:** All active internal roles maintain read access to registered `READY` job documents via short-lived signed URLs (TTL $\le$ 300s).
4. **Closed Job Immutability:** Closed jobs reject all mutations, child inserts, runs, QA evaluations, and attachment uploads.
5. **No Production Deployment:** Zero changes made to production resources; credentials and tests fail-closed.

---

## 2. ROOT-CAUSE REMEDIATION MATRIX (FIXES 1–6)

| Finding ID | Severity | Component | Root Cause | Remediated Implementation |
| :--- | :---: | :--- | :--- | :--- |
| **Fix 1 (B2-R2-01)** | **BLOCKER** | Database Schema (`00001_v1_clean_baseline.sql`) | Direct authenticated `UPDATE` on `jobs` bypassed intermediate states (`ACTIVE` $\rightarrow$ `ARCHIVE`/`PURGED`) because `check_job_active_status()` returned early and `enforce_job_rules()` lacked exhaustive negative guards. | Implemented an exhaustive, fail-closed state machine in `enforce_job_rules()`: explicitly blocked `ACTIVE -> ARCHIVE`, `ACTIVE -> PURGED`, and `CLOSE -> PURGED`. Explicitly blocked transition to `PURGED` with future release notice. Updated `check_job_active_status()` to allow only valid forward lifecycle transitions (`ACTIVE -> CLOSE`, `CLOSE -> ARCHIVE`). |
| **Fix 2 (B2-R2-02)** | **BLOCKER** | Database Schema (`00001_v1_clean_baseline.sql`) | Transitioning operation from `HOLD` to `IN_PROGRESS` did not verify `is_authorized_pe_decision_maker`, nor did it require or record a reason for releasing the hold. | Updated `enforce_operation_workflow_rules()`: transitioning `HOLD -> IN_PROGRESS` strictly verifies `is_authorized_pe_decision_maker(NEW.job_id, auth.uid())`, mandates `reopen_reason` $\ge 5$ characters, and stamps `reopened_at` / `reopened_by`. Status-preserving updates to reopen metadata are strictly guarded. |
| **Fix 3 (B2-R2-03)** | **HIGH** | Database RPC & Client Service (`00001_v1_clean_baseline.sql`, `attachmentUploadService.ts`) | Retrying failed uploads reused the initial `file_path`, causing Supabase Storage upload with `upsert: false` to collide with previous failed binary uploads. `file_path` could also not be updated without trigger conflict. | Updated `retry_attachment_upload` to accept `p_new_path` or auto-generate collision-free path `<job_id>/<file_type>/r<epoch>_<rand>_<sanitized_name>`. Updated `enforce_attachment_integrity` to permit `file_path` updates strictly during `FAILED -> PENDING` retry (and reject it elsewhere). Updated `attachmentUploadService.ts` to upload to the fresh path with `upsert: false` and best-effort clean up old objects. |
| **Fix 4 (B2-R2-04)** | **HIGH** | Test Suite (`src/test/databaseIntegration.test.ts`) | Integration test suite only checked presence of URL and key, executing destructive queries during standard `npm test` without verifying disposable confirmation or project allowlist. | Rewrote test preflight: requires `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_IS_DISPOSABLE === 'true'`, and matching `SUPABASE_TEST_PROJECT_ALLOWLIST`. Fails closed and reports `BLOCKED` status if any condition is missing, guaranteeing zero destructive live operations during normal unit test runs. |
| **Fix 5 (B2-R2-05)** | **MEDIUM** | Test Runner (`scripts/run-gate-b-live-tests.cjs`) | Persona setup was not wrapped in `try/finally`; cleanup failures were logged as warnings without failing the runner; SDK non-200 responses caused test assertions to crash on null data. | Wrapped both setup and scenario execution in `try ... finally` in `main()`. Created standalone `cleanupCreatedResources()` that counts cleanup errors and fails the runner exit code (`cleanupErrors > 0`). Updated TC-16 to assert `upload_status === 'FAILED'` directly against the database record instead of fragile SDK response bodies. |
| **Fix 6 (B2-R2-06)** | **MEDIUM** | Test Runner & Matrix (`scripts/run-gate-b-live-tests.cjs`, `docs/gate_b_test_matrix.md`) | TC-19 only checked database row readability, omitting signed URL generation, HTTP byte download, and negative authorization tests. | Upgraded TC-19 in runner: requests signed URL via `create-signed-url` Edge Function with user JWT; performs real HTTP `fetch()`; verifies downloaded binary SHA-256 hash strictly matches original PDF; tests negative access for `P-INACTIVE`, `P-ANON`, and direct unauthenticated storage URLs. Updated `docs/gate_b_test_matrix.md`. |

---

## 3. DETAILED SOURCE CHANGES

### 3.1 Migration Baseline (`supabase/migrations/00001_v1_clean_baseline.sql`)
1. **`check_job_active_status()` (Lines 590–594):**
   ```sql
   -- Allow valid forward lifecycle transitions to proceed to enforce_job_rules
   IF (OLD.status = 'ACTIVE' AND NEW.status = 'CLOSE') OR
      (OLD.status = 'CLOSE' AND NEW.status = 'ARCHIVE') THEN
       RETURN NEW;
   END IF;
   ```
2. **`enforce_job_rules()` (Lines 704–740):**
   ```sql
   IF OLD.status IS DISTINCT FROM NEW.status THEN
       -- 1. Explicitly block skipping intermediate states (fail closed)
       IF OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVE' THEN
           RAISE EXCEPTION 'Invalid JOB status transition: ACTIVE cannot transition directly to ARCHIVE. Job must be closed first (ACTIVE -> CLOSE -> ARCHIVE).';
       END IF;
       IF OLD.status = 'ACTIVE' AND NEW.status = 'PURGED' THEN
           RAISE EXCEPTION 'Invalid JOB status transition: ACTIVE cannot transition directly to PURGED. Job must be closed and archived first.';
       END IF;
       IF OLD.status = 'CLOSE' AND NEW.status = 'PURGED' THEN
           RAISE EXCEPTION 'Invalid JOB status transition: CLOSE cannot transition directly to PURGED. Job must be archived first.';
       END IF;

       -- 2. Explicitly block PURGED transition until verified archive is implemented
       IF NEW.status = 'PURGED' THEN
           RAISE EXCEPTION 'Transition to PURGED is blocked: verified archive confirmation process is not yet implemented (scheduled for future release)';
       END IF;

       -- 3. Closing Job: ACTIVE -> CLOSE
       IF OLD.status = 'ACTIVE' AND NEW.status = 'CLOSE' THEN
           IF v_role NOT IN ('Planning', 'Admin') THEN
               RAISE EXCEPTION 'Only Planning or Admin can close an ACTIVE job.';
           END IF;
           NEW.closed_at := timezone('Asia/Ho_Chi_Minh', now());
           NEW.closed_by := auth.uid();

       -- 4. Archiving: CLOSE -> ARCHIVE (Admin only)
       ELSIF OLD.status = 'CLOSE' AND NEW.status = 'ARCHIVE' THEN
           IF v_role != 'Admin' THEN
               RAISE EXCEPTION 'Only Admin can transition a CLOSED job to ARCHIVE.';
           END IF;

       -- 5. Any other status transition is rejected (fail closed)
       ELSE
           RAISE EXCEPTION 'Invalid JOB status transition from % to %.', OLD.status, NEW.status;
       END IF;
   END IF;
   ```
3. **`enforce_operation_workflow_rules()` (Lines 1083–1110):**
   ```sql
   -- Releasing HOLD to IN_PROGRESS (Fix 2 Remediation)
   IF OLD.status = 'HOLD' AND NEW.status = 'IN_PROGRESS' THEN
       IF NOT public.is_authorized_pe_decision_maker(NEW.job_id, auth.uid()) THEN
           RAISE EXCEPTION 'Only designated PE Owner or delegate can release operation from HOLD for JOB %.', NEW.job_id;
       END IF;

       IF length(trim(COALESCE(NEW.reopen_reason, ''))) < 5 THEN
           RAISE EXCEPTION 'Releasing operation from HOLD requires a recorded reason (minimum 5 characters in reopen_reason).';
       END IF;

       NEW.reopened_at := timezone('Asia/Ho_Chi_Minh', now());
       NEW.reopened_by := auth.uid();
   ```
4. **`enforce_attachment_integrity()` (Lines 1238–1260):**
   ```sql
   -- Fix 3: Validate new file_path if modified during FAILED -> PENDING retry
   IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
       v_parts := string_to_array(NEW.file_path, '/');
       IF array_length(v_parts, 1) != 3
          OR v_parts[1] != OLD.job_id::text
          OR v_parts[2] != OLD.file_type::text
          OR length(v_parts[3]) = 0
          OR v_parts[3] IN ('.', '..')
          OR position('\' in v_parts[3]) > 0
          OR position('/' in v_parts[3]) > 0 THEN
           RAISE EXCEPTION 'Retry attachment path must strictly match <job_id>/<file_type>/<filename>';
       END IF;
   END IF;
   ```
5. **`retry_attachment_upload()` (Lines 1563–1580):**
   ```sql
   -- Fix 3: Resolve fresh storage path to strictly prevent collisions with prior failed upload attempts
   v_old_path := v_att.file_path;
   IF p_new_path IS NOT NULL AND length(trim(p_new_path)) > 0 THEN
       v_new_path := trim(p_new_path);
   ELSE
       v_sanitized_name := regexp_replace(v_att.file_name, '[/\\ ]+', '_', 'g');
       v_new_path := v_att.job_id::text || '/' || v_att.file_type::text || '/r' ||
                     floor(extract(epoch from now()))::text || '_' ||
                     substr(md5(random()::text), 1, 6) || '_' ||
                     v_sanitized_name;
   END IF;

   UPDATE public.attachments
   SET upload_status = 'PENDING',
       file_path = v_new_path,
       file_size = COALESCE(p_new_size, file_size),
       mime_type = COALESCE(p_new_mime, mime_type),
       content_hash = COALESCE(lower(p_new_hash), content_hash),
       last_error = NULL,
       last_retry_at = timezone('Asia/Ho_Chi_Minh', now())
   WHERE id = p_attachment_id AND upload_status = 'FAILED';
   ```

### 3.2 Client Services (`src/services/attachmentUploadService.ts`)
- `retryAttachmentUpload()` calls `retry_attachment_upload` with `p_new_path: null`.
- Uploads replacement binary to `attRecord.file_path` with `upsert: false`.
- Best-effort clean up of `retryData.old_file_path` to prevent storage orphan bloat.

### 3.3 Test Preflight & Safety (`src/test/databaseIntegration.test.ts`)
- Added strict multi-gate validation: checks for `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_IS_DISPOSABLE === 'true'`, and matches target host/ref against `SUPABASE_TEST_PROJECT_ALLOWLIST`.
- Safely skips live tests and logs informative BLOCKED message without attempting any mutations.

### 3.4 Live Cloud Runner (`scripts/run-gate-b-live-tests.cjs`)
- Restructured `main()` with `try { await setupPersonas(); await executeGateBScenarios(); } finally { cleanupErrors = await cleanupCreatedResources(); }`.
- Fails runner with exit code 1 if `failed > 0 || cleanupErrors > 0`.
- TC-16 asserts against database records directly to verify `upload_status === 'FAILED'`.
- TC-19 requests signed URL via `create-signed-url`, performs real HTTP fetch, verifies byte SHA-256 hash, and verifies negative access for inactive and anonymous callers.

---

## 4. VERIFICATION EVIDENCE

```
> vitest run
 Test Files  10 passed (10)
      Tests  248 passed (248)
   Duration  4.73s

> oxlint
Found 4 warnings and 0 errors.

> tsc -b && vite build
✓ built in 651ms

> node scripts/run-gate-b-live-tests.cjs
⚠️  [GATE B AUDIT STATUS: BLOCKED]
   Lý do: Chưa cấu hình đầy đủ thông số kết nối cơ sở dữ liệu thật trong .env:
     - SUPABASE_TEST_URL
     - SUPABASE_TEST_SERVICE_KEY
     - SUPABASE_TEST_ANON_KEY
   (Exited with code 1 - Safe fail-closed behavior verified)
```

---

## 5. AUDIT STATUS & RECOMMENDATION

1. **Gate A:** Ready for independent Codex re-audit. All root causes for findings B2-R2-01 through B2-R2-06 are closed.
2. **Gate B:** Remains honestly reported as **BLOCKED** until live disposable Supabase credentials and allowlist are provided in `.env`.
