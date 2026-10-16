# SAMPLE TRACKING V1.0 — F-03 FINAL ROOT-CAUSE FIX REPORT

**Project**: `C:\Sample report - AI`  
**Mode**: Targeted Security Fix — F-03 & Offline Test Safety  
**Status**: COMPLETE (All 12 acceptance cases pass; zero network access in default tests)

---

## 1. Exact Root Cause

Prior to this fix, three interrelated defects caused F-03 to fail independent audit:

1. **Divergent, Duplicated Approval Logic Across Entry Points**:
   - `scripts/run-gate-b-live-tests.cjs` implemented one version of the project approval logic.
   - `src/test/databaseIntegration.test.ts` implemented an independent, duplicate version that still retained legacy `approvedProjectId` fallback (`approvedConfig.approvedProjectRef || approvedConfig.approvedProjectId || ''`) and permissive OR matching (`targetRef === approvedTargetRef || targetHost === approvedHost`).
   - Neither entry point enforced a strict whitelist of configuration keys, permitting misspelled keys (e.g., `approvedHostName`) or unexpected fields to bypass validation.

2. **Environment Variable Configuration Path Override**:
   - `scripts/run-gate-b-live-tests.cjs` accepted `process.env.GATE_B_CONFIG_PATH`, allowing an environment variable to redirect target approval to an arbitrary file. Independent approval must strictly resolve from a fixed, non-secret repository file.

3. **Operational Runner Execution in Default Regression Suite**:
   - `src/test/phaseB2R4Regression.test.ts` invoked `spawnSync('node', [runnerScript])` during default `npm test`. Because the operational runner executes network operations upon passing approval preflight, this broke the invariant that `npm test` must remain 100% offline and side-effect-free.

---

## 2. Changed Files and Lines

### A. New File: `scripts/gate-b-target-validator.cjs` (Lines 1–214)
- **Role**: Centralized, side-effect-free, pure target approval validator shared by all live test entry points and regression suites.
- **Exports**:
  - `ALLOWED_CONFIG_KEYS`: Strict Set of permissible keys (`$schema`, `description`, `approvedProjectRef`, `approvedHostname`, `isDisposable`, `approvedBy`, `approvedAt`).
  - `FIXED_CONFIG_RELATIVE_PATH`: Fixed string `'config/gate-b-approved-target.json'`.
  - `getFixedApprovalConfigPath(repoRoot)`: Resolves fixed repository-relative path, demonstrably ignoring any environment variable.
  - `loadApprovalConfigFile(repoRoot)`: Loads and parses fixed JSON config.
  - `validateApprovalObject(configObj, targetUrl, isDisposableEnv)`: Pure, side-effect-free validation function.
  - `validateTargetApproval(options)`: Unified entry point with optional `configOverride` for in-memory testing.

### B. Modified: `scripts/run-gate-b-live-tests.cjs`
- **Line 33**: Added `const { validateTargetApproval } = require('./gate-b-target-validator.cjs');`.
- **Lines 82–101**: Replaced duplicated parsing, legacy checks, and `GATE_B_CONFIG_PATH` override with:
  ```javascript
  const approvalResult = validateTargetApproval({
    repoRoot: process.cwd(),
    targetUrl: supabaseUrl,
    isDisposableEnv: isDisposable,
  });

  if (!approvalResult.ok) {
    console.error('\n🛑 [GATE B SAFETY GUARD: TARGET APPROVAL REJECTED]');
    console.error(`   Lý do: ${approvalResult.reason}`);
    process.exit(1);
  }

  const { targetRef, targetHost } = approvalResult;
  console.log(`  Target verified: ${targetHost} (Ref: ${targetRef}) [INDEPENDENT APPROVAL: MATCH]`);
  ```
- **Ordering Preserved**: Approval validation strictly executes before `createClient` (line 117) and before `setupPersonas()` (line 280).

### C. Modified: `src/test/databaseIntegration.test.ts`
- **Lines 23–27**: Replaced ad-hoc `fs`/`path` imports with:
  ```typescript
  import { createRequire } from 'module';
  const requireModule = createRequire(import.meta.url);
  const { validateTargetApproval } = requireModule('../../scripts/gate-b-target-validator.cjs');
  ```
- **Lines 35–46**: Replaced duplicate parsing, legacy `approvedProjectId` fallback, and OR-matching with:
  ```typescript
  const approvalResult = validateTargetApproval({
    repoRoot: process.cwd(),
    targetUrl: testUrl || '',
    isDisposableEnv: isDisposable,
  });

  const isIndependentlyApproved = approvalResult.ok;
  const targetRef = approvalResult.targetRef || '';
  const targetHost = approvalResult.targetHost || '';
  ```
- **Line 69**: Updated blocked notice reason: `reason = approvalResult.reason || ...`.
- **Safety**: When approval fails, `isLiveDbSafe` is `false`, and the suite reports `BLOCKED` without initializing `createClient` or making network requests.

### D. Modified: `src/test/phaseB2R4Regression.test.ts`
- **Lines 10–20**: Imported `validateApprovalObject`, `validateTargetApproval`, and `getFixedApprovalConfigPath` from the shared validator.
- **Lines 68–110**: Added static verification proving both entry points call `validateTargetApproval` strictly before any `createClient` or persona/test setup.
- **Lines 111–248**: Replaced all `spawnSync` operational runner execution with pure, offline, in-memory fixtures evaluating all 12 acceptance cases.

---

## 3. Shared Validator Implementation

The shared validator (`scripts/gate-b-target-validator.cjs`) enforces:

1. **Strict Key Whitelist**:
   ```javascript
   const ALLOWED_CONFIG_KEYS = new Set([
     '$schema', 'description', 'approvedProjectRef', 'approvedHostname',
     'isDisposable', 'approvedBy', 'approvedAt'
   ]);
   for (const key of Object.keys(configObj)) {
     if (!ALLOWED_CONFIG_KEYS.has(key)) {
       if (key === 'approvedProjectId') {
         return { ok: false, reason: 'Field "approvedProjectId" is strictly forbidden and rejected. Only canonical "approvedProjectRef" is permitted.' };
       }
       return { ok: false, reason: `Unexpected or misspelled configuration key "${key}". Allowed keys: ${Array.from(ALLOWED_CONFIG_KEYS).join(', ')}.` };
     }
   }
   ```
2. **Canonical Mandatory Fields**:
   - `approvedProjectRef`: non-empty string.
   - `approvedHostname`: non-empty string.
   - `isDisposable`: strictly `true`.
   - `isDisposableEnv`: strictly `true`.
3. **Strict AND Matching**:
   ```javascript
   if (targetRef !== approvedRef) {
     return { ok: false, reason: `Target project reference '${targetRef}' does not match canonical approvedProjectRef '${approvedRef}'.` };
   }
   if (targetHost !== approvedHost) {
     return { ok: false, reason: `Target hostname '${targetHost}' does not match canonical approvedHostname '${approvedHost}'.` };
   }
   ```
4. **Fixed Path Resolution**:
   ```javascript
   function getFixedApprovalConfigPath(repoRoot) {
     const root = repoRoot || process.cwd();
     return path.resolve(root, 'config', 'gate-b-approved-target.json');
   }
   ```
   No environment variable can alter or override this path.

---

## 4. Twelve Acceptance Results

All 12 acceptance cases were verified against the shared validator:

| # | Acceptance Case | Test Input / Condition | Validator Decision | Verdict |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Valid approvedProjectRef + approvedHostname** | Ref: `test-ref-123`, Host: `test-ref-123.supabase.co`, Disposable: `true`, Target: `https://test-ref-123.supabase.co`, Env: `true` | `ok: true`, matches ref & host | **PASS** |
| **2** | **Reference matches, hostname mismatches** | Ref: `test-ref-123`, Host: `mismatch-host.supabase.co`, Target: `https://test-ref-123.supabase.co` | `ok: false`, rejects on hostname mismatch | **PASS** |
| **3** | **Hostname matches, reference mismatches** | Ref: `wrong-ref`, Host: `test-ref-123.supabase.co`, Target: `https://test-ref-123.supabase.co` | `ok: false`, rejects on reference mismatch | **PASS** |
| **4** | **approvedProjectId only** | Config has `{ approvedProjectId: 'test-ref-123', isDisposable: true }` | `ok: false`, strictly rejects forbidden key | **PASS** |
| **5** | **approvedProjectRef + approvedProjectId** | Config has both `approvedProjectRef` and `approvedProjectId` | `ok: false`, strictly rejects forbidden key | **PASS** |
| **6** | **Unknown approval key** | Config includes unexpected key `{ unexpectedKey: '...' }` | `ok: false`, rejects unwhitelisted key | **PASS** |
| **7** | **Misspelled approvedHostname** | Config includes misspelled `{ approvedHostName: '...' }` | `ok: false`, rejects unwhitelisted key | **PASS** |
| **8** | **Missing approval** | Input is `null`, `undefined`, or array | `ok: false`, requires valid JSON object | **PASS** |
| **9** | **Unconfigured approval** | Empty ref `""`, empty host `""`, or `isDisposable: false` | `ok: false`, rejects unconfigured approval | **PASS** |
| **10** | **Environment variable override attempt** | `process.env.GATE_B_CONFIG_PATH = '/evil/override.json'` | Path remains fixed to `config/gate-b-approved-target.json` | **PASS** |
| **11** | **Invalid approval prevents network/client setup** | Evaluated before any client initialization | Verified by static AST ordering in both live entry points | **PASS** |
| **12** | **Both live entry points return identical decisions** | Evaluated identical matrix across runner and integration suite | 100% decision and reason parity | **PASS** |

---

## 5. Evidence that Default npm test is Offline

1. **No Operational Runner Execution**: Removed `spawnSync` of `scripts/run-gate-b-live-tests.cjs` from the test suite. All tests execute purely in-memory.
2. **No HTTP Requests or Client Setup**: The regression test suite imports only the pure validation functions.
3. **Execution Speed**: All 268 tests in 10 test files complete in **3.62 seconds** (`phaseB2R4Regression.test.ts` executes in **23ms**):
   ```powershell
   npm.cmd test
   # Test Files: 10 passed (10)
   # Tests:      268 passed (268)
   # Duration:   3.62s
   ```
4. **Safety Under Pre-set Credentials**: Even if `SUPABASE_TEST_*` credentials exist in `.env`, `npm test` never invokes the live runner and never executes live DB tests (protected by `ENABLE_LIVE_DB_TESTS=true` and default vitest exclude rules).

---

## 6. Verification Results

- `node --check scripts/run-gate-b-live-tests.cjs` → **Exit 0 (Syntax valid)**
- `node --check scripts/gate-b-target-validator.cjs` → **Exit 0 (Syntax valid)**
- `npm.cmd test` → **268/268 PASS (0 failed, 100% offline)**
- `npm.cmd run lint` → **0 errors, 5 pre-existing warnings in unrelated UI files**
- `npm.cmd run build` → **Built in 491ms, Exit 0**
- `node scripts/run-gate-b-live-tests.cjs` → **Fail-closed exit 1 (Blocked on missing test credentials)**

---

## 7. Remaining Live Gate B Requirements

1. **Infrastructure Provisioning**: A real, dedicated disposable Supabase instance must be provisioned.
2. **Approval Signing**: The disposable project ref and hostname must be recorded in [`config/gate-b-approved-target.json`](file:///c:/Sample%20report%20-%20AI/config/gate-b-approved-target.json) with `isDisposable: true`.
3. **Credential Binding**: Dedicated credentials (`SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_IS_DISPOSABLE=true`) must be provided in the test runner's private execution environment.
4. **Execution Protocol**: Live tests must only be triggered via `node scripts/run-gate-b-live-tests.cjs` or `npm run test:integration:live` with explicit `ENABLE_LIVE_DB_TESTS=true`.
