/**
 * OpenLibrary ISBN Resolver
 *
 * Resolves ISBNs from title/author using OpenLibrary Search API.
 * Implements Search → Validate pattern for data quality.
 *
 * @module services/book-resolution/resolvers/open-library-resolver
 * @since 2.5.0
 */

import type { IBookResolver, ISBNResolutionResult } from '../interfaces.js';
import type { Env } from '../../../env.js';
import type { Logger } from '../../../../lib/logger.js';
import {
  searchOpenLibraryByTitleAuthor,
  fetchOpenLibraryByISBN,
} from '../../../../services/open-library.js';
import { validateMetadataMatch } from '../interfaces.js';

/**
 * OpenLibrary Resolver
 *
 * Priority: 3rd in fallback chain (after ISBNdb, Google Books)
 * - Free, no authentication required
 * - Good coverage (~20M+ books estimated)
 * - Rate limited: 100 req per 5 minutes (1 req per 3 seconds)
 *
 * **Search → Validate Flow**:
 * 1. Search OpenLibrary by title/author
 * 2. Extract ISBNs from search results
 * 3. For each ISBN, fetch full metadata
 * 4. Validate title/author match using string similarity
 * 5. Return first validated ISBN
 */
export class OpenLibraryResolver implements IBookResolver {
  readonly name = 'OpenLibraryResolver';

  async resolve(
    title: string,
    author: string,
    env: Env,
    logger?: Logger
  ): Promise<ISBNResolutionResult> {
    try {
      // Step 1: Search by title/author
      const searchResult = await searchOpenLibraryByTitleAuthor(title, author, env, logger);

      if (!searchResult || !searchResult.isbns || searchResult.isbns.length === 0) {
        if (logger) {
          logger.debug('OpenLibrary search returned no ISBNs', { title, author });
        }
        return {
          isbn: null,
          confidence: 0,
          source: 'open-library',
        };
      }

      // Step 2-4: Validate each ISBN
      for (const isbn of searchResult.isbns) {
        try {
          // Fetch full metadata for this ISBN
          const metadata = await fetchOpenLibraryByISBN(isbn, env, logger);

          if (!metadata || !metadata.title || !metadata.authorNames?.[0]) {
            continue; // Skip ISBNs without sufficient metadata
          }

          // Validate match
          const isValidMatch = validateMetadataMatch(
            metadata.title,
            metadata.authorNames[0],
            title,
            author
          );

          if (isValidMatch) {
            if (logger) {
              logger.info('OpenLibrary validated ISBN match', {
                title,
                author,
                isbn,
                fetchedTitle: metadata.title,
                fetchedAuthor: metadata.authorNames[0],
                confidence: searchResult.confidence,
              });
            }

            return {
              isbn,
              confidence: searchResult.confidence,
              source: 'open-library',
              metadata: {
                title: metadata.title,
                author: metadata.authorNames[0],
                publishYear: metadata.firstPublishYear,
              },
            };
          } else {
            if (logger) {
              logger.debug('OpenLibrary ISBN failed validation', {
                title,
                author,
                isbn,
                fetchedTitle: metadata.title,
                fetchedAuthor: metadata.authorNames[0],
              });
            }
          }
        } catch (error) {
          // Log validation error but continue to next ISBN
          if (logger) {
            logger.warn('OpenLibrary ISBN validation error', {
              isbn,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // No validated ISBN found
      if (logger) {
        logger.info('OpenLibrary found ISBNs but none validated', {
          title,
          author,
          isbnCount: searchResult.isbns.length,
        });
      }

      return {
        isbn: null,
        confidence: 0,
        source: 'open-library',
      };
    } catch (error) {
      if (logger) {
        logger.error('OpenLibrary resolver error', {
          title,
          author,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        isbn: null,
        confidence: 0,
        source: 'open-library',
      };
    }
  }
}
