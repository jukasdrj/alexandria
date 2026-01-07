import type { Sql } from 'postgres';
import type { Logger } from '../lib/logger.js';

// Cloudflare Worker Environment Bindings
export interface Env {
  // Hyperdrive binding
  HYPERDRIVE: Hyperdrive;

  // R2 bindings
  COVER_IMAGES: R2Bucket;

  // KV bindings
  CACHE: KVNamespace;
  QUOTA_KV: KVNamespace;

  // Analytics Engine bindings
  ANALYTICS: AnalyticsEngineDataset;
  QUERY_ANALYTICS: AnalyticsEngineDataset;
  COVER_ANALYTICS: AnalyticsEngineDataset;

  // Secrets Store bindings (async get() method)
  ISBNDB_API_KEY: {
    get(): Promise<string | null>;
  };
  GOOGLE_BOOKS_API_KEY: {
    get(): Promise<string | null>;
  };
  GEMINI_API_KEY: {
    get(): Promise<string | null>;
  };

  // Queue bindings
  ENRICHMENT_QUEUE: Queue;
  COVER_QUEUE: Queue;
  BACKFILL_QUEUE: Queue;

  // Environment variables (from wrangler.jsonc vars)
  DB_MAX_CONNECTIONS: string;
  DB_CONNECTION_TIMEOUT_MS: string;
  DB_IDLE_TIMEOUT_MS: string;
  CACHE_TTL_SHORT: string;
  CACHE_TTL_MEDIUM: string;
  CACHE_TTL_LONG: string;
  ENABLE_QUERY_CACHE: string;
  RATE_LIMIT_REQUESTS: string;
  RATE_LIMIT_WINDOW_MS: string;
  MAX_COVER_SIZE_MB: string;
  COVER_QUALITY: string;
  ENABLE_WEBP_CONVERSION: string;
  COVER_SIZES: string;
  ENRICHMENT_BATCH_SIZE: string;
  ENRICHMENT_CONCURRENCY: string;
  MAX_RETRIES: string;
  OPENLIBRARY_BASE_URL: string;
  PLACEHOLDER_COVER_URL?: string; // Optional: Fallback placeholder image URL
  USER_AGENT: string;
  LOG_LEVEL: string;
  ENABLE_PERFORMANCE_LOGGING: string;
  ENABLE_QUERY_LOGGING: string;
  STRUCTURED_LOGGING: string;
  ENABLE_ENRICHMENT_QUEUE: string;
  ENABLE_COVER_PROCESSING: string;
  ENABLE_ANALYTICS: string;

  // Webhook Integration
  BEND_WEBHOOK_URL?: string;
  ALEXANDRIA_WEBHOOK_SECRET?: string;

  // Harvest configuration (Issue #135)
  HARVEST_MIN_YEAR: string;
  HARVEST_MAX_YEAR: string;
  HARVEST_ISBN_PREFIXES: string;
  HARVEST_BATCH_SIZE: string;
  HARVEST_SORT_BY: string;
  HARVEST_QUEUE_DEFAULT: string;

  // Parallel enrichment configuration (Issue #133)
  ENABLE_PARALLEL_ENRICHMENT: string;
  PARALLEL_CONCURRENCY_LIMIT: string;
}

// Logger type is imported from lib/logger.js for consistency

// Extend Hono Context with custom variables
export type Variables = {
  sql: Sql; // postgres-js SQL instance with full type safety
  startTime: number;
  requestId: string; // Unique request ID for log tracing (cf-ray or UUID)
  logger: Logger; // Logger instance with full type safety
};

// App type for OpenAPIHono
export type AppBindings = {
  Bindings: Env;
  Variables: Variables;
};
