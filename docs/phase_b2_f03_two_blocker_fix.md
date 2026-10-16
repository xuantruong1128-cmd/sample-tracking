# PHASE B2 — F-03 TWO-BLOCKER TARGETED FIX REPORT

**Date:** 2026-10-12  
**Project:** Sample Tracking V1.0  
**Role:** Senior Node.js / Supabase Security Engineer  
**Source:** Independent Codex Final Gate A Audit  
**Status:** Remediated — Fix A & Fix B Verified  

---

## 1. EXECUTIVE SUMMARY

The previous Gate A audit confirmed that while findings F-01, F-02, and F-04 passed all security and functional checks, finding F-03 contained two distinct execution-safety defects that blocked Gate B live execution:

1. **Defect A (Path Resolution & Directory Traversal Risk):** Approval path resolution in `gate-b-target-validator.cjs` accepted caller-provided `repoRoot` and fell back to `process.cwd()`. An alternate current working directory or external caller parameter could cause the validator to read an unapproved or attacker-controlled configuration file from outside the repository.
2. **Defect B (Storage Cleanup Premature Registration & Ownership Confusion):** The live test runner (`scripts/run-gate-b-live-tests.cjs`) eagerly registered target object storage paths into `createdResources.storagePaths` *prior* to upload execution. If an upload was rejected because an object already existed or because of network/RLS errors, the runner would attempt to delete that path during teardown, risking accidental destruction of pre-existing storage objects not owned by the test run. Furthermore, one upload call lacked explicit `upsert: false`.

Both blockers have been resolved with strict root-cause corrections:
- **Fix A:** The validator derives the repository root exclusively from its own physical module location via `__dirname` and `path.resolve(__dirname, '..')`. All caller-provided roots, `process.cwd()`, and environment overrides (`GATE_B_CONFIG_PATH`) are strictly ignored.
- **Fix B:** A dedicated `createStorageResourceTracker()` registers storage paths for automatic cleanup **only** after upload returns successfully without error (`!error && !thrown`). Failed, rejected, or duplicate upload attempts are captured in a separate `ambiguousStoragePaths` diagnostic list and warned about during teardown, never deleted. All upload invocations strictly specify `upsert: false`.

---

## 2. ROOT CAUSE ANALYSIS & CODE CHANGES

### Defect A: Non-Anchored Approval Configuration Resolution

* **Root Cause:**
  `loadApprovalConfigFile(customRepoRoot)` accepted a caller-supplied root and fell back to `process.cwd()`. When invoked from subdirectories or external tooling, `path.resolve(repoRoot, 'config/gate-b-approved-target.json')` resolved relative to the calling shell rather than the project root.
* **Remediation:**
  Anchored configuration resolution directly to `__dirname` of `scripts/gate-b-target-validator.cjs`.
  ```javascript
  const CANONICAL_REPO_ROOT = path.resolve(__dirname, '..');
  const FIXED_CONFIG_RELATIVE_PATH = path.join('config', 'gate-b-approved-target.json');
  const CANONICAL_APPROVAL_CONFIG_PATH = path.resolve(CANONICAL_REPO_ROOT, FIXED_CONFIG_RELATIVE_PATH);
  ```
  `getFixedApprovalConfigPath()` returns `CANONICAL_APPROVAL_CONFIG_PATH` directly without arguments, and `loadApprovalConfigFile()` strictly reads this path.
* **Changed Files & Lines:**
  - `scripts/gate-b-target-validator.cjs`: lines 16–28, lines 39–50, lines 231–246.
  - `scripts/run-gate-b-live-tests.cjs`: line 86 (removed `repoRoot: process.cwd()`).
  - `src/test/databaseIntegration.test.ts`: line 37 (removed `repoRoot: process.cwd()`).

---

### Defect B: Eager Storage Registration & Object Ownership Proving

* **Root Cause:**
  In `scripts/run-gate-b-live-tests.cjs`, three test cases (`TC-14`/`TC-15`, `TC-16c`, `TC-16f`) previously called `createdResources.storagePaths.push(path)` *before* the upload call. If `storage.upload(...)` failed or was rejected due to an existing object at that path, teardown would call `storage.remove([path])`, deleting an object created by someone else. In addition, `TC-16c` lacked `upsert: false`.
* **Remediation:**
  1. Implemented `createStorageResourceTracker()` in `scripts/gate-b-target-validator.cjs`.
  2. Wrapped every upload attempt in try/catch and recorded the result via `storageTracker.recordUploadAttempt({ path, error, thrown })`.
  3. Paths are registered in `confirmedStoragePaths` if and only if `!error && !thrown`.
  4. Failed/duplicate/rejected paths are recorded in `ambiguousStoragePaths` with failure rationale and timestamp for audit purposes.
  5. `cleanupCreatedResources()` warns on ambiguous paths without attempting removal, and calls `storage.remove()` **only** on `storageTracker.getPathsToDelete()`.
  6. Added `upsert: false` to all test upload calls (`TC-15`, `TC-16c`, `TC-16f`).
* **Changed Files & Lines:**
  - `scripts/gate-b-target-validator.cjs`: lines 248–287 (`createStorageResourceTracker` implementation).
  - `scripts/run-gate-b-live-tests.cjs`:
    - Lines 110–121: Initialized `storageTracker` and wired `createdResources`.
    - Lines 588–608 (`TC-15`): Wrapped upload in try/catch and recorded attempt via `storageTracker`.
    - Lines 643–654 (`TC-16c`): Removed eager push, added `upsert: false`, recorded attempt via `storageTracker`.
    - Lines 734–747 (`TC-16f`): Removed eager push, added try/catch, recorded attempt via `storageTracker`.
    - Lines 920–946 (`cleanupCreatedResources`): Added audit warning for ambiguous paths and limited `remove()` to `storageTracker.getPathsToDelete()`.

---

## 3. ACCEPTANCE TEST MATRIX

All 12 acceptance criteria (A1–A6 and B1–B6) are codified as offline tests in `src/test/phaseB2R4Regression.test.ts`:

| Test ID | Description | Result |
|---|---|---|
| **A1** | Default target validation uses `CANONICAL_APPROVAL_CONFIG_PATH` derived from validator `__dirname` | **PASS** |
| **A2** | Running validator from an alternate `process.cwd()` resolves the exact same canonical approval file | **PASS** |
| **A3** | `validateTargetApproval({ repoRoot })` ignores caller-provided `repoRoot` and resolves canonical file | **PASS** |
| **A4** | Environment variable `GATE_B_CONFIG_PATH` is demonstrably ignored | **PASS** |
| **A5** | Tampering with config in an external directory has zero impact on canonical validation | **PASS** |
| **A6** | `getFixedApprovalConfigPath()` returns `CANONICAL_APPROVAL_CONFIG_PATH` and accepts no redirection | **PASS** |
| **B1** | Object path is NOT added to deletion list before upload is called | **PASS** |
| **B2** | Object path is added to deletion list ONLY when upload succeeds with `!error && !thrown` | **PASS** |
| **B3** | When upload returns an error (409 duplicate / RLS error), path is recorded in `ambiguousStoragePaths` and NOT deletion list | **PASS** |
| **B4** | When upload throws an exception (network failure), path is recorded in `ambiguousStoragePaths` and NOT deletion list | **PASS** |
| **B5** | When cleanup runs, it invokes `remove()` with only confirmed paths and logs warnings for ambiguous paths without attempting removal | **PASS** |
| **B6** | Every upload call in `scripts/run-gate-b-live-tests.cjs` includes `upsert: false` and zero eager pushes | **PASS** |

---

## 4. VERIFICATION RESULTS

### 4.1 Unit & Offline Regression Tests
```
> vitest run

 ✓ src/test/phaseB2R4Regression.test.ts (33 tests)
 ✓ src/test/routing.test.ts (6 tests)
 ✓ src/test/authUtils.test.ts (4 tests)
 ✓ src/test/phoneCanonicalization.test.ts (10 tests)
 ✓ src/test/permissions.test.ts (6 tests)
 ✓ src/test/securityWorkflow.test.ts (211 tests)
 ✓ src/test/jobDashboard.test.tsx (2 tests)
 ✓ src/test/dataIntegrity.test.tsx (3 tests)
 ✓ src/test/authFlow.test.tsx (2 tests)
 ✓ src/test/ui.test.tsx (3 tests)

 Test Files  10 passed (10)
      Tests  280 passed (280)
   Duration  2.46s
```

### 4.2 Linter & Typecheck
- **oxlint:** 0 errors (5 benign warnings in preexisting React components).
- **tsc -b && vite build:** Built in 1.17s with 0 errors.

### 4.3 Fail-Closed Runner Execution
- **Without credentials:** Exits with code 1 (`GATE B AUDIT STATUS: BLOCKED`).
- **With dummy credentials but unconfigured canonical approval:** Exits with code 1 (`GATE B SAFETY GUARD: TARGET APPROVAL REJECTED: Missing or unconfigured approval`) prior to any client creation or network mutation.

---

## 5. LIVE GATE B PRE-REQUISITES

To execute Gate B live cloud tests against a real Supabase instance, the following prerequisites must be met by an operator:
1. **Dedicated Disposable Supabase Instance:** A test project isolated from production.
2. **Independent Approval Configuration:** Configure `config/gate-b-approved-target.json`:
   - `approvedProjectRef`: `<exact-project-ref>`
   - `approvedHostname`: `<exact-ref>.supabase.co`
   - `isDisposable`: `true`
   - `approvedBy`: `<auditor-identity>`
   - `approvedAt`: `<iso8601-timestamp>`
3. **Dedicated Test Credentials in `.env`:**
   - `SUPABASE_TEST_URL`
   - `SUPABASE_TEST_SERVICE_KEY`
   - `SUPABASE_TEST_ANON_KEY`
   - `SUPABASE_TEST_IS_DISPOSABLE=true`
