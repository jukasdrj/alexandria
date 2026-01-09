# GitHub Issue for bendv3: User Ratings Infrastructure for Book Recommendations

**Title**: Add user ratings infrastructure to support Alexandria recommendation system

**Labels**: enhancement, architecture, database

---

## Context

Alexandria is building a recommendation system to suggest personalized book recommendations based on user reading history. The system will live in Alexandria (data lake with 54M+ books) but requires bendv3to own all user-specific data (ratings, reading goals, preferences).

**Full planning doc**: `alexandria/.planning/recommendation-system-plan.md`

---

## Scope

We need to design and implement the user-side infrastructure for:

1. **User book ratings** (1-5 stars)
2. **Reading preferences** (genres, authors, mood, constraints)
3. **Optional: Reading goals** (future enhancement)

**Out of scope for this issue**:
- Social features (sharing, following, etc.) - not planned
- Trending books - could come from web scraping later, not in MVP

---

## Proposed Data Model (Discussion Starter)

### Option A: Postgres Tables (bendv3 database)

```sql
CREATE TABLE user_book_ratings (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  isbn VARCHAR(13) NOT NULL,
  score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  tags TEXT[], -- Optional: ["dnf", "reread", "favorite"]
  notes TEXT, -- Optional: Private notes
  rated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, isbn)
);
CREATE INDEX idx_user_ratings_user ON user_book_ratings(user_id);
CREATE INDEX idx_user_ratings_isbn ON user_book_ratings(isbn);

CREATE TABLE user_reading_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  preferred_genres TEXT[], -- ["fantasy", "sci-fi"]
  excluded_genres TEXT[], -- ["romance", "horror"]
  preferred_authors TEXT[], -- ["Brandon Sanderson"]
  excluded_authors TEXT[],
  mood VARCHAR(50), -- "epic", "light", "dark", "cozy"
  page_count_min INT,
  page_count_max INT,
  publication_year_min INT,
  publication_year_max INT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Option B: Cloudflare D1 (if bendv3 is using D1)

Same schema, adapted for D1's SQLite syntax.

### Option C: KV/Durable Objects (if simplicity preferred)

Store as JSON documents per user:
```typescript
interface UserRatings {
  userId: string;
  ratings: Array<{
    isbn: string;
    score: number; // 1-5
    tags?: string[];
    ratedAt: string;
  }>;
  preferences?: {
    genres?: string[];
    excludeGenres?: string[];
    // ... etc
  };
}
```

---

## API Endpoints Needed in bendv3

### 1. Rate a Book
```
POST /api/users/me/ratings
{
  "isbn": "9780765326355",
  "score": 5,
  "tags": ["favorite"]
}
```

### 2. Get User's Ratings
```
GET /api/users/me/ratings
Response: [{ isbn, score, tags, ratedAt }]
```

### 3. Update Preferences
```
PATCH /api/users/me/preferences
{
  "preferred_genres": ["fantasy", "sci-fi"],
  "mood": "epic"
}
```

### 4. Get Recommendations (calls Alexandria)
```
GET /api/users/me/recommendations?limit=10

Flow:
1. bendv3 fetches user's ratings from DB
2. bendv3 calls Alexandria: POST /api/recommend/content-based
3. bendv3 returns recommendations to frontend
```

---

## Integration with Alexandria

Alexandria will expose:
```
POST /api/recommend/content-based
Request:
{
  rated_books: [{ isbn, score }],
  preferences: { genres, mood, ... },
  limit: 10
}
Response:
{
  recommendations: [{ isbn, title, authors, match_score, reasons }]
}
```

**Important**: Alexandria is stateless - bendv3 passes all user data in each request. No user state stored in Alexandria.

---

## Questions for Discussion

1. **Database choice**: Postgres, D1, or KV? What does bendv3 currently use?

2. **User separation**: Is bendv3 multi-tenant? How are users isolated?

3. **Authentication**: How will Alexandria verify requests are from bendv3? Service token? mTLS?

4. **Privacy**:
   - Should ratings be private or could they be aggregated anonymously?
   - GDPR considerations for storing reading history?

5. **Migration path**: Do existing bendv3 users need a way to import ratings from Goodreads/StoryGraph?

6. **Frontend requirements**:
   - Star rating component?
   - Recommendation display UI?
   - Onboarding flow for new users ("Pick your favorite genres")?

7. **Caching strategy**: Should bendv3 cache recommendations? For how long?

8. **Rate limiting**: Should there be limits on recommendation requests per user?

---

## Timeline Coordination

**Alexandria's Phase 1 timeline**:
- Week 1: Metadata validation, API spec finalized
- Week 2: Core algorithm implementation
- Week 3: Testing
- Week 4: Deployment

**Sync point**: Week 3 - integration testing in staging

**Question**: What's bendv3's timeline for implementing the ratings infrastructure?

---

## Success Criteria

- [ ] User can rate books (1-5 stars) in bendv3 UI
- [ ] User can set reading preferences
- [ ] bendv3 can call Alexandria recommendation endpoint
- [ ] Recommendations display in bendv3 UI
- [ ] Data model supports 100+ ratings per user
- [ ] Response time <3s end-to-end (bendv3 → Alexandria → bendv3)

---

## Next Steps

1. Review this proposal and decide on data model approach
2. Finalize API contract between bendv3 ↔ Alexandria
3. Coordinate parallel development (Week 1-2 for both teams)
4. Set up staging environment for integration testing (Week 3)

---

## References

- Alexandria planning doc: `.planning/recommendation-system-plan.md`
- Alexandria API spec (to be created): `docs/api/RECOMMENDATION-API.md`
- Architecture diagram: See planning doc

---

**Assignee**: TBD
**Priority**: Medium (feature enhancement, not critical bug)
**Estimated effort**: 1-2 weeks for ratings infrastructure + UI
