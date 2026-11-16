import { ENV } from './env';

export interface SignedUrlCacheEntry {
  signedUrl: string;
  expiresAt: number;     // Absolute timestamp (ms) when the signed URL expires
  createdAt: number;     // Absolute timestamp (ms) when created
  lastAccessedAt: number;// Absolute timestamp (ms) when last read (for LRU eviction)
  userId: string;
  bucket: string;
  filePath: string;
  paramsHash: string;
}

export interface CacheKeyParams {
  projectId?: string;
  userId?: string | null;
  bucket: string;
  filePath: string;
  params?: Record<string, any>;
}

export interface SignedUrlResult {
  signedUrl: string | null;
  error: string | null;
}

export interface SignedUrlCacheStats {
  hits: number;
  misses: number;
  dedupedRequests: number;
  invalidations: number;
  evictions: number;
  activeEntries: number;
}

/**
 * Minimum remaining validity threshold required to reuse a cached Signed URL.
 * Per M2.1 specification: strictly 60 seconds (60,000 ms).
 */
export const MIN_REMAINING_TTL_MS = 60 * 1000;

/**
 * Maximum entries allowed in the session in-memory cache to prevent memory bloat.
 */
export const MAX_CACHE_ENTRIES = 500;

/**
 * In-memory cache storage partitioned by composite cache key.
 * Strictly held in memory for the application session. NEVER written to localStorage.
 */
const cacheMap = new Map<string, SignedUrlCacheEntry>();

/**
 * Active in-flight Promises for concurrent request deduplication.
 */
const inFlightRequests = new Map<string, Promise<SignedUrlResult>>();

/**
 * Metrics tracking for cache efficiency and auditing.
 */
const stats: SignedUrlCacheStats = {
  hits: 0,
  misses: 0,
  dedupedRequests: 0,
  invalidations: 0,
  evictions: 0,
  activeEntries: 0,
};

/**
 * Extracts a stable project identifier from the configured Supabase URL.
 */
export function getProjectId(): string {
  if (!ENV.SUPABASE_URL) return 'default-project';
  try {
    const match = ENV.SUPABASE_URL.match(/^https?:\/\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // fallback
  }
  return 'default-project';
}

/**
 * Normalizes file path to ensure uniform key lookups.
 */
export function normalizeStoragePath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') return '';
  return filePath.trim().replace(/^\/+/, '');
}

/**
 * Computes deterministic hash string for optional request parameters.
 */
function hashParams(params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) return '';
  try {
    const sortedKeys = Object.keys(params).sort();
    const sortedObj: Record<string, any> = {};
    for (const k of sortedKeys) {
      if (params[k] !== undefined) {
        sortedObj[k] = params[k];
      }
    }
    return JSON.stringify(sortedObj);
  } catch {
    return '';
  }
}

/**
 * Builds the composite cache key:
 * Format: `<projectId>:<userId>:<bucket>:<normalizedFilePath>:<paramsHash>`
 *
 * Guarantees strict isolation across:
 * - Projects (dev vs prod vs test)
 * - Users (signed URLs are never shared between accounts)
 * - Buckets (drawing-reviews vs sample-documents)
 * - File paths and request options
 */
export function buildSignedUrlCacheKey({
  projectId,
  userId,
  bucket,
  filePath,
  params,
}: CacheKeyParams): string {
  const pId = projectId || getProjectId();
  const uId = userId || 'anonymous';
  const b = (bucket || '').trim();
  const normalizedPath = normalizeStoragePath(filePath);
  const pHash = hashParams(params);

  return `${pId}:${uId}:${b}:${normalizedPath}:${pHash}`;
}

/**
 * Evicts expired entries or the least recently accessed (LRU) entry when at capacity.
 */
function pruneCacheIfNeeded(): void {
  if (cacheMap.size < MAX_CACHE_ENTRIES) return;

  const now = Date.now();

  // Phase 1: Prune any expired entries (remaining validity < 60s)
  for (const [key, entry] of cacheMap.entries()) {
    if (entry.expiresAt - now < MIN_REMAINING_TTL_MS) {
      cacheMap.delete(key);
      stats.evictions++;
    }
  }

  // Phase 2: If still at or over capacity, evict the least recently used entry
  if (cacheMap.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of cacheMap.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cacheMap.delete(oldestKey);
      stats.evictions++;
    }
  }

  stats.activeEntries = cacheMap.size;
}

/**
 * Retrieves a valid cached Signed URL if it has at least 60 seconds of validity remaining.
 */
export function getCachedSignedUrl(params: CacheKeyParams): string | null {
  const key = buildSignedUrlCacheKey(params);
  const entry = cacheMap.get(key);
  if (!entry) return null;

  const now = Date.now();
  const remainingMs = entry.expiresAt - now;

  // Enforce M2.1 rule: Only reuse when remaining validity >= 60 seconds
  if (remainingMs < MIN_REMAINING_TTL_MS) {
    cacheMap.delete(key);
    stats.evictions++;
    stats.activeEntries = cacheMap.size;
    return null;
  }

  // Cache Hit: Update last access time for LRU tracking
  entry.lastAccessedAt = now;
  stats.hits++;
  return entry.signedUrl;
}

/**
 * Sets a Signed URL in the in-memory cache with specified TTL in seconds.
 */
export function setCachedSignedUrl(
  params: CacheKeyParams,
  signedUrl: string,
  expiresInSeconds: number
): void {
  if (!signedUrl || expiresInSeconds <= 0) return;

  pruneCacheIfNeeded();

  const now = Date.now();
  const key = buildSignedUrlCacheKey(params);
  const normalizedPath = normalizeStoragePath(params.filePath);

  const entry: SignedUrlCacheEntry = {
    signedUrl,
    expiresAt: now + expiresInSeconds * 1000,
    createdAt: now,
    lastAccessedAt: now,
    userId: params.userId || 'anonymous',
    bucket: params.bucket,
    filePath: normalizedPath,
    paramsHash: hashParams(params.params),
  };

  cacheMap.set(key, entry);
  stats.activeEntries = cacheMap.size;
}

/**
 * Orchestrates Cache-Aside resolution with In-Flight Promise Deduplication.
 *
 * 1. Checks cache for active URL with >= 60s remaining TTL.
 * 2. If in-flight fetch exists for the same key, reuses the existing Promise.
 * 3. Otherwise, invokes the fetcher, stores the result upon success, and cleans in-flight tracking.
 */
export async function getOrFetchSignedUrl(
  params: CacheKeyParams,
  fetcher: () => Promise<SignedUrlResult>,
  expiresInSeconds: number
): Promise<SignedUrlResult> {
  const cached = getCachedSignedUrl(params);
  if (cached) {
    return { signedUrl: cached, error: null };
  }

  const key = buildSignedUrlCacheKey(params);

  // In-flight Promise deduplication: reuse running request if identical call is pending
  const inFlight = inFlightRequests.get(key);
  if (inFlight) {
    stats.dedupedRequests++;
    return inFlight;
  }

  stats.misses++;

  const fetchPromise = (async (): Promise<SignedUrlResult> => {
    try {
      const result = await fetcher();
      if (result.signedUrl && !result.error) {
        setCachedSignedUrl(params, result.signedUrl, expiresInSeconds);
      }
      return result;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Invalidate cached Signed URL for a specific bucket and file path.
 * Should be called when a file is deleted, overwritten, or updated.
 */
export function invalidateSignedUrl(bucket: string, filePath: string): number {
  const normalizedPath = normalizeStoragePath(filePath);
  if (!normalizedPath) return 0;

  let count = 0;
  for (const [key, entry] of cacheMap.entries()) {
    if (entry.bucket === bucket && entry.filePath === normalizedPath) {
      cacheMap.delete(key);
      inFlightRequests.delete(key);
      count++;
    }
  }

  stats.invalidations += count;
  stats.activeEntries = cacheMap.size;
  return count;
}

/**
 * Invalidate all cached Signed URLs matching a bucket and prefix path.
 * Useful when a version folder, avatar group, or job directory is modified.
 */
export function invalidateSignedUrlsByPrefix(bucket: string, prefix: string): number {
  const normalizedPrefix = normalizeStoragePath(prefix);
  if (!normalizedPrefix) return 0;

  let count = 0;
  for (const [key, entry] of cacheMap.entries()) {
    if (entry.bucket === bucket && entry.filePath.startsWith(normalizedPrefix)) {
      cacheMap.delete(key);
      inFlightRequests.delete(key);
      count++;
    }
  }

  stats.invalidations += count;
  stats.activeEntries = cacheMap.size;
  return count;
}

/**
 * Invalidate all cached Signed URLs belonging to a specific user.
 */
export function invalidateUserSignedUrls(userId: string): number {
  if (!userId) return 0;

  let count = 0;
  for (const [key, entry] of cacheMap.entries()) {
    if (entry.userId === userId) {
      cacheMap.delete(key);
      inFlightRequests.delete(key);
      count++;
    }
  }

  stats.invalidations += count;
  stats.activeEntries = cacheMap.size;
  return count;
}

/**
 * Clears the entire cache and cancels all pending in-flight tracking.
 * Called on logout, user switch, or session expiration.
 */
export function clearSignedUrlCache(): void {
  const count = cacheMap.size;
  cacheMap.clear();
  inFlightRequests.clear();
  stats.invalidations += count;
  stats.activeEntries = 0;
}

/**
 * Returns read-only metrics regarding cache hits, misses, deduplications, and entry count.
 */
export function getSignedUrlCacheStats(): Readonly<SignedUrlCacheStats> {
  return {
    ...stats,
    activeEntries: cacheMap.size,
  };
}

/**
 * Resets telemetry counters (useful for isolated benchmark tests).
 */
export function resetSignedUrlCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.dedupedRequests = 0;
  stats.invalidations = 0;
  stats.evictions = 0;
  stats.activeEntries = cacheMap.size;
}
