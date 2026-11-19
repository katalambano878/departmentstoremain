/**
 * Simple in-memory rate limiter for API routes.
 *
 * WARNING: This store is per-process. On multi-instance deployments (e.g. Vercel)
 * each instance has its own counter, so an attacker distributing requests across
 * instances can exceed the per-IP limit. For production, replace with a shared
 * Redis store (e.g. Upstash Redis + @upstash/ratelimit).
 */
if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    console.warn('[rate-limit] WARNING: Using in-memory rate limiting in production. ' +
        'Set REDIS_URL or UPSTASH_REDIS_REST_URL and switch to a Redis-backed store ' +
        'to prevent per-instance bypass on multi-instance deployments.');
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
}

/**
 * Check if a request should be rate limited
 * @param identifier - Unique identifier for the client (IP, user ID, etc.)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const key = identifier;
  
  let entry = rateLimitStore.get(key);
  
  // If no entry or window expired, create new entry
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + windowMs
    };
    rateLimitStore.set(key, entry);
    
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetIn: config.windowSeconds
    };
  }
  
  // Check if limit exceeded
  if (entry.count >= config.maxRequests) {
    const resetIn = Math.ceil((entry.resetTime - now) / 1000);
    return {
      success: false,
      remaining: 0,
      resetIn
    };
  }
  
  // Increment count
  entry.count++;
  rateLimitStore.set(key, entry);
  
  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetIn: Math.ceil((entry.resetTime - now) / 1000)
  };
}

/**
 * Get client identifier from request (IP address).
 *
 * Traefik (Coolify) is the only proxy in front of the app. It sets
 * `X-Real-Ip` to the address it received the connection from and APPENDS
 * that address to any `X-Forwarded-For` the client sent, so only the last
 * forwarded entry is trustworthy: earlier entries are whatever the client
 * typed. Never use the first entry.
 */
export function getClientIdentifier(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // Fallback to a default identifier
  return 'unknown';
}

// ---- per-email sign-in lockout ------------------------------------------------

export const LOGIN_LOCKOUT = {
  /** Failed password attempts for one email before it is locked. */
  maxFailures: 10,
  /** Window the failures are counted in, and how long the lock lasts. */
  lockSeconds: 15 * 60,
};

const loginFailures = new Map<string, { count: number; resetTime: number }>();

function loginKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Seconds left on an email's sign-in lock, or 0 when it may try again. */
export function loginLockRemaining(email: string): number {
  const entry = loginFailures.get(loginKey(email));
  const now = Date.now();
  if (!entry || entry.resetTime <= now) return 0;
  if (entry.count < LOGIN_LOCKOUT.maxFailures) return 0;
  return Math.ceil((entry.resetTime - now) / 1000);
}

/** Count one wrong password for an email. Only failures count toward the lock. */
export function recordLoginFailure(email: string): void {
  const key = loginKey(email);
  if (!key) return;
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.resetTime <= now) {
    if (loginFailures.size > 10_000) {
      for (const [k, e] of loginFailures) if (e.resetTime <= now) loginFailures.delete(k);
    }
    loginFailures.set(key, { count: 1, resetTime: now + LOGIN_LOCKOUT.lockSeconds * 1000 });
    return;
  }
  entry.count++;
  // Reaching the limit starts a full lock period from the last failure.
  if (entry.count >= LOGIN_LOCKOUT.maxFailures) {
    entry.resetTime = now + LOGIN_LOCKOUT.lockSeconds * 1000;
  }
}

/** A correct password clears the failure count. */
export function clearLoginFailures(email: string): void {
  loginFailures.delete(loginKey(email));
}

/**
 * Rate limit configurations for different endpoints
 */
export const RATE_LIMITS = {
  // Payment endpoints - strict limits
  payment: {
    maxRequests: 10,
    windowSeconds: 60 // 10 requests per minute
  },
  
  // Notification endpoints - moderate limits
  notification: {
    maxRequests: 20,
    windowSeconds: 60 // 20 requests per minute
  },

  /** Sign-in, sign-up and password-reset requests to /auth/v1 */
  auth: {
    maxRequests: 10,
    windowSeconds: 60,
  },

  /** Public welcome emails after signup — stricter than generic notification */
  welcome: {
    maxRequests: 5,
    windowSeconds: 900, // 5 per 15 minutes per IP
  },
  
  // Callback endpoints - relaxed (webhooks from payment providers)
  callback: {
    maxRequests: 50,
    windowSeconds: 60 // 50 requests per minute
  },
  
  // General API - default limits
  default: {
    maxRequests: 100,
    windowSeconds: 60 // 100 requests per minute
  }
};
