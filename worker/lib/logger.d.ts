/**
 * TypeScript type definitions for Logger class
 *
 * Provides type safety for the centralized logging utility.
 * Implementation in logger.js
 *
 * @module lib/logger
 */

import type { Env } from '../src/env.js';

/**
 * Log level enumeration
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  env: Env;
  context?: Record<string, unknown>;
}

/**
 * Logger context for request or queue processing
 */
export interface LoggerContext {
  requestId?: string;
  batchId?: string;
  queueName?: string;
  batchSize?: number;
  type?: 'http' | 'queue';
  [key: string]: unknown;
}

/**
 * Centralized Logger class for structured, context-aware logging
 *
 * Features:
 * - Multiple log levels (debug, info, warn, error)
 * - Environment-based configuration (LOG_LEVEL, STRUCTURED_LOGGING)
 * - Request-scoped and queue-scoped contexts
 * - Performance and query analytics integration
 * - JSON or human-readable output formats
 *
 * @example
 * ```typescript
 * // Create request-scoped logger
 * const logger = Logger.forRequest(env, request);
 * logger.info('Search request received', { isbn: '9780439064873' });
 *
 * // Create queue-scoped logger
 * const logger = Logger.forQueue(env, 'alexandria-cover-queue', 10);
 * logger.debug('Processing batch', { processed: 8, failed: 2 });
 *
 * // Log performance metrics
 * logger.perf('search', 145, { result_count: 20, cache_hit: false });
 *
 * // Log query analytics
 * logger.query('isbn_search', 42, { cache_hit: true });
 * ```
 */
export class Logger {
  /**
   * Worker environment bindings
   */
  env: Env;

  /**
   * Contextual metadata (requestId, batchId, type, etc.)
   */
  context: LoggerContext;

  /**
   * Configured log level threshold
   */
  level: number;

  /**
   * Whether to use structured JSON output
   */
  structured: boolean;

  /**
   * Whether performance logging is enabled
   */
  perfLoggingEnabled: boolean;

  /**
   * Whether query logging is enabled
   */
  queryLoggingEnabled: boolean;

  /**
   * Create a new Logger instance
   *
   * @param env - Worker environment bindings
   * @param context - Contextual metadata (requestId, batchId, type, etc.)
   */
  constructor(env: Env, context?: LoggerContext);

  /**
   * Create a request-scoped logger
   *
   * Extracts cf-ray header as requestId for distributed tracing
   *
   * @param env - Worker environment bindings
   * @param request - HTTP request object
   * @returns Request-scoped logger instance
   */
  static forRequest(env: Env, request: Request): Logger;

  /**
   * Create a queue-scoped logger
   *
   * For tracking batch processing in queue consumers
   *
   * @param env - Worker environment bindings
   * @param queueName - Name of the queue being processed
   * @param batchSize - Number of messages in the batch
   * @returns Queue-scoped logger instance
   */
  static forQueue(env: Env, queueName: string, batchSize: number): Logger;

  /**
   * Log debug message (most verbose)
   *
   * Use for detailed debugging information, disabled in production
   *
   * @param message - Debug message
   * @param data - Additional structured data
   */
  debug(message: string, data?: Record<string, unknown>): void;

  /**
   * Log info message
   *
   * Use for normal operational events
   *
   * @param message - Info message
   * @param data - Additional structured data
   */
  info(message: string, data?: Record<string, unknown>): void;

  /**
   * Log warning message
   *
   * Use for potentially harmful situations that should be reviewed
   *
   * @param message - Warning message
   * @param data - Additional structured data
   */
  warn(message: string, data?: Record<string, unknown>): void;

  /**
   * Log error message (least verbose, always logged)
   *
   * Use for error conditions that should be investigated
   *
   * @param message - Error message
   * @param data - Additional structured data
   */
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Log performance metrics
   *
   * Writes to ANALYTICS dataset when ENABLE_PERFORMANCE_LOGGING=true
   *
   * @param operation - Operation name (e.g., 'search', 'cover_process')
   * @param durationMs - Operation duration in milliseconds
   * @param metadata - Additional metadata for analytics
   */
  perf(operation: string, durationMs: number, metadata?: Record<string, unknown>): void;

  /**
   * Log query performance metrics
   *
   * Writes to QUERY_ANALYTICS dataset when ENABLE_QUERY_LOGGING=true
   *
   * @param operation - Query operation name (e.g., 'isbn_search', 'title_search')
   * @param durationMs - Query duration in milliseconds
   * @param metadata - Additional metadata (e.g., result_count, cache_hit)
   */
  query(operation: string, durationMs: number, metadata?: Record<string, unknown>): void;
}
