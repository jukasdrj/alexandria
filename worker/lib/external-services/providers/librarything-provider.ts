/**
 * LibraryThing Service Provider
 *
 * Provides edition variant discovery via LibraryThing's thingISBN API.
 * Community-validated edition relationships from 2M+ LibraryThing users.
 *
 * Implements:
 * - IEditionVariantProvider: ISBN → Related ISBNs (editions, formats, translations)
 *
 * Features:
 * - Free for non-commercial use
 * - Rate limit: 1,000 requests/day, 1 request per second
 * - KV-backed rate limiting and caching
 * - 30-day cache TTL (edition data is stable)
 * - Graceful error handling (returns empty array, never throws)
 *
 * API Documentation:
 * - Endpoint: https://www.librarything.com/api/{key}/thingISBN/{isbn}
 * - Format: XML response with related ISBNs
 * - Optional allids=1 parameter for LCCN/OCLC numbers
 *
 * @see https://www.librarything.com/services/webservices.php
 * @see https://wiki.librarything.com/index.php/LibraryThing_APIs
 * @module lib/external-services/providers/librarything-provider
 */

import type {
  IEditionVariantProvider,
  EditionVariant,
} from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

// =================================================================================
// Constants
// =================================================================================

/**
 * LibraryThing thingISBN API base URL
 */
const LIBRARYTHING_API_BASE = 'https://www.librarything.com/api';

// =================================================================================
// Types
// =================================================================================

/**
 * LibraryThing thingISBN API response structure
 *
 * XML format:
 * <idlist>
 *   <isbn>9780441172719</isbn>
 *   <isbn>0441172717</isbn>
 *   ...
 * </idlist>
 *
 * We'll parse the XML to extract ISBNs
 */
interface ThingISBNResponse {
  isbns: string[];
}

// =================================================================================
// LibraryThing Provider
// =================================================================================

/**
 * LibraryThing Service Provider
 *
 * Free service for non-commercial use.
 * Rate limited to 1 req/sec (1,000 req/day).
 */
export class LibraryThingProvider implements IEditionVariantProvider {
  readonly name = 'librarything';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.EDITION_VARIANTS];

  private client = new ServiceHttpClient({
    providerName: 'librarything',
    rateLimitMs: 1000, // 1 req/sec to stay well under limit
    cacheTtlSeconds: 2592000, // 30 days (edition data is stable)
    purpose: 'Edition disambiguation and variant discovery',
  });

  /**
   * Check if LibraryThing is available
   * Requires API key in environment
   */
  async isAvailable(env: Env): Promise<boolean> {
    const apiKey = await env.LIBRARYTHING_API_KEY?.get();
    return !!apiKey;
  }

  /**
   * Fetch edition variants (related ISBNs) for a given ISBN
   *
   * Uses thingISBN API to find other editions, formats, and translations
   * of the same work based on LibraryThing's community-validated data.
   *
   * @param isbn - The ISBN to look up
   * @param context - Service context with logger and env
   * @returns Array of edition variants (may be empty if none found)
   */
  async fetchEditionVariants(isbn: string, context: ServiceContext): Promise<EditionVariant[]> {
    const { logger, env } = context;

    try {
      // Validate ISBN format
      const normalizedISBN = normalizeISBN(isbn);
      if (!normalizedISBN) {
        logger.debug('Invalid ISBN format for LibraryThing edition variants', { isbn });
        return [];
      }

      // Get API key
      const apiKey = await env.LIBRARYTHING_API_KEY?.get();
      if (!apiKey) {
        logger.error('LibraryThing API key not configured');
        return [];
      }

      // Build thingISBN API URL
      const url = `${LIBRARYTHING_API_BASE}/${apiKey}/thingISBN/${normalizedISBN}`;

      // Fetch XML response
      const xmlResponse = await this.client.fetch<string>(
        url,
        {
          headers: {
            'Accept': 'application/xml, text/xml',
          },
        },
        context,
        'text' // Request text response instead of JSON
      );

      if (!xmlResponse) {
        logger.debug('No response from LibraryThing thingISBN API', { isbn });
        return [];
      }

      // Parse XML to extract ISBNs
      const relatedISBNs = this.parseThingISBNResponse(xmlResponse);

      if (relatedISBNs.length === 0) {
        logger.debug('No edition variants found via LibraryThing', { isbn });
        return [];
      }

      // Convert ISBNs to EditionVariant objects
      // Note: LibraryThing doesn't provide format info, so we mark as 'other'
      const variants: EditionVariant[] = relatedISBNs
        .filter((relatedIsbn) => relatedIsbn !== normalizedISBN) // Exclude the original ISBN
        .map((relatedIsbn) => ({
          isbn: relatedIsbn,
          format: 'other' as const, // LibraryThing doesn't provide format info
          formatDescription: 'Related edition from LibraryThing',
          source: 'librarything',
        }));

      logger.info('LibraryThing edition variants fetched', {
        isbn,
        variantCount: variants.length,
        totalRelated: relatedISBNs.length,
      });

      return variants;
    } catch (error) {
      logger.error('LibraryThing edition variants fetch failed', {
        isbn,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Parse thingISBN XML response to extract ISBNs
   *
   * XML format:
   * <idlist>
   *   <isbn>9780441172719</isbn>
   *   <isbn>0441172717</isbn>
   * </idlist>
   *
   * @param xml - XML response string
   * @returns Array of ISBNs
   */
  private parseThingISBNResponse(xml: string): string[] {
    const isbns: string[] = [];

    try {
      // Simple regex-based XML parsing (safe for this simple structure)
      // Match all <isbn>...</isbn> tags
      const isbnRegex = /<isbn>([^<]+)<\/isbn>/gi;
      let match: RegExpExecArray | null;

      while ((match = isbnRegex.exec(xml)) !== null) {
        const isbn = match[1].trim();
        if (isbn) {
          isbns.push(isbn);
        }
      }

      return isbns;
    } catch (error) {
      // If parsing fails, return empty array (graceful degradation)
      return [];
    }
  }
}
