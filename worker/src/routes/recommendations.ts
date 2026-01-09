import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
	SubjectsQuerySchema,
	SimilarBooksQuerySchema,
	SubjectsSuccessSchema,
	SimilarBooksSuccessSchema,
	RecommendationsErrorSchema,
	type BookSubjects,
	type SimilarBook,
} from '../schemas/recommendations.js';
import {
	createSuccessResponse,
	createErrorResponse,
	ErrorCode,
} from '../schemas/response.js';
import { detectISBN, normalizeISBN } from '../lib/query-detector.js';

// =================================================================================
// Helper Functions
// =================================================================================

/**
 * Detect if an ID is an ISBN or work_key
 */
function detectIdType(id: string): 'isbn' | 'work' {
	if (detectISBN(id)) {
		return 'isbn';
	}
	// Work keys follow format: /works/OL[0-9]+W
	if (id.match(/^\/works\/OL\d+W$/)) {
		return 'work';
	}
	// Default to work key for anything else
	return 'work';
}

/**
 * Normalize an ID based on its type
 */
function normalizeId(id: string, type: 'isbn' | 'work'): string {
	if (type === 'isbn') {
		return normalizeISBN(id);
	}
	return id; // Work keys don't need normalization
}

/**
 * Parse PostgreSQL array literal string to JavaScript array
 * Example: '{item1,item2,"item with spaces"}' -> ['item1', 'item2', 'item with spaces']
 */
function parsePostgresArray(pgArray: string | any[]): string[] {
	// Already an array
	if (Array.isArray(pgArray)) {
		return pgArray;
	}

	// Not a string or empty
	if (typeof pgArray !== 'string' || !pgArray || pgArray === '{}') {
		return [];
	}

	// Remove outer braces
	const inner = pgArray.slice(1, -1);
	if (!inner) return [];

	// Split while respecting quoted strings
	const elements: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < inner.length; i++) {
		const char = inner[i];

		if (char === '"' && (i === 0 || inner[i - 1] !== '\\')) {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			if (current) elements.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	if (current) elements.push(current);

	return elements;
}

/**
 * Build cache key for subjects endpoint
 */
function buildSubjectsCacheKey(ids: string[], limit: number): string {
	const sortedIds = ids.slice().sort();
	const idsHash = sortedIds.join(',').substring(0, 100); // Limit length
	return `recommendations:v1:subjects:${idsHash}:l${limit}`;
}

/**
 * Build cache key for similar books endpoint
 */
function buildSimilarCacheKey(
	subjects: string[],
	excludeCount: number,
	limit: number,
	minOverlap: number
): string {
	const sortedSubjects = subjects.slice().sort();
	return `recommendations:v1:similar:${sortedSubjects.join(',')}:ex${excludeCount}:l${limit}:min${minOverlap}`;
}

// =================================================================================
// Route: GET /api/recommendations/subjects
// =================================================================================

const subjectsRoute = createRoute({
	method: 'get',
	path: '/api/recommendations/subjects',
	tags: ['Recommendations'],
	summary: 'Get subjects for books',
	description:
		'Fetch subject tags for multiple books by ISBN or work_key. Supports batch queries (up to 100 IDs). Returns normalized subject arrays used for content-based recommendations.',
	request: {
		query: SubjectsQuerySchema,
	},
	responses: {
		200: {
			description: 'Subjects retrieved successfully',
			content: {
				'application/json': {
					schema: SubjectsSuccessSchema,
				},
			},
		},
		400: {
			description: 'Invalid request parameters',
			content: {
				'application/json': {
					schema: RecommendationsErrorSchema,
				},
			},
		},
		500: {
			description: 'Server error',
			content: {
				'application/json': {
					schema: RecommendationsErrorSchema,
				},
			},
		},
	},
});

// =================================================================================
// Route: GET /api/recommendations/similar
// =================================================================================

const similarBooksRoute = createRoute({
	method: 'get',
	path: '/api/recommendations/similar',
	tags: ['Recommendations'],
	summary: 'Find similar books by subjects',
	description:
		'Find books with matching subject tags. Optimized for recommendation engines using content-based filtering. Returns full book metadata sorted by subject overlap.',
	request: {
		query: SimilarBooksQuerySchema,
	},
	responses: {
		200: {
			description: 'Similar books found',
			content: {
				'application/json': {
					schema: SimilarBooksSuccessSchema,
				},
			},
		},
		400: {
			description: 'Invalid request parameters',
			content: {
				'application/json': {
					schema: RecommendationsErrorSchema,
				},
			},
		},
		500: {
			description: 'Server error',
			content: {
				'application/json': {
					schema: RecommendationsErrorSchema,
				},
			},
		},
	},
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

app.openapi(subjectsRoute, async (c) => {
	const startTime = Date.now();
	const { ids, limit = 1, nocache = false } = c.req.valid('query');
	const sql = c.get('sql');
	const cache = c.env.CACHE;
	const logger = c.get('logger');

	try {
		// Validate batch size
		if (ids.length > 100) {
			return createErrorResponse(
				c,
				ErrorCode.VALIDATION_ERROR,
				'Maximum 100 IDs per request',
				{ provided: ids.length, maximum: 100 }
			);
		}

		// Check cache
		const cacheKey = buildSubjectsCacheKey(ids, limit);
		if (!nocache && cache) {
			try {
				const cached: any = await cache.get(cacheKey, 'json');
				if (cached) {
					logger.info('Cache hit', { endpoint: 'subjects', key: cacheKey });
					return createSuccessResponse(c, cached);
				}
			} catch (err) {
				logger.warn('Cache read failed', { error: err, key: cacheKey });
			}
		}

		// Separate ISBNs and work_keys
		const isbnIds: { original: string; normalized: string }[] = [];
		const workIds: { original: string; normalized: string }[] = [];

		for (const id of ids) {
			const type = detectIdType(id);
			const normalized = normalizeId(id, type);

			if (type === 'isbn') {
				isbnIds.push({ original: id, normalized });
			} else {
				workIds.push({ original: id, normalized });
			}
		}

		logger.info('Processing subjects request', {
			total: ids.length,
			isbns: isbnIds.length,
			works: workIds.length,
		});

		// Query for ISBNs (via edition_isbns → enriched_editions → enriched_works)
		const isbnResults =
			isbnIds.length > 0
				? await sql`
					SELECT
						ei.isbn as id,
						'isbn' as type,
						e.work_key,
						COALESCE(w.title, e.title) as title,
						w.subject_tags as subjects,
						CASE
							WHEN w.subject_tags IS NOT NULL AND array_length(w.subject_tags, 1) > 0 THEN 'enriched_works'
							WHEN works.data->'subjects' IS NOT NULL THEN 'works_fallback'
							ELSE 'not_found'
						END as match_source
					FROM edition_isbns ei
					JOIN enriched_editions e ON ei.isbn = e.isbn
					LEFT JOIN enriched_works w ON e.work_key = w.work_key
					LEFT JOIN works ON e.work_key = works.key
					WHERE ei.isbn IN ${sql(isbnIds.map((id) => id.normalized))}
					LIMIT ${limit * isbnIds.length}
				`
				: [];

		// Query for work_keys (directly from enriched_works)
		const workResults =
			workIds.length > 0
				? await sql`
					SELECT
						w.work_key as id,
						'work' as type,
						w.work_key,
						w.title,
						COALESCE(w.subject_tags, ARRAY[]::text[]) as subjects,
						CASE
							WHEN w.subject_tags IS NOT NULL AND array_length(w.subject_tags, 1) > 0 THEN 'enriched_works'
							WHEN works.data->'subjects' IS NOT NULL THEN 'works_fallback'
							ELSE 'not_found'
						END as match_source
					FROM enriched_works w
					LEFT JOIN works ON w.work_key = works.key
					WHERE w.work_key IN ${sql(workIds.map((id) => id.normalized))}
					LIMIT ${limit * workIds.length}
				`
				: [];

		// Combine results
		const allResults = [...isbnResults, ...workResults];

		// Format results
		const resultsMap = new Map<string, BookSubjects>();
		for (const row of allResults) {
			const parsedSubjects = parsePostgresArray(row.subjects);

			const bookSubjects: BookSubjects = {
				id: row.id,
				type: row.type as 'isbn' | 'work',
				work_key: row.work_key || null,
				title: row.title || null,
				subjects: parsedSubjects,
				match_source: row.match_source as 'enriched_works' | 'works_fallback' | 'not_found',
			};

			// Skip books without subjects (per user decision)
			if (bookSubjects.subjects.length === 0) {
				continue;
			}

			resultsMap.set(row.id, bookSubjects);
		}

		// Find missing IDs
		const foundIds = new Set(resultsMap.keys());
		const missing = ids.filter((id) => {
			const normalized = normalizeId(id, detectIdType(id));
			return !foundIds.has(normalized);
		});

		const responseData = {
			results: Array.from(resultsMap.values()),
			total: resultsMap.size,
			missing,
			query: {
				ids_count: ids.length,
				limit,
			},
		};

		// Store in cache (24 hour TTL for subject data)
		if (cache && !nocache) {
			try {
				await cache.put(cacheKey, JSON.stringify(responseData), {
					expirationTtl: 86400, // 24 hours
				});
				logger.info('Cache set', { endpoint: 'subjects', key: cacheKey });
			} catch (err) {
				logger.warn('Cache write failed', { error: err, key: cacheKey });
			}
		}

		logger.info('Subjects request complete', {
			duration: Date.now() - startTime,
			found: resultsMap.size,
			missing: missing.length,
		});

		return createSuccessResponse(c, responseData);
	} catch (error) {
		logger.error('Subjects request failed', { error });

		if (error instanceof Error) {
			return createErrorResponse(
				c,
				ErrorCode.INTERNAL_ERROR,
				`Subjects fetch failed: ${error.message}`
			);
		}

		return createErrorResponse(c, ErrorCode.INTERNAL_ERROR, 'Subjects fetch failed');
	}
});

app.openapi(similarBooksRoute, async (c) => {
	const startTime = Date.now();
	const {
		subjects,
		exclude = [],
		limit = 100,
		min_overlap = 1,
		nocache = false,
	} = c.req.valid('query');
	const sql = c.get('sql');
	const cache = c.env.CACHE;
	const logger = c.get('logger');

	try {
		// Check cache
		const cacheKey = buildSimilarCacheKey(subjects, exclude.length, limit, min_overlap);
		if (!nocache && cache) {
			try {
				const cached: any = await cache.get(cacheKey, 'json');
				if (cached) {
					logger.info('Cache hit', { endpoint: 'similar', key: cacheKey });
					return createSuccessResponse(c, cached);
				}
			} catch (err) {
				logger.warn('Cache read failed', { error: err, key: cacheKey });
			}
		}

		logger.info('Processing similar books request', {
			subjects: subjects.length,
			exclude: exclude.length,
			limit,
			min_overlap,
		});

		// Query for similar books
		// Calculate match count once in HAVING to avoid connection issues
		const results = await sql`
			SELECT
				w.work_key,
				w.title,
				e.isbn,
				w.subject_tags as subjects,
				0 as subject_match_count,
				e.publication_date,
				e.publisher,
				e.page_count,
				e.cover_url_large as cover_url,
				e.cover_source,
				CONCAT('https://openlibrary.org/works/', w.work_key) as openlibrary_work,
				CONCAT('https://openlibrary.org/books/', e.openlibrary_edition_id) as openlibrary_edition,
				COALESCE(
					json_agg(
						DISTINCT jsonb_build_object(
							'name', a.name,
							'key', a.author_key,
							'openlibrary', CONCAT('https://openlibrary.org', a.author_key),
							'gender', a.gender,
							'nationality', a.nationality,
							'birth_year', a.birth_year,
							'death_year', a.death_year,
							'bio', a.bio,
							'wikidata_id', a.wikidata_id,
							'image', a.author_photo_url
						)
					) FILTER (WHERE a.author_key IS NOT NULL),
					'[]'::json
				) AS authors
			FROM enriched_works w
			JOIN enriched_editions e ON e.work_key = w.work_key
			LEFT JOIN author_works aw ON w.work_key = aw.work_key
			LEFT JOIN enriched_authors a ON aw.author_key = a.author_key
			WHERE EXISTS (
				SELECT 1 FROM unnest(w.subject_tags) s WHERE s IN ${sql(subjects)}
			)
				${exclude.length > 0 ? sql`AND w.work_key NOT IN ${sql(exclude)}` : sql``}
			GROUP BY w.work_key, w.title, w.subject_tags, e.isbn, e.publication_date, e.publisher, e.page_count, e.cover_url_large, e.cover_source, e.openlibrary_edition_id
			LIMIT ${limit * 2}
		`;

		// Format results and calculate match count in JavaScript
		const formattedResults: SimilarBook[] = results
			.map((row) => {
				// Parse PostgreSQL array format
				const bookSubjects = parsePostgresArray(row.subjects);

				// Calculate subject match count (case-insensitive)
				const matchCount = bookSubjects.filter((s: string) =>
					subjects.includes(s?.toLowerCase())
				).length;

				return {
					work_key: row.work_key,
					title: row.title || '',
					isbn: row.isbn || null,
					subjects: bookSubjects,
					subject_match_count: matchCount,
					authors: Array.isArray(row.authors) ? row.authors : [],
					publish_date: row.publication_date || null,
					publishers: row.publisher || null,
					pages: row.page_count || null,
					cover_url: row.cover_url || null,
					cover_source: row.cover_source || null,
					openlibrary_work: row.openlibrary_work,
					openlibrary_edition: row.openlibrary_edition || null,
				};
			})
			.filter((book) => book.subject_match_count >= min_overlap)
			.sort((a, b) => {
				// Sort by match count DESC, then publication date DESC
				if (b.subject_match_count !== a.subject_match_count) {
					return b.subject_match_count - a.subject_match_count;
				}
				const dateA = a.publish_date ? new Date(a.publish_date).getTime() : 0;
				const dateB = b.publish_date ? new Date(b.publish_date).getTime() : 0;
				return dateB - dateA;
			})
			.slice(0, limit);

		const responseData = {
			results: formattedResults,
			total: formattedResults.length,
			query: {
				subjects,
				excluded_count: exclude.length,
				min_overlap,
			},
		};

		// Store in cache (24 hour TTL for similar books)
		if (cache && !nocache) {
			try {
				await cache.put(cacheKey, JSON.stringify(responseData), {
					expirationTtl: 86400, // 24 hours
				});
				logger.info('Cache set', { endpoint: 'similar', key: cacheKey });
			} catch (err) {
				logger.warn('Cache write failed', { error: err, key: cacheKey });
			}
		}

		logger.info('Similar books request complete', {
			duration: Date.now() - startTime,
			found: formattedResults.length,
		});

		return createSuccessResponse(c, responseData);
	} catch (error) {
		logger.error('Similar books request failed', { error });

		if (error instanceof Error) {
			return createErrorResponse(
				c,
				ErrorCode.INTERNAL_ERROR,
				`Similar books fetch failed: ${error.message}`
			);
		}

		return createErrorResponse(c, ErrorCode.INTERNAL_ERROR, 'Similar books fetch failed');
	}
});

export default app;
