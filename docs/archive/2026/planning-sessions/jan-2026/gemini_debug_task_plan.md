# Task Plan: Fix Backfill Quota Exhaustion Issue

## Goal
Enable backfill to work WITHOUT ISBNdb by implementing fallback to 4 available external APIs (Wikidata, Archive.org, Google Books, Wikipedia).

## Success Criteria
- [ ] Backfill generates books from Gemini even when ISBNdb quota exhausted
- [ ] Falls back to Wikidata → Google Books → OpenLibrary → Synthetic
- [ ] Each fallback attempt logged with source tracking
- [ ] Synthetic works created only as last resort
- [ ] 0% data loss (all Gemini results preserved)

## Phases

### Phase 1: Code Investigation ⏳ in_progress
**Goal**: Understand current backfill flow and identify missing fallbacks

**Tasks**:
- [ ] Read hybrid-backfill.ts (understand orchestration)
- [ ] Read isbn-resolution.ts (check if ISBNdb-only)
- [ ] Check if Wikidata fallback exists
- [ ] Check if Google Books fallback exists
- [ ] Map current vs desired flow

**Status**: Starting investigation

### Phase 2: Design Fallback Chain 🔄 pending
**Goal**: Design multi-API fallback strategy

**Approach**:
1. ISBNdb (primary - when quota available)
2. Wikidata SPARQL (title/author search)
3. Google Books API (search by title/author)
4. OpenLibrary Search API
5. Synthetic work creation (last resort)

**Status**: Pending Phase 1 findings

### Phase 3: Implementation 🔄 pending
**Goal**: Implement cascading fallback logic

**Status**: Pending design approval

### Phase 4: Testing 🔄 pending
**Goal**: Verify works with ISBNdb quota exhausted

**Test Cases**:
- ISBNdb quota exhausted → Falls back to Wikidata
- Wikidata fails → Falls back to Google Books
- All APIs fail → Creates synthetic work
- Track source in metadata

**Status**: Pending implementation

### Phase 5: Validation 🔄 pending
**Goal**: Production testing

**Status**: Pending test success

## Previous Investigation (WRONG PATH)

**Hypothesis**: Type definition bug with `GEMINI_API_KEY.get()`
**Result**: DISPROVEN - API key binding works correctly
**Validation**: ISBNDB, Google Books, and Gemini test all work

## Correct Understanding

- ✅ Gemini API works (generates books)
- ✅ Type definitions correct
- ❌ Backfill blocked by ISBNdb quota exhaustion
- ❌ No fallback to other 4 external APIs
- ✅ Solution: Implement cascading API fallback

## Open Questions

1. Does isbn-resolution.ts already have fallback logic?
2. Is Wikidata search-by-title implemented?
3. Should we prioritize Wikidata over Google Books?
4. How to track which API provided the data?
5. Should synthetic works be enhanced later when quota refreshes?

## Decisions Needed

- [ ] Fallback priority order
- [ ] Confidence scoring per source
- [ ] Synthetic work enhancement strategy
- [ ] Error handling for each fallback
