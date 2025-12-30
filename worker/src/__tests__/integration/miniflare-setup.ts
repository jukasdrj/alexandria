/**
 * Miniflare Test Setup
 *
 * Provides test bindings and mock services for Miniflare integration tests.
 * This allows testing Worker runtime without connecting to real external services.
 */

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { Env } from '../../env.js';

/**
 * Create mock KV namespace for testing
 */
export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: async (key: string) => {
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => {
      return {
        keys: Array.from(store.keys()).map(name => ({ name })),
        list_complete: true,
        cursor: '',
      };
    },
    getWithMetadata: async (key: string) => {
      const value = store.get(key) ?? null;
      return { value, metadata: null };
    },
  } as KVNamespace;
}

/**
 * Create mock Hyperdrive binding for testing
 * Returns a connection string that won't actually be used
 */
export function createMockHyperdrive() {
  return {
    connectionString: 'postgres://mock:mock@localhost:5432/mock',
  };
}

/**
 * Create mock R2 bucket for testing
 */
export function createMockR2(): R2Bucket {
  const store = new Map<string, ArrayBuffer>();

  return {
    get: async (key: string) => {
      const value = store.get(key);
      if (!value) return null;

      return {
        key,
        size: value.byteLength,
        arrayBuffer: async () => value,
        text: async () => new TextDecoder().decode(value),
        json: async () => JSON.parse(new TextDecoder().decode(value)),
        blob: async () => new Blob([value]),
      } as R2ObjectBody;
    },
    put: async (key: string, value: ArrayBuffer | string) => {
      const buffer = typeof value === 'string' ? new TextEncoder().encode(value).buffer : value;
      store.set(key, buffer);
      return {} as R2Object;
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => {
      return {
        objects: Array.from(store.keys()).map(key => ({
          key,
          size: store.get(key)!.byteLength,
          uploaded: new Date(),
        })),
        truncated: false,
      } as R2Objects;
    },
  } as unknown as R2Bucket;
}

/**
 * Create mock queue for testing
 */
export function createMockQueue(): Queue {
  const messages: unknown[] = [];

  return {
    send: async (body: unknown) => {
      messages.push(body);
    },
    sendBatch: async (batch: unknown[]) => {
      messages.push(...batch);
    },
  } as Queue;
}

/**
 * Create mock analytics engine binding
 */
export function createMockAnalytics(): AnalyticsEngineDataset {
  return {
    writeDataPoint: async () => {
      // No-op for testing
    },
  } as AnalyticsEngineDataset;
}

/**
 * Create complete mock environment for testing
 */
export function createTestEnv(): Env {
  return {
    // Database
    HYPERDRIVE: createMockHyperdrive() as any,

    // Storage
    CACHE: createMockKV(),
    QUOTA_KV: createMockKV(),
    COVER_IMAGES: createMockR2(),

    // Queues
    ENRICHMENT_QUEUE: createMockQueue(),
    COVER_QUEUE: createMockQueue(),

    // Analytics
    ANALYTICS: createMockAnalytics(),
    QUERY_ANALYTICS: createMockAnalytics(),
    COVER_ANALYTICS: createMockAnalytics(),

    // Secrets (mock values for testing)
    ISBNDB_API_KEY: 'test-isbndb-key',
    GOOGLE_BOOKS_API_KEY: 'test-google-books-key',

    // Config
    CACHE_TTL_SHORT: '300',
    CACHE_TTL_MEDIUM: '3600',
    CACHE_TTL_LONG: '86400',
  } as Env;
}
