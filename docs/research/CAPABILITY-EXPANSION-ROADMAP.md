# Capability Expansion Roadmap: Provider Integration Opportunities

**Document**: Strategic roadmap for expanding Alexandria's capability interfaces based on comprehensive provider research (January 2026)

---

## Current Capability Interfaces (Status Quo)

Alexandria's Service Provider Framework currently implements these capability interfaces:

### Implemented Interfaces

```typescript
// worker/lib/external-services/capabilities/

1. IISBNResolutionCapability
   - resolveISBN(title, author): Promise<string | null>
   - Returns: Single ISBN-13 or null

2. IMetadataCapability
   - fetchMetadata(isbn): Promise<BookMetadata>
   - Returns: title, author, publisher, publishDate, pageCount, language

3. ICoverCapability
   - fetchCover(isbn): Promise<CoverUrl>
   - Returns: URL to cover image (single size)

4. ISubjectCapability
   - fetchSubjects(isbn): Promise<string[]>
   - Returns: Genre/subject tags

5. IBiographyCapability
   - fetchBiography(authorKey): Promise<string>
   - Returns: Author biography text

6. IBookGenerationCapability
   - generateBooks(query, count): Promise<SyntheticBook[]>
   - Returns: AI-generated book suggestions
```

---

## Proposed New Capability Interfaces

### HIGH PRIORITY: Quick Wins

#### 1. IRatingsCapability
**Source**: ISBNdb Premium (only provider)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Easy
**Provider**: ISBNdb Premium only

```typescript
interface IRatingsCapability {
  /**
   * Get ratings and reviews for a book
   */
  fetchRatings(isbn: string): Promise<{
    averageRating: number;      // 0-5 scale
    ratingsCount: number;        // Total number of ratings
    reviews: ReviewItem[];       // User reviews with text
  } | null>;

  interface ReviewItem {
    reviewId: string;
    reviewer: string;
    rating: number;              // 1-5 stars
    reviewText: string;
    date: string;               // ISO 8601
  }
}
```

**Value**: Enable recommendation engine, trending books, social features

---

#### 2. IEditionCapability
**Source**: ISBNdb (all formats + editions), OpenLibrary
**Current Status**: ⚠️ Partially implemented
**Implementation Difficulty**: Easy
**Providers**: ISBNdb Premium, OpenLibrary

```typescript
interface IEditionCapability {
  /**
   * Get all formats and editions of a book
   */
  fetchEditions(isbn: string): Promise<{
    formats: EditionFormat[];
    relatedISBNs: string[];
  } | null>;

  interface EditionFormat {
    isbn: string;
    format: 'hardcover' | 'paperback' | 'ebook' | 'audiobook';
    edition: string;
    year: number;
    binding?: string;
    pages?: number;
  }
}
```

**Value**: Show readers format options, enable reading format preferences

---

#### 3. IPublicDomainCapability
**Source**: Google Books (publicDomain flag), Archive.org (lending status)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Easy
**Providers**: Google Books, Archive.org

```typescript
interface IPublicDomainCapability {
  /**
   * Determine if book is in public domain and available for free
   */
  checkPublicDomain(isbn: string): Promise<{
    isPublicDomain: boolean;
    availableFormats: string[];  // ['pdf', 'epub', 'txt']
    downloadUrl?: string;        // Direct download link
    lendingStatus?: 'open' | 'dark' | 'restricted';
  } | null>;
}
```

**Value**: Enable free book distribution, highlight available editions

---

#### 4. IPhysicalMetadataCapability
**Source**: ISBNdb Premium, Google Books
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Easy
**Providers**: ISBNdb Premium

```typescript
interface IPhysicalMetadataCapability {
  /**
   * Get physical book properties
   */
  fetchPhysicalMetadata(isbn: string): Promise<{
    pages: number;
    dimensions: {
      height: string;      // "8.5 in"
      width: string;       // "5.5 in"
      thickness: string;   // "1.25 in"
      weight: string;      // "8.5 oz"
    };
    binding: string;       // "Paperback", "Hardcover"
    language: string;
    msrp?: string;        // Original retail price
    currentPrice?: string; // Sale price
  } | null>;
}
```

**Value**: Display detailed product information, inventory management

---

### MEDIUM PRIORITY: Feature Expansion

#### 5. ISeriesCapability
**Source**: Wikidata (P179 series, P1545 ordinal), OpenLibrary (works)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Medium
**Providers**: Wikidata (primary), OpenLibrary (fallback)

```typescript
interface ISeriesCapability {
  /**
   * Get series information and position in series
   */
  fetchSeriesInfo(isbn: string): Promise<{
    seriesName: string;
    position: number;           // Position in series (e.g., 1, 2, 3)
    totalBooks: number;         // Total books in series
    relatedISBNs: string[];     // Other books in series
    seriesUrl?: string;
  } | null>;

  /**
   * Get all books in a series
   */
  fetchSeriesBooks(seriesName: string): Promise<SeriesBook[]>;

  interface SeriesBook {
    isbn: string;
    title: string;
    position: number;
    author: string;
    year: number;
  }
}
```

**Value**: Series browsing, reading order enforcement, series completeness tracking

---

#### 6. IAwardCapability
**Source**: ISBNdb Premium (awards list), Wikidata (P166 award received)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Medium
**Providers**: Wikidata (books), ISBNdb (direct), Wikidata (authors)

```typescript
interface IAwardCapability {
  /**
   * Get awards for a book
   */
  fetchBookAwards(isbn: string): Promise<Award[]>;

  /**
   * Get awards for an author
   */
  fetchAuthorAwards(authorKey: string): Promise<Award[]>;

  interface Award {
    awardName: string;       // "Hugo Award", "Booker Prize"
    year: number;
    category?: string;       // "Best Novel", "Best Short Story"
    winner?: boolean;        // true if won, false if nominated
    prestigeLevel: 'major' | 'moderate' | 'minor';
  }
}
```

**Value**: Highlight prestigious books, author credentials, award winners by year

---

#### 7. ITableOfContentsCapability
**Source**: Archive.org (TOC from metadata), OpenLibrary (table_of_contents)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Medium
**Providers**: Archive.org, OpenLibrary (via detailed jscmd)

```typescript
interface ITableOfContentsCapability {
  /**
   * Get chapter/section structure of book
   */
  fetchTableOfContents(isbn: string): Promise<{
    chapters: Chapter[];
    hasFullText: boolean;      // Can full-text search be performed?
  } | null>;

  interface Chapter {
    title: string;
    level: number;            // Nesting level (0=book, 1=part, 2=chapter, 3=section)
    pageStart?: number;
    pageEnd?: number;
    children?: Chapter[];
  }
}
```

**Value**: Chapter navigation, targeted reading, reference lookup by section

---

#### 8. ITranslationCapability
**Source**: Wikidata (P655 translator, P364 language), OpenLibrary (languages field)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Medium-High
**Providers**: Wikidata (primary)

```typescript
interface ITranslationCapability {
  /**
   * Get all translations of a work
   */
  fetchTranslations(workId: string): Promise<{
    originalLanguage: string;
    originalISBN?: string;
    translations: Translation[];
  } | null>;

  interface Translation {
    isbn: string;
    title: string;
    language: string;
    languageCode: string;      // ISO 639-1
    translator: string;
    publishDate: string;
    publisher: string;
  }
}
```

**Value**: Multilingual catalog, translation metadata, reading in preferred language

---

#### 9. IAuthorBiographyCapability (Enhanced)
**Source**: Wikipedia (full page with sections), Wikidata (biographical properties)
**Current Status**: ⚠️ Partially implemented (basic text only)
**Implementation Difficulty**: Medium
**Providers**: Wikipedia (primary), Wikidata (structured)

```typescript
interface IAuthorBiographyCapability {
  /**
   * Get comprehensive author biography with structure
   */
  fetchComprehensiveBiography(authorKey: string): Promise<{
    name: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    biography: string;         // Main biography text
    sections: BiographySection[];
    categories: string[];      // Wikipedia categories
    relatedAuthors: RelatedAuthor[];
  } | null>;

  interface BiographySection {
    title: string;             // "Early life", "Career", "Awards"
    content: string;
    subsections?: BiographySection[];
  }

  interface RelatedAuthor {
    name: string;
    relationship: 'contemporary' | 'influenced' | 'influenced_by' | 'student_of';
  }
}
```

**Value**: Rich author profiles, literary context, influences and connections

---

#### 10. IEbookCapability
**Source**: Google Books (epub, pdf availability), Archive.org (lending)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: Medium
**Providers**: Google Books, Archive.org

```typescript
interface IEbookCapability {
  /**
   * Check eBook availability and formats
   */
  fetchEbookInfo(isbn: string): Promise<{
    isEbook: boolean;
    formats: EbookFormat[];
    accessLevel: 'full' | 'partial' | 'free' | 'denied';
    preview?: string;          // Preview URL
  } | null>;

  interface EbookFormat {
    format: 'pdf' | 'epub' | 'mobi' | 'azw3';
    downloadUrl?: string;
    accessLevel: 'full' | 'partial' | 'free' | 'preview';
    textToSpeech: boolean;
    copyable: boolean;
  }
}
```

**Value**: eReader compatibility, DRM information, format availability

---

### LOW PRIORITY: Exploratory Features

#### 11. IFullTextCapability
**Source**: Archive.org BookReader API, OpenLibrary Search Inside
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: High
**Providers**: Archive.org (via BookReader), OpenLibrary (Search Inside)

```typescript
interface IFullTextCapability {
  /**
   * Search for text passages within a book
   */
  searchPassages(isbn: string, query: string): Promise<{
    results: PassageMatch[];
    totalMatches: number;
  } | null>;

  interface PassageMatch {
    pageNumber?: number;
    context: string;           // Surrounding text
    matchStart: number;        // Position in context
    matchEnd: number;
  }
}
```

**Value**: Passage lookup, quote verification, research tool

---

#### 12. IAdaptationCapability
**Source**: Wikidata (P144 based_on, P408 adaptation_of, P156 followed_by)
**Current Status**: ❌ Not implemented
**Implementation Difficulty**: High
**Providers**: Wikidata (primary)

```typescript
interface IAdaptationCapability {
  /**
   * Find adaptations of a book (movie, play, musical, etc.)
   */
  fetchAdaptations(workId: string): Promise<{
    originalWork: Work;
    adaptations: Adaptation[];
    sequels: Work[];
    prequels: Work[];
  } | null>;

  interface Adaptation {
    title: string;
    type: 'film' | 'television' | 'play' | 'musical' | 'game' | 'comic';
    year: number;
    creators: string[];
    imdbId?: string;
    wikipediaUrl?: string;
  }
}
```

**Value**: Related media discovery, entertainment value, cross-platform reading

---

#### 13. ISubjectBrowsingCapability (Enhanced)
**Source**: OpenLibrary Subjects API, Wikidata categories
**Current Status**: ⚠️ Partially implemented
**Implementation Difficulty**: Low-Medium
**Providers**: OpenLibrary (primary)

```typescript
interface ISubjectBrowsingCapability {
  /**
   * Browse books by subject/genre with hierarchy
   */
  fetchBooksBySubject(subject: string): Promise<{
    isbns: string[];
    count: number;
    pagination: {
      limit: number;
      offset: number;
    };
  }>;

  /**
   * Get subject hierarchy/taxonomy
   */
  fetchSubjectHierarchy(subject: string): Promise<{
    parent?: string;
    children: string[];
    relatedSubjects: string[];
  } | null>;
}
```

**Value**: Genre navigation, discovery browsing, personalized recommendations

---

#### 14. IExternalIdentifierCapability (Enhanced)
**Source**: ISBNdb (all IDs), OpenLibrary (identifiers), Wikidata (properties)
**Current Status**: ✅ Implemented (basic)
**Implementation Difficulty**: Low
**Providers**: ISBNdb Premium (comprehensive)

```typescript
interface IExternalIdentifierCapability {
  /**
   * Get all external identifiers for a book
   */
  fetchExternalIdentifiers(isbn: string): Promise<{
    amazon?: {
      asin: string;
      url: string;
    };
    goodreads?: {
      bookId: string;
      url: string;
    };
    googleBooks?: {
      volumeId: string;
      url: string;
    };
    openLibrary?: {
      key: string;
      url: string;
    };
    librarything?: {
      workId: string;
      url: string;
    };
    wikidata?: {
      qid: string;
      url: string;
    };
    viaf?: string;
    isni?: string;
  } | null>;
}
```

**Value**: Cross-platform linking, distributed identity management

---

## Implementation Priority Matrix

| Capability | Value | Effort | Priority | Dependencies |
|-----------|-------|--------|----------|--------------|
| IRatingsCapability | ⭐⭐⭐⭐ | 🟢 Easy | 1 | None |
| IEditionCapability | ⭐⭐⭐⭐ | 🟢 Easy | 2 | None |
| IPublicDomainCapability | ⭐⭐⭐⭐ | 🟢 Easy | 3 | None |
| IPhysicalMetadataCapability | ⭐⭐⭐ | 🟢 Easy | 4 | None |
| ISeriesCapability | ⭐⭐⭐⭐⭐ | 🟡 Medium | 5 | None |
| IAwardCapability | ⭐⭐⭐ | 🟡 Medium | 6 | None |
| ITableOfContentsCapability | ⭐⭐⭐⭐ | 🟡 Medium | 7 | None |
| ITranslationCapability | ⭐⭐⭐⭐ | 🟡 Medium | 8 | ISeriesCapability |
| IAuthorBiographyCapability | ⭐⭐⭐⭐ | 🟡 Medium | 9 | None |
| IEbookCapability | ⭐⭐⭐ | 🟡 Medium | 10 | None |
| IFullTextCapability | ⭐⭐ | 🔴 High | 11 | ITableOfContentsCapability |
| IAdaptationCapability | ⭐⭐⭐ | 🔴 High | 12 | None |
| ISubjectBrowsingCapability | ⭐⭐⭐⭐ | 🟢 Easy | 13 | None |
| IExternalIdentifierCapability | ⭐⭐⭐ | 🟢 Easy | 14 | None |

---

## Phase-Based Implementation Plan

### PHASE 1: Quick Wins (Weeks 1-4)
**Effort**: ~40-50 hours
**Goal**: Add high-value, low-effort capabilities

- [ ] **IRatingsCapability** - ISBNdb Premium only
  - Add ratings/reviews to book details
  - Enable recommendation engine
  - **Time**: 8-10 hours

- [ ] **IEditionCapability** - ISBNdb + OpenLibrary
  - Show format variants
  - Enable format selection
  - **Time**: 6-8 hours

- [ ] **IPublicDomainCapability** - Google Books + Archive.org
  - Add free availability indicator
  - Enable free distribution
  - **Time**: 8-10 hours

- [ ] **IPhysicalMetadataCapability** - ISBNdb Premium
  - Display book dimensions/weight
  - Support inventory management
  - **Time**: 4-6 hours

- [ ] **ISubjectBrowsingCapability** - OpenLibrary
  - Add subject browsing endpoint
  - Enable genre navigation
  - **Time**: 6-8 hours

- [ ] **IExternalIdentifierCapability** (Enhanced) - ISBNdb
  - Expand from 2-3 identifiers to 6-8
  - Better cross-linking
  - **Time**: 4-6 hours

**Total Phase 1**: ~36-48 hours

---

### PHASE 2: Feature Expansion (Weeks 5-12)
**Effort**: ~80-100 hours
**Goal**: Add semantic and relationship capabilities

- [ ] **ISeriesCapability** - Wikidata + OpenLibrary
  - Implement series detection
  - Series reading order
  - **Time**: 16-20 hours

- [ ] **IAwardCapability** - ISBNdb + Wikidata
  - Book awards tracking
  - Author awards/credentials
  - **Time**: 12-16 hours

- [ ] **ITableOfContentsCapability** - Archive.org + OpenLibrary
  - Chapter-level navigation
  - Section-based search
  - **Time**: 14-18 hours

- [ ] **ITranslationCapability** - Wikidata
  - Translation discovery
  - Multilingual catalog
  - **Time**: 18-22 hours

- [ ] **IAuthorBiographyCapability** (Enhanced) - Wikipedia + Wikidata
  - Rich author profiles
  - Literary connections
  - **Time**: 16-20 hours

- [ ] **IEbookCapability** - Google Books + Archive.org
  - eBook format detection
  - Download link aggregation
  - **Time**: 14-18 hours

**Total Phase 2**: ~90-114 hours

---

### PHASE 3: Advanced Features (Weeks 13+)
**Effort**: ~120-160 hours
**Goal**: Implement complex discovery and search features

- [ ] **IFullTextCapability** - Archive.org + OpenLibrary
  - Passage search within books
  - Quote verification
  - **Time**: 40-50 hours

- [ ] **IAdaptationCapability** - Wikidata
  - Movie/play/game adaptations
  - Related media discovery
  - **Time**: 30-40 hours

- [ ] **Advanced Query Optimizations**
  - Caching strategies for Wikidata
  - Rate limit management
  - Batch operations
  - **Time**: 20-30 hours

**Total Phase 3**: ~90-120 hours

---

## Integration Strategy

### Provider Capability Matrix (After Full Implementation)

```
Capability                  | OpenLibrary | Google Books | Archive.org | Wikidata | Wikipedia | ISBNdb
----------------------------|-------------|--------------|-------------|----------|-----------|-------
ISBNResolution              | ✅          | ✅           | ⚠️          | ✅       | ❌        | ✅✅
Metadata                    | ✅✅        | ✅           | ✅          | ✅       | ❌        | ✅✅
Cover                       | ✅          | ✅✅         | ✅          | ⚠️       | ❌        | ✅
Subject (Browse)            | ✅✅        | ❌           | ✅          | ✅       | ❌        | ✅
Biography (Author)          | ✅          | ❌           | ❌          | ✅       | ✅✅      | ❌
BookGeneration              | ❌          | ❌           | ❌          | ❌       | ❌        | ❌
---NEW CAPABILITIES---       |             |              |             |          |           |
Ratings                     | ❌          | ✅           | ✅          | ❌       | ❌        | ✅✅
Edition (Formats)           | ✅          | ❌           | ❌          | ✅       | ❌        | ✅✅
PublicDomain               | ❌          | ✅           | ✅          | ❌       | ❌        | ❌
PhysicalMetadata           | ⚠️          | ✅           | ⚠️          | ❌       | ❌        | ✅✅
Series                     | ✅          | ❌           | ❌          | ✅✅     | ⚠️        | ❌
Award                      | ❌          | ❌           | ✅          | ✅✅     | ❌        | ✅
TableOfContents            | ⚠️          | ❌           | ✅✅        | ❌       | ❌        | ❌
Translation                | ⚠️          | ❌           | ❌          | ✅✅     | ❌        | ❌
AuthorBiography (Enhanced) | ✅          | ❌           | ❌          | ✅       | ✅✅      | ❌
Ebook                      | ❌          | ✅✅         | ✅          | ❌       | ❌        | ❌
FullText                   | ❌          | ❌           | ✅✅        | ❌       | ❌        | ❌
Adaptation                 | ❌          | ❌           | ❌          | ✅✅     | ❌        | ❌
SubjectBrowsing (Enhanced) | ✅✅        | ❌           | ✅          | ✅       | ❌        | ✅
ExternalIdentifier (Enhanced) | ✅       | ❌           | ❌          | ✅       | ❌        | ✅✅
```

---

## Technical Implementation Notes

### Registration Pattern

```typescript
// Phase 1: After quick wins implementation
import { getGlobalRegistry } from './lib/external-services/provider-registry.js';
import { OpenLibraryProvider, GoogleBooksProvider, ArchiveOrgProvider,
         WikidataProvider, WikipediaProvider, ISBNdbProvider } from './providers/index.js';

const registry = getGlobalRegistry();
registry.registerAll([
  new OpenLibraryProvider(),
  new GoogleBooksProvider(),
  new ArchiveOrgProvider(),
  new WikidataProvider(),
  new WikipediaProvider(),
  new ISBNdbProvider(),
]);

// Capabilities now available:
provider.hasCapability('ratings');           // ISBNdb only
provider.hasCapability('editions');          // ISBNdb + OpenLibrary
provider.hasCapability('publicDomain');      // Google Books + Archive.org
provider.hasCapability('physicalMetadata');  // ISBNdb
provider.hasCapability('series');            // Wikidata + OpenLibrary
provider.hasCapability('awards');            // Wikidata + ISBNdb
provider.hasCapability('tableOfContents');   // Archive.org + OpenLibrary
provider.hasCapability('translation');       // Wikidata
provider.hasCapability('authorBiography');   // Wikipedia + Wikidata
provider.hasCapability('ebook');             // Google Books + Archive.org
```

### Orchestrator Pattern (Example: Series Discovery)

```typescript
class SeriesOrchestrator {
  async detectSeries(isbn: string, context: ServiceContext): Promise<Series | null> {
    // Try Wikidata first (most complete)
    let series = await this.tryWikidata(isbn, context);
    if (series) return series;

    // Fallback to OpenLibrary
    series = await this.tryOpenLibrary(isbn, context);
    if (series) return series;

    return null;
  }

  private async tryWikidata(isbn: string, context: ServiceContext): Promise<Series | null> {
    const provider = this.registry.getProviderWithCapability('series', 'wikidata');
    if (!provider) return null;

    const capability = provider.getCapability('series');
    return capability.fetchSeriesInfo(isbn);
  }

  private async tryOpenLibrary(isbn: string, context: ServiceContext): Promise<Series | null> {
    const provider = this.registry.getProviderWithCapability('series', 'openlibrary');
    if (!provider) return null;

    const capability = provider.getCapability('series');
    return capability.fetchSeriesInfo(isbn);
  }
}
```

---

## Risk Assessment

### High-Risk Items

1. **Wikidata SPARQL complexity** - Queries can timeout on large datasets
   - Mitigation: Implement result caching, query optimization, pagination

2. **Rate limit conflicts** - Multiple new providers hitting limits
   - Mitigation: Implement priority queuing, graceful degradation

3. **Data quality variability** - Community-edited sources less reliable
   - Mitigation: Add confidence scores, source attribution, user feedback

### Medium-Risk Items

1. **Archive.org API reliability** - Non-profit infrastructure
   - Mitigation: Add retry logic, fallback providers

2. **Series detection false positives** - Wikidata may incorrectly identify series
   - Mitigation: Implement human review workflow for edge cases

3. **Translation data incompleteness** - Wikidata may not have all translations
   - Mitigation: Combine with OpenLibrary, accept partial results

### Low-Risk Items

1. **ISBNdb cost increases** - Currently stable at $29.95/month
2. **Google Books API changes** - Stable, long-term commitment by Google
3. **OpenLibrary uptime** - Reliable non-profit infrastructure

---

## Success Metrics

### Phase 1 Success Criteria
- [ ] 4+ new capabilities deployed
- [ ] Zero regression in existing search functionality
- [ ] < 10ms additional latency per request
- [ ] > 95% hit rate for new capabilities on top 1000 books

### Phase 2 Success Criteria
- [ ] Series detection working for > 80% of book series
- [ ] Award metadata available for > 60% of books
- [ ] Translation metadata available for > 40% international books
- [ ] Table of contents available for > 30% of books

### Phase 3 Success Criteria
- [ ] Full-text search operational with < 2s response time
- [ ] Adaptation discovery for > 50% of classic/popular books
- [ ] User engagement metrics improve by > 25%

---

## Documentation Requirements

For each new capability, create:

1. **API Endpoint Documentation** - In `docs/api/`
2. **Implementation Guide** - In `docs/development/`
3. **Provider Configuration** - In provider documentation
4. **Usage Examples** - In code examples
5. **Performance Benchmarks** - Rate limit and latency data
6. **Error Handling** - Graceful degradation patterns

---

## Conclusion

Alexandria's Service Provider Framework provides a solid foundation for capability expansion. The proposed 14 new capabilities represent a 2-3x increase in discoverable metadata while maintaining the existing architectural patterns (registry, capability interfaces, orchestrators, graceful degradation).

**Quick Wins (Phase 1)** can be completed in 4-6 weeks with minimal risk, delivering immediate user value through ratings, edition variants, and public domain detection.

**Feature Expansion (Phase 2)** requires more coordination but adds powerful semantic capabilities (series, awards, translations) that differentiate Alexandria from generic book APIs.

**Advanced Features (Phase 3)** represent a long-term investment in discovery and research capabilities that position Alexandria as a premier book metadata platform.

---

## References

- Primary Research: `/docs/research/PROVIDER-API-CAPABILITIES-2026.md`
- Current Architecture: `/docs/development/SERVICE_PROVIDER_GUIDE.md`
- Implementation Status: `task_plan.md`
