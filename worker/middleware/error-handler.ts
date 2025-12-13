import type { Context, ErrorHandler } from 'hono';
import type { AppBindings } from '../src/env.js';
import {
  ErrorCode,
  ErrorCodeType,
  ERROR_STATUS_MAP,
  LEGACY_TYPE_TO_CODE,
  APIError,
  buildMeta,
  type ErrorResponse,
} from '../src/schemas/response.js';

// =================================================================================
// Error Handler Middleware - Consistent Error Responses for bendv3 Integration
// =================================================================================

/**
 * Patterns to redact from error messages (security)
 */
const REDACT_PATTERNS = [
  /postgres:\/\/[^\s]+/gi,           // Connection strings
  /password[=:][^\s&]+/gi,           // Passwords in URLs
  /api[_-]?key[=:][^\s&]+/gi,        // API keys
  /bearer\s+[^\s]+/gi,               // Bearer tokens
  /authorization[=:][^\s]+/gi,       // Auth headers
  /\/home\/[^\s]+/gi,                // File paths
  /at\s+[^\s]+\s+\([^)]+\)/gi,       // Stack trace lines
  /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g,  // IP addresses
];

/**
 * Sanitize error message to prevent leaking sensitive information
 */
function sanitizeMessage(message: string | undefined): string {
  if (!message) return 'An unexpected error occurred';

  let sanitized = message;
  for (const pattern of REDACT_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Truncate very long messages
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }

  return sanitized;
}

/**
 * Provider error patterns - maps keywords to error codes
 */
const PROVIDER_ERROR_PATTERNS: Array<{ patterns: string[]; code: ErrorCodeType }> = [
  { patterns: ['isbndb'], code: ErrorCode.ISBNDB_ERROR },
  { patterns: ['google books', 'books.google'], code: ErrorCode.GOOGLE_BOOKS_ERROR },
  { patterns: ['openlibrary', 'open library'], code: ErrorCode.OPENLIBRARY_ERROR },
];

/**
 * Categorize an error into an ErrorCode
 */
function categorizeError(error: Error & { status?: number; code?: string; type?: string }): ErrorCodeType {
  const message = error.message?.toLowerCase() || '';
  const name = error.name || '';

  // Check for APIError (our custom error class)
  if (error instanceof APIError) {
    return error.code;
  }

  // Check for legacy type field
  if (error.type && LEGACY_TYPE_TO_CODE[error.type]) {
    return LEGACY_TYPE_TO_CODE[error.type];
  }

  // Zod validation errors
  if (name === 'ZodError') {
    return ErrorCode.VALIDATION_ERROR;
  }

  // Timeout errors
  if (name === 'TimeoutError' || message.includes('timeout') || message.includes('timed out')) {
    return ErrorCode.DATABASE_TIMEOUT;
  }

  // Rate limit errors
  if (error.status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return ErrorCode.RATE_LIMIT_EXCEEDED;
  }

  // Not found
  if (error.status === 404 || message.includes('not found')) {
    return ErrorCode.NOT_FOUND;
  }

  // Validation errors
  if (name === 'ValidationError' || message.includes('invalid') || message.includes('validation')) {
    return ErrorCode.VALIDATION_ERROR;
  }

  // Database errors
  if (message.includes('database') || message.includes('connection') ||
      message.includes('postgres') || message.includes('sql')) {
    return ErrorCode.DATABASE_ERROR;
  }

  // Provider-specific errors (ISBNdb, Google Books, OpenLibrary)
  for (const { patterns, code } of PROVIDER_ERROR_PATTERNS) {
    if (patterns.some(p => message.includes(p))) {
      return code;
    }
  }

  // Upstream/external API errors
  if (name === 'HTTPError' || message.includes('api error') ||
      message.includes('fetch') || (error.status && error.status >= 500)) {
    return ErrorCode.PROVIDER_ERROR;
  }

  return ErrorCode.INTERNAL_ERROR;
}

/**
 * Hono error handler middleware
 * Catches errors and returns consistent JSON responses with envelope format
 */
export const errorHandler: ErrorHandler<AppBindings> = (error, c) => {
  const logger = c.get('logger');
  // Log the full error for debugging (not exposed to client)
  logger.error('Error handler caught:', {
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    url: c.req.url,
    method: c.req.method,
  });

  const code = categorizeError(error as Error & { status?: number; code?: string; type?: string });
  const status = ERROR_STATUS_MAP[code] || 500;
  const message = sanitizeMessage(error.message);

  // Build details from APIError if available
  const details = error instanceof APIError ? error.details : undefined;

  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    meta: buildMeta(c),
  };

  return c.json(response, status as any);
};

/**
 * Create a typed API error for consistent error throwing
 *
 * @deprecated Use `new APIError(code, message, details)` instead
 */
export function createAPIError(code: ErrorCodeType, message: string, details?: Record<string, unknown>): APIError {
  return new APIError(code, message, details);
}

// Re-export for convenience
export { APIError, ErrorCode };
export type { ErrorCodeType };
