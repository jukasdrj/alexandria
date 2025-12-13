import { z } from 'zod';

// =================================================================================
// ISBNdb Test Schemas
// =================================================================================

export const ISBNdbTestResultSchema = z.object({
  endpoint: z.string(),
  success: z.boolean(),
  status: z.number().optional(),
  data: z.object({}).passthrough().optional(),
  error: z.string().optional(),
  responseTime: z.number().optional(),
}).openapi('ISBNdbTestResult');

export const ISBNdbTestSummarySchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  results: z.array(ISBNdbTestResultSchema),
}).openapi('ISBNdbTestSummary');

// Request schemas
export const ISBNParamSchema = z.object({
  isbn: z.string().describe('ISBN-10 or ISBN-13'),
}).openapi('ISBNParam');

export const NameParamSchema = z.object({
  name: z.string().describe('Author, publisher, or subject name'),
}).openapi('NameParam');

export const ISBNdbBooksQuerySchema = z.object({
  q: z.string().optional().default('harry potter').describe('Search query'),
  page: z.string().optional().default('1').transform(val => parseInt(val, 10)),
  pageSize: z.string().optional().default('5').transform(val => parseInt(val, 10)),
  column: z.string().optional().describe('Filter by column (e.g., title, author)'),
}).openapi('ISBNdbBooksQuery');

export const ISBNdbAuthorsQuerySchema = z.object({
  q: z.string().optional().default('rowling').describe('Search query'),
  page: z.string().optional().default('1').transform(val => parseInt(val, 10)),
  pageSize: z.string().optional().default('5').transform(val => parseInt(val, 10)),
}).openapi('ISBNdbAuthorsQuery');

export const BatchISBNsRequestSchema = z.object({
  isbns: z.array(z.string()).max(1000, 'Premium plan allows up to 1000 ISBNs per batch'),
}).openapi('BatchISBNsRequest');

// =================================================================================
// jSquash Test Schemas
// =================================================================================

export const JSquashRequestSchema = z.object({
  url: z.string().url().describe('Cover image URL to process'),
  isbn: z.string().optional().describe('If provided, stores in R2; otherwise runs benchmark only'),
}).openapi('JSquashRequest');

export const JSquashResultSchema = z.object({
  success: z.boolean(),
  isbn: z.string().optional(),
  sizes: z.object({
    large: z.number().optional(),
    medium: z.number().optional(),
    small: z.number().optional(),
  }).optional(),
  timing: z.object({
    download_ms: z.number().optional(),
    process_ms: z.number().optional(),
    upload_ms: z.number().optional(),
    total_ms: z.number().optional(),
  }).optional(),
  error: z.string().optional(),
}).openapi('JSquashResult');

// =================================================================================
// Wikidata Test Schemas
// =================================================================================

export const WikidataTestResultSchema = z.object({
  success: z.boolean(),
  endpoint: z.string(),
  responseTime: z.number().optional(),
  data: z.object({}).passthrough().optional(),
  error: z.string().optional(),
}).openapi('WikidataTestResult');

// =================================================================================
// Error Response Schema for Tests
// =================================================================================

export const TestErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
}).openapi('TestError');

// =================================================================================
// Type Exports
// =================================================================================

export type ISBNdbTestResult = z.infer<typeof ISBNdbTestResultSchema>;
export type ISBNdbTestSummary = z.infer<typeof ISBNdbTestSummarySchema>;
export type ISBNParam = z.infer<typeof ISBNParamSchema>;
export type NameParam = z.infer<typeof NameParamSchema>;
export type ISBNdbBooksQuery = z.infer<typeof ISBNdbBooksQuerySchema>;
export type ISBNdbAuthorsQuery = z.infer<typeof ISBNdbAuthorsQuerySchema>;
export type BatchISBNsRequest = z.infer<typeof BatchISBNsRequestSchema>;
export type JSquashRequest = z.infer<typeof JSquashRequestSchema>;
export type JSquashResult = z.infer<typeof JSquashResultSchema>;
export type WikidataTestResult = z.infer<typeof WikidataTestResultSchema>;
export type TestError = z.infer<typeof TestErrorSchema>;
