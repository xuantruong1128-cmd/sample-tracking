/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — CENTRALIZED TARGET APPROVAL VALIDATOR (F-03)
 * ==============================================================================
 *
 * Side-effect-free, centralized approval validator shared by:
 * 1. scripts/run-gate-b-live-tests.cjs (Gate B Runner)
 * 2. src/test/databaseIntegration.test.ts (Live DB Integration Suite)
 *
 * Enforces strict invariant:
 * - Canonical field: approvedProjectRef
 * - Canonical field: approvedHostname
 * - Strict boolean: isDisposable === true
 * - Strict key whitelist (rejects approvedProjectId, unknown keys, typos)
 * - Strict reference AND hostname matching (never OR)
 * - Fixed repository-relative path (strictly config/gate-b-approved-target.json)
 * - No environment-variable path overrides
 * - No automatic approval derivation from .env
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const CANONICAL_REPO_ROOT = path.resolve(__dirname, '..');
const FIXED_CONFIG_RELATIVE_PATH = path.join('config', 'gate-b-approved-target.json');
const CANONICAL_APPROVAL_CONFIG_PATH = path.resolve(CANONICAL_REPO_ROOT, FIXED_CONFIG_RELATIVE_PATH);

const ALLOWED_CONFIG_KEYS = new Set([
  '$schema',
  'description',
  'approvedProjectRef',
  'approvedHostname',
  'isDisposable',
  'approvedBy',
  'approvedAt',
]);

/**
 * Resolves the fixed repository-relative approval configuration path.
 * Strictly anchored to the validator module's own physical directory (__dirname).
 * Does NOT accept process.cwd(), caller-supplied repoRoot, or environment variables.
 *
 * @returns {string} Absolute path to canonical config/gate-b-approved-target.json
 */
function getFixedApprovalConfigPath() {
  return CANONICAL_APPROVAL_CONFIG_PATH;
}

/**
 * Loads the approval configuration from the canonical repository root file.
 * Always resolves from CANONICAL_APPROVAL_CONFIG_PATH.
 *
 * @returns {{ ok: boolean, data?: Record<string, unknown>, error?: string, filePath: string }}
 */
function loadApprovalConfigFile() {
  const filePath = CANONICAL_APPROVAL_CONFIG_PATH;

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      error: `Missing independent approval file: ${filePath}. Approval must be configured in ${FIXED_CONFIG_RELATIVE_PATH}.`,
      filePath,
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      data: parsed,
      filePath,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON in approval file ${filePath}: ${err.message}`,
      filePath,
    };
  }
}

/**
 * Pure, side-effect-free validation of an approval configuration object and target URL.
 *
 * @param {unknown} configObj Parsed approval configuration object
 * @param {string} targetUrl Supabase target URL
 * @param {boolean} isDisposableEnv Explicit disposable flag from environment
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   approvedRef?: string,
 *   approvedHost?: string,
 *   targetRef?: string,
 *   targetHost?: string
 * }}
 */
function validateApprovalObject(configObj, targetUrl, isDisposableEnv) {
  if (!configObj || typeof configObj !== 'object' || Array.isArray(configObj)) {
    return {
      ok: false,
      reason: 'Approval configuration must be a valid non-null JSON object.',
    };
  }

  // 1. Strict key whitelist: reject any unknown, misspelled, or forbidden keys
  for (const key of Object.keys(configObj)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      if (key === 'approvedProjectId') {
        return {
          ok: false,
          reason: 'Field "approvedProjectId" is strictly forbidden and rejected. Only canonical "approvedProjectRef" is permitted.',
        };
      }
      return {
        ok: false,
        reason: `Unexpected or misspelled configuration key "${key}". Allowed keys: ${Array.from(ALLOWED_CONFIG_KEYS).join(', ')}.`,
      };
    }
  }

  // 2. Reject if approvedProjectId is present (guard against prototype or symbol)
  if ('approvedProjectId' in configObj) {
    return {
      ok: false,
      reason: 'Field "approvedProjectId" is strictly forbidden and rejected. Only canonical "approvedProjectRef" is permitted.',
    };
  }

  // 3. Extract and check canonical fields
  const approvedRef = typeof configObj.approvedProjectRef === 'string'
    ? configObj.approvedProjectRef.trim().toLowerCase()
    : '';
  const approvedHost = typeof configObj.approvedHostname === 'string'
    ? configObj.approvedHostname.trim().toLowerCase()
    : '';
  const isConfigDisposable = configObj.isDisposable === true;

  if (!approvedRef) {
    return {
      ok: false,
      reason: 'Missing or unconfigured approval: "approvedProjectRef" is required and cannot be empty.',
    };
  }

  if (!approvedHost) {
    return {
      ok: false,
      reason: 'Missing or unconfigured approval: "approvedHostname" is required and cannot be empty.',
    };
  }

  if (!isConfigDisposable) {
    return {
      ok: false,
      reason: 'Target is not confirmed disposable in config: "isDisposable" must be strictly true.',
    };
  }

  if (isDisposableEnv !== true) {
    return {
      ok: false,
      reason: 'Target is not confirmed disposable in environment: SUPABASE_TEST_IS_DISPOSABLE must be strictly "true".',
    };
  }

  // 4. Validate target URL
  if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    return {
      ok: false,
      reason: 'Target URL is missing or empty.',
    };
  }

  let targetHost = '';
  let targetRef = '';
  try {
    const parsedUrl = new URL(targetUrl);
    targetHost = parsedUrl.hostname.toLowerCase();
    targetRef = targetHost.split('.')[0];
  } catch (urlErr) {
    return {
      ok: false,
      reason: `Target URL is invalid: ${urlErr.message}`,
    };
  }

  // 5. Strict reference AND hostname matching (never OR)
  if (targetRef !== approvedRef) {
    return {
      ok: false,
      reason: `Target project reference '${targetRef}' does not match canonical approvedProjectRef '${approvedRef}'.`,
    };
  }

  if (targetHost !== approvedHost) {
    return {
      ok: false,
      reason: `Target hostname '${targetHost}' does not match canonical approvedHostname '${approvedHost}'.`,
    };
  }

  return {
    ok: true,
    approvedRef,
    approvedHost,
    targetRef,
    targetHost,
  };
}

/**
 * End-to-end target approval validator.
 * Resolves the configuration from the fixed file unless configOverride is explicitly passed.
 *
 * @param {object} options
 * @param {string} [options.repoRoot] Optional repo root
 * @param {string} options.targetUrl Target Supabase URL
 * @param {boolean} options.isDisposableEnv Environment disposable flag
 * @param {Record<string, unknown>} [options.configOverride] Optional in-memory config for pure unit testing
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   approvedRef?: string,
 *   approvedHost?: string,
 *   targetRef?: string,
 *   targetHost?: string
 * }}
 */
function validateTargetApproval({ targetUrl, isDisposableEnv, configOverride } = {}) {
  let configObj = configOverride;

  if (configObj === undefined) {
    const loadResult = loadApprovalConfigFile();
    if (!loadResult.ok) {
      return {
        ok: false,
        reason: loadResult.error,
      };
    }
    configObj = loadResult.data;
  }

  return validateApprovalObject(configObj, targetUrl, isDisposableEnv);
}

/**
 * Creates an offline/online Storage resource tracker enforcing Fix B ownership semantics:
 * - Confirms run-ownership ONLY after a successful upload (!error && !thrown).
 * - Ambiguous, failed, or occupied upload attempts are NEVER registered for deletion.
 * - Tracks ambiguous paths separately for audit/diagnostics.
 * - Cleanup targets ONLY confirmed run-owned objects.
 */
function createStorageResourceTracker() {
  const confirmedStoragePaths = [];
  const ambiguousStoragePaths = [];

  function recordUploadAttempt({ path, error, thrown }) {
    if (!path || typeof path !== 'string') return;

    if (!error && !thrown) {
      if (!confirmedStoragePaths.includes(path)) {
        confirmedStoragePaths.push(path);
      }
    } else {
      const reason = error?.message || thrown?.message || String(error || thrown || 'Upload failed');
      ambiguousStoragePaths.push({
        path,
        reason,
        recordedAt: new Date().toISOString(),
      });
    }
  }

  function getPathsToDelete() {
    return [...confirmedStoragePaths];
  }

  function getAmbiguousPaths() {
    return ambiguousStoragePaths.map((item) => item.path);
  }

  return {
    confirmedStoragePaths,
    ambiguousStoragePaths,
    recordUploadAttempt,
    getPathsToDelete,
    getAmbiguousPaths,
  };
}

module.exports = {
  CANONICAL_REPO_ROOT,
  CANONICAL_APPROVAL_CONFIG_PATH,
  ALLOWED_CONFIG_KEYS,
  FIXED_CONFIG_RELATIVE_PATH,
  getFixedApprovalConfigPath,
  loadApprovalConfigFile,
  validateApprovalObject,
  validateTargetApproval,
  createStorageResourceTracker,
};
