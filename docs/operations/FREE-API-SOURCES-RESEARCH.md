# Free & Open API Sources - Comprehensive Research

**Date**: 2026-01-09
**Purpose**: Identify all available free/open APIs for book enrichment

---

## Current Sources (In Use)

### 1. Google Books API
- **Status**: ✅ Active (1,000/day quota, auto-adjuster enabled)
- **Strength**: Cover images, basic metadata, good coverage
- **Weakness**: Quota limitations, covers may be low-res
- **Cost**: Free (with limits)

### 2. OpenLibrary
- **Status**: ✅ Active (6,000/hour guideline)
- **Strength**: Free, high limits, CDN-backed covers, full metadata
- **Weakness**: Smaller coverage than commercial APIs
- **Cost**: Free

### 3. ISBNdb Premium
- **Status**: ✅ Active (15K/day, $29.95/mo)
- **Strength**: Best metadata, high-res covers, batch API
- **Weakness**: Paid, quota constraints
- **Cost**: $29.95/month

---

## Enrichment Path Analysis

### Path 1: Cover Images

**Current Priority**: Google Books → OpenLibrary → ISBNdb → Placeholder

**Additional Free Sources**:

#### a) Wikidata / Wikimedia Commons
- **API**: https://www.wikidata.org/w/api.php
- **Coverage**: Book covers from Wikipedia articles
- **Quality**: High-res (often original scans)
- **Rate Limit**: None documented (reasonable use expected)
- **Pros**:
  - Public domain/CC licensed images
  - Often higher resolution than APIs
  - Free forever
- **Cons**:
  - Lower coverage (only notable books with Wikipedia articles)
  - Requires ISBN → Wikidata entity resolution
  - More complex API (SPARQL queries)
- **Implementation effort**: Medium-High
- **Recommendation**: ⭐⭐⭐ Good supplementary source

#### b) Archive.org (Internet Archive)
- **API**: https://archive.org/services/docs/api/
- **Coverage**: Books in public domain + modern scanned books
- **Quality**: Very high-res (scanned covers)
- **Rate Limit**: Generous (no hard limits documented)
- **Pros**:
  - Massive collection (30M+ books)
  - Free, no API key required
  - High-quality scans
- **Cons**:
  - Coverage weighted toward older/public domain books
  - API not specifically designed for covers (requires metadata lookup)
- **Implementation effort**: Medium
- **Recommendation**: ⭐⭐⭐⭐ Excellent for older books

#### c) Goodreads (Owned by Amazon)
- **API**: ⚠️ DEPRECATED (shut down Dec 2020)
- **Status**: No longer available
- **Recommendation**: ❌ Not an option

#### d) LibraryThing
- **API**: https://www.librarything.com/services/
- **Coverage**: Covers + metadata
- **Quality**: Medium-high
- **Rate Limit**: 1,000/day (with registration)
- **Pros**:
  - Free tier available
  - Good metadata
- **Cons**:
  - Lower coverage than Google/OpenLibrary
  - Requires developer key
- **Implementation effort**: Low
- **Recommendation**: ⭐⭐⭐ Decent fallback option

#### e) Bookcover.xyz (Community)
- **API**: https://bookcover.xyz/
- **Coverage**: Aggregates covers from multiple sources
- **Quality**: Varies
- **Rate Limit**: Unknown (community project)
- **Pros**:
  - Simple API
  - No key required
- **Cons**:
  - Reliability unknown
  - May aggregate our existing sources
- **Implementation effort**: Low
- **Recommendation**: ⭐⭐ Uncertain reliability

---

### Path 2: Book Metadata

**Current Sources**: ISBNdb (paid) → Google Books → OpenLibrary

**Additional Free Sources**:

#### a) Wikidata
- **API**: https://www.wikidata.org/w/api.php
- **Coverage**: Structured data for notable books
- **Data Quality**: Excellent (community verified)
- **Rate Limit**: None (reasonable use)
- **Data Available**:
  - Title, subtitle, authors
  - Publication date, publisher
  - Genres, subjects
  - External IDs (OCLC, LCCN, etc.)
  - Awards, series information
- **Pros**:
  - Rich structured data
  - Multilingual support
  - Authority file links
  - Free forever
- **Cons**:
  - Coverage limited to notable books
  - Complex SPARQL queries required
  - No batch ISBN lookup
- **Implementation effort**: High
- **Recommendation**: ⭐⭐⭐⭐ Excellent for notable books

#### b) WorldCat / OCLC
- **API**: https://www.oclc.org/developer/home.en.html
- **Coverage**: 500M+ library records worldwide
- **Data Quality**: Authoritative (library standard)
- **Rate Limit**: Varies by plan
- **Free tier**: Limited (requires membership)
- **Pros**:
  - Most comprehensive bibliographic database
  - Library-quality metadata
  - FRBR work grouping
- **Cons**:
  - Complex registration process
  - Free tier very limited
  - Requires OCLC membership ($1,500+/year)
- **Implementation effort**: High
- **Recommendation**: ⭐⭐ Not practical unless budget increases

#### c) Library of Congress
- **API**: https://www.loc.gov/apis/
- **Coverage**: All LOC catalog records
- **Data Quality**: Authoritative
- **Rate Limit**: None documented
- **Pros**:
  - Free, unlimited
  - Authoritative data
  - MARC records available
- **Cons**:
  - US-centric coverage
  - No ISBN-first lookup (LCCN required)
  - Complex MARC format
- **Implementation effort**: High
- **Recommendation**: ⭐⭐⭐ Good supplementary source

#### d) Amazon Product Advertising API
- **API**: https://webservices.amazon.com/paapi5/documentation/
- **Coverage**: Everything on Amazon (massive)
- **Data Quality**: Very good
- **Rate Limit**: Based on revenue (tiered)
- **Cost**: Free with conditions
  - Must link to Amazon
  - Must have qualifying revenue OR
  - 1 request per 5 seconds without revenue
- **Pros**:
  - Massive coverage
  - High-quality covers
  - Customer reviews, ratings
  - Pricing data
- **Cons**:
  - Requires approved application
  - Must comply with TOS (Amazon links)
  - Rate limits without sales
  - May get shut down if no revenue
- **Implementation effort**: Medium
- **Recommendation**: ⭐⭐⭐ Good if you can meet TOS

---

### Path 3: Author Data & Bibliographies

**Current Sources**: ISBNdb author endpoint (paginated)

**Additional Free Sources**:

#### a) Wikidata (Author Hub)
- **API**: https://www.wikidata.org/w/api.php
- **Coverage**: Notable authors worldwide
- **Data Quality**: Excellent
- **Data Available**:
  - Birth/death dates, nationality
  - Biography summary (from Wikipedia)
  - Complete bibliography (via works)
  - Awards, movements, influences
  - VIAF, ISNI identifiers
- **Pros**:
  - Best free source for author data
  - Complete bibliographies for notable authors
  - Authority file integration
  - Multilingual
- **Cons**:
  - Limited to notable authors
  - SPARQL queries required
  - No simple ISBN → author bibliography
- **Implementation effort**: High
- **Recommendation**: ⭐⭐⭐⭐⭐ Best free option for authors

#### b) VIAF (Virtual International Authority File)
- **API**: https://www.oclc.org/developer/api/oclc-apis/viaf.en.html
- **Coverage**: 50M+ authority records
- **Data Quality**: Authoritative (library standard)
- **Rate Limit**: Generous
- **Pros**:
  - Free, unlimited
  - Authority file standard
  - Links to national libraries
  - Connects authors across catalogs
- **Cons**:
  - Bibliographies require additional API calls
  - Complex data format
- **Implementation effort**: Medium-High
- **Recommendation**: ⭐⭐⭐⭐ Best for author identity resolution

#### c) ISNI (International Standard Name Identifier)
- **API**: https://isni.org/page/technical-documentation/
- **Coverage**: 13M+ people and organizations
- **Data Quality**: Authoritative
- **Rate Limit**: Limited (SRU interface)
- **Pros**:
  - Global identifier
  - Free API
- **Cons**:
  - No bibliographies
  - Identifier resolution only
- **Implementation effort**: Low
- **Recommendation**: ⭐⭐⭐ Good for author linking

#### d) Google Scholar
- **API**: ⚠️ No official API
- **Coverage**: Academic authors
- **Scraping**: Violates TOS
- **Recommendation**: ❌ Not an option

#### e) OpenAlex (Research Papers)
- **API**: https://openalex.org/
- **Coverage**: 250M+ academic works
- **Data Quality**: Good
- **Rate Limit**: 100K/day (free)
- **Pros**:
  - Free, open data
  - Good for academic authors
  - Author profiles + works
- **Cons**:
  - Academic focus only
  - Not for popular fiction authors
- **Implementation effort**: Medium
- **Recommendation**: ⭐⭐⭐ Good for academic books only

---

### Path 4: Author Biographies

**Current Sources**: None (not implemented)

**Free Sources**:

#### a) Wikipedia API
- **API**: https://en.wikipedia.org/w/api.php
- **Coverage**: Notable persons worldwide
- **Data Quality**: Very good (community edited)
- **Rate Limit**: Generous
- **Pros**:
  - Free, unlimited
  - High-quality prose biographies
  - Multilingual (300+ languages)
  - Images available
- **Cons**:
  - Only for notable people
  - Requires author name → Wikipedia article resolution
- **Implementation effort**: Low-Medium
- **Recommendation**: ⭐⭐⭐⭐⭐ Best free biography source

#### b) Wikidata (Structured Bio)
- **API**: https://www.wikidata.org/w/api.php
- **Coverage**: Same as Wikipedia
- **Data Quality**: Structured facts
- **Pros**:
  - Structured biographical data
  - Easy to parse (JSON)
  - Links to Wikipedia articles
- **Cons**:
  - No prose biography (only facts)
- **Implementation effort**: Medium
- **Recommendation**: ⭐⭐⭐⭐ Best for structured bio data

#### c) VIAF (Brief Notes)
- **API**: VIAF API
- **Coverage**: Brief biographical notes
- **Data Quality**: Minimal (cataloging notes)
- **Pros**:
  - Authoritative
- **Cons**:
  - Very brief (1-2 sentences)
  - Not narrative biographies
- **Implementation effort**: Low
- **Recommendation**: ⭐⭐ Too minimal

---

## Recommended Free API Strategy

### Priority 1: Cover Images
```
1. Google Books (1,000/day, auto-scales) ✅ Current
2. OpenLibrary (6,000/hour) ✅ Current
3. Archive.org (unlimited) ⭐ ADD THIS
4. Wikidata/Wikimedia (unlimited) ⭐ ADD THIS
5. ISBNdb (13,000/day, paid) ✅ Current
6. Placeholder
```

**Why Archive.org + Wikidata?**
- Archive.org excellent for older books (pre-2000)
- Wikidata excellent for notable/classic books
- Both free, unlimited, high-quality
- Reduces pressure on Google Books quota

### Priority 2: Book Metadata
```
1. ISBNdb (paid, best quality) ✅ Current
2. Google Books (1,000/day) ✅ Current
3. OpenLibrary (6,000/hour) ✅ Current
4. Wikidata (for notable books) ⭐ ADD THIS
```

**Why Wikidata?**
- Excellent structured data for notable books
- No API limits
- Often more complete than other free sources
- Worth the implementation effort

### Priority 3: Author Bibliographies
```
1. ISBNdb /author endpoint ✅ Current
2. Wikidata SPARQL (notable authors) ⭐ ADD THIS
3. VIAF (identity resolution) ⭐ ADD THIS
```

**Why Wikidata + VIAF?**
- Wikidata has complete bibliographies for notable authors
- VIAF connects author identities across systems
- Both free and authoritative

### Priority 4: Author Biographies
```
1. Wikipedia API (prose biographies) ⭐ ADD THIS
2. Wikidata (structured bio facts) ⭐ ADD THIS
```

**Why Wikipedia/Wikidata?**
- Best free biography source
- High quality, multilingual
- Easy to implement
- No rate limits

---

## Amazon Product Advertising API Analysis

### Should You Sign Up?

**Pros**:
- Massive coverage (everything on Amazon)
- High-quality covers
- Customer reviews + ratings
- Pricing data
- Free tier available

**Cons**:
- Strict TOS compliance required:
  - Must display Amazon links
  - Must direct users to Amazon
  - Can lose access if no sales
- Rate limits without revenue (1 req/5 sec = ~17K/day)
- Application approval process
- Risk of account closure

**Recommendation**: ⭐⭐⭐ **WAIT**

**Reasoning**:
1. You have no users currently (can't generate Amazon revenue)
2. Without revenue, rate limits are restrictive
3. TOS requires Amazon links (may conflict with your design)
4. Better to exhaust free options first
5. **Revisit when you have users and can drive Amazon sales**

---

## Implementation Priority

### Phase 1: Quick Wins (Low Effort, High Value)
1. **Archive.org cover fallback** (Medium effort, huge coverage boost)
   - Add between OpenLibrary and ISBNdb
   - Excellent for pre-2000 books
   - API: https://archive.org/metadata/{identifier}

2. **Wikipedia author biographies** (Low effort, immediate value)
   - Simple API call
   - High-quality biographies
   - Can extract from author name

### Phase 2: High Value (Medium Effort)
3. **Wikidata cover images** (Medium effort)
   - Add after Archive.org
   - Best for classic/notable books
   - Requires ISBN → Wikidata entity resolution

4. **VIAF author resolution** (Medium effort)
   - Improves author identity matching
   - Links to national library records
   - API: https://viaf.org/viaf/

### Phase 3: Advanced (High Effort, High Value)
5. **Wikidata metadata enrichment** (High effort)
   - Structured book data for notable titles
   - Complete author bibliographies
   - Requires SPARQL expertise

6. **Wikidata author bibliographies** (High effort)
   - Complete works for notable authors
   - Better than ISBNdb for prolific authors
   - Reduces ISBNdb pagination costs

---

## Summary & Next Steps

### Best Free Options (Untapped)
1. **Archive.org** - Cover images (especially older books)
2. **Wikidata** - Metadata, covers, author data (notable books/authors)
3. **Wikipedia** - Author biographies (prose)
4. **VIAF** - Author identity resolution

### Amazon API Decision
**SKIP FOR NOW** - Wait until you have users who can generate Amazon referral revenue

### Immediate Recommendation
Let Google Books quota auto-adjust for 48 hours, then:
1. Add Archive.org for covers (quick win)
2. Add Wikipedia for author bios (quick win)
3. Monitor Google Books quota adjustment
4. Plan Wikidata integration (long-term)

### Questions to Consider
1. Do you want to prioritize notable books (Wikidata focus)?
2. Is author biography data important for your use case?
3. How much dev effort can you allocate to new integrations?
