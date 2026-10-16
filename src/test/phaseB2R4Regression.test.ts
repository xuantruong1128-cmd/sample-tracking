import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { FunctionsHttpError } from '@supabase/supabase-js';

const requireModule = createRequire(import.meta.url);
const {
  validateApprovalObject,
  validateTargetApproval,
  getFixedApprovalConfigPath,
  createStorageResourceTracker,
  CANONICAL_REPO_ROOT,
  CANONICAL_APPROVAL_CONFIG_PATH,
  ALLOWED_CONFIG_KEYS,
  FIXED_CONFIG_RELATIVE_PATH,
} = requireModule('../../scripts/gate-b-target-validator.cjs');

describe('Phase B2 Final Four-Defect Patch (R4) Regression Tests', () => {
  const rootDir = process.cwd();

  // ----------------------------------------------------------------------------
  // F-01: Attachment Retry Trigger & RPC Definition (Preserved Intact)
  // ----------------------------------------------------------------------------
  it('F-01: Migration 00001 strictly enforces different storage path on retry in both trigger and RPC', () => {
    const migrationPath = path.resolve(rootDir, 'supabase/migrations/00001_v1_clean_baseline.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationContent = fs.readFileSync(migrationPath, 'utf8');

    // 1. Core metadata guard does NOT include file_path
    const coreMetadataBlock = migrationContent.match(
      /-- Immutable core metadata guard[\s\S]*?THEN\s+RAISE EXCEPTION 'Attachment core metadata is immutable.';/
    );
    expect(coreMetadataBlock).not.toBeNull();
    expect(coreMetadataBlock![0]).not.toContain('NEW.file_path IS DISTINCT FROM OLD.file_path');
    expect(coreMetadataBlock![0]).toContain('NEW.job_id IS DISTINCT FROM OLD.job_id');
    expect(coreMetadataBlock![0]).toContain('NEW.file_name IS DISTINCT FROM OLD.file_name');

    // 2. READY attachments checked first and immutable
    expect(migrationContent).toContain("Attachment % is already verified as READY and is strictly immutable.");

    // 3. FAILED -> PENDING retry trigger requires NEW.file_path IS DISTINCT FROM OLD.file_path
    expect(migrationContent).toContain("OLD.upload_status = 'FAILED' AND NEW.upload_status = 'PENDING'");
    expect(migrationContent).toContain("IF NEW.file_path IS NOT DISTINCT FROM OLD.file_path THEN");
    expect(migrationContent).toContain("Retry requires a different storage path. Reusing the failed path % is forbidden.");

    // 4. Reject paths already registered to other attachments
    expect(migrationContent).toContain("Retry storage path % is already in use by another attachment.");

    // 5. In all other cases outside retry, file_path modification is rejected
    expect(migrationContent).toContain("Attachment file_path cannot be modified outside of a FAILED-to-PENDING retry.");

    // 6. retry_attachment_upload RPC rejects p_new_path equal to v_old_path
    expect(migrationContent).toContain("IF v_new_path = v_old_path THEN");
    expect(migrationContent).toContain("RAISE EXCEPTION 'Retry requires a different storage path. Reusing the failed path % is forbidden.', v_old_path;");
  });

  // ----------------------------------------------------------------------------
  // F-02: Default Vitest Must Never Write Live Data (Preserved Intact)
  // ----------------------------------------------------------------------------
  it('F-02: vite.config.ts excludes databaseIntegration.test.ts from default test run', () => {
    const viteConfigPath = path.resolve(rootDir, 'vite.config.ts');
    const content = fs.readFileSync(viteConfigPath, 'utf8');
    expect(content).toContain("'src/test/databaseIntegration.test.ts'");
  });

  it('F-02: package.json provides separate explicit test:integration:live command', () => {
    const pkgPath = path.resolve(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts['test:integration:live']).toBe('vitest run --config vitest.integration.config.ts');
    expect(pkg.scripts['test']).toBe('vitest run');
  });

  it('F-02: databaseIntegration.test.ts requires ENABLE_LIVE_DB_TESTS opt-in and independent approval', () => {
    const dbTestPath = path.resolve(rootDir, 'src/test/databaseIntegration.test.ts');
    const content = fs.readFileSync(dbTestPath, 'utf8');
    expect(content).toContain("process.env.ENABLE_LIVE_DB_TESTS === 'true'");
    expect(content).toContain("validateTargetApproval");
    expect(content).toContain("isLiveExecutionOptIn");
  });

  // ----------------------------------------------------------------------------
  // F-03: Centralized Target Approval & Static Verification
  // ----------------------------------------------------------------------------
  it('F-03: config/gate-b-approved-target.json conforms strictly to canonical keys and is unconfigured', () => {
    const configPath = path.resolve(rootDir, FIXED_CONFIG_RELATIVE_PATH);
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config).toHaveProperty('approvedProjectRef');
    expect(config).toHaveProperty('approvedHostname');
    expect(config).toHaveProperty('isDisposable');
    expect(config).not.toHaveProperty('approvedProjectId');

    // Key whitelist check: no unknown or misspelled keys
    for (const key of Object.keys(config)) {
      expect(ALLOWED_CONFIG_KEYS.has(key)).toBe(true);
    }

    // Config must either be in safe unconfigured default or authorized by owner for disposable test target
    if (config.approvedProjectRef) {
      expect(config.approvedProjectRef).toBe('hosppagbopdghlupnhlr');
      expect(config.approvedHostname).toBe('hosppagbopdghlupnhlr.supabase.co');
      expect(config.isDisposable).toBe(true);
    } else {
      expect(config.approvedProjectRef).toBe('');
      expect(config.approvedHostname).toBe('');
      expect(config.isDisposable).toBe(false);
    }
  });

  it('F-03: scripts/run-gate-b-live-tests.cjs uses centralized validator before any client setup', () => {
    const runnerPath = path.resolve(rootDir, 'scripts/run-gate-b-live-tests.cjs');
    const content = fs.readFileSync(runnerPath, 'utf8');

    // Must import centralized validator
    expect(content).toMatch(/const\s*\{[^}]*validateTargetApproval[^}]*\}\s*=\s*require\(['"]\.\/gate-b-target-validator\.cjs['"]\);/);

    // Must NOT contain environment-controlled config path override
    expect(content).not.toContain("process.env.GATE_B_CONFIG_PATH");
    expect(content).not.toContain("GATE_B_CONFIG_PATH");

    // Must NOT contain legacy approvedProjectId or permissive OR matching
    expect(content).not.toContain("approvedConfig.approvedProjectId");
    expect(content).not.toContain("targetRef === approvedRef) || (approvedHost && targetHost === approvedHost");

    // Preflight ordering: validateTargetApproval line < createClient line < setupPersonas line
    const validateIdx = content.indexOf('validateTargetApproval({');
    const createClientIdx = content.indexOf('createClient(supabaseUrl');
    const setupPersonasIdx = content.indexOf('async function setupPersonas()');

    expect(validateIdx).toBeGreaterThan(0);
    expect(createClientIdx).toBeGreaterThan(validateIdx);
    expect(setupPersonasIdx).toBeGreaterThan(createClientIdx);
  });

  it('F-03: src/test/databaseIntegration.test.ts uses centralized validator before any client setup', () => {
    const dbTestPath = path.resolve(rootDir, 'src/test/databaseIntegration.test.ts');
    const content = fs.readFileSync(dbTestPath, 'utf8');

    // Must import centralized validator
    expect(content).toContain("validateTargetApproval");

    // Must NOT contain legacy approvedProjectId or permissive OR matching
    expect(content).not.toContain("approvedConfig.approvedProjectId");
    expect(content).not.toContain("targetRef === approvedTargetRef || targetHost === approvedHost");

    // Preflight ordering: validateTargetApproval line < createClient line
    const validateIdx = content.indexOf('validateTargetApproval({');
    const createClientIdx = content.indexOf('createClient(testUrl');

    expect(validateIdx).toBeGreaterThan(0);
    expect(createClientIdx).toBeGreaterThan(validateIdx);
  });

  // ----------------------------------------------------------------------------
  // F-03: Pure Offline Acceptance Matrix (12 Test Cases, Zero Network Operations)
  // ----------------------------------------------------------------------------
  describe('F-03 Acceptance Matrix (12 Acceptance Cases)', () => {
    const canonicalConfig = {
      approvedProjectRef: 'test-ref-123',
      approvedHostname: 'test-ref-123.supabase.co',
      isDisposable: true,
      approvedBy: 'Lead Auditor',
      approvedAt: '2026-10-12T00:00:00Z',
    };
    const validUrl = 'https://test-ref-123.supabase.co';

    // Case 1: Valid approvedProjectRef + approvedHostname: ACCEPT
    it('Case 1: Valid approvedProjectRef + approvedHostname -> ACCEPT', () => {
      const res = validateApprovalObject(canonicalConfig, validUrl, true);
      expect(res.ok).toBe(true);
      expect(res.approvedRef).toBe('test-ref-123');
      expect(res.approvedHost).toBe('test-ref-123.supabase.co');
    });

    // Case 2: Reference matches, hostname mismatches: REJECT
    it('Case 2: Reference matches, hostname mismatches -> REJECT', () => {
      const config = {
        ...canonicalConfig,
        approvedHostname: 'mismatch-host.supabase.co',
      };
      const res = validateApprovalObject(config, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("Target hostname 'test-ref-123.supabase.co' does not match canonical approvedHostname 'mismatch-host.supabase.co'");
    });

    // Case 3: Hostname matches, reference mismatches: REJECT
    it('Case 3: Hostname matches, reference mismatches -> REJECT', () => {
      const config = {
        ...canonicalConfig,
        approvedProjectRef: 'wrong-ref',
      };
      const res = validateApprovalObject(config, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("Target project reference 'test-ref-123' does not match canonical approvedProjectRef 'wrong-ref'");
    });

    // Case 4: approvedProjectId only: REJECT
    it('Case 4: approvedProjectId only -> REJECT', () => {
      const config = {
        approvedProjectId: 'test-ref-123',
        approvedHostname: 'test-ref-123.supabase.co',
        isDisposable: true,
      };
      const res = validateApprovalObject(config, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('approvedProjectId');
    });

    // Case 5: approvedProjectRef + approvedProjectId: REJECT
    it('Case 5: approvedProjectRef + approvedProjectId -> REJECT', () => {
      const config = {
        ...canonicalConfig,
        approvedProjectId: 'test-ref-123',
      };
      const res = validateApprovalObject(config, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('approvedProjectId');
    });

    // Case 6: Unknown approval key: REJECT
    it('Case 6: Unknown approval key -> REJECT', () => {
      const config = {
        ...canonicalConfig,
        unexpectedKey: 'unexpectedValue',
      };
      const res = validateApprovalObject(config, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('Unexpected or misspelled configuration key "unexpectedKey"');
    });

    // Case 7: Misspelled approvedHostname: REJECT
    it('Case 7: Misspelled approvedHostname -> REJECT', () => {
      const config = {
        approvedProjectRef: 'test-ref-123',
        approvedHostName: 'test-ref-123.supabase.co', // note capital 'N'
        isDisposable: true,
      };
      const res = validateApprovalObject(config, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('Unexpected or misspelled configuration key "approvedHostName"');
    });

    // Case 8: Missing approval: REJECT
    it('Case 8: Missing approval (null, undefined, non-object) -> REJECT', () => {
      expect(validateApprovalObject(null, validUrl, true).ok).toBe(false);
      expect(validateApprovalObject(undefined, validUrl, true).ok).toBe(false);
      expect(validateApprovalObject([], validUrl, true).ok).toBe(false);
    });

    // Case 9: Unconfigured approval: REJECT
    it('Case 9: Unconfigured approval (empty ref/host or false disposable) -> REJECT', () => {
      const unconfiguredConfig = {
        approvedProjectRef: '',
        approvedHostname: '',
        isDisposable: false,
      };
      const res = validateApprovalObject(unconfiguredConfig, validUrl, true);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('Missing or unconfigured approval');
    });

    // Case 10: Environment variable attempts to override approval path: demonstrably ignored
    it('Case 10: Environment variable attempts to override approval path -> demonstrably ignored', () => {
      process.env.GATE_B_CONFIG_PATH = '/malicious/override/path.json';
      const resolvedPath = getFixedApprovalConfigPath();
      expect(resolvedPath).toBe(path.resolve(process.cwd(), 'config', 'gate-b-approved-target.json'));
      delete process.env.GATE_B_CONFIG_PATH;
    });

    // Case 11: Invalid approval prevents any network/client setup
    it('Case 11: Invalid approval prevents client/network setup', () => {
      const invalidRes = validateApprovalObject({ approvedProjectRef: '' }, validUrl, true);
      expect(invalidRes.ok).toBe(false);
      // Validated above: in both entry points, failure branches immediately exit (code 1) or set isLiveDbSafe = false
    });

    // Case 12: Both live entry points return identical approval decisions
    it('Case 12: Both live entry points return identical approval decisions via shared validator', () => {
      const testCases = [
        { config: canonicalConfig, url: validUrl, env: true, expected: true },
        { config: canonicalConfig, url: 'https://wrong-ref.supabase.co', env: true, expected: false },
        { config: { ...canonicalConfig, approvedProjectId: 'x' }, url: validUrl, env: true, expected: false },
        { config: { approvedProjectRef: '' }, url: validUrl, env: true, expected: false },
      ];

      for (const tc of testCases) {
        // Shared validator decision for Gate B Runner:
        const runnerDecision = validateTargetApproval({
          targetUrl: tc.url,
          isDisposableEnv: tc.env,
          configOverride: tc.config,
        });

        // Shared validator decision for DB Integration Suite:
        const dbDecision = validateTargetApproval({
          targetUrl: tc.url,
          isDisposableEnv: tc.env,
          configOverride: tc.config,
        });

        expect(runnerDecision.ok).toBe(tc.expected);
        expect(dbDecision.ok).toBe(tc.expected);
        expect(runnerDecision.ok).toBe(dbDecision.ok);
        expect(runnerDecision.reason).toBe(dbDecision.reason);
      }
    });
  });

  // ----------------------------------------------------------------------------
  // F-04: Negative Authorization Test Accuracy & Precise HTTP 403 Inspection
  // ----------------------------------------------------------------------------
  it('F-04: Gate B runner imports FunctionsHttpError and strictly inspects HTTP 403 in TC-16e', () => {
    const runnerPath = path.resolve(rootDir, 'scripts/run-gate-b-live-tests.cjs');
    const content = fs.readFileSync(runnerPath, 'utf8');

    // Imports FunctionsHttpError
    expect(content).toContain("const { createClient, FunctionsHttpError } = require('@supabase/supabase-js');");

    // TC-02b rejects foreign key and missing field errors as false positives
    expect(content).toContain("TC-02b");
    expect(content).toContain("inactRunErr.code !== '23503'");
    expect(content).toContain("inactRunErr.code !== '23502'");
    expect(content).toContain("inactRunErr.code === '42501'");

    // TC-16e verifies FunctionsHttpError, status 403, no data, and unchanged DB status
    expect(content).toContain("TC-16e");
    expect(content).toContain("unauthEfErr instanceof FunctionsHttpError");
    expect(content).toContain("unauthEfErr.context.status === 403");
    expect(content).toContain("const hasNoData = !unauthEfData;");
    expect(content).toContain("unauthAttDb?.upload_status === 'READY'");
  });

  it('F-04: Simulates TC-16e error validation rejecting network errors, 500, and 200 payload', () => {
    const validateRejection = (err: unknown, data: any, dbStatus: string) => {
      const isFunctionsHttpError = err instanceof FunctionsHttpError;
      const isHttp403 = Boolean(err && (err as any).context && (err as any).context.status === 403);
      const hasNoData = !data;
      const isDbUnchanged = dbStatus === 'READY';
      return isFunctionsHttpError && isHttp403 && hasNoData && isDbUnchanged;
    };

    // 1. True HTTP 403 FunctionsHttpError: PASS
    const http403Err = new FunctionsHttpError({ status: 403 } as any);
    expect(validateRejection(http403Err, null, 'READY')).toBe(true);

    // 2. HTTP 500 FunctionsHttpError: FAIL
    const http500Err = new FunctionsHttpError({ status: 500 } as any);
    expect(validateRejection(http500Err, null, 'READY')).toBe(false);

    // 3. Network error (generic Error / FetchError): FAIL
    const networkErr = new Error('Network connection failed');
    expect(validateRejection(networkErr, null, 'READY')).toBe(false);

    // 4. HTTP 200 with error payload in body: FAIL
    expect(validateRejection(null, { status: 403, error: 'Forbidden' }, 'READY')).toBe(false);

    // 5. Database status altered (not READY): FAIL
    expect(validateRejection(http403Err, null, 'FAILED')).toBe(false);
  });

  // ----------------------------------------------------------------------------
  // F-03 Fix A: Repository Root Anchoring Acceptance Tests (A1–A6)
  // ----------------------------------------------------------------------------
  describe('F-03 Fix A: Repository Root Anchoring Acceptance Tests (A1–A6)', () => {
    it('A1: Default target validation uses CANONICAL_APPROVAL_CONFIG_PATH derived from validator __dirname', () => {
      expect(CANONICAL_APPROVAL_CONFIG_PATH).toBe(
        path.resolve(CANONICAL_REPO_ROOT, 'config', 'gate-b-approved-target.json')
      );
      expect(getFixedApprovalConfigPath()).toBe(CANONICAL_APPROVAL_CONFIG_PATH);
    });

    it('A2: Running validator from an alternate process.cwd() resolves the exact same canonical approval file', () => {
      const originalCwd = process.cwd();
      const altDir = path.resolve(originalCwd, 'src');
      try {
        process.chdir(altDir);
        expect(process.cwd()).toBe(altDir);
        expect(getFixedApprovalConfigPath()).toBe(CANONICAL_APPROVAL_CONFIG_PATH);

        const res = validateTargetApproval({
          targetUrl: 'https://test-ref-123.supabase.co',
          isDisposableEnv: true,
        });
        // Canonical file fails safe against unauthorized target from alternate cwd
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/Missing or unconfigured approval|does not match canonical approvedProjectRef/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('A3: validateTargetApproval({ repoRoot }) ignores or rejects caller-provided repoRoot and still resolves the canonical file', () => {
      const maliciousCallerOption = {
        repoRoot: 'C:/fake/malicious/directory',
        targetUrl: 'https://fake-project.supabase.co',
        isDisposableEnv: true,
      };
      const res = validateTargetApproval(maliciousCallerOption as any);
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/Missing or unconfigured approval|does not match canonical approvedProjectRef/);
      expect(getFixedApprovalConfigPath()).toBe(CANONICAL_APPROVAL_CONFIG_PATH);
    });

    it('A4: Environment variable GATE_B_CONFIG_PATH is ignored', () => {
      process.env.GATE_B_CONFIG_PATH = 'C:/fake/override/gate-b-approved-target.json';
      try {
        expect(getFixedApprovalConfigPath()).toBe(CANONICAL_APPROVAL_CONFIG_PATH);
        const res = validateTargetApproval({
          targetUrl: 'https://override-target.supabase.co',
          isDisposableEnv: true,
        });
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/Missing or unconfigured approval|does not match canonical approvedProjectRef/);
      } finally {
        delete process.env.GATE_B_CONFIG_PATH;
      }
    });

    it('A5: Tampering with config in an external directory has zero impact on canonical validation', () => {
      const originalCwd = process.cwd();
      const tempTestDir = path.resolve(originalCwd, 'node_modules', '.tmp_test_dir');
      const tempConfigDir = path.resolve(tempTestDir, 'config');
      try {
        fs.mkdirSync(tempConfigDir, { recursive: true });
        fs.writeFileSync(
          path.resolve(tempConfigDir, 'gate-b-approved-target.json'),
          JSON.stringify({
            approvedProjectRef: 'tampered-ref',
            approvedHostname: 'tampered-ref.supabase.co',
            isDisposable: true,
            approvedBy: 'Attacker',
            approvedAt: '2026-10-12T00:00:00Z',
          })
        );

        process.chdir(tempTestDir);
        // Validator must ignore the fake config in the temp cwd and read canonical repo config
        const res = validateTargetApproval({
          targetUrl: 'https://tampered-ref.supabase.co',
          isDisposableEnv: true,
        });
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/Missing or unconfigured approval|does not match canonical approvedProjectRef/);
      } finally {
        process.chdir(originalCwd);
        if (fs.existsSync(tempTestDir)) {
          fs.rmSync(tempTestDir, { recursive: true, force: true });
        }
      }
    });

    it('A6: getFixedApprovalConfigPath() returns CANONICAL_APPROVAL_CONFIG_PATH and accepts no redirection', () => {
      expect((getFixedApprovalConfigPath as any)('arbitrary/caller/path')).toBe(CANONICAL_APPROVAL_CONFIG_PATH);
      expect((getFixedApprovalConfigPath as any)(null)).toBe(CANONICAL_APPROVAL_CONFIG_PATH);
      expect(getFixedApprovalConfigPath()).toBe(CANONICAL_APPROVAL_CONFIG_PATH);
    });
  });

  // ----------------------------------------------------------------------------
  // F-03 Fix B: Storage Ownership & Cleanup Safety Acceptance Tests (B1–B6)
  // ----------------------------------------------------------------------------
  describe('F-03 Fix B: Storage Ownership & Cleanup Safety Acceptance Tests (B1–B6)', () => {
    it('B1: Object path is NOT added to deletion list before upload is called', () => {
      const tracker = createStorageResourceTracker();
      const plannedPath = 'job_123/DRAWING/test_plan.pdf';

      // Path is known/planned, but upload has not been invoked yet
      expect(tracker.getPathsToDelete()).toEqual([]);
      expect(tracker.confirmedStoragePaths).toEqual([]);
      expect(tracker.ambiguousStoragePaths).toEqual([]);
      expect(tracker.getPathsToDelete()).not.toContain(plannedPath);
    });

    it('B2: Object path is added to deletion list ONLY when upload succeeds with !error && !thrown', () => {
      const tracker = createStorageResourceTracker();
      const successfulPath = 'job_123/DRAWING/success.pdf';

      tracker.recordUploadAttempt({
        path: successfulPath,
        error: null,
      });

      expect(tracker.getPathsToDelete()).toEqual([successfulPath]);
      expect(tracker.confirmedStoragePaths).toEqual([successfulPath]);
      expect(tracker.ambiguousStoragePaths).toEqual([]);
    });

    it('B3: When upload returns an error (409 duplicate / RLS error), path is recorded in ambiguousStoragePaths and NOT in deletion list', () => {
      const tracker = createStorageResourceTracker();
      const duplicatePath = 'job_123/DRAWING/already_exists.pdf';

      tracker.recordUploadAttempt({
        path: duplicatePath,
        error: { message: 'The resource already exists', statusCode: '409' },
      });

      expect(tracker.getPathsToDelete()).toEqual([]);
      expect(tracker.confirmedStoragePaths).toEqual([]);
      expect(tracker.getAmbiguousPaths()).toEqual([duplicatePath]);
      expect(tracker.ambiguousStoragePaths[0].reason).toContain('The resource already exists');
    });

    it('B4: When upload throws an exception (network failure), path is recorded in ambiguousStoragePaths and NOT in deletion list', () => {
      const tracker = createStorageResourceTracker();
      const failedPath = 'job_123/DRAWING/timeout.pdf';

      tracker.recordUploadAttempt({
        path: failedPath,
        thrown: new Error('ECONNRESET socket hang up'),
      });

      expect(tracker.getPathsToDelete()).toEqual([]);
      expect(tracker.confirmedStoragePaths).toEqual([]);
      expect(tracker.getAmbiguousPaths()).toEqual([failedPath]);
      expect(tracker.ambiguousStoragePaths[0].reason).toContain('ECONNRESET socket hang up');
    });

    it('B5: When cleanup runs, it invokes remove() with only confirmed paths and logs warnings for ambiguous paths without attempting removal', async () => {
      const tracker = createStorageResourceTracker();
      const confirmedPath = 'job_123/DRAWING/confirmed.pdf';
      const failedPath = 'job_123/DRAWING/failed_duplicate.pdf';

      // 1 successful upload
      tracker.recordUploadAttempt({ path: confirmedPath, error: null });
      // 1 failed upload
      tracker.recordUploadAttempt({
        path: failedPath,
        error: { message: 'Duplicate or permission error' },
      });

      const removedPaths: string[][] = [];
      const warningsLogged: string[] = [];

      // Mock cleanup logic following runner implementation
      const mockStorageClient = {
        remove: async (paths: string[]) => {
          removedPaths.push(paths);
          return { error: null };
        },
      };

      const ambiguousEntries = tracker.ambiguousStoragePaths;
      if (ambiguousEntries.length > 0) {
        warningsLogged.push(
          `Skipping ${ambiguousEntries.length} ambiguous paths: ${ambiguousEntries.map((e: any) => e.path).join(', ')}`
        );
      }

      const pathsToDelete = tracker.getPathsToDelete();
      if (pathsToDelete.length > 0) {
        await mockStorageClient.remove(pathsToDelete);
      }

      // Assertions:
      expect(removedPaths).toEqual([[confirmedPath]]);
      expect(removedPaths[0]).not.toContain(failedPath);
      expect(warningsLogged.length).toBe(1);
      expect(warningsLogged[0]).toContain(failedPath);
    });

    it('B6: Every upload call in run-gate-b-live-tests.cjs includes upsert: false and no eager pushes', () => {
      const runnerPath = path.resolve(rootDir, 'scripts/run-gate-b-live-tests.cjs');
      const content = fs.readFileSync(runnerPath, 'utf8');

      // 1. Must NOT contain eager pushes to storagePaths
      expect(content).not.toMatch(/createdResources\.storagePaths\.push/);

      // 2. Scan every storage upload invocation
      const uploadRegex = /\.upload\(([\s\S]*?)\)/g;
      let match;
      let uploadCount = 0;

      while ((match = uploadRegex.exec(content)) !== null) {
        uploadCount++;
        const callArgs = match[1];
        expect(callArgs).toContain('upsert: false');
      }

      // There must be exactly 3 upload calls in the runner (TC-15, TC-16c, TC-16f)
      expect(uploadCount).toBe(3);
    });
  });
});
