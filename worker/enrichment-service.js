// =================================================================================
// Enrichment Service - Database Operations
// =================================================================================

import { calculateEditionQuality, calculateWorkQuality, calculateCompleteness, formatPgArray } from './utils.js';

/**
 * Enrich an edition in the database
 * @param {import('postgres').Sql} sql - postgres connection
 * @param {import('./types').EnrichEditionRequest} edition - Edition data
 * @returns {Promise<{isbn: string, action: 'created'|'updated', quality_improvement: number, stored_at: string}>}
 */
export async function enrichEdition(sql, edition) {
  const qualityScore = calculateEditionQuality(edition);
  const completenessScore = calculateCompleteness(edition, [
    'title', 'subtitle', 'publisher', 'publication_date', 'page_count',
    'format', 'language', 'cover_urls', 'openlibrary_edition_id',
    'amazon_asins', 'google_books_volume_ids', 'goodreads_edition_ids'
  ]);

  try {
    // Fetch existing quality score before upsert (for quality improvement calculation)
    const existing = await sql`
      SELECT isbndb_quality FROM enriched_editions WHERE isbn = ${edition.isbn}
    `.then(rows => rows[0]);

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
        cover_source,
        openlibrary_edition_id,
        amazon_asins,
        google_books_volume_ids,
        goodreads_edition_ids,
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
        ${formatPgArray(edition.alternate_isbns)},
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
        ${edition.cover_source || null},
        ${edition.openlibrary_edition_id || null},
        ${formatPgArray(edition.amazon_asins)},
        ${formatPgArray(edition.google_books_volume_ids)},
        ${formatPgArray(edition.goodreads_edition_ids)},
        ${edition.primary_provider},
        ARRAY[${edition.primary_provider}]::text[],
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
        cover_source = COALESCE(EXCLUDED.cover_source, enriched_editions.cover_source),
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

    const row = result[0];
    const wasInsert = row.was_insert;
    const previousQuality = wasInsert ? 0 : (existing?.isbndb_quality || 0);
    const qualityImprovement = row.isbndb_quality - previousQuality;

    return {
      isbn: row.isbn,
      action: wasInsert ? 'created' : 'updated',
      quality_improvement: qualityImprovement,
      stored_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('enrichEdition database error:', error);
    throw new Error(`Database operation failed: ${error.message}`);
  }
}

/**
 * Enrich a work in the database
 * @param {import('postgres').Sql} sql - postgres connection
 * @param {import('./types').EnrichWorkRequest} work - Work data
 * @returns {Promise<{work_key: string, action: 'created'|'updated', quality_improvement: number, stored_at: string}>}
 */
export async function enrichWork(sql, work) {
  const qualityScore = calculateWorkQuality(work);
  const completenessScore = calculateCompleteness(work, [
    'title', 'subtitle', 'description', 'original_language', 'first_publication_year',
    'subject_tags', 'cover_urls', 'openlibrary_work_id', 'goodreads_work_ids',
    'amazon_asins', 'google_books_volume_ids'
  ]);

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
        ${work.description || null},
        ${work.original_language || null},
        ${work.first_publication_year || null},
        ${formatPgArray(work.subject_tags)},
        ${work.cover_urls?.large || null},
        ${work.cover_urls?.medium || null},
        ${work.cover_urls?.small || null},
        ${work.cover_source || null},
        ${work.openlibrary_work_id || null},
        ${formatPgArray(work.goodreads_work_ids)},
        ${formatPgArray(work.amazon_asins)},
        ${formatPgArray(work.google_books_volume_ids)},
        ${work.primary_provider},
        ARRAY[${work.primary_provider}]::text[],
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

    const row = result[0];

    return {
      work_key: row.work_key,
      action: row.was_insert ? 'created' : 'updated',
      quality_improvement: 0, // Could track this if we stored previous quality
      stored_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('enrichWork database error:', error);
    throw new Error(`Database operation failed: ${error.message}`);
  }
}

/**
 * Enrich an author in the database
 * @param {import('postgres').Sql} sql - postgres connection
 * @param {import('./types').EnrichAuthorRequest} author - Author data
 * @returns {Promise<{author_key: string, action: 'created'|'updated', stored_at: string}>}
 */
export async function enrichAuthor(sql, author) {
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

    const row = result[0];

    return {
      author_key: row.author_key,
      action: row.was_insert ? 'created' : 'updated',
      stored_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('enrichAuthor database error:', error);
    throw new Error(`Database operation failed: ${error.message}`);
  }
}

/**
 * Queue an enrichment job
 * @param {import('postgres').Sql} sql - postgres connection
 * @param {Object} queueRequest - Queue request data
 * @param {string} queueRequest.entity_type - Type: work, edition, or author
 * @param {string} queueRequest.entity_key - ISBN, work_key, or author_key
 * @param {string[]} queueRequest.providers_to_try - List of providers to try
 * @param {number} [queueRequest.priority] - Priority (1-10, default 5)
 * @returns {Promise<{queue_id: string, position_in_queue: number, estimated_processing_time: string}>}
 */
export async function queueEnrichment(sql, queueRequest) {
  try {
    const priority = queueRequest.priority || 5;

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
        ${queueRequest.providers_to_try},
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

    const position = parseInt(positionResult[0].position, 10) + 1;
    const estimatedTime = position <= 10 ? '1-5 minutes' : position <= 50 ? '5-15 minutes' : '15-30 minutes';

    return {
      queue_id: result[0].id,
      position_in_queue: position,
      estimated_processing_time: estimatedTime
    };
  } catch (error) {
    console.error('queueEnrichment database error:', error);
    throw new Error(`Failed to queue enrichment: ${error.message}`);
  }
}

/**
 * Get enrichment job status
 * @param {import('postgres').Sql} sql - postgres connection
 * @param {string} jobId - Queue job ID
 * @returns {Promise<Object>} Job status
 */
export async function getEnrichmentStatus(sql, jobId) {
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

    return result[0];
  } catch (error) {
    console.error('getEnrichmentStatus database error:', error);
    throw new Error(`Failed to get job status: ${error.message}`);
  }
}
