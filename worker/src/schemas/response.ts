import { z } from 'zod';
import type { Context } from 'hono';
import type { AppBindings } from '../env.js';

// =================================================================================
// Error Codes - Machine-readable error identifiers
// =================================================================================

export const ErrorCode = {
  // Validation errors (4xx)
  INVALID_ISBN: 'INVALID_ISBN',
  INVALID_REQUEST: 'INVALID_REQUEST',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Resource errors (4xx)
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // External provider errors (5xx)
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  ISBNDB_ERROR: 'ISBNDB_ERROR',
  GOOGLE_BOOKS_ERROR: 'GOOGLE_BOOKS_ERROR',
  OPENLIBRARY_ERROR: 'OPENLIBRARY_ERROR',

  // Database errors (5xx)
  DATABASE_ERROR: 'DATABASE_ERROR',
  DATABASE_TIMEOUT: 'DATABASE_TIMEOUT',

  // Storage errors (5xx)
  STORAGE_ERROR: 'STORAGE_ERROR',

  // Queue errors (5xx)
  QUEUE_ERROR: 'QUEUE_ERROR',

  // Generic errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

export const ErrorCodeSchema = z.enum(Object.values(ErrorCode) as [string, ...string[]]).openapi('ErrorCode');

// =================================================================================
// Error Code to HTTP Status Mapping
// =================================================================================

export const ERROR_STATUS_MAP: Record<ErrorCodeType, number> = {
  [ErrorCode.INVALID_ISBN]: 400,
  [ErrorCode.INVALID_REQUEST]: 400,
  [ErrorCode.MISSING_PARAMETER]: 400,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.PROVIDER_ERROR]: 502,
  [ErrorCode.PROVIDER_TIMEOUT]: 504,
  [ErrorCode.ISBNDB_ERROR]: 502,
  [ErrorCode.GOOGLE_BOOKS_ERROR]: 502,
  [ErrorCode.OPENLIBRARY_ERROR]: 502,
  [ErrorCode.DATABASE_ERROR]: 503,
  [ErrorCode.DATABASE_TIMEOUT]: 504,
  [ErrorCode.STORAGE_ERROR]: 503,
  [ErrorCode.QUEUE_ERROR]: 503,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

// =================================================================================
// Response Meta Schema
// =================================================================================

export const ResponseMetaSchema = z.object({
  requestId: z.string().describe('Unique request identifier for tracing'),
  timestamp: z.string().datetime().describe('ISO-8601 timestamp'),
  latencyMs: z.number().int().nonnegative().optional().describe('Request processing time in milliseconds'),
}).openapi('ResponseMeta');

export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

// =================================================================================
// Error Details Schema
// =================================================================================

export const ErrorDetailsSchema = z.object({
  code: ErrorCodeSchema.describe('Machine-readable error code'),
  message: z.string().describe('Human-readable error message'),
  details: z.record(z.string(), z.unknown()).optional().describe('Additional error context'),
}).openapi('ErrorDetails');

export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;

// =================================================================================
// Error Response Schema
// =================================================================================

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: ErrorDetailsSchema,
  meta: ResponseMetaSchema,
}).openapi('ErrorResponse');

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// =================================================================================
// Success Response Schema Factory
// =================================================================================

/**
 * Creates a typed success response schema wrapping the provided data schema
 *
 * @example
 * const SearchSuccessSchema = createSuccessSchema(SearchResultsSchema, 'SearchSuccess');
 */
export function createSuccessSchema<T extends z.ZodTypeAny>(
  dataSchema: T,
  name: string
) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: ResponseMetaSchema,
  }).openapi(name);
}

// =================================================================================
// Response Helper Utilities
// =================================================================================

/**
 * Build response meta from Hono context
 */
export function buildMeta(c: Context<AppBindings>): ResponseMeta {
  const startTime = c.get('startTime') as number | undefined;
  return {
    requestId: (c.get('requestId') as string | undefined) || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    latencyMs: startTime ? Date.now() - startTime : undefined,
  };
}

/**
 * Create a standardized success response
 *
 * @example
 * return createSuccessResponse(c, { results: [...], total: 100 });
 */
export function createSuccessResponse<T>(
  c: Context<AppBindings>,
  data: T,
  status: number = 200,
  headers?: Record<string, string>
) {
  const response = {
    success: true as const,
    data,
    meta: buildMeta(c),
  };

  return c.json(response, status as any, headers);
}

/**
 * Create a standardized error response
 *
 * @example
 * return createErrorResponse(c, ErrorCode.INVALID_ISBN, 'ISBN must be 10 or 13 digits');
 */
export function createErrorResponse(
  c: Context<AppBindings>,
  code: ErrorCodeType,
  message: string,
  details?: Record<string, unknown>
) {
  const status = ERROR_STATUS_MAP[code] || 500;

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
}

// =================================================================================
// API Error Class
// =================================================================================

/**
 * Custom error class for throwing typed API errors
 *
 * @example
 * throw new APIError(ErrorCode.NOT_FOUND, 'Book not found', { isbn: '123' });
 */
export class APIError extends Error {
  code: ErrorCodeType;
  details?: Record<string, unknown>;
  status: number;

  constructor(code: ErrorCodeType, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.details = details;
    this.status = ERROR_STATUS_MAP[code] || 500;
  }
}

// =================================================================================
// Legacy Error Type Mapping (for backwards compatibility with error-handler.js)
// =================================================================================

export const LEGACY_TYPE_TO_CODE: Record<string, ErrorCodeType> = {
  'validation': ErrorCode.VALIDATION_ERROR,
  'not_found': ErrorCode.NOT_FOUND,
  'timeout': ErrorCode.DATABASE_TIMEOUT,
  'rate_limit': ErrorCode.RATE_LIMIT_EXCEEDED,
  'upstream': ErrorCode.PROVIDER_ERROR,
  'database': ErrorCode.DATABASE_ERROR,
  'internal': ErrorCode.INTERNAL_ERROR,
};
