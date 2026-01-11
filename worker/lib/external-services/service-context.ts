/**
 * Service Provider Framework - Service Context
 *
 * Unified context passed to all service providers.
 * Eliminates parameter duplication across service calls.
 *
 * PERFORMANCE IMPACT:
 * - Single object allocation per request (minimal overhead)
 * - Enables request-scoped configuration (cache/rate limit strategies)
 * - QuotaManager is optional (only for paid services like ISBNdb)
 * - Metadata field supports tracing/debugging without breaking interface
 */

import type { Env } from '../../src/env.js';
import type { Logger } from '../logger.js';
import type { QuotaManager } from '../../src/services/quota-manager.js';
import type { Sql } from 'postgres';

/**
 * Cache strategy for service calls
 */
export type CacheStrategy = 'read-write' | 'read-only' | 'write-only' | 'disabled';

/**
 * Rate limit enforcement strategy
 */
export type RateLimitStrategy = 'enforce' | 'log-only' | 'disabled';

/**
 * Unified context passed to all service providers
 *
 * This eliminates the need to pass env, logger, and other common
 * parameters to every service method call.
 */
export interface ServiceContext {
  /** Cloudflare Worker environment (bindings, secrets, etc.) */
  env: Env;

  /** Structured logger for consistent logging */
  logger: Logger;

  /** Quota manager for paid services (optional) */
  quotaManager?: QuotaManager;

  /** Database connection (optional, for providers that need database access) */
  sql?: Sql;

  /**
   * Cache strategy for this request
   * - 'read-write': Read from cache, write on miss (default)
   * - 'read-only': Only read from cache, never write
   * - 'write-only': Always fetch fresh, always cache
   * - 'disabled': No caching
   */
  cacheStrategy?: CacheStrategy;

  /**
   * Rate limit enforcement strategy
   * - 'enforce': Block until rate limit allows (default)
   * - 'log-only': Log violations but don't block
   * - 'disabled': No rate limiting
   */
  rateLimitStrategy?: RateLimitStrategy;

  /**
   * Request timeout in milliseconds
   * Defaults to service-specific timeout if not provided
   */
  timeoutMs?: number;

  /**
   * AbortSignal for request cancellation
   * When provided, HTTP requests will abort when signal fires (e.g., orchestrator timeouts)
   */
  signal?: AbortSignal;

  /**
   * Request-specific metadata for tracing/debugging
   */
  metadata?: Record<string, unknown>;
}

/**
 * Create a ServiceContext with defaults
 */
export function createServiceContext(
  env: Env,
  logger: Logger,
  options?: {
    quotaManager?: QuotaManager;
    sql?: Sql;
    cacheStrategy?: CacheStrategy;
    rateLimitStrategy?: RateLimitStrategy;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
  }
): ServiceContext {
  return {
    env,
    logger,
    quotaManager: options?.quotaManager,
    sql: options?.sql,
    cacheStrategy: options?.cacheStrategy ?? 'read-write',
    rateLimitStrategy: options?.rateLimitStrategy ?? 'enforce',
    timeoutMs: options?.timeoutMs,
    metadata: options?.metadata,
  };
}
