# SAMPLE TRACKING V1.0 — PHASE B2 FINAL FOUR-DEFECT PATCH R4 CLOSURE REPORT

**Project:** `C:\Sample report - AI`  
**Role:** Senior PostgreSQL/Supabase Engineer  
**Mode:** STRICT TARGETED FIX  
**Source of Truth:** Codex Final Targeted Code Audit (F-01, F-02, F-03, F-04)  
**Date:** October 12, 2026  

---

## 1. FOUR-DEFECT CLOSURE MATRIX

| Finding ID | Root Cause | Exact Changed File & Lines | Fix | Positive Acceptance | Negative Acceptance | Remaining Live Verification |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **F-01**<br>*(HIGH)* | The `BEFORE UPDATE` trigger on `public.attachments` unconditionally rejected any `file_path` change in the core metadata block before reaching its special `FAILED -> PENDING` retry evaluation. | [`supabase/migrations/00001_v1_clean_baseline.sql`](file:///C:/Sample%20report%20-%20AI/supabase/migrations/00001_v1_clean_baseline.sql)<br>Lines 1211–1275 | 1. Placed `OLD.upload_status = 'READY'` immutability check first.<br>2. Removed `file_path` from the general core metadata check (`id`, `job_id`, `operation_id`, `file_name`, `file_type`, `uploaded_by`, `owning_department`, `created_at` remain immutable).<br>3. In the authorized `FAILED -> PENDING` retry branch, permitted updating `file_path`, `content_hash`, `file_size`, and `mime_type` subject to format validation, freshness (`NEW.file_path != OLD.file_path`), and collision prevention (`NOT EXISTS` in `attachments`).<br>4. In the `ELSE` branch (all other updates), strictly rejected any change to `file_path`, `content_hash`, `file_size`, or `mime_type`.<br>5. Did not rely on `pg_trigger_depth()`. | Authorized `retry_attachment_upload()` resets `FAILED -> PENDING` with fresh, unique storage path (`r<epoch>_<rand>_<name>`); replacement upload succeeds with `upsert: false`; Edge Function verifies SHA-256 and transitions to `READY`. | Direct authenticated client `UPDATE` is denied at grant level and trigger level; altering `file_path` on a `READY` attachment is strictly denied; reusing an existing or another attachment's `file_path` is rejected. | Pending live Gate B: Real PostgreSQL trigger execution during TC-16f retry lifecycle. |
| **F-02**<br>*(HIGH)* | Default Vitest test discovery (`npm test`) loaded `databaseIntegration.test.ts`, which would attempt live mutations via `service_role` if credentials existed in `.env`. | [`vite.config.ts`](file:///C:/Sample%20report%20-%20AI/vite.config.ts)<br>Lines 25–26<br><br>[`package.json`](file:///C:/Sample%20report%20-%20AI/package.json)<br>Line 13<br><br>[`vitest.integration.config.ts`](file:///C:/Sample%20report%20-%20AI/vitest.integration.config.ts)<br>Lines 1–13<br><br>[`src/test/databaseIntegration.test.ts`](file:///C:/Sample%20report%20-%20AI/src/test/databaseIntegration.test.ts)<br>Lines 20–85 | 1. Excluded `src/test/databaseIntegration.test.ts` from default Vitest discovery in `vite.config.ts`.<br>2. Created dedicated `vitest.integration.config.ts` and explicit npm command `"test:integration:live"`.<br>3. Required explicit opt-in `ENABLE_LIVE_DB_TESTS === 'true'` and independent project approval in `config/gate-b-approved-target.json` before allowing live execution.<br>4. Default `npm test` remains 100% local and non-destructive even if test credentials exist. | `npm test` runs 10 local test suites (254 tests) in 2.3s with zero live database calls.<br>Explicit command `npm run test:integration:live` runs isolated integration suite. | `npm test` with credentials in `.env`: zero live writes.<br>`npm run test:integration:live` without explicit opt-in: safely reports status as BLOCKED and performs zero database writes. | Pending live Gate B: Running `npm run test:integration:live` when live disposable instance is provisioned and approved. |
| **F-03**<br>*(BLOCKER)* | Target URL, credentials, and allowlist were all read from the same `.env` file, allowing self-referential target approval without independent verification. Profile delete errors during teardown were also not checked. | [`config/gate-b-approved-target.json`](file:///C:/Sample%20report%20-%20AI/config/gate-b-approved-target.json)<br>Lines 1–8<br><br>[`scripts/run-gate-b-live-tests.cjs`](file:///C:/Sample%20report%20-%20AI/scripts/run-gate-b-live-tests.cjs)<br>Lines 83–128, 891–955 | 1. Introduced independent, non-secret approval source: [`config/gate-b-approved-target.json`](file:///C:/Sample%20report%20-%20AI/config/gate-b-approved-target.json).<br>2. Removed reliance on `.env` allowlist; runner strictly validates target project ref and hostname against the independent approval config.<br>3. Fails closed before any database call if approval file is missing, unconfigured, or mismatched.<br>4. In teardown, explicitly checked and logged profile deletion errors (`profileDelErr`), tracked all remaining uncleaned resources in `uncleanedResources`, and ensured nonzero exit on any teardown failure. | Target matching independently configured and approved project ref passes preflight.<br>All created resources cleanly removed in teardown. | Missing approval file: BLOCKED.<br>Unconfigured approval file: BLOCKED.<br>Mismatched project identity: BLOCKED.<br>Failed profile or Auth deletion: runner exits with code 1 and outputs uncleaned resource registry. | Pending live Gate B: Preflight execution against an actual provisioned disposable Supabase project. |
| **F-04**<br>*(MEDIUM)* | TC-02b used a dummy UUID `00000000-0000-0000-0000-000000000000` which could fail due to foreign key constraints rather than authorization. TC-16e accepted generic SDK errors rather than specifically verifying HTTP 403 Forbidden. | [`scripts/run-gate-b-live-tests.cjs`](file:///C:/Sample%20report%20-%20AI/scripts/run-gate-b-live-tests.cjs)<br>Lines 448–478, 717–745 | 1. **TC-02b:** Moved right after TC-06a/b where the live operation is proven active and accepting runs. Uses the proven valid operation with complete mandatory production-run payload. Asserts rejection is specifically authorization RLS (`42501` / `is_user_active`), explicitly rejecting foreign-key (`23503`) or missing-field (`23502`) errors.<br>2. **TC-16e:** Inspects `FunctionsHttpError` from `functions.invoke()`, verifies HTTP status code is specifically `403`, rejects network errors (`FunctionsFetchError`) or HTTP 500, and verifies database status remains unchanged (`READY`). | TC-02b rejects deactivated user on a valid, active operation specifically via authorization.<br>TC-16e confirms Edge Function responds specifically with HTTP 403 Forbidden on unauthorized caller. | TC-02b fails if foreign-key or missing-field error is returned.<br>TC-16e fails if network failure, HTTP 500, or status mutation occurs. | Pending live Gate B: Live Edge Function response and PostgreSQL RLS error code verification. |

---

## 2. CODE CHANGES INVENTORY

1. [`supabase/migrations/00001_v1_clean_baseline.sql`](file:///C:/Sample%20report%20-%20AI/supabase/migrations/00001_v1_clean_baseline.sql):
   - Refactored [`enforce_attachment_integrity()`](file:///C:/Sample%20report%20-%20AI/supabase/migrations/00001_v1_clean_baseline.sql#L1198-L1285) to separate immutable core metadata from retryable file metadata.
   - Enforced that only an authorized `FAILED -> PENDING` retry can alter `file_path`, `content_hash`, `file_size`, and `mime_type`.
   - Added anti-collision check ensuring `NEW.file_path` does not exist in any other attachment row.
   - Preserved absolute immutability of `READY` attachments.

2. [`vite.config.ts`](file:///C:/Sample%20report%20-%20AI/vite.config.ts):
   - Configured `test.exclude: [...configDefaults.exclude, 'src/test/databaseIntegration.test.ts']` so default test runner never discovers live integration tests.

3. [`package.json`](file:///C:/Sample%20report%20-%20AI/package.json):
   - Added `"test:integration:live": "vitest run --config vitest.integration.config.ts"`.
   - Kept `"test": "vitest run"` purely local and non-destructive.

4. [`vitest.integration.config.ts`](file:///C:/Sample%20report%20-%20AI/vitest.integration.config.ts):
   - Created dedicated configuration for isolated live database integration tests.

5. [`src/test/databaseIntegration.test.ts`](file:///C:/Sample%20report%20-%20AI/src/test/databaseIntegration.test.ts):
   - Added mandatory `ENABLE_LIVE_DB_TESTS === 'true'` opt-in check.
   - Added independent approval validation from `config/gate-b-approved-target.json`.
   - Without opt-in and approval, safely prints warning, reports BLOCKED, and executes zero database calls.

6. [`config/gate-b-approved-target.json`](file:///C:/Sample%20report%20-%20AI/config/gate-b-approved-target.json):
   - Established independent, non-secret configuration file specifying the approved disposable target project reference and hostname.

7. [`scripts/run-gate-b-live-tests.cjs`](file:///C:/Sample%20report%20-%20AI/scripts/run-gate-b-live-tests.cjs):
   - Guard 2 & Guard 3: Replaced `.env` allowlist with independent project verification via `config/gate-b-approved-target.json`.
   - Teardown: Explicitly checks and logs profile deletion errors (`profileDelErr`), tracks `uncleanedResources`, and exits with code 1 if any resource fails cleanup.
   - TC-02b: Tests deactivated persona on proven valid live operation, strictly verifying authorization RLS denial and rejecting false positives.
   - TC-16e: Specifically inspects `FunctionsHttpError` for HTTP 403 Forbidden, rejecting network or 500 errors.

8. [`src/test/phaseB2R4Regression.test.ts`](file:///C:/Sample%20report%20-%20AI/src/test/phaseB2R4Regression.test.ts):
   - Added 7 targeted unit tests verifying all F-01 through F-04 contracts locally.

---

## 3. NON-DESTRUCTIVE LOCAL VERIFICATION EVIDENCE

| Verification Step | Command | Result | Details |
| :--- | :--- | :---: | :--- |
| **Syntax Validation** | `node --check scripts/run-gate-b-live-tests.cjs` | **PASS (Exit 0)** | Zero syntax errors in Gate B test runner. |
| **Linter** | `npm run lint` | **PASS (Exit 0)** | 0 errors across 48 files with 116 rules. |
| **Default Unit & Security Tests** | `npm test` | **PASS (Exit 0)** | 10 test files passed (254 tests) in 2.35s. `databaseIntegration.test.ts` was not discovered/run. |
| **Explicit Integration Command** | `npm run test:integration:live` | **PASS (Exit 0)** | Runs isolated integration file; detects `ENABLE_LIVE_DB_TESTS` is unset; safely reports BLOCKED with 0 writes. |
| **Production Build** | `npm run build` | **PASS (Exit 0)** | Clean TypeScript compilation (`tsc -b`) and Vite production bundle generated in 277ms. |
| **Runner Fail-Closed Guard (No Env)** | `node scripts/run-gate-b-live-tests.cjs` | **PASS (Exit 1)** | Exits with code 1 when credentials are not configured in `.env`. Zero network requests. |
| **Runner Fail-Closed Guard (Unapproved)** | `node scripts/run-gate-b-live-tests.cjs` (with dummy env) | **PASS (Exit 1)** | Exits with code 1 when `config/gate-b-approved-target.json` is unconfigured. Rejects self-approval. |

---

## 4. REMAINING LIVE VERIFICATION

The following verifications require a live disposable Supabase project and cannot be demonstrated solely with local mocks:
1. **Live F-01 Execution:** Real PostgreSQL trigger execution during `retry_attachment_upload()` confirming transition from `FAILED` to `PENDING` with fresh storage path.
2. **Live F-03 Execution:** Real project ref match against `config/gate-b-approved-target.json` and verification of teardown cascade across Supabase Auth, profiles, and private Storage.
3. **Live F-04 Execution:** Real `FunctionsHttpError` status 403 response from deployed Deno Edge Function and PostgreSQL RLS error `42501` for inactive user mutation.
