# Book Recommendation System - Complete Planning Document

**Status**: Planning Complete, Ready for Implementation
**Master Tracker**: [Alexandria #160](https://github.com/jukasdrj/alexandria/issues/160)
**Related Issues**: [bendv3 #257](https://github.com/jukasdrj/bendv3/issues/257)
**Created**: 2026-01-09
**Phase**: Phase 1 - Content-Based Recommendations

---

## Executive Summary

Build a personalized book recommendation system that leverages Alexandria's 54M+ book metadata to suggest "next reads" based on user ratings and preferences.

**Architecture**: Hybrid approach
- bendv3: Owns user data (ratings, preferences, reading history)
- Alexandria: Provides stateless recommendation API
- Frontend: Displays ratings UI and recommendations

**Timeline**: 4 weeks to MVP launch

**Success Metrics**:
- Recommendation latency: <2s P95
- Relevance: >20% user acceptance rate
- Works with 3+ rated books minimum

---

## Architecture Overview

### Data Flow

```
┌────────────────────────────────────────────────────────────┐
│ 1. User rates books in bendv3                             │
│    └─> bendv3 DB (D1/Postgres)                           │
├────────────────────────────────────────────────────────────┤
│ 2. User requests recommendations                           │
│    └─> bendv3 API receives request                       │
├────────────────────────────────────────────────────────────┤
│ 3. bendv3 calls Alexandria recommendation API              │
│    POST /api/recommend/content-based                      │
│    {                                                       │
│      rated_books: [{isbn, score}],                       │
│      preferences: {genres, mood, ...}                     │
│    }                                                       │
├────────────────────────────────────────────────────────────┤
│ 4. Alexandria processes request                            │
│    - Lookup rated books in enriched_works                 │
│    - Build user preference vector (weighted by scores)    │
│    - Query candidate pool (trigram + genre matching)      │
│    - Score and rank candidates                            │
│    - Generate explanations                                 │
├────────────────────────────────────────────────────────────┤
│ 5. Alexandria returns recommendations                      │
│    {                                                       │
│      recommendations: [                                   │
│        {isbn, title, authors, match_score, reasons}      │
│      ]                                                     │
│    }                                                       │
├────────────────────────────────────────────────────────────┤
│ 6. bendv3 returns to frontend                              │
│    └─> Frontend displays recommendations                 │
└────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**bendv3**:
- User authentication and authorization
- Store ratings, preferences, reading history
- Proxy endpoint to Alexandria
- Handle service authentication (token-based)
- Cache recommendations (optional, for performance)
- Rate limiting on recommendation requests

**Alexandria**:
- Stateless recommendation computation
- No user data storage
- Content-based filtering algorithm
- Metadata access (enriched_works, enriched_editions)
- Performance-optimized queries
- Analytics instrumentation

**Frontend** (TBD - may be in bendv3):
- Star rating UI component
- Preferences form (genres, mood, constraints)
- Recommendations display with explanations
- Onboarding flow for new users

---

## Phase 1: Content-Based Recommendations

### API Contract

#### Endpoint: `POST /api/recommend/content-based`

**Request Schema**:
```typescript
{
  rated_books: Array<{
    isbn: string,           // ISBN-13
    score: number,          // 1-5 stars
    tags?: string[]         // Optional: ["dnf", "reread", "favorite"]
  }>,
  preferences?: {
    genres?: string[],                    // Preferred genres
    exclude_genres?: string[],            // Genres to avoid
    authors?: string[],                   // Preferred authors
    exclude_authors?: string[],           // Authors to avoid
    mood?: string,                        // "light", "dark", "epic", "cozy"
    page_count?: {
      min?: number,
      max?: number
    },
    publication_year?: {
      min?: number,
      max?: number
    }
  },
  limit?: number           // Default 10, max 50
}
```

**Response Schema**:
```typescript
{
  recommendations: Array<{
    isbn: string,
    title: string,
    authors: string[],
    cover_url?: string,              // From Alexandria covers endpoint
    match_score: number,             // 0.0 to 1.0
    reasons: string[],               // Human-readable explanations
    metadata: {
      genres: string[],
      subjects?: string[],
      page_count?: number,
      publication_year?: number,
      ratings_count?: number
    }
  }>,
  algorithm_info: {
    version: "content-based-v1",
    processed_ms: number,
    input_books_found: number,       // How many rated books were in DB
    candidate_pool_size: number      // How many books considered
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid ISBN format, invalid score range
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Database error, unexpected failure

**Rate Limits**:
- 60 requests per minute per user
- 1000 requests per hour per user

---

### Algorithm Design

#### Step 1: Build User Preference Vector

For each rated book:
1. Lookup in `enriched_works` and `enriched_editions`
2. Extract metadata:
   - Genres (array)
   - Subjects (array)
   - Author(s)
   - Publication decade
   - Page count bracket (short/medium/long)

3. Weight by user score:
   - 5 stars = 2.0x weight
   - 4 stars = 1.5x weight
   - 3 stars = 1.0x weight
   - 2 stars = 0.5x weight
   - 1 star = 0.0x weight (exclude from preferences)

4. Aggregate into preference histogram:
```typescript
{
  genres: { "Fantasy": 8, "Science Fiction": 5, "Mystery": 2 },
  subjects: { "Magic": 6, "Space exploration": 4 },
  authors: { "Brandon Sanderson": 3, "Isaac Asimov": 2 },
  decades: { "2010s": 4, "2000s": 3, "1990s": 2 },
  length: { "long": 6, "medium": 3, "short": 1 }
}
```

#### Step 2: Query Candidate Pool

```sql
WITH user_top_genres AS (
  -- Top 5 genres from user preferences
  SELECT UNNEST(ARRAY['Fantasy', 'Science Fiction', 'Mystery']) AS genre
),
user_rated_isbns AS (
  -- ISBNs user has already rated (exclude from results)
  SELECT UNNEST(ARRAY['9780765326355', '9780553293357']) AS isbn
),
candidates AS (
  SELECT DISTINCT ON (e.isbn)
    e.isbn,
    e.title,
    e.authors,
    w.genres,
    w.subjects,
    e.number_of_pages,
    e.publish_date,
    w.ratings_count
  FROM enriched_works w
  JOIN enriched_editions e ON e.work_key = w.key
  WHERE
    -- Must match at least one preferred genre
    w.genres && (SELECT array_agg(genre) FROM user_top_genres)
    -- Exclude already rated books
    AND e.isbn NOT IN (SELECT isbn FROM user_rated_isbns)
    -- Must have ISBN
    AND e.isbn IS NOT NULL
    -- Must have minimum metadata quality
    AND w.genres IS NOT NULL
    AND e.authors IS NOT NULL
  ORDER BY e.isbn, w.ratings_count DESC NULLS LAST
  LIMIT 500
)
SELECT * FROM candidates;
```

**Performance considerations**:
- Limit to 500 candidates (balance between diversity and speed)
- Use GIN indexes on `genres` array for fast overlap queries
- `DISTINCT ON` to avoid duplicate ISBNs (pick most popular edition)

#### Step 3: Score Each Candidate

```typescript
interface ScoringWeights {
  genre_match: 0.40,
  author_match: 0.30,
  subject_match: 0.20,
  popularity: 0.10
}

function scoreBook(
  candidate: Book,
  userPreferences: PreferenceVector
): number {
  let score = 0;

  // 1. Genre match (40% weight)
  const genreOverlap = intersection(
    candidate.genres,
    userPreferences.top_genres
  );
  const genreScore = genreOverlap.length / userPreferences.top_genres.length;
  score += genreScore * 0.40;

  // 2. Author match (30% weight)
  const hasPreferredAuthor = candidate.authors.some(author =>
    userPreferences.top_authors.includes(author)
  );
  if (hasPreferredAuthor) {
    score += 0.30;
  }

  // 3. Subject similarity (20% weight)
  const subjectOverlap = intersection(
    candidate.subjects || [],
    userPreferences.top_subjects
  );
  const subjectScore = subjectOverlap.length /
    Math.max(userPreferences.top_subjects.length, 1);
  score += subjectScore * 0.20;

  // 4. Popularity bonus (10% weight)
  // Books with 1000+ ratings get full bonus
  const popularityScore = Math.min(
    (candidate.ratings_count || 0) / 1000,
    1.0
  );
  score += popularityScore * 0.10;

  // 5. Apply diversity penalty
  // If we've already recommended 3+ books by this author, penalize
  const authorRecommendationCount =
    recommendedAuthors.filter(a => candidate.authors.includes(a)).length;
  if (authorRecommendationCount >= 3) {
    score *= 0.5; // 50% penalty
  }

  // 6. Apply user constraints
  if (userPreferences.exclude_genres?.some(g => candidate.genres.includes(g))) {
    return 0; // Hard exclude
  }
  if (userPreferences.page_count_min &&
      candidate.page_count < userPreferences.page_count_min) {
    return 0;
  }
  if (userPreferences.page_count_max &&
      candidate.page_count > userPreferences.page_count_max) {
    return 0;
  }

  return Math.min(score, 1.0); // Normalize to 0-1
}
```

#### Step 4: Rank & Generate Explanations

1. Sort candidates by score (descending)
2. Take top N (default 10)
3. Generate human-readable reasons:

```typescript
function generateReasons(
  candidate: Book,
  userPreferences: PreferenceVector,
  ratedBooks: RatedBook[]
): string[] {
  const reasons: string[] = [];

  // Genre match
  const matchedGenres = intersection(candidate.genres, userPreferences.top_genres);
  if (matchedGenres.length > 0) {
    reasons.push(`Matches your love of ${matchedGenres.join(', ')}`);
  }

  // Similar to highly rated book
  const similarBooks = ratedBooks.filter(rated =>
    rated.score >= 4 &&
    intersection(rated.genres, candidate.genres).length >= 2
  );
  if (similarBooks.length > 0) {
    const topBook = similarBooks[0];
    reasons.push(`Similar to ${topBook.title} (${topBook.score} stars)`);
  }

  // Preferred author
  const preferredAuthor = candidate.authors.find(a =>
    userPreferences.top_authors.includes(a)
  );
  if (preferredAuthor) {
    const authorBookCount = ratedBooks.filter(b =>
      b.authors.includes(preferredAuthor) && b.score >= 4
    ).length;
    reasons.push(
      `By ${preferredAuthor} (${authorBookCount} books rated highly)`
    );
  }

  // Popularity signal
  if (candidate.ratings_count && candidate.ratings_count > 5000) {
    reasons.push(`Popular with readers (${candidate.ratings_count.toLocaleString()} ratings)`);
  }

  // Mood match (if applicable)
  if (userPreferences.mood) {
    const moodGenres = {
      epic: ['Fantasy', 'Epic', 'High Fantasy'],
      light: ['Humor', 'Romance', 'Contemporary'],
      dark: ['Horror', 'Thriller', 'Dark Fantasy'],
      cozy: ['Cozy Mystery', 'Romance', 'Slice of Life']
    };
    const moodMatch = moodGenres[userPreferences.mood]?.some(g =>
      candidate.genres.includes(g)
    );
    if (moodMatch) {
      reasons.push(`Fits your ${userPreferences.mood} mood`);
    }
  }

  return reasons.slice(0, 3); // Max 3 reasons for clarity
}
```

---

## Implementation Roadmap

### Week 1: Foundation & Validation

**Day 1: Metadata Coverage Analysis**

Run validation queries to ensure we have sufficient data quality:

```sql
-- Query 1: Check genre/subject population for popular books
SELECT
  COUNT(*) as total_popular_books,
  COUNT(genres) as has_genres,
  COUNT(subjects) as has_subjects,
  AVG(array_length(genres, 1)) as avg_genre_count,
  AVG(array_length(subjects, 1)) as avg_subject_count,
  ROUND(100.0 * COUNT(genres) / COUNT(*), 2) as genre_coverage_pct
FROM enriched_works
WHERE ratings_count > 100;

-- Query 2: Sample actual data for manual inspection
SELECT
  title,
  genres,
  subjects,
  ratings_count
FROM enriched_works
WHERE ratings_count > 1000
ORDER BY ratings_count DESC
LIMIT 50;

-- Query 3: Genre distribution (check for quality)
SELECT
  unnest(genres) as genre,
  COUNT(*) as book_count
FROM enriched_works
WHERE genres IS NOT NULL
GROUP BY genre
ORDER BY book_count DESC
LIMIT 100;

-- Query 4: Check for extremely long genre lists (data quality issue)
SELECT
  title,
  array_length(genres, 1) as genre_count,
  genres
FROM enriched_works
WHERE array_length(genres, 1) > 10
ORDER BY genre_count DESC
LIMIT 20;
```

**Success criteria**:
- 70%+ of popular books (ratings_count > 100) have genres
- Average genre count: 3-5 per book (not too sparse or too noisy)
- Genres are meaningful (not too granular like "Books about cats in space")

**Action if coverage < 50%**: Pause and run enrichment backfill for popular books first

**Day 2-3: Algorithm Prototype**

Create `scripts/test-recommendation-algorithm.sql`:

```sql
-- Test case: User who loved Sanderson fantasy + Asimov sci-fi
-- Expected recommendations: More epic fantasy, classic sci-fi

WITH user_ratings AS (
  SELECT isbn, score FROM (VALUES
    ('9780765326355', 5),  -- The Way of Kings (Sanderson)
    ('9780765365279', 5),  -- Mistborn (Sanderson)
    ('9780553293357', 4),  -- Foundation (Asimov)
    ('9780553803709', 4)   -- I, Robot (Asimov)
  ) AS t(isbn, score)
),
user_preferences AS (
  -- Build preference vector from rated books
  SELECT
    array_agg(DISTINCT g ORDER BY g) as top_genres,
    array_agg(DISTINCT a ORDER BY a) as top_authors,
    array_agg(DISTINCT s ORDER BY s) as top_subjects
  FROM user_ratings ur
  JOIN enriched_editions e ON e.isbn = ur.isbn
  JOIN enriched_works w ON w.key = e.work_key
  CROSS JOIN LATERAL unnest(COALESCE(w.genres, ARRAY[]::text[])) g
  CROSS JOIN LATERAL unnest(COALESCE(e.authors, ARRAY[]::text[])) a
  CROSS JOIN LATERAL unnest(COALESCE(w.subjects, ARRAY[]::text[])) s
),
candidates AS (
  -- Find similar books
  SELECT DISTINCT ON (e.isbn)
    e.isbn,
    e.title,
    e.authors,
    w.genres,
    w.subjects,
    w.ratings_count,
    -- Calculate genre overlap score
    (
      SELECT COUNT(*)
      FROM unnest(w.genres) g
      WHERE g = ANY((SELECT top_genres FROM user_preferences))
    ) as genre_matches
  FROM enriched_works w
  JOIN enriched_editions e ON e.work_key = w.key
  CROSS JOIN user_preferences up
  WHERE
    -- Must match at least one genre
    w.genres && up.top_genres
    -- Exclude already rated
    AND e.isbn NOT IN (SELECT isbn FROM user_ratings)
    -- Quality filters
    AND e.isbn IS NOT NULL
    AND w.genres IS NOT NULL
    AND e.authors IS NOT NULL
  ORDER BY e.isbn, w.ratings_count DESC NULLS LAST
  LIMIT 100
)
SELECT
  isbn,
  title,
  authors,
  genres,
  genre_matches,
  ratings_count
FROM candidates
ORDER BY
  genre_matches DESC,
  ratings_count DESC NULLS LAST
LIMIT 15;
```

**Manual validation**:
- Run with personal reading history
- Do results feel relevant?
- Are there obvious mismatches?
- Are genres too broad or too narrow?

**Day 4: Zod Schemas**

Create `worker/src/schemas/recommendation.ts`:

```typescript
import { z } from 'zod';

export const RatedBookSchema = z.object({
  isbn: z.string().length(13, 'ISBN must be 13 digits'),
  score: z.number().int().min(1).max(5),
  tags: z.array(z.string()).optional()
}).openapi('RatedBook');

export const PreferencesSchema = z.object({
  genres: z.array(z.string()).optional(),
  exclude_genres: z.array(z.string()).optional(),
  authors: z.array(z.string()).optional(),
  exclude_authors: z.array(z.string()).optional(),
  mood: z.enum(['light', 'dark', 'epic', 'cozy']).optional(),
  page_count: z.object({
    min: z.number().int().positive().optional(),
    max: z.number().int().positive().optional()
  }).optional(),
  publication_year: z.object({
    min: z.number().int().min(1000).max(2100).optional(),
    max: z.number().int().min(1000).max(2100).optional()
  }).optional()
}).openapi('Preferences');

export const RecommendationRequestSchema = z.object({
  rated_books: z.array(RatedBookSchema).min(1).max(100),
  preferences: PreferencesSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10)
}).openapi('RecommendationRequest');

export const RecommendationSchema = z.object({
  isbn: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  cover_url: z.string().url().optional(),
  match_score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  metadata: z.object({
    genres: z.array(z.string()),
    subjects: z.array(z.string()).optional(),
    page_count: z.number().int().optional(),
    publication_year: z.number().int().optional(),
    ratings_count: z.number().int().optional()
  })
}).openapi('Recommendation');

export const RecommendationResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  algorithm_info: z.object({
    version: z.string(),
    processed_ms: z.number(),
    input_books_found: z.number(),
    candidate_pool_size: z.number()
  })
}).openapi('RecommendationResponse');
```

**Day 5: Route Skeleton**

Create `worker/src/routes/recommend.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppBindings } from '../env.js';
import {
  RecommendationRequestSchema,
  RecommendationResponseSchema
} from '../schemas/recommendation.js';

const recommendRoute = createRoute({
  method: 'post',
  path: '/api/recommend/content-based',
  tags: ['Recommendations'],
  summary: 'Get personalized book recommendations',
  description: 'Returns recommendations based on user ratings and preferences using content-based filtering',
  request: {
    body: {
      content: {
        'application/json': {
          schema: RecommendationRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Recommendations generated successfully',
      content: {
        'application/json': {
          schema: RecommendationResponseSchema
        }
      }
    },
    400: {
      description: 'Invalid request (bad ISBN, invalid score, etc.)'
    },
    429: {
      description: 'Rate limit exceeded'
    },
    500: {
      description: 'Internal server error'
    }
  }
});

const app = new OpenAPIHono<AppBindings>();

app.openapi(recommendRoute, async (c) => {
  const startTime = Date.now();
  const { rated_books, preferences, limit } = c.req.valid('json');
  const sql = c.get('sql');
  const logger = c.get('logger');

  try {
    // TODO: Implement recommendation logic (Week 2)
    logger.info('Recommendation request received', {
      rated_count: rated_books.length,
      has_preferences: !!preferences,
      limit
    });

    // Placeholder response
    return c.json({
      recommendations: [],
      algorithm_info: {
        version: 'content-based-v1',
        processed_ms: Date.now() - startTime,
        input_books_found: 0,
        candidate_pool_size: 0
      }
    });
  } catch (error) {
    logger.error('Recommendation error', { error });
    return c.json({ error: 'Failed to generate recommendations' }, 500);
  }
});

export default app;
```

Update `worker/src/index.ts` to mount the route:

```typescript
import recommend from './routes/recommend.js';

// ... existing code ...

app.route('/', recommend);
```

---

### Week 2: Core Algorithm Implementation

**Day 6-7: Preference Vector Builder**

Create `worker/src/services/recommendation.ts`:

```typescript
import type { postgres } from '@neondatabase/serverless';

interface RatedBook {
  isbn: string;
  score: number;
  tags?: string[];
}

interface PreferenceVector {
  top_genres: string[];
  top_subjects: string[];
  top_authors: string[];
  weighted_genres: Record<string, number>;
  weighted_subjects: Record<string, number>;
  weighted_authors: Record<string, number>;
  decades: Record<string, number>;
  length_preference: 'short' | 'medium' | 'long' | 'mixed';
}

export async function buildPreferenceVector(
  sql: ReturnType<typeof postgres>,
  ratedBooks: RatedBook[]
): Promise<PreferenceVector> {
  // Fetch metadata for all rated books
  const isbns = ratedBooks.map(b => b.isbn);

  const bookMetadata = await sql`
    SELECT
      e.isbn,
      e.title,
      e.authors,
      e.number_of_pages,
      e.publish_date,
      w.genres,
      w.subjects
    FROM enriched_editions e
    JOIN enriched_works w ON w.key = e.work_key
    WHERE e.isbn = ANY(${isbns})
  `;

  // Build weighted histograms
  const genreCounts: Record<string, number> = {};
  const subjectCounts: Record<string, number> = {};
  const authorCounts: Record<string, number> = {};
  const decadeCounts: Record<string, number> = {};
  let totalPageCount = 0;
  let bookCount = 0;

  for (const book of bookMetadata) {
    const rated = ratedBooks.find(r => r.isbn === book.isbn);
    if (!rated) continue;

    // Weight: 5 stars = 2x, 4 stars = 1.5x, 3 stars = 1x, 2 stars = 0.5x, 1 star = 0x
    const weight = rated.score === 5 ? 2.0 :
                   rated.score === 4 ? 1.5 :
                   rated.score === 3 ? 1.0 :
                   rated.score === 2 ? 0.5 : 0;

    if (weight === 0) continue; // Skip 1-star books

    // Aggregate genres
    if (book.genres) {
      for (const genre of book.genres) {
        genreCounts[genre] = (genreCounts[genre] || 0) + weight;
      }
    }

    // Aggregate subjects
    if (book.subjects) {
      for (const subject of book.subjects) {
        subjectCounts[subject] = (subjectCounts[subject] || 0) + weight;
      }
    }

    // Aggregate authors
    if (book.authors) {
      for (const author of book.authors) {
        authorCounts[author] = (authorCounts[author] || 0) + weight;
      }
    }

    // Aggregate decades
    if (book.publish_date) {
      const year = new Date(book.publish_date).getFullYear();
      const decade = `${Math.floor(year / 10) * 10}s`;
      decadeCounts[decade] = (decadeCounts[decade] || 0) + weight;
    }

    // Track page counts
    if (book.number_of_pages) {
      totalPageCount += book.number_of_pages * weight;
      bookCount += weight;
    }
  }

  // Extract top preferences
  const sortByCount = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);

  const avgPageCount = bookCount > 0 ? totalPageCount / bookCount : 0;
  const lengthPreference: 'short' | 'medium' | 'long' | 'mixed' =
    avgPageCount < 250 ? 'short' :
    avgPageCount < 400 ? 'medium' :
    avgPageCount >= 400 ? 'long' : 'mixed';

  return {
    top_genres: sortByCount(genreCounts).slice(0, 10),
    top_subjects: sortByCount(subjectCounts).slice(0, 20),
    top_authors: sortByCount(authorCounts).slice(0, 10),
    weighted_genres: genreCounts,
    weighted_subjects: subjectCounts,
    weighted_authors: authorCounts,
    decades: decadeCounts,
    length_preference: lengthPreference
  };
}
```

**Day 8-9: Candidate Query & Scoring**

Add to `worker/src/services/recommendation.ts`:

```typescript
interface Candidate {
  isbn: string;
  title: string;
  authors: string[];
  genres: string[];
  subjects: string[];
  page_count: number | null;
  publish_date: string | null;
  ratings_count: number | null;
}

export async function queryCandidates(
  sql: ReturnType<typeof postgres>,
  preferenceVector: PreferenceVector,
  excludeIsbns: string[],
  limit: number = 500
): Promise<Candidate[]> {
  const topGenres = preferenceVector.top_genres.slice(0, 5);

  const results = await sql<Candidate[]>`
    SELECT DISTINCT ON (e.isbn)
      e.isbn,
      e.title,
      e.authors,
      w.genres,
      w.subjects,
      e.number_of_pages as page_count,
      e.publish_date,
      w.ratings_count
    FROM enriched_works w
    JOIN enriched_editions e ON e.work_key = w.key
    WHERE
      w.genres && ${topGenres}
      AND e.isbn NOT IN ${sql(excludeIsbns)}
      AND e.isbn IS NOT NULL
      AND w.genres IS NOT NULL
      AND e.authors IS NOT NULL
    ORDER BY e.isbn, w.ratings_count DESC NULLS LAST
    LIMIT ${limit}
  `;

  return results;
}

interface ScoredCandidate extends Candidate {
  score: number;
  genre_overlap: number;
  subject_overlap: number;
  has_preferred_author: boolean;
  popularity_score: number;
}

export function scoreCandidate(
  candidate: Candidate,
  preferenceVector: PreferenceVector
): ScoredCandidate {
  let score = 0;

  // 1. Genre match (40% weight)
  const genreOverlap = candidate.genres.filter(g =>
    preferenceVector.top_genres.includes(g)
  ).length;
  const genreScore = genreOverlap / Math.max(preferenceVector.top_genres.length, 1);
  score += genreScore * 0.40;

  // 2. Author match (30% weight)
  const hasPreferredAuthor = candidate.authors.some(a =>
    preferenceVector.top_authors.includes(a)
  );
  if (hasPreferredAuthor) {
    score += 0.30;
  }

  // 3. Subject similarity (20% weight)
  const subjectOverlap = (candidate.subjects || []).filter(s =>
    preferenceVector.top_subjects.includes(s)
  ).length;
  const subjectScore = subjectOverlap / Math.max(preferenceVector.top_subjects.length, 1);
  score += subjectScore * 0.20;

  // 4. Popularity bonus (10% weight)
  const popularityScore = Math.min((candidate.ratings_count || 0) / 1000, 1.0);
  score += popularityScore * 0.10;

  return {
    ...candidate,
    score: Math.min(score, 1.0),
    genre_overlap: genreOverlap,
    subject_overlap: subjectOverlap,
    has_preferred_author: hasPreferredAuthor,
    popularity_score: popularityScore
  };
}

export function applyDiversityFilter(
  candidates: ScoredCandidate[],
  maxPerAuthor: number = 3
): ScoredCandidate[] {
  const authorCounts: Record<string, number> = {};
  const filtered: ScoredCandidate[] = [];

  // Sort by score first
  const sorted = [...candidates].sort((a, b) => b.score - a.score);

  for (const candidate of sorted) {
    let authorOverrepresented = false;

    for (const author of candidate.authors) {
      if ((authorCounts[author] || 0) >= maxPerAuthor) {
        authorOverrepresented = true;
        break;
      }
    }

    if (!authorOverrepresented) {
      filtered.push(candidate);
      for (const author of candidate.authors) {
        authorCounts[author] = (authorCounts[author] || 0) + 1;
      }
    }
  }

  return filtered;
}
```

**Day 10: Explanation Generator**

Add to `worker/src/services/recommendation.ts`:

```typescript
export function generateReasons(
  candidate: ScoredCandidate,
  preferenceVector: PreferenceVector,
  ratedBooks: RatedBook[],
  ratedBooksMetadata: Candidate[]
): string[] {
  const reasons: string[] = [];

  // 1. Genre match
  const matchedGenres = candidate.genres.filter(g =>
    preferenceVector.top_genres.includes(g)
  );
  if (matchedGenres.length > 0) {
    const genreList = matchedGenres.slice(0, 2).join(' and ');
    reasons.push(`Matches your love of ${genreList}`);
  }

  // 2. Similar to highly rated book
  const similarRatedBooks = ratedBooksMetadata.filter(rated => {
    const ratingInfo = ratedBooks.find(r => r.isbn === rated.isbn);
    if (!ratingInfo || ratingInfo.score < 4) return false;

    const sharedGenres = rated.genres.filter(g =>
      candidate.genres.includes(g)
    );
    return sharedGenres.length >= 2;
  });

  if (similarRatedBooks.length > 0) {
    const topSimilar = similarRatedBooks[0];
    const rating = ratedBooks.find(r => r.isbn === topSimilar.isbn);
    reasons.push(`Similar to ${topSimilar.title} (${rating?.score} stars)`);
  }

  // 3. Preferred author
  const preferredAuthor = candidate.authors.find(a =>
    preferenceVector.top_authors.includes(a)
  );
  if (preferredAuthor) {
    const authorBookCount = ratedBooksMetadata.filter(b =>
      b.authors.includes(preferredAuthor)
    ).length;
    if (authorBookCount > 1) {
      reasons.push(`By ${preferredAuthor} (${authorBookCount} books rated highly)`);
    } else {
      reasons.push(`By ${preferredAuthor}`);
    }
  }

  // 4. Popularity signal
  if (candidate.ratings_count && candidate.ratings_count > 5000) {
    reasons.push(
      `Popular with readers (${candidate.ratings_count.toLocaleString()} ratings)`
    );
  }

  // Return max 3 reasons for clarity
  return reasons.slice(0, 3);
}
```

**Wire it all together in route handler**:

Update `worker/src/routes/recommend.ts`:

```typescript
import {
  buildPreferenceVector,
  queryCandidates,
  scoreCandidate,
  applyDiversityFilter,
  generateReasons
} from '../services/recommendation.js';

app.openapi(recommendRoute, async (c) => {
  const startTime = Date.now();
  const { rated_books, preferences, limit } = c.req.valid('json');
  const sql = c.get('sql');
  const logger = c.get('logger');

  try {
    // Step 1: Build preference vector
    const preferenceVector = await buildPreferenceVector(sql, rated_books);
    logger.info('Preference vector built', {
      top_genres: preferenceVector.top_genres,
      top_authors: preferenceVector.top_authors
    });

    // Step 2: Query candidates
    const excludeIsbns = rated_books.map(b => b.isbn);
    const candidates = await queryCandidates(
      sql,
      preferenceVector,
      excludeIsbns,
      500
    );
    logger.info('Candidates queried', { count: candidates.length });

    // Step 3: Score candidates
    const scoredCandidates = candidates.map(c =>
      scoreCandidate(c, preferenceVector)
    );

    // Step 4: Apply diversity filter
    const diverseCandidates = applyDiversityFilter(scoredCandidates, 3);

    // Step 5: Take top N
    const topCandidates = diverseCandidates.slice(0, limit);

    // Step 6: Fetch rated books metadata for explanations
    const ratedIsbns = rated_books.map(b => b.isbn);
    const ratedMetadata = await sql`
      SELECT
        e.isbn,
        e.title,
        e.authors,
        w.genres,
        w.subjects
      FROM enriched_editions e
      JOIN enriched_works w ON w.key = e.work_key
      WHERE e.isbn = ANY(${ratedIsbns})
    `;

    // Step 7: Generate recommendations with explanations
    const recommendations = topCandidates.map(candidate => ({
      isbn: candidate.isbn,
      title: candidate.title,
      authors: candidate.authors,
      cover_url: `https://alexandria.ooheynerds.com/covers/${candidate.isbn}/medium.webp`,
      match_score: candidate.score,
      reasons: generateReasons(
        candidate,
        preferenceVector,
        rated_books,
        ratedMetadata
      ),
      metadata: {
        genres: candidate.genres,
        subjects: candidate.subjects,
        page_count: candidate.page_count,
        publication_year: candidate.publish_date
          ? new Date(candidate.publish_date).getFullYear()
          : null,
        ratings_count: candidate.ratings_count
      }
    }));

    const processingTime = Date.now() - startTime;

    // Track in Analytics Engine
    c.get('analytics')?.writeDataPoint({
      blobs: ['recommendation_request'],
      doubles: [processingTime, rated_books.length, candidates.length, limit],
      indexes: ['content-based-v1']
    });

    return c.json({
      recommendations,
      algorithm_info: {
        version: 'content-based-v1',
        processed_ms: processingTime,
        input_books_found: ratedMetadata.length,
        candidate_pool_size: candidates.length
      }
    });
  } catch (error) {
    logger.error('Recommendation error', { error });
    return c.json({ error: 'Failed to generate recommendations' }, 500);
  }
});
```

---

### Week 3: Testing & Optimization

**Day 11-12: Unit Tests**

Create `worker/test/services/recommendation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildPreferenceVector,
  scoreCandidate,
  applyDiversityFilter,
  generateReasons
} from '../../src/services/recommendation.js';

describe('Recommendation Service', () => {
  describe('scoreCandidate', () => {
    it('should score genre match correctly', () => {
      const candidate = {
        isbn: '9780000000000',
        title: 'Test Book',
        authors: ['Test Author'],
        genres: ['Fantasy', 'Epic'],
        subjects: ['Magic'],
        page_count: 500,
        publish_date: '2020-01-01',
        ratings_count: 1000
      };

      const preferenceVector = {
        top_genres: ['Fantasy', 'Science Fiction'],
        top_subjects: ['Magic', 'Space'],
        top_authors: ['Brandon Sanderson'],
        weighted_genres: { Fantasy: 10 },
        weighted_subjects: { Magic: 5 },
        weighted_authors: { 'Brandon Sanderson': 3 },
        decades: { '2020s': 5 },
        length_preference: 'long' as const
      };

      const scored = scoreCandidate(candidate, preferenceVector);

      // Genre match: 1/2 genres matched = 0.5 * 0.40 = 0.20
      // No author match: 0
      // Subject match: 1/2 = 0.5 * 0.20 = 0.10
      // Popularity: 1000/1000 = 1.0 * 0.10 = 0.10
      // Total: 0.40
      expect(scored.score).toBeCloseTo(0.40, 2);
    });

    it('should give bonus for preferred author', () => {
      const candidate = {
        isbn: '9780000000001',
        title: 'Sanderson Book',
        authors: ['Brandon Sanderson'],
        genres: ['Fantasy'],
        subjects: [],
        page_count: 500,
        publish_date: '2020-01-01',
        ratings_count: 100
      };

      const preferenceVector = {
        top_genres: ['Fantasy'],
        top_subjects: [],
        top_authors: ['Brandon Sanderson'],
        weighted_genres: { Fantasy: 10 },
        weighted_subjects: {},
        weighted_authors: { 'Brandon Sanderson': 5 },
        decades: { '2020s': 5 },
        length_preference: 'long' as const
      };

      const scored = scoreCandidate(candidate, preferenceVector);

      // Genre: 1/1 * 0.40 = 0.40
      // Author: 0.30
      // Subjects: 0
      // Popularity: 0.10 * 0.10 = 0.01
      // Total: 0.71
      expect(scored.score).toBeCloseTo(0.71, 2);
      expect(scored.has_preferred_author).toBe(true);
    });
  });

  describe('applyDiversityFilter', () => {
    it('should limit books per author', () => {
      const candidates = [
        {
          isbn: '1',
          title: 'Book 1',
          authors: ['Author A'],
          score: 0.9,
          genres: [],
          subjects: [],
          page_count: 300,
          publish_date: null,
          ratings_count: null,
          genre_overlap: 2,
          subject_overlap: 1,
          has_preferred_author: true,
          popularity_score: 0.5
        },
        {
          isbn: '2',
          title: 'Book 2',
          authors: ['Author A'],
          score: 0.85,
          genres: [],
          subjects: [],
          page_count: 350,
          publish_date: null,
          ratings_count: null,
          genre_overlap: 2,
          subject_overlap: 1,
          has_preferred_author: true,
          popularity_score: 0.5
        },
        {
          isbn: '3',
          title: 'Book 3',
          authors: ['Author A'],
          score: 0.8,
          genres: [],
          subjects: [],
          page_count: 400,
          publish_date: null,
          ratings_count: null,
          genre_overlap: 2,
          subject_overlap: 1,
          has_preferred_author: true,
          popularity_score: 0.5
        },
        {
          isbn: '4',
          title: 'Book 4',
          authors: ['Author A'],
          score: 0.75,
          genres: [],
          subjects: [],
          page_count: 320,
          publish_date: null,
          ratings_count: null,
          genre_overlap: 2,
          subject_overlap: 1,
          has_preferred_author: true,
          popularity_score: 0.5
        }
      ];

      const filtered = applyDiversityFilter(candidates, 2);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].isbn).toBe('1');
      expect(filtered[1].isbn).toBe('2');
    });
  });

  describe('generateReasons', () => {
    it('should generate genre match reason', () => {
      const candidate = {
        isbn: '9780000000000',
        title: 'Test Book',
        authors: ['Test Author'],
        genres: ['Fantasy', 'Epic'],
        subjects: [],
        page_count: 500,
        publish_date: '2020-01-01',
        ratings_count: 1000,
        score: 0.8,
        genre_overlap: 2,
        subject_overlap: 0,
        has_preferred_author: false,
        popularity_score: 1.0
      };

      const preferenceVector = {
        top_genres: ['Fantasy', 'Science Fiction'],
        top_subjects: [],
        top_authors: [],
        weighted_genres: { Fantasy: 10 },
        weighted_subjects: {},
        weighted_authors: {},
        decades: {},
        length_preference: 'long' as const
      };

      const reasons = generateReasons(candidate, preferenceVector, [], []);

      expect(reasons).toContain('Matches your love of Fantasy');
    });

    it('should generate similarity reason', () => {
      const candidate = {
        isbn: '9780000000001',
        title: 'New Book',
        authors: ['Author B'],
        genres: ['Fantasy', 'Magic'],
        subjects: [],
        page_count: 400,
        publish_date: '2021-01-01',
        ratings_count: 500,
        score: 0.85,
        genre_overlap: 2,
        subject_overlap: 0,
        has_preferred_author: false,
        popularity_score: 0.5
      };

      const ratedBooks = [
        { isbn: '9780000000002', score: 5, tags: [] }
      ];

      const ratedMetadata = [
        {
          isbn: '9780000000002',
          title: 'Old Favorite',
          authors: ['Author A'],
          genres: ['Fantasy', 'Magic'],
          subjects: [],
          page_count: 450,
          publish_date: '2019-01-01',
          ratings_count: 2000
        }
      ];

      const preferenceVector = {
        top_genres: ['Fantasy'],
        top_subjects: [],
        top_authors: [],
        weighted_genres: { Fantasy: 10 },
        weighted_subjects: {},
        weighted_authors: {},
        decades: {},
        length_preference: 'long' as const
      };

      const reasons = generateReasons(
        candidate,
        preferenceVector,
        ratedBooks,
        ratedMetadata
      );

      expect(reasons).toContain('Similar to Old Favorite (5 stars)');
    });
  });
});
```

Run tests:
```bash
cd worker/
npm run test
```

**Day 13: Integration Tests**

Create `worker/test/routes/recommend.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/index.js';

describe('Recommendation API', () => {
  it('should return 400 for invalid request', async () => {
    const res = await app.request('/api/recommend/content-based', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rated_books: [] // Empty array is invalid
      })
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid ISBN', async () => {
    const res = await app.request('/api/recommend/content-based', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rated_books: [
          { isbn: '123', score: 5 } // ISBN too short
        ]
      })
    });

    expect(res.status).toBe(400);
  });

  it('should return recommendations for valid request', async () => {
    const res = await app.request('/api/recommend/content-based', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rated_books: [
          { isbn: '9780765326355', score: 5 }, // The Way of Kings
          { isbn: '9780553293357', score: 4 }  // Foundation
        ],
        limit: 5
      })
    });

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('recommendations');
    expect(data).toHaveProperty('algorithm_info');
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations.length).toBeLessThanOrEqual(5);

    // Check recommendation structure
    if (data.recommendations.length > 0) {
      const rec = data.recommendations[0];
      expect(rec).toHaveProperty('isbn');
      expect(rec).toHaveProperty('title');
      expect(rec).toHaveProperty('authors');
      expect(rec).toHaveProperty('match_score');
      expect(rec).toHaveProperty('reasons');
      expect(Array.isArray(rec.reasons)).toBe(true);
    }
  });
});
```

**Day 14: Load Testing**

Create `worker/test/load/artillery-config.yml`:

```yaml
config:
  target: 'https://alexandria-staging.ooheynerds.com'
  phases:
    - duration: 60
      arrivalRate: 10 # 10 requests per second
      name: "Warm up"
    - duration: 120
      arrivalRate: 50 # 50 requests per second
      name: "Sustained load"
    - duration: 60
      arrivalRate: 100 # 100 requests per second
      name: "Peak load"
  processor: "./load-test-processor.js"

scenarios:
  - name: "Get recommendations"
    flow:
      - post:
          url: "/api/recommend/content-based"
          json:
            rated_books:
              - isbn: "9780765326355"
                score: 5
              - isbn: "9780553293357"
                score: 4
              - isbn: "9780765365279"
                score: 5
            limit: 10
          capture:
            - json: "$.algorithm_info.processed_ms"
              as: "latency"
          expect:
            - statusCode: 200
            - contentType: json
            - hasProperty: recommendations
```

Run load test:
```bash
npm install -g artillery
artillery run worker/test/load/artillery-config.yml
```

**Success criteria**:
- P50 latency: <500ms
- P95 latency: <2s
- P99 latency: <5s
- Error rate: <1%

**Day 15: Performance Tuning**

If latency exceeds targets:

1. **Add database indexes**:
```sql
-- Check if these exist already
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enriched_works_genres_gin
ON enriched_works USING GIN (genres);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enriched_editions_isbn
ON enriched_editions (isbn);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enriched_editions_work_key
ON enriched_editions (work_key);
```

2. **Reduce candidate pool**:
```typescript
// Change from 500 to 200
const candidates = await queryCandidates(sql, preferenceVector, excludeIsbns, 200);
```

3. **Add caching** (optional):
```typescript
// Cache recommendations per user profile hash
const profileHash = hashUserProfile(rated_books, preferences);
const cached = await c.env.CACHE.get(`rec:${profileHash}`);
if (cached) {
  return c.json(JSON.parse(cached));
}

// ... compute recommendations ...

await c.env.CACHE.put(
  `rec:${profileHash}`,
  JSON.stringify(response),
  { expirationTtl: 3600 } // 1 hour
);
```

---

### Week 4: Deployment & Monitoring

**Day 16: Deploy to Staging**

```bash
cd worker/
npm run deploy -- --env staging
```

**Day 17: Manual Testing**

Test with real reading history:
1. Export Goodreads/StoryGraph data
2. Convert to JSON format
3. Call staging endpoint
4. Review recommendations - do they make sense?

**Day 18: Analytics Instrumentation**

Add Analytics Engine tracking (already in route handler):

```typescript
// Track in Analytics Engine
c.get('analytics')?.writeDataPoint({
  blobs: [
    'recommendation_request',
    algorithm_version,
    preferenceVector.top_genres[0] || 'unknown'
  ],
  doubles: [
    processingTime,
    rated_books.length,
    candidates.length,
    limit,
    recommendations.length
  ],
  indexes: ['content-based-v1']
});
```

Query analytics:
```sql
SELECT
  blob1 as event,
  blob2 as algorithm,
  blob3 as top_genre,
  AVG(double1) as avg_latency_ms,
  AVG(double2) as avg_rated_books,
  AVG(double3) as avg_candidates,
  AVG(double5) as avg_recommendations,
  COUNT(*) as request_count
FROM RECOMMENDATION_ANALYTICS
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY blob1, blob2, blob3
ORDER BY request_count DESC;
```

**Day 19: Production Deployment**

```bash
cd worker/
npm run deploy -- --env production
```

**Feature flag in bendv3**:
```typescript
const RECOMMENDATION_FEATURE_FLAG = {
  enabled: false, // Start disabled
  rollout_percentage: 0
};
```

**Day 20: Beta Launch**

1. Enable for internal users (5-10 people)
2. Monitor for 48 hours:
   - Error rates
   - Latency metrics
   - User feedback

3. Expand rollout:
   - Day 22: 10% of users
   - Day 25: 25% of users
   - Day 28: 50% of users
   - Day 30: 100% rollout

---

## Risk Register

### High Priority Risks

| Risk | Impact | Probability | Mitigation | Status |
|------|--------|-------------|------------|--------|
| Poor metadata coverage | Recommendations feel random | Medium | Validate Week 1, backfill if needed | Not assessed |
| Slow query performance | UX degraded (>5s response) | Medium | Load testing Week 3, add indexes | Not assessed |
| bendv3 timeline delays | Alexandria ready but can't integrate | Low | Build standalone test UI | Not assessed |
| Cold start problem | New users get poor results | High | Onboarding asks for genres/authors | Design needed |

### Medium Priority Risks

| Risk | Impact | Probability | Mitigation | Status |
|------|--------|-------------|------------|--------|
| Authentication complexity | Security issues or delays | Low | Simple service token initially | Design needed |
| Schema changes during dev | Rework, coordination overhead | Medium | Lock API contract Week 1 | In progress |

---

## Success Metrics

### Technical Metrics (Analytics Engine)

- **Latency**:
  - P50: <500ms
  - P95: <2s
  - P99: <5s

- **Error Rate**: <1%

- **Coverage**: Works with 3+ rated books minimum

### Product Metrics (bendv3)

- **Acceptance Rate**: >20% of users click/save recommendations
- **Rating Frequency**: Users rate 10+ books in first month
- **Return Rate**: 50% of users request recommendations multiple times

### Qualitative Feedback

- User survey: "Recommendations feel personalized" (agree/disagree)
- Low support tickets about irrelevant recommendations
- Positive feedback in user interviews

---

## Phase 2 Considerations (Future Work)

**Not in MVP scope, but document for later**:

### Semantic Embeddings (Priority 1)
- Cloudflare Workers AI for text embeddings
- Vectorize for vector storage
- Combined scoring: `0.6 * content_based + 0.4 * semantic`
- Estimated cost: $15-20/month for 10K recommendations

### Collaborative Filtering (Priority 2)
- Requires 100+ active users for meaningful results
- Matrix factorization on Unraid (nightly batch)
- Or upgrade to Vertex AI if scale demands

### Reading Goals (Priority 3)
- Track "Read 50 books in 2026" type goals
- Suggest books that help achieve goals
- Progress visualization

### Social Features (Future - Not Planned)
- Not in current roadmap
- Could add later if user demand emerges

### Trending Books (Future)
- Web scraping for trending lists
- NYT bestsellers, Goodreads Choice, etc.
- Boost popular/trending books in recommendations

---

## Communication & Coordination

### Sync Meetings
- **Week 0** (now): Kickoff + alignment (1 hour)
- **Week 1**: Checkpoint (30 min)
- **Week 2**: Checkpoint (30 min)
- **Week 3**: Integration review (1 hour)
- **Week 4**: Go/No-Go (30 min)
- **Week 5**: Post-launch retrospective (1 hour)

### Async Updates
- Daily: Progress updates in GitHub issue #160
- Blocking issues: Tag relevant team, escalate if >24h
- Questions: Ask in issue comments, expect <24h response

### Escalation Path
1. Comment in issue with tag
2. If urgent: Direct message
3. If blocker: Emergency sync call

---

## Related Issues & Documentation

### GitHub Issues
- **Alexandria #160**: Master project tracker (this document)
- **bendv3 #257**: User ratings infrastructure implementation

### Documentation Files
- This file: `.planning/recommendation-system-plan.md`
- Master tracker: `.planning/master-tracker-recommendation-system.md`
- bendv3 issue draft: `.planning/bendv3-ratings-issue.md`
- API spec (to be created): `docs/api/RECOMMENDATION-API.md`
- Metadata analysis (to be created): `docs/operations/RECOMMENDATION-METADATA-ANALYSIS.md`

---

## Next Actions

1. **This week**: Run metadata validation queries (Day 1)
2. **This week**: Finalize API contract with bendv3 team
3. **Week 1**: Begin implementation following roadmap
4. **Checkpoint**: End of Week 1 - review progress, adjust timeline

---

## Appendix: Example User Flows

### Flow 1: New User Onboarding

```
1. User creates account in bendv3
2. Onboarding prompt: "What genres do you like?"
   - User selects: Fantasy, Science Fiction, Mystery
3. Onboarding prompt: "Rate some books to get started"
   - User rates 3-5 books with star ratings
4. bendv3 calls Alexandria recommendation endpoint
5. User sees personalized recommendations immediately
```

### Flow 2: Existing User Gets Recommendations

```
1. User has rated 20+ books over past month
2. User navigates to "Recommendations" page in bendv3
3. bendv3 fetches user's ratings from DB
4. bendv3 calls Alexandria: POST /api/recommend/content-based
5. Alexandria computes recommendations (1-2s)
6. bendv3 displays recommendations with:
   - Cover images
   - Match scores
   - Explanations ("Similar to X because Y")
   - Call-to-action buttons ("Add to library", "Learn more")
```

### Flow 3: User Refines Preferences

```
1. User sees recommendations but wants different mood
2. User adjusts preferences: mood = "light" (was "epic")
3. bendv3 calls Alexandria with updated preferences
4. New recommendations appear (lighter, more humorous books)
5. User finds a match, rates it highly
6. Future recommendations incorporate this new data point
```

---

**Status**: Planning Complete
**Ready for**: Implementation Week 1
**Owner**: Alexandria + bendv3 teams
**Last Updated**: 2026-01-09
