/**
 * Cover URL Resolver
 *
 * Determines whether to return Alexandria R2 URL or external URL.
 * Implements lazy-loading: external URL on first request, Alexandria URL after caching.
 *
 * @module services/cover-resolver
 */

import { coverExists, processCoverImage } from './image-processor.js';
import { fetchBestCover } from './cover-fetcher.js';

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
 * 3. If not cached → return external URL + queue background caching
 * 
 * @param {string} isbn - ISBN to resolve cover for
 * @param {string|null} externalUrl - External cover URL from provider
 * @param {object} env - Worker environment
 * @param {object} ctx - Execution context (for waitUntil)
 * @returns {Promise<{url: string, source: 'alexandria'|'external'|'placeholder', queued: boolean}>}
 */
export async function resolveCoverUrl(isbn, externalUrl, env, ctx) {
  if (!isbn) {
    return { url: PLACEHOLDER_URL, source: 'placeholder', queued: false };
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
        queued: false
      };
    }
    
    // 2. Not cached - fetch from external providers or use provided URL
    let coverUrl = externalUrl;

    // If no external URL provided, try to fetch from ISBNdb → Google Books → OpenLibrary
    if (!coverUrl) {
      console.log(`[CoverResolver] No cover_id in DB for ${normalizedISBN}, fetching from providers...`);
      const coverResult = await fetchBestCover(normalizedISBN, env);
      coverUrl = coverResult?.url || null;

      if (coverUrl && coverUrl !== 'https://placehold.co/300x450/e0e0e0/666666?text=No+Cover') {
        console.log(`[CoverResolver] Found cover via ${coverResult.source} for ${normalizedISBN}`);
      }
    }

    // If we have a cover URL, queue background processing and return it
    if (coverUrl && coverUrl !== 'https://placehold.co/300x450/e0e0e0/666666?text=No+Cover') {
      // Queue background cover processing (non-blocking)
      if (ctx?.waitUntil) {
        ctx.waitUntil(
          processCoverImage(normalizedISBN, env)
            .then(result => {
              if (result.status === 'processed') {
                console.log(`[CoverResolver] Cached cover for ${normalizedISBN}`);
              }
            })
            .catch(err => {
              console.error(`[CoverResolver] Failed to cache ${normalizedISBN}:`, err.message);
            })
        );
      }

      return {
        url: coverUrl,
        source: 'external',
        queued: true
      };
    }

    // 3. No cover URL available from any source
    return { url: PLACEHOLDER_URL, source: 'placeholder', queued: false };
    
  } catch (error) {
    console.error(`[CoverResolver] Error resolving ${normalizedISBN}:`, error.message);
    
    // Fallback to external URL if available
    if (externalUrl) {
      return { url: externalUrl, source: 'external', queued: false };
    }
    
    return { url: PLACEHOLDER_URL, source: 'placeholder', queued: false };
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
