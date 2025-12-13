import { z } from 'zod';

// =================================================================================
// Re-export centralized response schemas
// =================================================================================

export { ErrorResponseSchema, createSuccessSchema } from './response.js';
export type { ErrorResponse, ResponseMeta } from './response.js';

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

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;
