/**
 * Cover URL Resolver
 *
 * ALWAYS returns Alexandria R2 URLs - never external URLs.
 * Downloads and caches covers immediately on first request.
 *
 * Flow:
 * 1. Check if cover exists in R2 → return Alexandria URL (fast)
 * 2. Not cached → download from providers, store in R2, return Alexandria URL (slower first request)
 * 3. No cover found → return placeholder
 *
 * @module services/cover-resolver
 */

import { coverExists, processCoverImage } from './image-processor.js';
import type { Env } from '../src/env';

// Alexandria cover CDN base
const ALEXANDRIA_COVER_BASE = 'https://alexandria.ooheynerds.com/covers';

// Placeholder for books without covers
const PLACEHOLDER_URL = 'https://alexandria.ooheynerds.com/covers/placeholder.svg';

/**
 * Cover resolution result
 */
export interface CoverResolutionResult {
  url: string;
  source: 'alexandria' | 'placeholder';
  cached: boolean;
}

/**
 * Process cover image options
 */
interface ProcessCoverOptions {
  knownCoverUrl?: string;
  force?: boolean;
}

/**
 * Resolve cover URL for an ISBN
 *
 * Logic:
 * 1. Check R2 for cached cover
 * 2. If cached → return Alexandria URL
 * 3. If not cached → download immediately, store in R2, return Alexandria URL
 *
 * CRITICAL: Alexandria NEVER returns external URLs. All covers are downloaded and served from R2.
 *
 * @param isbn - ISBN to resolve cover for
 * @param externalUrl - External cover URL from provider (used to avoid redundant API calls)
 * @param env - Worker environment
 * @param ctx - Execution context (unused, kept for compatibility)
 * @returns Cover resolution result
 */
export async function resolveCoverUrl(
  isbn: string,
  externalUrl: string | null,
  env: Env,
  ctx?: ExecutionContext
): Promise<CoverResolutionResult> {
  if (!isbn) {
    return { url: PLACEHOLDER_URL, source: 'placeholder', cached: false };
  }

  const normalizedISBN = isbn.replace(/[-\s]/g, '');

  try {
    // 1. Check if cover exists in R2
    const cached = await coverExists(env, normalizedISBN);

    if (cached) {
      // Return Alexandria CDN URL
      return {
        url: `${ALEXANDRIA_COVER_BASE}/${normalizedISBN}/large`,
        source: 'alexandria',
        cached: true
      };
    }

    // 2. Not cached - download immediately and store in R2
    console.log(`[CoverResolver] Cover not cached for ${normalizedISBN}, downloading now...`);

    // Pass externalUrl if available to avoid redundant provider searches
    const options: ProcessCoverOptions = externalUrl ? { knownCoverUrl: externalUrl } : {};
    const result = await processCoverImage(normalizedISBN, env, options);

    if (result.status === 'processed' || result.status === 'already_exists') {
      console.log(`[CoverResolver] Successfully processed cover for ${normalizedISBN}`);
      return {
        url: `${ALEXANDRIA_COVER_BASE}/${normalizedISBN}/large`,
        source: 'alexandria',
        cached: false
      };
    }

    // 3. No cover available from any provider
    console.log(`[CoverResolver] No cover found for ${normalizedISBN}`);
    return { url: PLACEHOLDER_URL, source: 'placeholder', cached: false };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[CoverResolver] Error resolving ${normalizedISBN}:`, errorMessage);
    return { url: PLACEHOLDER_URL, source: 'placeholder', cached: false };
  }
}

/**
 * Batch item for cover resolution
 */
export interface CoverBatchItem {
  isbn: string;
  externalUrl: string | null;
}

/**
 * Resolve cover URLs for multiple ISBNs (batch)
 *
 * @param items - Items to resolve
 * @param env - Worker environment
 * @param ctx - Execution context
 * @returns Map of ISBN to cover resolution result
 */
export async function resolveCoverUrlsBatch(
  items: CoverBatchItem[],
  env: Env,
  ctx?: ExecutionContext
): Promise<Map<string, CoverResolutionResult>> {
  const results = new Map<string, CoverResolutionResult>();

  // Process in parallel (limited concurrency)
  const BATCH_SIZE = 10;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async ({ isbn, externalUrl }) => {
        const result = await resolveCoverUrl(isbn, externalUrl, env, ctx);
        return { isbn, result };
      })
    );

    batchResults.forEach(({ isbn, result }) => {
      results.set(isbn, result);
    });
  }

  return results;
}

/**
 * Cover size option
 */
export type CoverSize = 'small' | 'medium' | 'large';

/**
 * Get Alexandria cover URL for an ISBN (without checking R2)
 * Use when you know the cover is cached
 *
 * @param isbn - ISBN
 * @param size - Cover size
 * @returns Alexandria cover URL
 */
export function getAlexandriaCoverUrl(isbn: string, size: CoverSize = 'large'): string {
  const normalizedISBN = isbn.replace(/[-\s]/g, '');
  return `${ALEXANDRIA_COVER_BASE}/${normalizedISBN}/${size}`;
}

/**
 * OpenLibrary edition data structure (minimal typing for cover extraction)
 */
interface OpenLibraryEditionData {
  covers?: number[];
  data?: {
    covers?: number[];
    key?: string;
  };
  key?: string;
}

/**
 * Extract cover URL from OpenLibrary data
 * @param editionData - OpenLibrary edition data
 * @returns Cover URL or null
 */
export function extractOpenLibraryCover(editionData: OpenLibraryEditionData | null): string | null {
  if (!editionData) return null;

  // Try cover_id first (preferred)
  const coverId = editionData?.covers?.[0] || editionData?.data?.covers?.[0];
  if (coverId && coverId > 0) {
    return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  }

  // Try OLID-based cover
  const key = editionData?.key || editionData?.data?.key;
  if (key) {
    const olid = key.replace('/books/', '').replace('/works/', '');
    return `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
  }

  return null;
}
