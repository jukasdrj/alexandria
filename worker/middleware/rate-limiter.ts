/**
 * Application-Level Rate Limiter
 *
 * Provides granular rate limiting per endpoint using KV storage.
 * Works in conjunction with Cloudflare's WAF rate limiting.
 *
 * Features:
 * - Per-IP rate limiting
 * - Per-endpoint customization
 * - Sliding window algorithm
 * - Graceful degradation on KV failure
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../src/env.js';

export interface RateLimitConfig {
  /**
   * Maximum requests allowed in the time window
   */
  maxRequests: number;

  /**
   * Time window in seconds
   */
  windowSeconds: number;

  /**
   * Custom key prefix for KV storage
   */
  keyPrefix?: string;

  /**
   * Whether to fail open (allow) or closed (deny) on KV errors
   */
  failOpen?: boolean;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Get client IP from request
 */
function getClientIP(c: Context): string {
  // Cloudflare provides CF-Connecting-IP header
  return c.req.header('cf-connecting-ip') ||
         c.req.header('x-forwarded-for')?.split(',')[0] ||
         c.req.header('x-real-ip') ||
         'unknown';
}

/**
 * Check rate limit for a client
 */
export async function checkRateLimit(
  env: Env,
  clientIP: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const prefix = config.keyPrefix || 'ratelimit';
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.windowSeconds;

  // Create KV key with minute precision for efficient cleanup
  const minute = Math.floor(now / 60);
  const key = `${prefix}:${clientIP}:${minute}`;

  try {
    // Get current request count
    const stored = await env.CACHE.get(key);
    const data = stored ? JSON.parse(stored) : { count: 0, requests: [] };

    // Filter requests within the sliding window
    const recentRequests = data.requests.filter((timestamp: number) => timestamp > windowStart);

    // Check if limit exceeded
    if (recentRequests.length >= config.maxRequests) {
      const oldestRequest = Math.min(...recentRequests);
      const resetAt = oldestRequest + config.windowSeconds;
      const retryAfter = resetAt - now;

      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    // Add current request
    recentRequests.push(now);

    // Update KV with TTL = window size + 60s buffer
    await env.CACHE.put(
      key,
      JSON.stringify({
        count: recentRequests.length,
        requests: recentRequests,
      }),
      { expirationTtl: config.windowSeconds + 60 }
    );

    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - recentRequests.length,
      resetAt: now + config.windowSeconds,
    };

  } catch (error) {
    console.error('[RateLimit] KV error:', error);

    // Fail open (allow) or closed (deny) based on config
    if (config.failOpen !== false) {
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests,
        resetAt: now + config.windowSeconds,
      };
    } else {
      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        resetAt: now + config.windowSeconds,
        retryAfter: config.windowSeconds,
      };
    }
  }
}

/**
 * Rate limiting middleware factory
 */
export function rateLimiter(config: RateLimitConfig): MiddlewareHandler {
  return async (c: Context, next) => {
    const env = c.env as Env;
    const clientIP = getClientIP(c);

    // Check rate limit
    const result = await checkRateLimit(env, clientIP, config);

    // Add rate limit headers
    c.header('X-RateLimit-Limit', result.limit.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetAt.toString());

    if (!result.allowed) {
      c.header('Retry-After', result.retryAfter!.toString());
      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Maximum ${result.limit} requests per ${config.windowSeconds}s.`,
          details: {
            limit: result.limit,
            reset_at: result.resetAt,
            retry_after: result.retryAfter,
          },
        },
      }, 429);
    }

    await next();
  };
}

/**
 * Preset configurations for different endpoint types
 */
export const RateLimitPresets = {
  /**
   * Standard API endpoints - 100 req/min
   */
  standard: {
    maxRequests: 100,
    windowSeconds: 60,
    keyPrefix: 'rl:std',
    failOpen: true,
  } as RateLimitConfig,

  /**
   * Search endpoints (more expensive) - 60 req/min
   */
  search: {
    maxRequests: 60,
    windowSeconds: 60,
    keyPrefix: 'rl:search',
    failOpen: true,
  } as RateLimitConfig,

  /**
   * Write operations (covers, enrichment) - 30 req/min
   */
  write: {
    maxRequests: 30,
    windowSeconds: 60,
    keyPrefix: 'rl:write',
    failOpen: true,
  } as RateLimitConfig,

  /**
   * Heavy operations (batch, bulk) - 10 req/min
   */
  heavy: {
    maxRequests: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:heavy',
    failOpen: false, // Fail closed for expensive ops
  } as RateLimitConfig,
};
