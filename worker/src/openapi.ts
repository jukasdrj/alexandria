import { OpenAPIHono } from '@hono/zod-openapi';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { AppBindings } from './env.js';

// =================================================================================
// OpenAPI Configuration
// =================================================================================

/**
 * OpenAPI document configuration
 * Used by both the doc endpoint and getOpenAPIDocument()
 */
export const openAPIConfig = {
  openapi: '3.1.0' as const,
  info: {
    title: 'Alexandria Book API',
    version: '2.1.0',
    description: `Search and enrich 54+ million books from OpenLibrary.

## Features
- **ISBN Search**: Exact match with automatic Smart Resolution enrichment
- **Title/Author Search**: Fuzzy matching with pg_trgm trigram indexes
- **Cover Processing**: Multi-provider cover fetching with WebP optimization
- **Metadata Enrichment**: ISBNdb → Google Books → OpenLibrary chain

## Rate Limits
- 100 requests per minute (standard)
- ISBNdb: 3 requests/second (Premium plan)

## Authentication
API is secured with Cloudflare Access (IP whitelist).
`,
    contact: {
      name: 'Alexandria API Support',
      email: 'nerd@ooheynerds.com',
    },
  },
  servers: [
    {
      url: 'https://alexandria.ooheynerds.com',
      description: 'Production',
    },
    {
      url: 'http://localhost:8787',
      description: 'Local Development',
    },
  ],
  tags: [
    { name: 'System', description: 'Health checks and system status' },
    { name: 'Search', description: 'Book search endpoints' },
    { name: 'Covers', description: 'Cover image processing and serving' },
    { name: 'Covers (Legacy)', description: 'ISBN-based cover endpoints (legacy)' },
    { name: 'Enrichment', description: 'Metadata enrichment endpoints' },
    { name: 'Authors', description: 'Author bibliography endpoints' },
    { name: 'Test', description: 'ISBNdb API test endpoints' },
  ],
};

/**
 * Creates the OpenAPI-enabled Hono app
 * NOTE: app.doc() must be called AFTER routes are mounted
 */
export const createOpenAPIApp = () => {
  return new OpenAPIHono<AppBindings>();
};

/**
 * Registers the OpenAPI documentation endpoint
 * Call this AFTER all routes are mounted
 *
 * Note: Due to @hono/zod-openapi limitation, sub-routers don't share OpenAPI registries.
 * We collect and merge OpenAPI specs from all sub-routers.
 */
export const registerOpenAPIDoc = (
  app: OpenAPIHono<AppBindings>,
  subRouters: OpenAPIHono<AppBindings>[]
) => {
  app.get('/openapi.json', (c) => {
    try {
      // Start with base config
      const mergedDoc: OpenAPIV3_1.Document = {
        ...openAPIConfig,
        paths: {},
        components: {
          schemas: {},
        },
      };

      // Collect OpenAPI specs from all sub-routers
      for (let i = 0; i < subRouters.length; i++) {
        const router = subRouters[i];
        try {
          const subDoc = router.getOpenAPI31Document(openAPIConfig);

          // Merge paths
          if (subDoc.paths) {
            const pathCount = Object.keys(subDoc.paths).length;
            console.log(`[OpenAPI] Router ${i} contributed ${pathCount} paths`);
            Object.assign(mergedDoc.paths || {}, subDoc.paths);
          }

          // Merge component schemas
          if (subDoc.components?.schemas) {
            // Ensure mergedDoc.components exists
            if (!mergedDoc.components) {
              mergedDoc.components = { schemas: {} };
            }
            Object.assign(mergedDoc.components.schemas || {}, subDoc.components.schemas);
          }
        } catch (e) {
          // Log which router failed with error details
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.warn(`[OpenAPI] Router ${i} failed: ${errorMsg}`);
        }
      }

      return c.json(mergedDoc);
    } catch (error) {
      console.error('OpenAPI generation error:', error);
      return c.json({
        error: 'Failed to generate OpenAPI spec',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
};
