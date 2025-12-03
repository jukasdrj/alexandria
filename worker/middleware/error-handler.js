// =================================================================================
// Error Handler Middleware - Consistent Error Responses for bendv3 Integration
// =================================================================================

/**
 * Error types for categorization
 */
export const ErrorType = {
  VALIDATION: 'validation',
  NOT_FOUND: 'not_found',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  UPSTREAM: 'upstream',
  DATABASE: 'database',
  INTERNAL: 'internal'
};

/**
 * Map of error types to HTTP status codes
 */
const ERROR_STATUS_CODES = {
  [ErrorType.VALIDATION]: 400,
  [ErrorType.NOT_FOUND]: 404,
  [ErrorType.TIMEOUT]: 504,
  [ErrorType.RATE_LIMIT]: 429,
  [ErrorType.UPSTREAM]: 502,
  [ErrorType.DATABASE]: 503,
  [ErrorType.INTERNAL]: 500
};

/**
 * Categorize an error into a known type
 *
 * @param {Error} error - The error to categorize
 * @returns {string} Error type from ErrorType enum
 */
export function categorizeError(error) {
  const message = error.message?.toLowerCase() || '';
  const name = error.name || '';

  // Timeout errors
  if (name === 'TimeoutError' || message.includes('timeout') || message.includes('timed out')) {
    return ErrorType.TIMEOUT;
  }

  // Rate limit errors
  if (error.status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return ErrorType.RATE_LIMIT;
  }

  // Not found
  if (error.status === 404 || message.includes('not found')) {
    return ErrorType.NOT_FOUND;
  }

  // Validation errors
  if (name === 'ValidationError' || message.includes('invalid') || message.includes('validation')) {
    return ErrorType.VALIDATION;
  }

  // Database errors
  if (message.includes('database') || message.includes('connection') ||
      message.includes('postgres') || message.includes('sql')) {
    return ErrorType.DATABASE;
  }

  // Upstream/external API errors
  if (name === 'HTTPError' || message.includes('api error') ||
      message.includes('fetch') || error.status >= 500) {
    return ErrorType.UPSTREAM;
  }

  return ErrorType.INTERNAL;
}

/**
 * Get HTTP status code for an error type
 *
 * @param {string} errorType - Error type from ErrorType enum
 * @returns {number} HTTP status code
 */
export function getStatusCode(errorType) {
  return ERROR_STATUS_CODES[errorType] || 500;
}

/**
 * Sanitize error message to prevent leaking sensitive information
 *
 * @param {string} message - Raw error message
 * @returns {string} Sanitized message safe for client
 */
export function sanitizeErrorMessage(message) {
  if (!message) return 'An unexpected error occurred';

  // Patterns to redact (connection strings, API keys, internal paths, etc.)
  const redactPatterns = [
    /postgres:\/\/[^\s]+/gi,           // Connection strings
    /password[=:][^\s&]+/gi,           // Passwords in URLs
    /api[_-]?key[=:][^\s&]+/gi,        // API keys
    /bearer\s+[^\s]+/gi,               // Bearer tokens
    /authorization[=:][^\s]+/gi,       // Auth headers
    /\/home\/[^\s]+/gi,                // File paths
    /at\s+[^\s]+\s+\([^)]+\)/gi,       // Stack trace lines
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g  // IP addresses
  ];

  let sanitized = message;
  for (const pattern of redactPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Truncate very long messages
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }

  return sanitized;
}

/**
 * Create a standardized error response object
 *
 * @param {Error} error - The error that occurred
 * @param {string} requestId - Optional request ID for tracing
 * @returns {{success: false, error: {type: string, message: string, request_id?: string}}}
 */
export function createErrorResponse(error, requestId = null) {
  const type = categorizeError(error);
  const message = sanitizeErrorMessage(error.message);

  const response = {
    success: false,
    error: {
      type,
      message
    }
  };

  if (requestId) {
    response.error.request_id = requestId;
  }

  return response;
}

/**
 * Hono error handler middleware
 * Catches errors and returns consistent JSON responses
 *
 * Usage:
 *   app.onError(errorHandler);
 *
 * @param {Error} error - The caught error
 * @param {import('hono').Context} c - Hono context
 * @returns {Response}
 */
export function errorHandler(error, c) {
  // Log the full error for debugging (not exposed to client)
  console.error('Error handler caught:', {
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    url: c.req.url,
    method: c.req.method
  });

  // Get request ID if present
  const requestId = c.req.header('x-request-id') || c.req.header('cf-ray');

  // Create standardized response
  const errorResponse = createErrorResponse(error, requestId);
  const statusCode = getStatusCode(errorResponse.error.type);

  return c.json(errorResponse, statusCode);
}

/**
 * Create a typed API error for consistent error throwing
 *
 * @param {string} type - Error type from ErrorType enum
 * @param {string} message - Error message
 * @returns {Error}
 */
export function createAPIError(type, message) {
  const error = new Error(message);
  error.name = 'APIError';
  error.type = type;
  error.status = getStatusCode(type);
  return error;
}

/**
 * Wrap a handler to ensure it returns consistent response format
 * Useful for wrapping existing handlers during migration
 *
 * @param {Function} handler - Async handler function (c) => Response
 * @returns {Function} Wrapped handler with consistent error handling
 */
export function wrapHandler(handler) {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      return errorHandler(error, c);
    }
  };
}
