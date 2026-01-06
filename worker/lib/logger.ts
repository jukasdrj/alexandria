/**
 * Centralized Logger Utility for Alexandria Worker
 *
 * Provides context-aware, structured logging with support for:
 * - Multiple log levels (debug, info, warn, error)
 * - Environment-based configuration (LOG_LEVEL, STRUCTURED_LOGGING)
 * - Request-scoped and queue-scoped contexts
 * - Performance and query analytics integration
 * - JSON or human-readable output formats
 *
 * @module lib/logger
 */

import type { Env } from '../src/env.js';

/**
 * Log level type
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log level enumeration with priority values
 * Lower numbers = more verbose, higher numbers = less verbose
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Context metadata for logging
 */
interface LogContext {
  requestId?: string;
  batchId?: string;
  queueName?: string;
  batchSize?: number;
  taskId?: string;
  type?: 'http' | 'queue' | 'scheduled';
  [key: string]: unknown;
}

/**
 * Log entry structure
 */
interface LogEntry extends LogContext {
  timestamp: string;
  level: LogLevel;
  message: string;
}

/**
 * Additional data for log entries
 */
type LogData = Record<string, unknown>;

/**
 * Logger class for structured, context-aware logging
 */
export class Logger {
  private env: Env;
  private context: LogContext;
  private level: number;
  private structured: boolean;
  private perfLoggingEnabled: boolean;
  private queryLoggingEnabled: boolean;

  /**
   * Create a new Logger instance
   *
   * @param env - Worker environment bindings
   * @param context - Contextual metadata (requestId, batchId, type, etc.)
   */
  constructor(env: Env, context: LogContext = {}) {
    this.env = env;
    this.context = context;

    // Parse log level from environment (default: info)
    const configuredLevel = env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
    this.level = LOG_LEVELS[configuredLevel || 'info'] ?? LOG_LEVELS.info;

    // Parse structured logging flag (default: false, requires explicit 'true')
    this.structured = env.STRUCTURED_LOGGING === 'true';

    // Parse feature flags for analytics
    this.perfLoggingEnabled = env.ENABLE_PERFORMANCE_LOGGING === 'true';
    this.queryLoggingEnabled = env.ENABLE_QUERY_LOGGING === 'true';
  }

  /**
   * Create a request-scoped logger
   *
   * Extracts cf-ray header as requestId for distributed tracing
   *
   * @param env - Worker environment bindings
   * @param request - HTTP request object
   * @returns Request-scoped logger instance
   */
  static forRequest(env: Env, request: Request): Logger {
    return new Logger(env, {
      requestId: request.headers.get('cf-ray') || crypto.randomUUID().slice(0, 8),
      type: 'http'
    });
  }

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
  static forQueue(env: Env, queueName: string, batchSize: number): Logger {
    return new Logger(env, {
      queueName,
      batchSize,
      batchId: crypto.randomUUID().slice(0, 8),
      type: 'queue'
    });
  }

  /**
   * Create a scheduled/cron-scoped logger
   *
   * For tracking scheduled task execution
   *
   * @param env - Worker environment bindings
   * @returns Scheduled-scoped logger instance
   */
  static forScheduled(env: Env): Logger {
    return new Logger(env, {
      taskId: crypto.randomUUID().slice(0, 8),
      type: 'scheduled'
    });
  }

  /**
   * Internal log method - handles level filtering and formatting
   *
   * @private
   * @param level - Log level (debug, info, warn, error)
   * @param message - Log message
   * @param data - Additional structured data
   */
  private _log(level: LogLevel, message: string, data: LogData = {}): void {
    // Filter by configured log level
    if (LOG_LEVELS[level] < this.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data
    };

    if (this.structured) {
      // Structured JSON output for production log aggregation
      console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
    } else {
      // Human-readable format for development
      const ctx = this.context.requestId ? `[req:${this.context.requestId}]` :
                  this.context.batchId ? `[batch:${this.context.batchId}]` : '';
      const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
      console[level === 'debug' ? 'log' : level](`[${level.toUpperCase()}] ${ctx} ${message}${dataStr}`);
    }
  }

  /**
   * Log debug message (most verbose)
   *
   * Use for detailed debugging information, disabled in production
   *
   * @param message - Debug message
   * @param data - Additional structured data
   */
  debug(message: string, data?: LogData): void {
    this._log('debug', message, data);
  }

  /**
   * Log info message
   *
   * Use for normal operational events
   *
   * @param message - Info message
   * @param data - Additional structured data
   */
  info(message: string, data?: LogData): void {
    this._log('info', message, data);
  }

  /**
   * Log warning message
   *
   * Use for potentially harmful situations that should be reviewed
   *
   * @param message - Warning message
   * @param data - Additional structured data
   */
  warn(message: string, data?: LogData): void {
    this._log('warn', message, data);
  }

  /**
   * Log error message (least verbose, always logged)
   *
   * Use for error conditions that should be investigated
   *
   * @param message - Error message
   * @param data - Additional structured data
   */
  error(message: string, data?: LogData): void {
    this._log('error', message, data);
  }

  /**
   * Log performance metrics
   *
   * Writes to ANALYTICS dataset when ENABLE_PERFORMANCE_LOGGING=true
   *
   * @param operation - Operation name (e.g., 'search', 'cover_process')
   * @param durationMs - Operation duration in milliseconds
   * @param metadata - Additional metadata for analytics
   */
  perf(operation: string, durationMs: number, metadata: LogData = {}): void {
    if (!this.perfLoggingEnabled) return;

    if (!this.env.ANALYTICS) {
      this.warn('Performance logging enabled but ANALYTICS binding not configured');
      return;
    }

    try {
      this.env.ANALYTICS.writeDataPoint({
        indexes: [operation],
        blobs: [this.context.requestId || '', JSON.stringify(metadata)],
        doubles: [durationMs]
      });

      this.debug(`Performance logged: ${operation}`, { durationMs, ...metadata });
    } catch (error) {
      this.error('Analytics write failed', {
        error: error instanceof Error ? error.message : String(error),
        operation
      });
    }
  }

  /**
   * Log query performance metrics
   *
   * Writes to QUERY_ANALYTICS dataset when ENABLE_QUERY_LOGGING=true
   *
   * @param operation - Query operation name (e.g., 'isbn_search', 'title_search')
   * @param durationMs - Query duration in milliseconds
   * @param metadata - Additional metadata (e.g., result_count, cache_hit)
   */
  query(operation: string, durationMs: number, metadata: LogData = {}): void {
    if (!this.queryLoggingEnabled) return;

    if (!this.env.QUERY_ANALYTICS) {
      this.warn('Query logging enabled but QUERY_ANALYTICS binding not configured');
      return;
    }

    try {
      this.env.QUERY_ANALYTICS.writeDataPoint({
        indexes: [operation],
        blobs: [this.context.requestId || '', JSON.stringify(metadata)],
        doubles: [durationMs]
      });

      this.debug(`Query logged: ${operation}`, { durationMs, ...metadata });
    } catch (error) {
      this.error('Query analytics write failed', {
        error: error instanceof Error ? error.message : String(error),
        operation
      });
    }
  }
}
