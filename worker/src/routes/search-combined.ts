import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
	CombinedSearchQuerySchema,
	CombinedSearchSuccessSchema,
	SearchErrorSchema,
	type BookResult,
} from '../schemas/search.js';
import {
	createSuccessResponse,
	createErrorResponse,
	ErrorCode,
} from '../schemas/response.js';
import { detectQueryType, type DetectionResult } from '../lib/query-detector.js';
import {
	buildCombinedCacheKey,
	getCacheTTL,
} from '../lib/cache-helpers.js';

// =================================================================================
// Search Execution Functions
// =================================================================================

/**
 * Search by ISBN using edition_isbns table (REQUIRED by CLAUDE.md)
 */
async function searchByISBN(
	sql: any,
	isbn: string,
	limit: number,
	offset: number
): Promise<{ data: any[]; total: number }> {
	const results: any[] = await sql`
		SELECT
			e.edition_id,
			e.isbn_13 AS isbn,
			e.title,
			e.publish_date,
			e.publishers,
			e.pages,
			e.binding,
			w.title AS work_title,
			e.openlibrary_edition_url,
			w.openlibrary_work_url,
			e.cover_url,
			e.cover_source,
			COALESCE(
				json_agg(
					DISTINCT jsonb_build_object(
						'name', a.name,
						'key', a.author_key,
						'openlibrary', a.openlibrary_author_url,
						'gender', a.gender,
						'nationality', a.nationality,
						'birth_year', a.birth_year,
						'death_year', a.death_year,
						'bio', a.bio,
						'wikidata_id', a.wikidata_id,
						'image', a.image_url
					)
				) FILTER (WHERE a.author_id IS NOT NULL),
				'[]'::json
			) AS authors
		FROM edition_isbns ei
		JOIN enriched_editions e ON ei.edition_id = e.edition_id
		LEFT JOIN enriched_works w ON e.work_id = w.work_id
		LEFT JOIN author_works aw ON w.work_id = aw.work_id
		LEFT JOIN enriched_authors a ON aw.author_id = a.author_id
		WHERE ei.isbn = ${isbn}
		GROUP BY e.edition_id, w.work_id
		LIMIT ${limit} OFFSET ${offset}
	`;

	return {
		data: results,
		total: results.length > 0 ? 1 : 0, // ISBN is unique
	};
}

/**
 * Search by author name using enriched_authors table
 */
async function searchByAuthor(
	sql: any,
	name: string,
	limit: number,
	offset: number
): Promise<{ data: any[]; total: number }> {
	const [countResult, dataResult] = await Promise.all([
		sql`
			SELECT COUNT(DISTINCT e.edition_id)::int AS total
			FROM enriched_authors a
			JOIN author_works aw ON a.author_id = aw.author_id
			JOIN enriched_works w ON aw.work_id = w.work_id
			JOIN enriched_editions e ON e.work_id = w.work_id
			WHERE a.normalized_name = ${name}
		`,
		sql`
			SELECT
				e.edition_id,
				e.isbn_13 AS isbn,
				e.title,
				e.publish_date,
				e.publishers,
				e.pages,
				e.binding,
				w.title AS work_title,
				e.openlibrary_edition_url,
				w.openlibrary_work_url,
				e.cover_url,
				e.cover_source,
				COALESCE(
					json_agg(
						DISTINCT jsonb_build_object(
							'name', a2.name,
							'key', a2.author_key,
							'openlibrary', a2.openlibrary_author_url,
							'gender', a2.gender,
							'nationality', a2.nationality,
							'birth_year', a2.birth_year,
							'death_year', a2.death_year,
							'bio', a2.bio,
							'wikidata_id', a2.wikidata_id,
							'image', a2.image_url
						)
					) FILTER (WHERE a2.author_id IS NOT NULL),
					'[]'::json
				) AS authors
			FROM enriched_authors a
			JOIN author_works aw ON a.author_id = aw.author_id
			JOIN enriched_works w ON aw.work_id = w.work_id
			JOIN enriched_editions e ON e.work_id = w.work_id
			LEFT JOIN author_works aw2 ON w.work_id = aw2.work_id
			LEFT JOIN enriched_authors a2 ON aw2.author_id = a2.author_id
			WHERE a.normalized_name = ${name}
			GROUP BY e.edition_id, w.work_id
			ORDER BY e.publish_date DESC NULLS LAST
			LIMIT ${limit} OFFSET ${offset}
		`,
	]);

	return {
		data: dataResult,
		total: parseInt(countResult[0]?.total || '0'),
	};
}

/**
 * Search by title using GIN trigram indexes (fuzzy search)
 */
async function searchByTitle(
	sql: any,
	title: string,
	limit: number,
	offset: number
): Promise<{ data: any[]; total: number }> {
	const [countResult, dataResult] = await Promise.all([
		sql`
			SELECT COUNT(DISTINCT e.edition_id)::int AS total
			FROM enriched_works w
			JOIN enriched_editions e ON e.work_id = w.work_id
			WHERE w.title % ${title}
		`,
		sql`
			SELECT
				e.edition_id,
				e.isbn_13 AS isbn,
				e.title,
				e.publish_date,
				e.publishers,
				e.pages,
				e.binding,
				w.title AS work_title,
				e.openlibrary_edition_url,
				w.openlibrary_work_url,
				e.cover_url,
				e.cover_source,
				similarity(w.title, ${title}) AS score,
				COALESCE(
					json_agg(
						DISTINCT jsonb_build_object(
							'name', a.name,
							'key', a.author_key,
							'openlibrary', a.openlibrary_author_url,
							'gender', a.gender,
							'nationality', a.nationality,
							'birth_year', a.birth_year,
							'death_year', a.death_year,
							'bio', a.bio,
							'wikidata_id', a.wikidata_id,
							'image', a.image_url
						)
					) FILTER (WHERE a.author_id IS NOT NULL),
					'[]'::json
				) AS authors
			FROM enriched_works w
			JOIN enriched_editions e ON e.work_id = w.work_id
			LEFT JOIN author_works aw ON w.work_id = aw.work_id
			LEFT JOIN enriched_authors a ON aw.author_id = a.author_id
			WHERE w.title % ${title}
			GROUP BY e.edition_id, w.work_id, w.title
			ORDER BY score DESC, e.publish_date DESC NULLS LAST
			LIMIT ${limit} OFFSET ${offset}
		`,
	]);

	return {
		data: dataResult,
		total: parseInt(countResult[0]?.total || '0'),
	};
}

/**
 * Converts database row to API response format
 */
function formatSearchResult(row: any): BookResult {
	return {
		title: row.title || '',
		authors: Array.isArray(row.authors) ? row.authors : [],
		isbn: row.isbn || null,
		coverUrl: row.cover_url || null,
		coverSource: row.cover_source || null,
		publish_date: row.publish_date || null,
		publishers: row.publishers || null,
		pages: row.pages || null,
		work_title: row.work_title || null,
		openlibrary_edition: row.openlibrary_edition_url || null,
		openlibrary_work: row.openlibrary_work_url || null,
		binding: row.binding || null,
		related_isbns: null,
	};
}

// =================================================================================
// Route Definition
// =================================================================================

const combinedSearchRoute = createRoute({
	method: 'get',
	path: '/api/search/combined',
	tags: ['Search'],
	summary: 'Combined search with auto-detection',
	description:
		'Unified search endpoint that automatically detects query type (ISBN, author, or title) and routes to appropriate search logic. Supports caching with type-specific TTLs.',
	request: {
		query: CombinedSearchQuerySchema,
	},
	responses: {
		200: {
			description: 'Search results with query type detection info',
			content: {
				'application/json': {
					schema: CombinedSearchSuccessSchema,
				},
			},
		},
		400: {
			description: 'Invalid query parameters',
			content: {
				'application/json': {
					schema: SearchErrorSchema,
				},
			},
		},
		500: {
			description: 'Server error',
			content: {
				'application/json': {
					schema: SearchErrorSchema,
				},
			},
		},
	},
});

const app = new OpenAPIHono<AppBindings>();

app.openapi(combinedSearchRoute, async (c) => {
	const startTime = Date.now();
	const { q, limit = 10, offset = 0, nocache = false } = c.req.valid('query');
	const sql = c.get('sql');
	const cache = c.env.CACHE;
	const logger = c.get('logger');

	try {
		// Stage 1: Detect query type
		const detection: DetectionResult = await detectQueryType(q, sql);
		const { type, normalized, confidence } = detection;

		logger.info('Query type detected', {
			query: q,
			type,
			normalized,
			confidence,
		});

		// Stage 2: Check cache (unless nocache=true)
		const cacheKey = buildCombinedCacheKey(type, normalized, limit, offset);

		if (!nocache && cache) {
			try {
				const cached: any = await cache.get(cacheKey, 'json');
				if (cached) {
					logger.info('Cache hit', { type, query: q, key: cacheKey });

					// Update response time but keep original cache_hit metadata
					return createSuccessResponse(c, {
						...cached,
						metadata: {
							...cached.metadata,
							cache_hit: true,
							response_time_ms: Date.now() - startTime,
						},
					});
				}
			} catch (err) {
				logger.warn('Cache read failed', { error: err, key: cacheKey });
			}
		}

		// Stage 3: Execute search based on detected type
		let results;
		switch (type) {
			case 'isbn':
				results = await searchByISBN(sql, normalized, limit, offset);
				break;
			case 'author':
				results = await searchByAuthor(sql, normalized, limit, offset);
				break;
			case 'title':
				results = await searchByTitle(sql, normalized, limit, offset);
				break;
		}

		// Stage 4: Format response
		const formattedResults = results.data.map(formatSearchResult);
		const responseData = {
			query: {
				original: q,
				detected_type: type,
				normalized,
				confidence,
			},
			results: formattedResults,
			pagination: {
				limit,
				offset,
				total: results.total,
				hasMore: offset + limit < results.total,
				returnedCount: formattedResults.length,
			},
			metadata: {
				cache_hit: false,
				response_time_ms: Date.now() - startTime,
				source: 'database',
			},
		};

		// Stage 5: Store in cache
		if (cache && !nocache) {
			try {
				const ttl = getCacheTTL(type);
				await cache.put(cacheKey, JSON.stringify(responseData), {
					expirationTtl: ttl,
				});
				logger.info('Cache set', { type, query: q, key: cacheKey, ttl });
			} catch (err) {
				logger.warn('Cache write failed', { error: err, key: cacheKey });
			}
		}

		return createSuccessResponse(c, responseData);
	} catch (error) {
		logger.error('Combined search failed', { error, query: q });

		if (error instanceof Error) {
			return createErrorResponse(
				c,
				ErrorCode.INTERNAL_ERROR,
				`Search failed: ${error.message}`
			);
		}

		return createErrorResponse(
			c,
			ErrorCode.INTERNAL_ERROR,
			'Search failed'
		);
	}
});

export default app;
