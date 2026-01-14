// =================================================================================
// Enrichment Service - Database Operations
// =================================================================================

import type { Sql, TransactionSql } from 'postgres';
import type { Env } from '../env.js';
import { Logger } from '../../lib/logger.js';
import type {
  EnrichEditionRequest,
  EnrichWorkRequest,
  EnrichAuthorRequest,
  EnrichmentData,
  QueueEnrichmentRequest,
  QueueEnrichmentResponse,
  EnrichmentJobStatus,
  EnrichmentLogEntry,
  CoverQueueMessage,
} from './types.js';
import {
  calculateEditionQuality,
  calculateWorkQuality,
  calculateCompleteness,
  formatPgArray,
  flattenFieldKeys,
  normalizePriority,
} from './utils.js';
import type { WikidataBookMetadata } from '../../types/open-apis.js';
import type { ArchiveOrgMetadata } from '../../services/archive-org.js';

/**
 * Enrich an edition in the database
 *
 * @param archiveOrgData - Optional Archive.org metadata for supplemental enrichment
 */
export async function enrichEdition(
  sql: Sql | TransactionSql,
  edition: EnrichEditionRequest,
  logger: Logger,
  env?: Env,
  archiveOrgData?: ArchiveOrgMetadata | null,
  coverMessageCollector?: CoverQueueMessage[]
): Promise<EnrichmentData & { isbn: string; quality_improvement: number }> {
  const startTime = Date.now();
  const qualityScore = calculateEditionQuality(edition);
  const completenessScore = calculateCompleteness(edition as unknown as Record<string, unknown>, [
    'title',
    'subtitle',
    'publisher',
    'publication_date',
    'page_count',
    'format',
    'language',
    'cover_urls',
    'openlibrary_edition_id',
    'amazon_asins',
    'google_books_volume_ids',
    'goodreads_edition_ids',
  ]);

  // =========================================================================
  // Archive.org Merge Logic (Edition-Level)
  // =========================================================================
  // Merge alternate ISBNs from Archive.org (if provided)
  let mergedAlternateIsbns = edition.alternate_isbns || [];
  if (archiveOrgData?.isbn) {
    const archiveIsbns = archiveOrgData.isbn.filter(
      (isbn) => isbn !== edition.isbn // Exclude primary ISBN
    );
    mergedAlternateIsbns = [...new Set([...mergedAlternateIsbns, ...archiveIsbns])];
  }

  // Merge OpenLibrary edition ID (Archive.org primary)
  const mergedOpenLibraryEditionId =
    archiveOrgData?.openlibrary_edition || edition.openlibrary_edition_id;

  // Update contributors array
  const contributors = [edition.primary_provider];
  if (archiveOrgData) {
    contributors.push('archive-org');
  }

  try {
    // Fetch existing quality score before upsert (for quality improvement calculation)
    const existing = await sql`
      SELECT isbndb_quality FROM enriched_editions WHERE isbn = ${edition.isbn}
    `.then((rows) => rows[0] as { isbndb_quality?: number } | undefined);

    // Upsert into enriched_editions
    const result = await sql`
      INSERT INTO enriched_editions (
        isbn,
        alternate_isbns,
        work_key,
        title,
        subtitle,
        publisher,
        publication_date,
        page_count,
        format,
        language,
        cover_url_large,
        cover_url_medium,
        cover_url_small,
        cover_url_original,
        cover_source,
        openlibrary_edition_id,
        amazon_asins,
        google_books_volume_ids,
        goodreads_edition_ids,
        subjects,
        dewey_decimal,
        binding,
        related_isbns,
        primary_provider,
        contributors,
        isbndb_quality,
        completeness_score,
        work_match_confidence,
        work_match_source,
        work_match_at,
        created_at,
        updated_at,
        last_isbndb_sync
      ) VALUES (
        ${edition.isbn},
        ${formatPgArray(mergedAlternateIsbns)},
        ${edition.work_key || null},
        ${edition.title || null},
        ${edition.subtitle || null},
        ${edition.publisher || null},
        ${edition.publication_date || null},
        ${edition.page_count || null},
        ${edition.format || null},
        ${edition.language || null},
        ${edition.cover_urls?.large || null},
        ${edition.cover_urls?.medium || null},
        ${edition.cover_urls?.small || null},
        ${edition.cover_urls?.original || null},
        ${edition.cover_source || null},
        ${mergedOpenLibraryEditionId || null},
        ${formatPgArray(edition.amazon_asins)},
        ${formatPgArray(edition.google_books_volume_ids)},
        ${formatPgArray(edition.goodreads_edition_ids)},
        ${formatPgArray(edition.subjects)},
        ${formatPgArray(edition.dewey_decimal)},
        ${edition.binding || null},
        ${edition.related_isbns ? JSON.stringify(edition.related_isbns) : null},
        ${edition.primary_provider},
        ${formatPgArray(contributors)},
        ${qualityScore},
        ${completenessScore},
        ${edition.work_match_confidence || null},
        ${edition.work_match_source || null},
        ${edition.work_match_confidence ? new Date() : null},
        NOW(),
        NOW(),
        ${edition.primary_provider === 'isbndb' ? new Date() : null}
      )
      ON CONFLICT (isbn) DO UPDATE SET
        -- Only update if new data is higher quality
        title = CASE
          WHEN EXCLUDED.isbndb_quality > enriched_editions.isbndb_quality
          THEN EXCLUDED.title
          ELSE enriched_editions.title
        END,
        subtitle = CASE
          WHEN EXCLUDED.isbndb_quality > enriched_editions.isbndb_quality
          THEN EXCLUDED.subtitle
          ELSE enriched_editions.subtitle
        END,
        publisher = CASE
          WHEN EXCLUDED.isbndb_quality > enriched_editions.isbndb_quality
          THEN EXCLUDED.publisher
          ELSE enriched_editions.publisher
        END,
        publication_date = CASE
          WHEN EXCLUDED.isbndb_quality > enriched_editions.isbndb_quality
          THEN EXCLUDED.publication_date
          ELSE enriched_editions.publication_date
        END,
        page_count = COALESCE(EXCLUDED.page_count, enriched_editions.page_count),
        format = COALESCE(EXCLUDED.format, enriched_editions.format),
        language = COALESCE(EXCLUDED.language, enriched_editions.language),
        cover_url_large = COALESCE(EXCLUDED.cover_url_large, enriched_editions.cover_url_large),
        cover_url_medium = COALESCE(EXCLUDED.cover_url_medium, enriched_editions.cover_url_medium),
        cover_url_small = COALESCE(EXCLUDED.cover_url_small, enriched_editions.cover_url_small),
        cover_url_original = COALESCE(EXCLUDED.cover_url_original, enriched_editions.cover_url_original),
        cover_source = COALESCE(EXCLUDED.cover_source, enriched_editions.cover_source),
        subjects = COALESCE(EXCLUDED.subjects, enriched_editions.subjects),
        dewey_decimal = COALESCE(EXCLUDED.dewey_decimal, enriched_editions.dewey_decimal),
        binding = COALESCE(EXCLUDED.binding, enriched_editions.binding),
        related_isbns = COALESCE(EXCLUDED.related_isbns, enriched_editions.related_isbns),
        openlibrary_edition_id = COALESCE(EXCLUDED.openlibrary_edition_id, enriched_editions.openlibrary_edition_id),
        amazon_asins = COALESCE(EXCLUDED.amazon_asins, enriched_editions.amazon_asins),
        google_books_volume_ids = COALESCE(EXCLUDED.google_books_volume_ids, enriched_editions.google_books_volume_ids),
        goodreads_edition_ids = COALESCE(EXCLUDED.goodreads_edition_ids, enriched_editions.goodreads_edition_ids),
        alternate_isbns = COALESCE(EXCLUDED.alternate_isbns, enriched_editions.alternate_isbns),
        work_key = COALESCE(EXCLUDED.work_key, enriched_editions.work_key),
        contributors = CASE
          WHEN enriched_editions.contributors IS NULL
            THEN EXCLUDED.contributors
          WHEN EXCLUDED.contributors[1] = ANY(enriched_editions.contributors)
            THEN enriched_editions.contributors
          ELSE array_cat(enriched_editions.contributors, EXCLUDED.contributors)
        END,
        isbndb_quality = GREATEST(EXCLUDED.isbndb_quality, enriched_editions.isbndb_quality),
        completeness_score = GREATEST(EXCLUDED.completeness_score, enriched_editions.completeness_score),
        work_match_confidence = CASE
          WHEN EXCLUDED.work_match_confidence IS NOT NULL
            AND EXCLUDED.work_match_confidence > COALESCE(enriched_editions.work_match_confidence, 0)
          THEN EXCLUDED.work_match_confidence
          ELSE enriched_editions.work_match_confidence
        END,
        work_match_source = CASE
          WHEN EXCLUDED.work_match_confidence IS NOT NULL
            AND EXCLUDED.work_match_confidence > COALESCE(enriched_editions.work_match_confidence, 0)
          THEN EXCLUDED.work_match_source
          ELSE enriched_editions.work_match_source
        END,
        work_match_at = CASE
          WHEN EXCLUDED.work_match_confidence IS NOT NULL
            AND EXCLUDED.work_match_confidence > COALESCE(enriched_editions.work_match_confidence, 0)
          THEN NOW()
          ELSE enriched_editions.work_match_at
        END,
        updated_at = NOW(),
        last_isbndb_sync = CASE
          WHEN EXCLUDED.primary_provider = 'isbndb'
          THEN NOW()
          ELSE enriched_editions.last_isbndb_sync
        END
      RETURNING
        isbn,
        (xmax = 0) AS was_insert,
        isbndb_quality
    `;

    const row = result[0] as { isbn: string; was_insert: boolean; isbndb_quality: number };
    const wasInsert = row.was_insert;
    const previousQuality = wasInsert ? 0 : existing?.isbndb_quality || 0;
    const qualityImprovement = row.isbndb_quality - previousQuality;

    // Queue cover download if URLs exist
    if (env?.COVER_QUEUE && edition.cover_urls) {
      const coverUrl =
        edition.cover_urls.original ||
        edition.cover_urls.large ||
        edition.cover_urls.medium ||
        edition.cover_urls.small;

      if (coverUrl) {
        const message: CoverQueueMessage = {
          isbn: row.isbn,
          work_key: edition.work_key,
          provider_url: coverUrl,
          priority: 'normal',
          source: `enrichment-${edition.primary_provider}`,
          queued_at: new Date().toISOString(),
        };

        if (coverMessageCollector) {
          coverMessageCollector.push(message);
          logger.debug('Collected cover download for batch', {
            isbn: row.isbn,
            provider: edition.primary_provider,
          });
        } else {
          try {
            await env.COVER_QUEUE.send(message);
            logger.info('Queued cover download', {
              isbn: row.isbn,
              provider: edition.primary_provider,
            });
          } catch (queueError) {
            // Log but don't fail enrichment
            logger.error('Cover queue failed', {
              isbn: row.isbn,
              error: queueError instanceof Error ? queueError.message : String(queueError),
            });
          }
        }
      }
    }

    // Log the enrichment operation
    await logEnrichmentOperation(sql, {
      entity_type: 'edition',
      entity_key: edition.isbn,
      provider: edition.primary_provider,
      operation: wasInsert ? 'create' : 'update',
      success: true,
      fields_updated: flattenFieldKeys(edition as unknown as Record<string, unknown>, [
        'isbn',
        'primary_provider',
      ]),
      response_time_ms: Date.now() - startTime,
    }, logger);

    // Fire Webhook to Bend if improved and configured
    if (wasInsert && env?.BEND_WEBHOOK_URL && env?.ALEXANDRIA_WEBHOOK_SECRET) {
      const webhookPayload = {
        isbn: row.isbn,
        type: 'edition',
        quality_improvement: qualityImprovement
      };
      
      // Fire and forget (no await)
      fetch(env.BEND_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-alexandria-webhook-secret': env.ALEXANDRIA_WEBHOOK_SECRET
        },
        body: JSON.stringify(webhookPayload)
      }).catch(err => logger.error('Webhook failed', {
        isbn: row.isbn,
        error: err instanceof Error ? err.message : String(err),
      }));

      logger.info('Fired webhook', { isbn: row.isbn });
    }

    return {
      isbn: row.isbn,
      action: wasInsert ? 'created' : 'updated',
      quality_improvement: qualityImprovement,
      stored_at: new Date().toISOString(),
      cover_urls: edition.cover_urls,
    };
  } catch (error) {
    logger.error('enrichEdition database error', {
      error: error instanceof Error ? error.message : String(error),
      isbn: edition.isbn,
    });

    // Log failed operation
    await logEnrichmentOperation(sql, {
      entity_type: 'edition',
      entity_key: edition.isbn,
      provider: edition.primary_provider,
      operation: 'upsert',
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
      response_time_ms: Date.now() - startTime,
    }, logger).catch(() => {}); // Don't throw if logging fails

    throw new Error(
      `Database operation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Enrich a work in the database
 *
 * @param wikidataData - Optional Wikidata metadata for genre enrichment
 * @param archiveOrgData - Optional Archive.org metadata for supplemental enrichment
 */
export async function enrichWork(
  sql: Sql | TransactionSql,
  work: EnrichWorkRequest,
  logger: Logger,
  wikidataData?: WikidataBookMetadata | null,
  archiveOrgData?: ArchiveOrgMetadata | null
): Promise<EnrichmentData & { work_key: string }> {
  const startTime = Date.now();
  const qualityScore = calculateWorkQuality(work);
  const completenessScore = calculateCompleteness(work as unknown as Record<string, unknown>, [
    'title',
    'subtitle',
    'description',
    'original_language',
    'first_publication_year',
    'subject_tags',
    'cover_urls',
    'openlibrary_work_id',
    'goodreads_work_ids',
    'amazon_asins',
    'google_books_volume_ids',
  ]);

  // =========================================================================
  // 3-Way Merge Logic (ISBNdb + Wikidata + Archive.org)
  // =========================================================================

  // Description: Archive.org primary (richer), fallback to ISBNdb
  let mergedDescription = work.description;
  if (archiveOrgData?.description && archiveOrgData.description.length > 0) {
    mergedDescription = archiveOrgData.description.join('\n\n');
  }

  // Subject Tags: Merge all sources with normalization (lowercase + trim)
  let mergedSubjectTags = work.subject_tags || [];
  if (wikidataData?.genre_names) {
    mergedSubjectTags = [...mergedSubjectTags, ...wikidataData.genre_names];
  }
  if (archiveOrgData?.subject) {
    mergedSubjectTags = [...mergedSubjectTags, ...archiveOrgData.subject];
  }
  // Normalize: lowercase, trim, deduplicate
  mergedSubjectTags = [
    ...new Set(mergedSubjectTags.map((tag) => tag.toLowerCase().trim())),
  ];

  // OpenLibrary Work ID: Archive.org primary
  const mergedOpenLibraryWorkId =
    archiveOrgData?.openlibrary_work || work.openlibrary_work_id;

  // Contributors: Track all providers
  const contributors = [work.primary_provider];
  if (wikidataData) {
    contributors.push('wikidata');
  }
  if (archiveOrgData) {
    contributors.push('archive-org');
  }

  try {
    const result = await sql`
      INSERT INTO enriched_works (
        work_key,
        title,
        subtitle,
        description,
        original_language,
        first_publication_year,
        subject_tags,
        cover_url_large,
        cover_url_medium,
        cover_url_small,
        cover_source,
        openlibrary_work_id,
        goodreads_work_ids,
        amazon_asins,
        google_books_volume_ids,
        primary_provider,
        contributors,
        isbndb_quality,
        completeness_score,
        created_at,
        updated_at
      ) VALUES (
        ${work.work_key},
        ${work.title},
        ${work.subtitle || null},
        ${mergedDescription || null},
        ${work.original_language || null},
        ${work.first_publication_year || null},
        ${formatPgArray(mergedSubjectTags)},
        ${work.cover_urls?.large || null},
        ${work.cover_urls?.medium || null},
        ${work.cover_urls?.small || null},
        ${work.cover_source || null},
        ${mergedOpenLibraryWorkId || null},
        ${formatPgArray(work.goodreads_work_ids)},
        ${formatPgArray(work.amazon_asins)},
        ${formatPgArray(work.google_books_volume_ids)},
        ${work.primary_provider},
        ${formatPgArray(contributors)},
        ${qualityScore},
        ${completenessScore},
        NOW(),
        NOW()
      )
      ON CONFLICT (work_key) DO UPDATE SET
        -- Merge logic: keep highest quality fields
        description = COALESCE(NULLIF(EXCLUDED.description, ''), enriched_works.description),
        subtitle = COALESCE(NULLIF(EXCLUDED.subtitle, ''), enriched_works.subtitle),
        original_language = COALESCE(EXCLUDED.original_language, enriched_works.original_language),
        first_publication_year = COALESCE(EXCLUDED.first_publication_year, enriched_works.first_publication_year),
        cover_url_large = COALESCE(EXCLUDED.cover_url_large, enriched_works.cover_url_large),
        cover_url_medium = COALESCE(EXCLUDED.cover_url_medium, enriched_works.cover_url_medium),
        cover_url_small = COALESCE(EXCLUDED.cover_url_small, enriched_works.cover_url_small),
        cover_source = COALESCE(EXCLUDED.cover_source, enriched_works.cover_source),
        subject_tags = CASE
          WHEN EXCLUDED.subject_tags IS NOT NULL
          THEN (
            SELECT array_agg(DISTINCT tag)
            FROM unnest(array_cat(enriched_works.subject_tags, EXCLUDED.subject_tags)) AS tag
          )
          ELSE enriched_works.subject_tags
        END,
        goodreads_work_ids = COALESCE(EXCLUDED.goodreads_work_ids, enriched_works.goodreads_work_ids),
        amazon_asins = COALESCE(EXCLUDED.amazon_asins, enriched_works.amazon_asins),
        google_books_volume_ids = COALESCE(EXCLUDED.google_books_volume_ids, enriched_works.google_books_volume_ids),
        contributors = CASE
          WHEN enriched_works.contributors IS NULL
            THEN EXCLUDED.contributors
          WHEN EXCLUDED.contributors[1] = ANY(enriched_works.contributors)
            THEN enriched_works.contributors
          ELSE array_cat(enriched_works.contributors, EXCLUDED.contributors)
        END,
        isbndb_quality = GREATEST(EXCLUDED.isbndb_quality, enriched_works.isbndb_quality),
        completeness_score = GREATEST(EXCLUDED.completeness_score, enriched_works.completeness_score),
        updated_at = NOW()
      RETURNING
        work_key,
        (xmax = 0) AS was_insert,
        isbndb_quality
    `;

    const row = result[0] as { work_key: string; was_insert: boolean; isbndb_quality: number };

    // Log the enrichment operation
    await logEnrichmentOperation(sql, {
      entity_type: 'work',
      entity_key: work.work_key,
      provider: work.primary_provider,
      operation: row.was_insert ? 'create' : 'update',
      success: true,
      fields_updated: flattenFieldKeys(work as unknown as Record<string, unknown>, [
        'work_key',
        'primary_provider',
      ]),
      response_time_ms: Date.now() - startTime,
    }, logger);

    return {
      work_key: row.work_key,
      action: row.was_insert ? 'created' : 'updated',
      quality_improvement: 0, // Could track this if we stored previous quality
      stored_at: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('enrichWork database error', {
      error: error instanceof Error ? error.message : String(error),
      work_key: work.work_key,
    });

    // Log failed operation
    await logEnrichmentOperation(sql, {
      entity_type: 'work',
      entity_key: work.work_key,
      provider: work.primary_provider,
      operation: 'upsert',
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
      response_time_ms: Date.now() - startTime,
    }, logger).catch(() => {});

    throw new Error(
      `Database operation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Enrich an author in the database
 */
export async function enrichAuthor(
  sql: Sql | TransactionSql,
  author: EnrichAuthorRequest,
  logger: Logger
): Promise<EnrichmentData & { author_key: string }> {
  const startTime = Date.now();
  try {
    const result = await sql`
      INSERT INTO enriched_authors (
        author_key,
        name,
        gender,
        nationality,
        birth_year,
        death_year,
        bio,
        bio_source,
        author_photo_url,
        openlibrary_author_id,
        goodreads_author_ids,
        wikidata_id,
        primary_provider,
        created_at,
        updated_at
      ) VALUES (
        ${author.author_key},
        ${author.name},
        ${author.gender || null},
        ${author.nationality || null},
        ${author.birth_year || null},
        ${author.death_year || null},
        ${author.bio || null},
        ${author.bio_source || null},
        ${author.author_photo_url || null},
        ${author.openlibrary_author_id || null},
        ${formatPgArray(author.goodreads_author_ids)},
        ${author.wikidata_id || null},
        ${author.primary_provider},
        NOW(),
        NOW()
      )
      ON CONFLICT (author_key) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, enriched_authors.name),
        gender = COALESCE(EXCLUDED.gender, enriched_authors.gender),
        nationality = COALESCE(EXCLUDED.nationality, enriched_authors.nationality),
        birth_year = COALESCE(EXCLUDED.birth_year, enriched_authors.birth_year),
        death_year = COALESCE(EXCLUDED.death_year, enriched_authors.death_year),
        bio = COALESCE(NULLIF(EXCLUDED.bio, ''), enriched_authors.bio),
        bio_source = COALESCE(EXCLUDED.bio_source, enriched_authors.bio_source),
        author_photo_url = COALESCE(EXCLUDED.author_photo_url, enriched_authors.author_photo_url),
        openlibrary_author_id = COALESCE(EXCLUDED.openlibrary_author_id, enriched_authors.openlibrary_author_id),
        goodreads_author_ids = COALESCE(EXCLUDED.goodreads_author_ids, enriched_authors.goodreads_author_ids),
        wikidata_id = COALESCE(EXCLUDED.wikidata_id, enriched_authors.wikidata_id),
        updated_at = NOW()
      RETURNING
        author_key,
        (xmax = 0) AS was_insert
    `;

    const row = result[0] as { author_key: string; was_insert: boolean };

    // Log the enrichment operation
    await logEnrichmentOperation(sql, {
      entity_type: 'author',
      entity_key: author.author_key,
      provider: author.primary_provider,
      operation: row.was_insert ? 'create' : 'update',
      success: true,
      fields_updated: flattenFieldKeys(author as unknown as Record<string, unknown>, [
        'author_key',
        'primary_provider',
      ]),
      response_time_ms: Date.now() - startTime,
    }, logger);

    return {
      author_key: row.author_key,
      action: row.was_insert ? 'created' : 'updated',
      stored_at: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('enrichAuthor database error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      author_key: author.author_key
    });

    // Log failed operation
    await logEnrichmentOperation(sql, {
      entity_type: 'author',
      entity_key: author.author_key,
      provider: author.primary_provider,
      operation: 'upsert',
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
      response_time_ms: Date.now() - startTime,
    }, logger).catch(() => {});

    throw new Error(
      `Database operation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Queue an enrichment job
 */
export async function queueEnrichment(
  sql: Sql,
  queueRequest: QueueEnrichmentRequest,
  logger: Logger
): Promise<QueueEnrichmentResponse> {
  try {
    const priority = normalizePriority(queueRequest.priority);

    const result = await sql`
      INSERT INTO enrichment_queue (
        id,
        entity_type,
        entity_key,
        providers_to_try,
        priority,
        status,
        created_at
      ) VALUES (
        gen_random_uuid(),
        ${queueRequest.entity_type},
        ${queueRequest.entity_key},
        ${formatPgArray(queueRequest.providers_to_try)},
        ${priority},
        'pending',
        NOW()
      )
      RETURNING id
    `;

    // Get position in queue (count of pending/processing jobs with higher/equal priority)
    const positionResult = await sql`
      SELECT COUNT(*) as position
      FROM enrichment_queue
      WHERE status IN ('pending', 'processing')
        AND (priority > ${priority} OR (priority = ${priority} AND created_at < NOW()))
    `;

    const position = parseInt(String(positionResult[0].position), 10) + 1;

    // Estimate processing time based on queue position
    // - Top 10: 1-5 minutes (fast processing)
    // - Top 50: 5-15 minutes (moderate wait)
    // - Beyond 50: 15-30 minutes (longer wait)
    const estimatedTime =
      position <= 10 ? '1-5 minutes' : position <= 50 ? '5-15 minutes' : '15-30 minutes';

    return {
      queue_id: (result[0] as { id: string }).id,
      position_in_queue: position,
      estimated_processing_time: estimatedTime,
    };
  } catch (error) {
    logger.error('queueEnrichment database error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      entity_type: queueRequest.entity_type,
      entity_key: queueRequest.entity_key
    });
    throw new Error(
      `Failed to queue enrichment: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get enrichment job status
 */
export async function getEnrichmentStatus(
  sql: Sql,
  jobId: string,
  logger: Logger
): Promise<EnrichmentJobStatus> {
  try {
    const result = await sql`
      SELECT
        id,
        entity_type,
        entity_key,
        status,
        providers_attempted,
        providers_succeeded,
        retry_count,
        created_at,
        completed_at,
        error_message
      FROM enrichment_queue
      WHERE id = ${jobId}
    `;

    if (result.length === 0) {
      throw new Error('Job not found');
    }

    return result[0] as EnrichmentJobStatus;
  } catch (error) {
    logger.error('getEnrichmentStatus database error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      jobId
    });
    throw new Error(
      `Failed to get job status: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Log an enrichment operation to the audit log
 */
async function logEnrichmentOperation(
  sql: Sql | TransactionSql,
  logEntry: EnrichmentLogEntry,
  logger: Logger
): Promise<void> {
  try {
    await sql`
      INSERT INTO enrichment_log (
        entity_type,
        entity_key,
        provider,
        operation,
        success,
        fields_updated,
        error_message,
        response_time_ms,
        created_at
      ) VALUES (
        ${logEntry.entity_type},
        ${logEntry.entity_key},
        ${logEntry.provider},
        ${logEntry.operation},
        ${logEntry.success},
        ${formatPgArray(logEntry.fields_updated)},
        ${logEntry.error_message || null},
        ${logEntry.response_time_ms || null},
        NOW()
      )
    `;
  } catch (error) {
    // Log but don't throw - logging shouldn't break enrichment
    logger.error('Failed to write enrichment_log', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      entity_type: logEntry.entity_type,
      entity_key: logEntry.entity_key
    });
  }
}
