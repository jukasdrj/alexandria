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

// Alexandria cover CDN base
const ALEXANDRIA_COVER_BASE = 'https://alexandria.ooheynerds.com/covers';

// Placeholder for books without covers
const PLACEHOLDER_URL = 'https://alexandria.ooheynerds.com/covers/placeholder.svg';

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
 * @param {string} isbn - ISBN to resolve cover for
 * @param {string|null} externalUrl - External cover URL from provider (used to avoid redundant API calls)
 * @param {object} env - Worker environment
 * @param {object} ctx - Execution context (unused, kept for compatibility)
 * @returns {Promise<{url: string, source: 'alexandria'|'placeholder', cached: boolean}>}
 */
export async function resolveCoverUrl(isbn, externalUrl, env, ctx) {
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
    const options = externalUrl ? { knownCoverUrl: externalUrl } : {};
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
    console.error(`[CoverResolver] Error resolving ${normalizedISBN}:`, error.message);
    return { url: PLACEHOLDER_URL, source: 'placeholder', cached: false };
  }
}

/**
 * Resolve cover URLs for multiple ISBNs (batch)
 * 
 * @param {Array<{isbn: string, externalUrl: string|null}>} items - Items to resolve
 * @param {object} env - Worker environment
 * @param {object} ctx - Execution context
 * @returns {Promise<Map<string, {url: string, source: string}>>}
 */
export async function resolveCoverUrlsBatch(items, env, ctx) {
  const results = new Map();
  
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
 * Get Alexandria cover URL for an ISBN (without checking R2)
 * Use when you know the cover is cached
 * 
 * @param {string} isbn - ISBN
 * @param {'small'|'medium'|'large'} size - Cover size
 * @returns {string}
 */
export function getAlexandriaCoverUrl(isbn, size = 'large') {
  const normalizedISBN = isbn.replace(/[-\s]/g, '');
  return `${ALEXANDRIA_COVER_BASE}/${normalizedISBN}/${size}`;
}

/**
 * Extract cover URL from OpenLibrary data
 * @param {object} editionData - OpenLibrary edition data
 * @returns {string|null}
 */
export function extractOpenLibraryCover(editionData) {
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
