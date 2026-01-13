# Service Provider Developer Guide

**Version**: 2.0
**Last Updated**: January 2026
**Framework**: External Services Provider Framework
**Note**: Expanded with 8 new capabilities + 3 orchestrators (Phases 1-3)

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Creating a Provider](#creating-a-provider)
5. [Using Orchestrators](#using-orchestrators)
6. [Testing](#testing)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Overview

Alexandria's Service Provider Framework provides a unified, capability-based architecture for integrating external book metadata services. The framework eliminates code duplication and enables dynamic service discovery through a central registry.

### Key Features

- **Capability-Based Interfaces**: Providers implement only the capabilities they support (ISBN resolution, metadata, covers, etc.)
- **Dynamic Discovery**: Registry pattern eliminates hard-coded service chains
- **Unified HTTP Client**: Centralized rate limiting, caching, and retry logic
- **Graceful Degradation**: All providers return `null` on errors, never throw
- **Quota Management**: Automatic provider filtering based on availability
- **Orchestrators**: Multi-provider coordination for complex workflows

### Benefits

- **60% LOC Reduction**: Eliminates boilerplate across 8 providers
- **Easy Extensibility**: Adding a new service requires ≤2 file changes
- **Performance Optimized**: Sub-10ms initialization, <5ms registry lookups
- **Worker-Safe**: Designed for Cloudflare Workers constraints
- **14 Capabilities**: Comprehensive metadata enrichment (was 6 in v1.0)
- **6 Orchestrators**: Coordinated multi-provider workflows (was 3 in v1.0)

---

## Quick Start

### Adding a New Provider (5 Steps)

**Example**: Integrating LibraryThing thingISBN API for Edition Variants

**Real Implementation**: See `worker/lib/external-services/providers/librarything-provider.ts`

#### 1. Create Provider File

```typescript
// worker/lib/external-services/providers/librarything-provider.ts

import type { IEditionVariantProvider, EditionVariant } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

export class LibraryThingProvider implements IEditionVariantProvider {
  readonly name = 'librarything';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.EDITION_VARIANTS];

  private client = new ServiceHttpClient({
    providerName: 'librarything',
    rateLimitMs: 1000, // 1 req/sec (1,000 req/day limit)
    cacheTtlSeconds: 2592000, // 30 days (edition data is stable)
    purpose: 'Edition disambiguation and variant discovery',
  });

  async isAvailable(env: Env): Promise<boolean> {
    const apiKey = await env.LIBRARYTHING_API_KEY?.get();
    return !!apiKey;
  }

  async fetchEditionVariants(isbn: string, context: ServiceContext): Promise<EditionVariant[]> {
    const { logger, env } = context;

    // Validate ISBN before API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      logger.debug('Invalid ISBN format, skipping LibraryThing', { isbn });
      return [];
    }

    try {
      const apiKey = await env.LIBRARYTHING_API_KEY?.get();
      if (!apiKey) {
        logger.error('LibraryThing API key not configured');
        return [];
      }

      const url = `https://www.librarything.com/api/${apiKey}/thingISBN/${normalizedISBN}`;

      // Fetch XML response
      const xmlResponse = await this.client.fetch<string>(
        url,
        { headers: { 'Accept': 'application/xml, text/xml' } },
        context,
        'text' // Request text response instead of JSON
      );

      if (!xmlResponse) return [];

      // Parse XML to extract related ISBNs
      const relatedISBNs = this.parseThingISBNResponse(xmlResponse);

      // Convert to EditionVariant objects
      return relatedISBNs
        .filter((relatedIsbn) => relatedIsbn !== normalizedISBN)
        .map((relatedIsbn) => ({
          isbn: relatedIsbn,
          format: 'other' as const,
          formatDescription: 'Related edition from LibraryThing',
          source: 'librarything',
        }));
    } catch (error) {
      logger.error('LibraryThing API error', { isbn, error });
      return []; // Graceful degradation
    }
  }

  private parseThingISBNResponse(xml: string): string[] {
    const isbns: string[] = [];
    const isbnRegex = /<isbn>([^<]+)<\/isbn>/gi;
    let match: RegExpExecArray | null;

    while ((match = isbnRegex.exec(xml)) !== null) {
      const isbn = match[1].trim();
      if (isbn) isbns.push(isbn);
    }

    return isbns;
  }
}
```

**Key Points**:
- Implements `IEditionVariantProvider` for edition discovery
- Uses thingISBN API to find related ISBNs (formats, translations)
- Parses XML response (LibraryThing uses XML, not JSON)
- Rate limited to 1 req/sec (1,000/day free tier)
- Community-validated data from 2M+ LibraryThing users

#### 2. Register Provider

```typescript
// worker/lib/external-services/providers/index.ts

export { LibraryThingProvider } from './librarything-provider.js';
```

#### 3. Add to Global Registry (if using)

```typescript
// worker/src/index.ts (or your Worker entry point)

import { getGlobalRegistry } from './lib/external-services/provider-registry.js';
import { LibraryThingProvider } from './lib/external-services/providers/index.js';

// Register on Worker startup
const registry = getGlobalRegistry();
registry.register(new LibraryThingProvider());
```

#### 4. Use in Orchestrator

The orchestrator automatically discovers your provider:

```typescript
import { MetadataEnrichmentOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new MetadataEnrichmentOrchestrator(registry);
const result = await orchestrator.enrichMetadata('9780385544153', context);
// LibraryThing automatically included if available!
```

#### 5. Add Tests

```typescript
// worker/lib/external-services/providers/__tests__/librarything-provider.test.ts

import { describe, it, expect } from 'vitest';
import { LibraryThingProvider } from '../librarything-provider.js';

describe('LibraryThingProvider', () => {
  it('should validate ISBN before API call', async () => {
    const provider = new LibraryThingProvider();
    const result = await provider.fetchMetadata('invalid-isbn', mockContext);
    expect(result).toBeNull();
  });
});
```

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Service Provider Framework                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐  │
│  │ Capabilities │◄─────┤  Providers   │─────►│ Registry  │  │
│  │ (14 total)   │      │   (8 total)  │      │ (Singleton)│ │
│  └──────────────┘      └──────────────┘      └───────────┘  │
│         │                      │                     │       │
│         │                      ▼                     │       │
│         │              ┌──────────────┐              │       │
│         └─────────────►│ HTTP Client  │◄─────────────┘       │
│                        │ (Unified)    │                      │
│                        └──────────────┘                      │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Orchestrators (6 total)                 │   │
│  │  - ISBN Resolution   - Cover Fetch   - Metadata       │   │
│  │  - Ratings           - Public Domain - External IDs   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Interfaces

#### `IServiceProvider` (Base)

All providers implement this:

```typescript
export interface IServiceProvider {
  readonly name: string;
  readonly providerType: 'free' | 'paid' | 'ai';
  readonly capabilities: ServiceCapability[];
  isAvailable(env: Env): Promise<boolean>;
}
```

#### Capability Interfaces

Extend `IServiceProvider` with specific methods:

**Core Capabilities (v1.0)**:
- `IISBNResolver`: `resolveISBN(title, author, context)` → ISBN
- `IMetadataProvider`: `fetchMetadata(isbn, context)` → BookMetadata
- `ICoverProvider`: `fetchCover(isbn, context)` → CoverResult
- `ISubjectProvider`: `fetchSubjects(isbn, context)` → string[]
- `IAuthorBiographyProvider`: `fetchBiography(authorKey, context)` → AuthorBiography
- `IBookGenerator`: `generateBooks(prompt, count, context)` → GeneratedBook[]

**Phase 1 - Quick Wins (Jan 2026)**:
- `IRatingsProvider`: `fetchRatings(isbn, context)` → RatingsResult (average rating, count)
- `IEditionVariantProvider`: `fetchEditionVariants(isbn, context)` → EditionVariant[] (formats: hardcover, paperback, ebook, audiobook)
- `IPublicDomainProvider`: `checkPublicDomain(isbn, context)` → PublicDomainResult (detection + download links)
- `ISubjectBrowsingProvider`: `fetchSubjectHierarchy(subjectId, depth, context)` → SubjectNode[] (hierarchical genres)

**Phase 2 - High-Value (Jan 2026)**:
- `ISeriesProvider`: `fetchSeriesInfo(isbn, context)` → SeriesInfo (series name, position, related ISBNs)
- `IAwardsProvider`: `fetchAwards(isbn, context)` → AwardInfo[] (literary awards, nominations)
- `ITranslationProvider`: `fetchTranslations(isbn, context)` → TranslationInfo[] (editions in other languages)
- `IEnhancedExternalIdProvider`: `fetchEnhancedExternalIds(isbn, context)` → EnhancedExternalIds (comprehensive cross-provider IDs)

#### ServiceContext

Shared context passed to all provider methods:

```typescript
interface ServiceContext {
  env: Env;           // Worker environment (bindings)
  logger: Logger;     // Request-scoped logger
  quotaManager?: QuotaManager; // Optional quota tracking
}
```

### Provider Capabilities Matrix

This table shows which providers support which capabilities:

| Provider | Type | Core Capabilities | Phase 1 Capabilities | Phase 2 Capabilities |
|----------|------|-------------------|----------------------|----------------------|
| **ISBNdb** | Paid | ISBN Resolution, Metadata, Covers, Subjects | **Ratings**, **Edition Variants** | - |
| **Google Books** | Free | ISBN Resolution, Metadata, Covers, Subjects | **Public Domain** | **Enhanced External IDs** |
| **Archive.org** | Free | ISBN Resolution, Metadata, Covers | **Public Domain** | - |
| **Wikidata** | Free | ISBN Resolution, Metadata, Covers | **Subject Browsing** | **Series Info**, **Awards**, **Translations**, **Enhanced External IDs** |
| **OpenLibrary** | Free | ISBN Resolution, Metadata | - | **Enhanced External IDs** |
| **Wikipedia** | Free | Author Biography | - | - |
| **Gemini** | AI | Book Generation | - | - |
| **Xai (Grok)** | AI | Book Generation | - | - |

**Legend**:
- **Core Capabilities**: v1.0 capabilities (6 total)
- **Phase 1**: Quick wins (4 new capabilities)
- **Phase 2**: High-value (4 new capabilities)
- Total: **14 capabilities** across **8 providers**

**Key Observations**:
- Wikidata is the most feature-rich free provider (8 capabilities)
- ISBNdb offers premium features (ratings, edition variants) with quota management
- AI providers (Gemini, Xai) specialize in book generation for backfill
- Google Books + Archive.org provide free public domain detection with downloads

---

## Creating a Provider

### Step-by-Step Guide

#### 1. Choose Capabilities

Decide which interfaces your provider implements. You can mix core capabilities with new Phase 1/2 capabilities:

```typescript
// Single capability
class MyProvider implements IMetadataProvider { ... }

// Multiple capabilities (common pattern)
class MyProvider implements IMetadataProvider, ICoverProvider { ... }

// Phase 1 capabilities
class MyProvider implements IRatingsProvider, IEditionVariantProvider { ... }

// Phase 2 capabilities
class MyProvider implements ISeriesProvider, IAwardsProvider { ... }

// Mix old and new capabilities
class MyProvider implements IMetadataProvider, IRatingsProvider, IEnhancedExternalIdProvider { ... }
```

**Available Capability Interfaces** (14 total):
- **Core (v1.0)**: IISBNResolver, IMetadataProvider, ICoverProvider, ISubjectProvider, IAuthorBiographyProvider, IBookGenerator
- **Phase 1**: IRatingsProvider, IEditionVariantProvider, IPublicDomainProvider, ISubjectBrowsingProvider
- **Phase 2**: ISeriesProvider, IAwardsProvider, ITranslationProvider, IEnhancedExternalIdProvider

#### 2. Implement Required Methods

**Base Requirements**:
- `name`: Unique identifier (lowercase, hyphenated)
- `providerType`: `'free'`, `'paid'`, or `'ai'`
- `capabilities`: Array of `ServiceCapability` enum values
- `isAvailable()`: Check if provider can be used (API key exists, quota available)

**Capability Methods**:
- Implement methods for each capability interface
- Return `null` on errors (graceful degradation)
- Use `normalizeISBN()` for ISBN validation
- Never throw errors to the caller

#### 3. Use ServiceHttpClient

**Do NOT** implement rate limiting, caching, or retries manually:

```typescript
// ❌ BAD: Manual implementation
async fetchMetadata(isbn: string, context: ServiceContext) {
  await enforceRateLimit(context.env.CACHE, 'my-provider', 1000);
  const cached = await getCachedResponse(context.env.CACHE, cacheKey);
  // ... more boilerplate
}

// ✅ GOOD: Use ServiceHttpClient
private client = new ServiceHttpClient({
  providerName: 'my-provider',
  rateLimitMs: 1000,
  cacheTtlSeconds: 604800,
  purpose: 'Book metadata enrichment',
});

async fetchMetadata(isbn: string, context: ServiceContext) {
  const data = await this.client.fetch<MyResponse>(url, {}, context);
  return data ? this.transformResponse(data) : null;
}
```

#### 4. Handle Errors Gracefully

**CRITICAL**: Providers must never throw errors:

```typescript
async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
  try {
    // Your logic
    return metadata;
  } catch (error) {
    context.logger.error('Provider error', { isbn, error });
    return null; // Graceful degradation
  }
}
```

#### 5. Validate Input

Always validate ISBNs before making API calls:

```typescript
import { normalizeISBN } from '../../isbn-utils.js';

const normalizedISBN = normalizeISBN(isbn);
if (!normalizedISBN) {
  logger.debug('Invalid ISBN format', { isbn });
  return null;
}
```

### Provider Template

```typescript
import type { IMetadataProvider, BookMetadata } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

export class TemplateProvider implements IMetadataProvider {
  readonly name = 'template';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.METADATA_ENRICHMENT];

  private client = new ServiceHttpClient({
    providerName: 'template',
    rateLimitMs: 1000,
    cacheTtlSeconds: 604800,
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(env: Env): Promise<boolean> {
    // Free provider: always available
    return true;

    // Paid provider: check API key
    // const apiKey = await env.MY_API_KEY?.get();
    // return !!apiKey;
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    const { logger } = context;

    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      logger.debug('Invalid ISBN format', { isbn });
      return null;
    }

    try {
      const url = `https://api.example.com/books/${normalizedISBN}`;
      const data = await this.client.fetch<ApiResponse>(url, {}, context);

      if (!data) return null;

      return {
        title: data.title,
        authors: data.authors,
        isbn13: normalizedISBN,
        // ... transform other fields
      };
    } catch (error) {
      logger.error('API error', { isbn, error });
      return null;
    }
  }
}

interface ApiResponse {
  title: string;
  authors: string[];
}
```

---

## Using Orchestrators

Orchestrators coordinate multiple providers for complex workflows.

### ISBN Resolution

Cascading fallback chain (paid → free):

```typescript
import { ISBNResolutionOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new ISBNResolutionOrchestrator(registry, {
  providerTimeoutMs: 15000,      // 15s per provider
  enableLogging: true,
  providerOrder: ['isbndb', 'google-books', 'open-library'], // Custom order
});

const result = await orchestrator.resolveISBN('The Hobbit', 'J.R.R. Tolkien', context);
// { isbn: '9780547928227', confidence: 95, source: 'isbndb' }
```

### Cover Fetching

Free-first priority to save quota:

```typescript
import { CoverFetchOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new CoverFetchOrchestrator(registry, {
  providerTimeoutMs: 10000,      // 10s per provider
  preferredSize: 'large',
});

const cover = await orchestrator.fetchCover('9780547928227', context);
// { url: 'https://...', source: 'google-books', size: 'large' }
```

### Metadata Enrichment

Multi-provider aggregation with smart merging:

```typescript
import { MetadataEnrichmentOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new MetadataEnrichmentOrchestrator(registry, {
  enableParallelFetch: true,     // Parallel for speed
  maxSubjectProviders: 3,        // Limit subject sources
});

const result = await orchestrator.enrichMetadata('9780547928227', context);
// {
//   metadata: { title: '...', authors: [...], subjects: [...] },
//   providers: { metadata: ['google-books', 'wikidata'], subjects: ['google-books'] },
//   durationMs: 245
// }
```

### Ratings Orchestrator (NEW - Phase 1)

Cascading fallback for user ratings with quota-aware provider selection:

```typescript
import { RatingsOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new RatingsOrchestrator(registry, {
  stopOnFirstSuccess: true,  // Stop after first success (default)
  providerPriority: ['isbndb', 'google-books', 'open-library', 'wikidata'],
  providerTimeoutMs: 10000,  // 10s timeout per provider
});

const ratings = await orchestrator.fetchRatings('9780385544153', context);
// {
//   averageRating: 4.3,
//   ratingsCount: 1523,
//   source: 'isbndb',
//   confidence: 90
// }
```

**Batch Operations**:
```typescript
const results = await orchestrator.batchFetchRatings(
  ['9780385544153', '9780547928227'],
  context
);
// Map<string, RatingsResult>
```

### Public Domain Orchestrator (NEW - Phase 1)

Detects public domain status with download links:

```typescript
import { PublicDomainOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new PublicDomainOrchestrator(registry, {
  providerPriority: ['google-books', 'archive.org', 'wikidata'],
  stopOnFirstSuccess: true,
  requireDownloadUrl: false,  // Return results even without download URL
});

const result = await orchestrator.checkPublicDomain('9780141439518', context);
// {
//   isPublicDomain: true,
//   confidence: 95,
//   reason: 'publication-date',
//   copyrightExpiry: 1941,
//   downloadUrl: 'https://archive.org/download/...',
//   source: 'archive.org'
// }
```

### External ID Orchestrator (NEW - Phase 2)

Aggregates external identifiers from multiple providers:

```typescript
import { ExternalIdOrchestrator } from './lib/external-services/orchestrators/index.js';

const orchestrator = new ExternalIdOrchestrator(registry, {
  enableParallelFetch: true,  // Fetch from all providers in parallel
  minConfidence: 70,          // Only return IDs with 70%+ confidence
});

const result = await orchestrator.fetchExternalIds('9780385544153', context);
// {
//   amazonAsin: 'B00ICN066A',
//   goodreadsId: '18405684',
//   googleBooksId: 'x-h1AwAAQBAJ',
//   wikidataQid: 'Q13591359',
//   openLibraryWorkKey: '/works/OL17165W',
//   sources: ['isbndb', 'google-books', 'wikidata', 'open-library'],
//   confidence: 85
// }
```

**Batch Operations**:
```typescript
const results = await orchestrator.batchFetchExternalIds(
  ['9780385544153', '9780547928227'],
  context
);
// Map<string, EnhancedExternalIds>
```

---

## Testing

### Unit Tests

Test provider logic with mocks:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MyProvider', () => {
  let provider: MyProvider;
  let mockContext: ServiceContext;

  beforeEach(() => {
    provider = new MyProvider();
    mockContext = {
      env: {} as Env,
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  it('should validate ISBN before API call', async () => {
    const result = await provider.fetchMetadata('invalid-isbn', mockContext);
    expect(result).toBeNull();
    expect(mockContext.logger.debug).toHaveBeenCalledWith(
      'Invalid ISBN format',
      expect.anything()
    );
  });

  it('should handle API errors gracefully', async () => {
    // Test error handling
  });
});
```

### Integration Tests

Test with real providers:

```typescript
describe('Integration: Metadata Enrichment', () => {
  it('should aggregate from multiple providers', async () => {
    const registry = new ServiceProviderRegistry();
    registry.registerAll([
      new GoogleBooksProvider(),
      new WikidataProvider(),
    ]);

    const orchestrator = new MetadataEnrichmentOrchestrator(registry);
    const result = await orchestrator.enrichMetadata('9780385544153', mockContext);

    expect(result.metadata).toBeDefined();
    expect(result.providers.metadata.length).toBeGreaterThan(0);
  });
});
```

### Performance Benchmarks

Validate sub-10ms targets:

```typescript
it('should initialize in <5ms', () => {
  const startTime = performance.now();
  const orchestrator = new ISBNResolutionOrchestrator(registry);
  const duration = performance.now() - startTime;

  expect(orchestrator).toBeDefined();
  expect(duration).toBeLessThan(5);
});
```

---

## Best Practices

### DO ✅

1. **Use `normalizeISBN()`** for all ISBN validation
2. **Return `null` on errors** - never throw to caller
3. **Use `ServiceHttpClient`** - don't implement rate limiting manually
4. **Add JSDoc comments** - document behavior, especially error handling
5. **Test with invalid inputs** - ISBNs with hyphens, wrong length, etc.
6. **Log at appropriate levels**:
   - `debug`: Expected failures (invalid ISBN, provider unavailable)
   - `warn`: Unexpected failures (API timeout, quota exhausted)
   - `error`: Critical failures (network errors, parsing failures)

### DON'T ❌

1. **Don't throw errors** - orchestrators expect `null` on failure
2. **Don't mutate input parameters** - use local variables
3. **Don't hard-code provider chains** - use registry for discovery
4. **Don't skip ISBN validation** - wastes quota on invalid inputs
5. **Don't implement custom retry logic** - `ServiceHttpClient` handles it
6. **Don't use regex without sanitization** - SPARQL/SQL injection risk

### Security Checklist

- [ ] API keys in headers, not URL query strings
- [ ] Input sanitization for SPARQL/SQL queries
- [ ] ISBN validation before API calls
- [ ] No user input directly interpolated into queries
- [ ] Timeout protection on all HTTP calls

---

## Troubleshooting

### Provider Not Discovered

**Symptom**: Orchestrator doesn't use your provider

**Solution**:
1. Check `capabilities` array includes correct `ServiceCapability`
2. Verify provider registered: `registry.get('your-provider')`
3. Check `isAvailable()` returns `true`

### Quota Exhausted

**Symptom**: Paid provider always returns `null`

**Solution**:
1. Check `isAvailable()` implementation (should check quota)
2. Verify registry filters unavailable providers before orchestration
3. Add logging to track quota state

### Slow Performance

**Symptom**: Orchestrator takes >1 second

**Solution**:
1. Check provider timeout settings (default: 10-15s)
2. Verify `enableParallelFetch: true` for metadata enrichment
3. Use performance benchmarks to identify slow providers

### Tests Failing

**Symptom**: Unit tests fail after adding provider

**Solution**:
1. Check mock context has all required fields (`env`, `logger`)
2. Verify provider returns `null` on errors (not throwing)
3. Test with both valid and invalid ISBNs

---

## Reference

### File Locations

- **Core Framework**: `worker/lib/external-services/`
  - `capabilities.ts` - Interface definitions
  - `service-context.ts` - Shared context
  - `provider-registry.ts` - Dynamic discovery
  - `http-client.ts` - Unified HTTP client

- **Providers**: `worker/lib/external-services/providers/` (8 total)
  - `open-library-provider.ts` - Free, ISBN resolution, metadata, external IDs
  - `google-books-provider.ts` - Free, metadata, covers, subjects, public domain, external IDs
  - `archive-org-provider.ts` - Free, covers, metadata, public domain
  - `wikidata-provider.ts` - Free, metadata, covers, subject browsing, series, awards, translations, external IDs
  - `wikipedia-provider.ts` - Free, author biographies
  - `isbndb-provider.ts` - Paid, ISBN resolution, metadata, covers, ratings, edition variants
  - `gemini-provider.ts` - AI, book generation (Google Gemini)
  - `xai-provider.ts` - AI, book generation (x.ai Grok)
  - `index.ts` - Centralized exports

- **Orchestrators**: `worker/lib/external-services/orchestrators/` (6 total)
  - `isbn-resolution-orchestrator.ts` - Cascading ISBN resolution
  - `cover-fetch-orchestrator.ts` - Free-first cover fetching
  - `metadata-enrichment-orchestrator.ts` - Multi-provider aggregation
  - `book-generation-orchestrator.ts` - Concurrent AI book generation (Gemini + Grok)
  - `ratings-orchestrator.ts` - **NEW** User ratings with quota management
  - `public-domain-orchestrator.ts` - **NEW** Public domain detection + download links
  - `external-id-orchestrator.ts` - **NEW** Cross-provider ID aggregation
  - `index.ts` - Centralized exports

- **Tests**: `worker/lib/external-services/__tests__/`
  - `provider-registry.test.ts`
  - `service-context.test.ts`
  - `benchmarks.test.ts`
  - `quota-enforcement.test.ts`
  - `orchestrators/__tests__/` - Orchestrator tests
  - `providers/__tests__/` - Provider tests

### External Resources

- **Planning Document**: `docs/planning/EXTERNAL_API_ARCHITECTURE_PLAN.md`
- **Task Plan**: `task_plan.md`
- **CLAUDE.md**: Architecture overview and quick reference

---

**Need Help?** Check the existing providers for examples or consult the planning document for architectural decisions.
