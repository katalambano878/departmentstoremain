/**
 * Simple client-side data cache to avoid re-fetching from Supabase
 * on every page navigation. Data is cached in memory for a configurable TTL.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes — reduce re-fetches during browsing

/**
 * Get data from cache or fetch it fresh
 */
export async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL
): Promise<T> {
  const cached = cache.get(key);
  
  if (cached && (Date.now() - cached.timestamp) < ttlMs) {
    return cached.data;
  }
  
  // If queryFn throws, nothing is cached and the error reaches the caller.
  const data = await queryFn();
  // Never cache failures: Supabase-style results report errors as
  // `{ data, error }` instead of throwing, so a network blip would otherwise
  // stick for the whole TTL.
  if (!isFailedResult(data)) {
    cache.set(key, { data, timestamp: Date.now() });
  } else {
    cache.delete(key);
  }
  return data;
}

function isFailedResult(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (value as { error?: unknown }).error != null
  );
}

/**
 * Invalidate a specific cache key
 */
export function invalidateCache(key: string) {
  cache.delete(key);
}

/**
 * Invalidate all cache keys matching a prefix
 */
export function invalidateCachePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Clear the entire cache
 */
export function clearCache() {
  cache.clear();
}
