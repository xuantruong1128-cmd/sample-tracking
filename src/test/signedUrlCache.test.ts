import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedSignedUrl,
  setCachedSignedUrl,
  getOrFetchSignedUrl,
  invalidateSignedUrl,
  invalidateSignedUrlsByPrefix,
  invalidateUserSignedUrls,
  clearSignedUrlCache,
  getSignedUrlCacheStats,
  resetSignedUrlCacheStats,
  buildSignedUrlCacheKey,
  MIN_REMAINING_TTL_MS,
  MAX_CACHE_ENTRIES,
} from '../lib/signedUrlCache';

describe('SAMPLE TRACKING — M2.1 SIGNED URL CACHE OPTIMIZATION TEST SUITE', () => {
  beforeEach(() => {
    clearSignedUrlCache();
    resetSignedUrlCacheStats();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSignedUrlCache();
  });

  describe('1. In-Memory Cache Hit & Miss Mechanics', () => {
    it('returns null on cache miss', () => {
      const url = getCachedSignedUrl({
        bucket: 'drawing-reviews',
        filePath: 'drawings/issue-1/part.pdf',
        userId: 'user-001',
      });
      expect(url).toBeNull();
    });

    it('stores and retrieves signed URL within valid TTL window', () => {
      const keyParams = {
        bucket: 'drawing-reviews',
        filePath: 'drawings/issue-1/part.pdf',
        userId: 'user-001',
      };
      setCachedSignedUrl(keyParams, 'https://storage.mock/part.pdf?token=abc', 600);

      const url = getCachedSignedUrl(keyParams);
      expect(url).toBe('https://storage.mock/part.pdf?token=abc');

      const stats = getSignedUrlCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.activeEntries).toBe(1);
    });

    it('orchestrates getOrFetchSignedUrl: executes fetcher only once on initial miss', async () => {
      const keyParams = {
        bucket: 'drawing-reviews',
        filePath: 'avatars/ver-1_avatar.jpg',
        userId: 'user-001',
      };

      const fetcher = vi.fn().mockResolvedValue({
        signedUrl: 'https://storage.mock/avatar.jpg?token=tok1',
        error: null,
      });

      // 1st call: Cache miss -> fetcher executes
      const res1 = await getOrFetchSignedUrl(keyParams, fetcher, 600);
      expect(res1.signedUrl).toBe('https://storage.mock/avatar.jpg?token=tok1');
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 2nd call: Cache hit -> fetcher does NOT execute
      const res2 = await getOrFetchSignedUrl(keyParams, fetcher, 600);
      expect(res2.signedUrl).toBe('https://storage.mock/avatar.jpg?token=tok1');
      expect(fetcher).toHaveBeenCalledTimes(1); // Still 1

      const stats = getSignedUrlCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
    });
  });

  describe('2. Minimum 60-Second Remaining TTL Enforcement', () => {
    it('reuses signed URL when remaining TTL is >= 60 seconds', () => {
      const keyParams = {
        bucket: 'drawing-reviews',
        filePath: 'drawings/part.pdf',
        userId: 'user-001',
      };

      // Set TTL of 600 seconds
      setCachedSignedUrl(keyParams, 'https://storage.mock/part.pdf?token=valid', 600);

      // Advance clock by 530 seconds (remaining: 70 seconds >= 60s)
      vi.advanceTimersByTime(530 * 1000);

      const url = getCachedSignedUrl(keyParams);
      expect(url).toBe('https://storage.mock/part.pdf?token=valid');
    });

    it('rejects and evicts cached URL when remaining TTL is < 60 seconds', () => {
      const keyParams = {
        bucket: 'drawing-reviews',
        filePath: 'drawings/part.pdf',
        userId: 'user-001',
      };

      // Set TTL of 300 seconds
      setCachedSignedUrl(keyParams, 'https://storage.mock/part.pdf?token=expiring', 300);

      // Advance clock by 241 seconds (remaining: 59 seconds < 60s)
      vi.advanceTimersByTime(241 * 1000);

      const url = getCachedSignedUrl(keyParams);
      expect(url).toBeNull(); // Cache miss due to < 60s buffer

      const stats = getSignedUrlCacheStats();
      expect(stats.evictions).toBe(1);
      expect(stats.activeEntries).toBe(0);
    });
  });

  describe('3. In-Flight Promise Deduplication (Concurrent Burst Protection)', () => {
    it('collapses multiple simultaneous requests for the same file into exactly 1 network execution', async () => {
      const keyParams = {
        bucket: 'drawing-reviews',
        filePath: 'avatars/issue-100_avatar.jpg',
        userId: 'user-001',
      };

      let resolveFetcher: (val: any) => void;
      const delayedFetcher = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveFetcher = resolve;
        });
      });

      // Fire 5 concurrent requests simultaneously
      const promise1 = getOrFetchSignedUrl(keyParams, delayedFetcher, 600);
      const promise2 = getOrFetchSignedUrl(keyParams, delayedFetcher, 600);
      const promise3 = getOrFetchSignedUrl(keyParams, delayedFetcher, 600);
      const promise4 = getOrFetchSignedUrl(keyParams, delayedFetcher, 600);
      const promise5 = getOrFetchSignedUrl(keyParams, delayedFetcher, 600);

      // Fetcher should have been called only ONCE
      expect(delayedFetcher).toHaveBeenCalledTimes(1);

      // Resolve the single in-flight Promise
      resolveFetcher!({
        signedUrl: 'https://storage.mock/deduped.jpg?token=batch1',
        error: null,
      });

      const [res1, res2, res3, res4, res5] = await Promise.all([
        promise1,
        promise2,
        promise3,
        promise4,
        promise5,
      ]);

      expect(res1.signedUrl).toBe('https://storage.mock/deduped.jpg?token=batch1');
      expect(res2.signedUrl).toBe('https://storage.mock/deduped.jpg?token=batch1');
      expect(res3.signedUrl).toBe('https://storage.mock/deduped.jpg?token=batch1');
      expect(res4.signedUrl).toBe('https://storage.mock/deduped.jpg?token=batch1');
      expect(res5.signedUrl).toBe('https://storage.mock/deduped.jpg?token=batch1');

      const stats = getSignedUrlCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.dedupedRequests).toBe(4);
    });
  });

  describe('4. Composite Key Isolation & Cross-Account Security', () => {
    it('isolates cache keys by User ID: User A and User B never share signed URLs', () => {
      const keyUserA = buildSignedUrlCacheKey({
        bucket: 'drawing-reviews',
        filePath: 'drawings/secret.pdf',
        userId: 'user-A',
      });

      const keyUserB = buildSignedUrlCacheKey({
        bucket: 'drawing-reviews',
        filePath: 'drawings/secret.pdf',
        userId: 'user-B',
      });

      expect(keyUserA).not.toEqual(keyUserB);

      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'drawings/secret.pdf', userId: 'user-A' },
        'https://storage.mock/secret.pdf?token=userA_token',
        600
      );

      // User A can access
      const urlA = getCachedSignedUrl({
        bucket: 'drawing-reviews',
        filePath: 'drawings/secret.pdf',
        userId: 'user-A',
      });
      expect(urlA).toBe('https://storage.mock/secret.pdf?token=userA_token');

      // User B cannot access User A's cached URL
      const urlB = getCachedSignedUrl({
        bucket: 'drawing-reviews',
        filePath: 'drawings/secret.pdf',
        userId: 'user-B',
      });
      expect(urlB).toBeNull();
    });

    it('isolates cache keys by Bucket', () => {
      const keyDR = buildSignedUrlCacheKey({
        bucket: 'drawing-reviews',
        filePath: 'docs/test.pdf',
        userId: 'user-A',
      });

      const keyJobs = buildSignedUrlCacheKey({
        bucket: 'sample-documents',
        filePath: 'docs/test.pdf',
        userId: 'user-A',
      });

      expect(keyDR).not.toEqual(keyJobs);
    });
  });

  describe('5. Invalidation Mechanisms', () => {
    it('invalidates single signed URL when file is modified or deleted', () => {
      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'avatars/v1_old.jpg', userId: 'user-1' },
        'https://storage.mock/v1_old.jpg?token=old',
        600
      );

      expect(
        getCachedSignedUrl({ bucket: 'drawing-reviews', filePath: 'avatars/v1_old.jpg', userId: 'user-1' })
      ).not.toBeNull();

      const invalidatedCount = invalidateSignedUrl('drawing-reviews', 'avatars/v1_old.jpg');
      expect(invalidatedCount).toBe(1);

      expect(
        getCachedSignedUrl({ bucket: 'drawing-reviews', filePath: 'avatars/v1_old.jpg', userId: 'user-1' })
      ).toBeNull();
    });

    it('invalidates all URLs matching a folder prefix', () => {
      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'avatars/v2_avatar_01.jpg', userId: 'user-1' },
        'https://storage.mock/01.jpg',
        600
      );
      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'avatars/v2_avatar_02.jpg', userId: 'user-1' },
        'https://storage.mock/02.jpg',
        600
      );
      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'drawings/v2_drawing.pdf', userId: 'user-1' },
        'https://storage.mock/pdf.jpg',
        600
      );

      expect(getSignedUrlCacheStats().activeEntries).toBe(3);

      // Invalidate avatar prefix for version v2
      const count = invalidateSignedUrlsByPrefix('drawing-reviews', 'avatars/v2_avatar');
      expect(count).toBe(2);

      // Drawing file should still be preserved
      expect(
        getCachedSignedUrl({ bucket: 'drawing-reviews', filePath: 'drawings/v2_drawing.pdf', userId: 'user-1' })
      ).toBe('https://storage.mock/pdf.jpg');
    });

    it('purges all cache on clearSignedUrlCache (logout / auth state change)', () => {
      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'file1.pdf', userId: 'user-1' },
        'https://storage.mock/1',
        600
      );
      setCachedSignedUrl(
        { bucket: 'sample-documents', filePath: 'file2.pdf', userId: 'user-2' },
        'https://storage.mock/2',
        300
      );

      expect(getSignedUrlCacheStats().activeEntries).toBe(2);

      clearSignedUrlCache();

      expect(getSignedUrlCacheStats().activeEntries).toBe(0);
      expect(getCachedSignedUrl({ bucket: 'drawing-reviews', filePath: 'file1.pdf', userId: 'user-1' })).toBeNull();
      expect(getCachedSignedUrl({ bucket: 'sample-documents', filePath: 'file2.pdf', userId: 'user-2' })).toBeNull();
    });
  });

  describe('6. Cache Capacity Limit and Two-Phase Eviction', () => {
    it('prunes expired entries when reaching MAX_CACHE_ENTRIES', () => {
      // Fill cache with entries
      for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
        setCachedSignedUrl(
          { bucket: 'drawing-reviews', filePath: `item-${i}.jpg`, userId: 'user-1' },
          `https://storage.mock/item-${i}.jpg`,
          i < 100 ? 100 : 600 // First 100 entries have short TTL
        );
      }

      expect(getSignedUrlCacheStats().activeEntries).toBe(MAX_CACHE_ENTRIES);

      // Advance clock so first 100 expire (< 60s remaining)
      vi.advanceTimersByTime(50 * 1000); // 100 - 50 = 50s remaining < 60s

      // Add 1 more entry -> triggers prune
      setCachedSignedUrl(
        { bucket: 'drawing-reviews', filePath: 'overflow.jpg', userId: 'user-1' },
        'https://storage.mock/overflow.jpg',
        600
      );

      // The 100 expired entries should have been pruned
      expect(getSignedUrlCacheStats().evictions).toBeGreaterThanOrEqual(100);
      expect(getSignedUrlCacheStats().activeEntries).toBeLessThan(MAX_CACHE_ENTRIES);
    });
  });

  describe('7. Security: In-Memory Only, No LocalStorage Pollution', () => {
    it('does not read from or write to localStorage', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

      const keyParams = {
        bucket: 'drawing-reviews',
        filePath: 'drawings/confidential.pdf',
        userId: 'admin-1',
      };

      setCachedSignedUrl(keyParams, 'https://storage.mock/confidential.pdf?token=topsecret', 600);
      const retrieved = getCachedSignedUrl(keyParams);

      expect(retrieved).toBe('https://storage.mock/confidential.pdf?token=topsecret');

      // LocalStorage must NOT be used for signed URLs
      expect(setItemSpy).not.toHaveBeenCalledWith(expect.stringContaining('topsecret'), expect.anything());
      expect(getItemSpy).not.toHaveBeenCalledWith(expect.stringContaining('topsecret'));

      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('8. Benchmark Measurement: Concrete Request Reduction', () => {
    it('measures exact request count before and after cache on simulated Drawing Review list', async () => {
      // Simulate 12 issues in Drawing Review list (matching production screenshot)
      const issueAvatarPaths = Array.from({ length: 12 }, (_, i) => `avatars/issue_${i + 1}_avatar.jpg`);

      const backendStorageMock = vi.fn().mockImplementation((path: string) => {
        return Promise.resolve({
          signedUrl: `https://storage.mock/${path}?token=sig_${Math.random()}`,
          error: null,
        });
      });

      // Scenario A: First page load (12 items)
      for (const path of issueAvatarPaths) {
        await getOrFetchSignedUrl(
          { bucket: 'drawing-reviews', filePath: path, userId: 'user-pe' },
          () => backendStorageMock(path),
          600
        );
      }

      // Initial page load: exactly 12 backend storage requests
      expect(backendStorageMock).toHaveBeenCalledTimes(12);

      // Scenario B: User switches tabs (JOBs -> Drawing Review) or component re-renders 5 times
      for (let render = 0; render < 5; render++) {
        for (const path of issueAvatarPaths) {
          await getOrFetchSignedUrl(
            { bucket: 'drawing-reviews', filePath: path, userId: 'user-pe' },
            () => backendStorageMock(path),
            600
          );
        }
      }

      // After 5 tab switches / re-renders:
      // Without cache: would have been 12 + (5 * 12) = 72 requests!
      // With M2.1 cache: backendStorageMock is STILL EXACTLY 12 calls!
      expect(backendStorageMock).toHaveBeenCalledTimes(12);

      const stats = getSignedUrlCacheStats();
      expect(stats.misses).toBe(12);
      expect(stats.hits).toBe(60); // 5 * 12 hits!
      expect(stats.dedupedRequests).toBe(0);
    });
  });
});
