import { z } from 'zod';

// =================================================================================
// Common Response Schemas
// =================================================================================

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    type: z.enum(['validation', 'not_found', 'timeout', 'rate_limit', 'upstream', 'database', 'internal']),
    message: z.string(),
    request_id: z.string().optional(),
  }),
}).openapi('ErrorResponse');

export const SuccessResponseSchema = z.object({
  success: z.literal(true),
}).openapi('SuccessResponse');

// =================================================================================
// Health Check Schemas
// =================================================================================

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  database: z.enum(['connected', 'disconnected']),
  r2_covers: z.enum(['bound', 'not_configured']),
  hyperdrive_latency_ms: z.number().optional(),
  timestamp: z.string(),
  message: z.string().optional(),
}).openapi('HealthResponse');

// =================================================================================
// Pagination Schemas
// =================================================================================

export const PaginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 10;
    return Math.max(1, Math.min(100, parsed));
  }),
  offset: z.string().optional().transform((val) => {
    const parsed = val ? parseInt(val, 10) : 0;
    return Math.max(0, parsed);
  }),
}).openapi('PaginationQuery');

export const PaginationResponseSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  total: z.number().optional(),
  has_more: z.boolean().optional(),
}).openapi('PaginationResponse');

// =================================================================================
// ISBN Validation
// =================================================================================

export const ISBNSchema = z.string()
  .transform((val) => val.replace(/[^0-9X]/gi, '').toUpperCase())
  .refine((val) => val.length === 10 || val.length === 13, {
    message: 'ISBN must be 10 or 13 characters',
  })
  .openapi('ISBN');

// =================================================================================
// Type Exports
// =================================================================================

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;
