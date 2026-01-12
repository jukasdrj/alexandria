# Ratings Architecture Decision - January 2026

**Status:** 🚨 BLOCKED - Awaiting architectural decision
**Date:** 2026-01-12
**Context:** bendv3 issue #258 (Personalized Recommendations API)
**Planning Files:** task_plan.md, findings.md, progress.md

---

## Critical Discovery

**Original Assumption (INVALID):** Alexandria has access to OpenLibrary's `ratings` table (~100M ratings)

**Reality:** OpenLibrary does **NOT** have a ratings table or ratings API endpoint.

### Evidence

1. **PostgreSQL Database Query:**
   ```sql
   SELECT tablename FROM pg_tables WHERE tablename LIKE '%rating%';
   -- Result: 0 rows
   ```

2. **OpenLibrary Data Dumps:** [Source](https://openlibrary.org/developers/dumps)
   - Available: editions, works, authors, redirects, wikidata records
   - **Missing:** ratings, reviews, user-generated content

3. **OpenLibrary API:** [Source](https://openlibrary.org/developers/api)
   - No `/ratings` endpoint documented
   - No rating fields in work/edition responses

4. **Archive.org Exports:** Monthly dumps contain no ratings data

### Impact

Cannot implement the following endpoints without ratings data:
- `GET /works/top-rated` - Top books by composite rating
- `GET /works/:workKey/ratings` - Rating data for specific work

bendv3's recommendation system (90% complete) remains blocked.

---

## Alternative Approaches

### Option 1: Google Books API Integration ✅ **RECOMMENDED**

**Description:** Enrich Alexandria's database with ratings from Google Books API during the enrichment pipeline.

**Architecture:**
```
Google Books API
    ↓ (enrichment pipeline)
enriched_editions (ratings columns added)
    ↓ (aggregation)
enriched_work_stats (composite ratings per work)
    ↓ (Worker endpoints)
bendv3 recommendations
```

**Data Source:**
- Google Books API confirmed to have `averageRating` and `ratingsCount` fields
- [Documentation](https://developers.google.com/books/docs/v1/reference/volumes)
- Example: `"averageRating": 4.0, "ratingsCount": 710"`

**Implementation:**

1. **Phase 1: Research** (2 hours)
   - Test Google Books API ratings coverage across Alexandria's 54.8M books
   - Verify quota limits with existing `GOOGLE_BOOKS_API_KEY`
   - Measure expected coverage percentage

2. **Phase 2: Schema Extension** (4 hours)
   - Add columns to `enriched_editions`:
     - `rating_avg NUMERIC(3,2)` - Average rating (0.00-5.00)
     - `rating_count INTEGER` - Number of ratings
     - `rating_source TEXT` - Provider ('google-books', 'isbndb', etc.)
   - Create `enriched_work_stats` table:
     - `work_key TEXT PRIMARY KEY`
     - `rating_avg NUMERIC(3,2)` - Composite average
     - `rating_count INTEGER` - Total ratings across editions
     - `rating_dist JSONB` - Distribution histogram
     - `updated_at TIMESTAMPTZ`
   - Add indexes: `idx_stats_top_rated (rating_avg DESC, rating_count DESC)`

3. **Phase 3: Enrichment Pipeline** (3 hours)
   - Update `GoogleBooksProvider` to extract ratings
   - Update enrichment queue handlers to store ratings
   - Create aggregation job: editions → works
   - Schedule daily refresh

4. **Phase 4: API Endpoints** (4 hours)
   - `GET /works/top-rated` - Query enriched_work_stats
   - `GET /works/:workKey/ratings` - Join enriched_editions
   - `GET /api/recommendations/subjects` - Existing data
   - `GET /api/recommendations/similar` - Subject overlap

5. **Phase 5: Testing & Deployment** (2 hours)
   - Unit tests for aggregation logic
   - Integration tests with bendv3
   - Performance validation (<100ms P50)
   - Production deployment

**Estimated Timeline:** 15 hours (2-3 weeks)

**Pros:**
- ✅ Alexandria already has Google Books API key configured
- ✅ Real user ratings from established platform (millions of books)
- ✅ No cold start problem
- ✅ Reuses existing Service Provider Framework
- ✅ Can supplement with ISBNdb ratings (fallback)
- ✅ bendv3 can launch recommendations immediately

**Cons:**
- ❌ Not all books have Google Books ratings (~60-70% coverage estimated)
- ❌ Depends on external API availability
- ❌ Quota limits (need to verify)

---

### Option 2: Build Alexandria's Own Ratings System

**Description:** Create user-generated ratings system for bendv3 users.

**Architecture:**
```
bendv3 users
    ↓ (POST /api/ratings)
ratings table (user_id, work_key, rating, timestamp)
    ↓ (aggregation)
enriched_work_stats (composite ratings)
    ↓ (Worker endpoints)
bendv3 recommendations
```

**Implementation:**

1. **Phase 1: Database Schema** (3 hours)
   - Create `ratings` table:
     - `id SERIAL PRIMARY KEY`
     - `user_id TEXT NOT NULL` - bendv3 user identifier
     - `work_key TEXT NOT NULL`
     - `rating INTEGER CHECK (rating >= 1 AND rating <= 5)`
     - `created_at TIMESTAMPTZ DEFAULT NOW()`
     - `updated_at TIMESTAMPTZ DEFAULT NOW()`
   - Unique constraint: `(user_id, work_key)`
   - Indexes: `idx_ratings_work` on `work_key`

2. **Phase 2: API Endpoints** (4 hours)
   - `POST /api/ratings` - Submit rating
   - `GET /api/ratings/:workKey` - Get ratings for work
   - `DELETE /api/ratings/:workKey` - Remove user's rating
   - Authentication via bendv3 session token

3. **Phase 3: Aggregation** (3 hours)
   - Create `enriched_work_stats` table (same as Option 1)
   - Aggregation job: ratings → enriched_work_stats
   - Schedule: Every 5 minutes (near real-time)

4. **Phase 4: Cold Start Strategy** (3 hours)
   - Populate with popularity metrics:
     - Search frequency → `rating_count` proxy
     - Enrichment requests → "interest score"
     - Cover downloads → engagement metric
   - Algorithm: Normalize to 1-5 star scale

5. **Phase 5: bendv3 Integration** (2 hours)
   - Update bendv3 to call `POST /api/ratings` after user rates book
   - Add rating UI to bendv3 book details page

**Estimated Timeline:** 15 hours + bendv3 UI work (3-4 weeks)

**Pros:**
- ✅ Full control over data
- ✅ No external API dependencies
- ✅ Can build truly personalized recommendations as dataset grows
- ✅ Privacy-friendly (self-hosted)

**Cons:**
- ❌ **Cold start problem**: 0 ratings initially
- ❌ Requires user authentication system
- ❌ Growth depends on bendv3 user adoption
- ❌ Won't have historical ratings data
- ❌ Longer time to value (weeks to accumulate meaningful data)

---

### Option 3: Popularity-Based Recommendations (No Ratings)

**Description:** Pivot to content-based filtering without star ratings.

**Architecture:**
```
enriched_works (subjects, authors, metadata)
    ↓
popularity_stats (search freq, enrichment count)
    ↓
similarity scoring (subject overlap + popularity)
    ↓
bendv3 recommendations
```

**Implementation:**

1. **Phase 1: Popularity Tracking** (3 hours)
   - Add columns to `enriched_works`:
     - `search_count INTEGER DEFAULT 0`
     - `enrichment_count INTEGER DEFAULT 0`
     - `cover_download_count INTEGER DEFAULT 0`
     - `last_accessed TIMESTAMPTZ`
   - Update endpoints to increment counters

2. **Phase 2: Scoring Algorithm** (4 hours)
   - Popularity score: `(search_count * 3) + (enrichment_count * 2) + cover_downloads`
   - Recency bonus: Exponential decay over 90 days
   - Quality filter: Minimum 3 searches to appear in "top"

3. **Phase 3: API Endpoints** (3 hours)
   - `GET /works/popular` - Replace "top-rated" with "most popular"
   - `GET /works/:workKey/stats` - Replace "ratings" with "popularity stats"
   - `GET /api/recommendations/similar` - Subject overlap only
   - No changes needed to subjects endpoint

4. **Phase 4: bendv3 Adaptation** (2 hours)
   - Update RecommendationService to use popularity instead of ratings
   - Adjust scoring: 70% subject + 30% popularity (no user preferences)

**Estimated Timeline:** 12 hours (1-2 weeks)

**Pros:**
- ✅ Can implement immediately with existing data
- ✅ No external dependencies
- ✅ No cold start problem (54.8M books already enriched)
- ✅ Privacy-friendly (no user ratings needed)

**Cons:**
- ❌ Not "ratings-based" as originally envisioned
- ❌ Less personalized (no user preference vector)
- ❌ "Popular" ≠ "good quality" (popularity bias)
- ❌ bendv3's RecommendationService needs significant changes

---

## Decision Matrix

| Criteria | Option 1 (Google Books) | Option 2 (Build Own) | Option 3 (Popularity) |
|----------|-------------------------|----------------------|-----------------------|
| **Time to Value** | ✅ Immediate (2-3 weeks) | ❌ Long (3-4 weeks + growth) | ✅ Fast (1-2 weeks) |
| **Data Quality** | ✅ High (millions of ratings) | ⚠️ Low initially (cold start) | ⚠️ Medium (proxy metrics) |
| **Coverage** | ⚠️ ~60-70% books | ✅ 100% (eventually) | ✅ 100% (all enriched) |
| **Personalization** | ✅ Yes (real ratings) | ✅ Yes (grows over time) | ❌ Limited (no ratings) |
| **Dependencies** | ⚠️ Google Books API | ✅ None | ✅ None |
| **Complexity** | ⚠️ Medium (API integration) | ⚠️ Medium (auth + aggregation) | ✅ Low (existing data) |
| **Cost** | ⚠️ Quota limits | ✅ Free | ✅ Free |
| **Scalability** | ✅ High (cached aggregates) | ✅ High (self-hosted) | ✅ High (simple queries) |

---

## Recommendation

**Option 1 (Google Books API)** is the best path forward for the following reasons:

1. **Immediate Value**: bendv3 can launch recommendations in 2-3 weeks with real ratings data
2. **Proven Data**: Millions of Google Books ratings from established platform
3. **No Cold Start**: Avoid months of waiting for user-generated data
4. **Infrastructure Ready**: Alexandria already has API key and Service Provider Framework
5. **Hybrid Path**: Can supplement with Option 2 later (user ratings override Google Books)

**Fallback Strategy:**
- Use Google Books ratings as primary source
- Supplement with ISBNdb ratings where Google Books has none
- Track coverage metrics and alert if <50%

**Future Enhancement:**
- Implement Option 2 (user ratings) in Q2 2026
- User ratings override external sources (personalization)
- Continue using external ratings for books without user ratings

---

## Next Steps (Pending User Approval)

**If Option 1 approved:**
1. Research Google Books API ratings coverage (test 1000 random ISBNs)
2. Verify quota limits with existing API key
3. Update task_plan.md with revised implementation steps
4. Begin Phase 1 (enrichment pipeline extension)

**If Option 2 approved:**
1. Design authentication strategy (bendv3 session tokens)
2. Create ratings table schema
3. Plan cold start population strategy
4. Coordinate with bendv3 for UI integration

**If Option 3 approved:**
1. Update bendv3 RecommendationService for popularity-based scoring
2. Add popularity tracking to existing endpoints
3. Implement scoring algorithm
4. Update OpenAPI spec (rename endpoints)

---

## Related Issues

- bendv3 #258 - Deploy Personalized Recommendations API (blocked by this decision)
- bendv3 #257 - Implement Personalized Recommendations (90% complete, waiting on Alexandria)

## References

- [OpenLibrary Data Dumps](https://openlibrary.org/developers/dumps)
- [OpenLibrary API Documentation](https://openlibrary.org/developers/api)
- [Google Books API - Volume Reference](https://developers.google.com/books/docs/v1/reference/volumes)
- [Google Books API - Using the API](https://developers.google.com/books/docs/v1/using)
- Alexandria planning files: task_plan.md, findings.md, progress.md

---

**Author:** Alexandria AI Agent (Claude)
**Last Updated:** 2026-01-12 15:45 PST
