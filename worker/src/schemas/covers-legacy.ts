import { z } from 'zod';
import { ISBNSchema } from './common.js';

// =================================================================================
// Cover Legacy Route Schemas
// =================================================================================

// GET /covers/:isbn/status
export const CoverStatusParamsSchema = z.object({
  isbn: ISBNSchema,
}).openapi('CoverStatusParams');

export const CoverSizesSchema = z.object({
  large: z.number().optional(),
  medium: z.number().optional(),
  small: z.number().optional(),
}).openapi('CoverSizes');

export const CoverUrlsSchema = z.object({
  large: z.string(),
  medium: z.string(),
  small: z.string(),
  original: z.string().optional(),
}).openapi('CoverUrls');

export const CoverStatusResponseSchema = z.object({
  exists: z.boolean(),
  isbn: z.string(),
  format: z.enum(['webp', 'legacy']).optional(),
  storage: z.string().optional(),
  sizes: CoverSizesSchema.optional(),
  uploaded: z.string().optional(),
  urls: CoverUrlsSchema.optional(),
}).openapi('CoverStatusResponse');

// GET /covers/:isbn/:size
export const CoverServeParamsSchema = z.object({
  isbn: ISBNSchema,
  size: z.enum(['small', 'medium', 'large', 'original']),
}).openapi('CoverServeParams');

export const CoverServeErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
}).openapi('CoverServeError');

// POST /covers/:isbn/process
export const CoverProcessParamsSchema = z.object({
  isbn: ISBNSchema,
}).openapi('CoverProcessParams');

export const CoverProcessQuerySchema = z.object({
  force: z.string().optional().transform((val) => val === 'true'),
}).openapi('CoverProcessQuery');

export const CoverProcessResponseSchema = z.object({
  status: z.enum(['processed', 'already_exists', 'no_cover', 'error']),
  isbn: z.string(),
  work_key: z.string().optional(),
  provider_url: z.string().optional(),
  r2_key: z.string().optional(),
  size: z.number().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
}).openapi('CoverProcessResponse');

// POST /covers/batch
export const CoverBatchRequestSchema = z.object({
  isbns: z.array(z.string()).min(1).max(10),
}).openapi('CoverBatchRequest');

export const CoverBatchItemSchema = z.object({
  isbn: z.string(),
  status: z.enum(['processed', 'already_exists', 'no_cover', 'error']),
  work_key: z.string().optional(),
  provider_url: z.string().optional(),
  r2_key: z.string().optional(),
  size: z.number().optional(),
  error: z.string().optional(),
}).openapi('CoverBatchItem');

export const CoverBatchResponseSchema = z.object({
  results: z.array(CoverBatchItemSchema),
  summary: z.object({
    total: z.number(),
    processed: z.number(),
    cached: z.number(),
    no_cover: z.number(),
    failed: z.number(),
  }),
}).openapi('CoverBatchResponse');

// =================================================================================
// Type Exports
// =================================================================================

export type CoverStatusParams = z.infer<typeof CoverStatusParamsSchema>;
export type CoverStatusResponse = z.infer<typeof CoverStatusResponseSchema>;
export type CoverServeParams = z.infer<typeof CoverServeParamsSchema>;
export type CoverServeError = z.infer<typeof CoverServeErrorSchema>;
export type CoverProcessParams = z.infer<typeof CoverProcessParamsSchema>;
export type CoverProcessQuery = z.infer<typeof CoverProcessQuerySchema>;
export type CoverProcessResponse = z.infer<typeof CoverProcessResponseSchema>;
export type CoverBatchRequest = z.infer<typeof CoverBatchRequestSchema>;
export type CoverBatchItem = z.infer<typeof CoverBatchItemSchema>;
export type CoverBatchResponse = z.infer<typeof CoverBatchResponseSchema>;
