import { z } from 'zod';

// =================================================================================
// External ID Query Schemas
// =================================================================================

export const EntityTypeSchema = z.enum(['edition', 'work', 'author']).openapi('EntityType', {
  description: 'Type of entity to look up: edition (ISBN), work (OL work key), or author (OL author key)',
});

export const ProviderSchema = z.enum([
  'amazon',
  'google-books',
  'goodreads',
  'librarything',
  'wikidata',
  'viaf',
  'isni',
]).openapi('Provider', {
  description: 'External ID provider name',
});

export const ExternalIdParamSchema = z.object({
  entity_type: EntityTypeSchema,
  key: z.string().describe('Our internal key: ISBN for edition, /works/OL123W for work, /authors/OL456A for author'),
}).openapi('ExternalIdParam');

export const ResolveParamSchema = z.object({
  provider: z.string().describe('Provider name (e.g., "amazon", "goodreads", "google-books")'),
  id: z.string().describe('External provider ID (e.g., ASIN, Goodreads ID, Google Volume ID)'),
}).openapi('ResolveParam');

export const ResolveQuerySchema = z.object({
  type: EntityTypeSchema.default('edition').optional()
    .describe('Entity type to search for (default: edition)'),
}).openapi('ResolveQuery');

// =================================================================================
// External ID Response Schemas
// =================================================================================

export const ExternalIdSchema = z.object({
  provider: z.string().describe('Provider name (e.g., "amazon", "goodreads")'),
  provider_id: z.string().describe('External ID from provider'),
  confidence: z.number().int().min(0).max(100).describe('Confidence score (0-100)'),
  created_at: z.string().optional().describe('When this mapping was created (ISO 8601 timestamp)'),
}).openapi('ExternalId', {
  example: {
    provider: 'amazon',
    provider_id: 'B000FC1MCS',
    confidence: 90,
    created_at: '2026-01-08T10:30:00Z',
  },
});

export const ExternalIdMetaSchema = z.object({
  source: z.enum(['crosswalk', 'array_backfill']).describe(
    'Where data came from: crosswalk (existing mappings) or array_backfill (lazy backfill from arrays)'
  ),
  backfilled: z.boolean().describe('Whether this request triggered a backfill operation'),
  latency_ms: z.number().optional().describe('Query latency in milliseconds'),
}).openapi('ExternalIdMeta');

export const GetExternalIdsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(ExternalIdSchema),
  meta: ExternalIdMetaSchema,
}).openapi('GetExternalIdsResponse', {
  example: {
    success: true,
    data: [
      {
        provider: 'amazon',
        provider_id: 'B000FC1MCS',
        confidence: 90,
        created_at: '2026-01-08T10:30:00Z',
      },
      {
        provider: 'goodreads',
        provider_id: '2089208',
        confidence: 80,
        created_at: '2026-01-08T10:30:00Z',
      },
    ],
    meta: {
      source: 'crosswalk',
      backfilled: false,
      latency_ms: 0.75,
    },
  },
});

export const ResolveEntitySchema = z.object({
  key: z.string().describe('Our internal key (ISBN, work key, or author key)'),
  entity_type: EntityTypeSchema,
  confidence: z.number().int().min(0).max(100).describe('Confidence score of this mapping'),
}).openapi('ResolveEntity');

export const ResolveResponseSchema = z.object({
  success: z.boolean(),
  data: ResolveEntitySchema,
}).openapi('ResolveResponse', {
  example: {
    success: true,
    data: {
      key: '9780439064873',
      entity_type: 'edition',
      confidence: 80,
    },
  },
});

export const ExternalIdErrorSchema = z.object({
  success: z.boolean(),
  error: z.string(),
}).openapi('ExternalIdError');
