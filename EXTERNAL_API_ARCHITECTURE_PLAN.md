# External API Architecture Modernization Plan

**Date**: 2026-01-11
**Status**: Planning Phase
**Estimated Effort**: 8-12 days

---

## Executive Summary

Alexandria's external API integration system exhibits significant code duplication, tight coupling, and scattered responsibilities. The backfill system has revealed critical fragility points. This plan proposes a **Service Provider Framework** that extends the existing `IBookResolver` pattern to all capabilities, eliminating duplication and enabling easy addition/removal of external services.

---

## Current State Analysis

### External Services (7)

1. **ISBNdb** - Paid, quota-limited (13K/day), batch endpoint (1000 ISBNs/call)
2. **Gemini AI** - Book metadata generation via structured output
3. **Google Books** - Free metadata/covers (1 req/sec)
4. **OpenLibrary** - Free ISBN resolution (1 req/3sec, 100 req/5min)
5. **Archive.org** - Free covers/metadata for pre-2000 books (1 req/sec)
6. **Wikipedia** - Author biographies with Wikidata QID resolution (1 req/sec)
7. **Wikidata** - SPARQL queries for comprehensive metadata (2 req/sec)

### Critical Issues Identified

#### 1. Massive Code Duplication (60+ LOC per service)

**Evidence**:
- **Rate Limiting**: 5+ different implementations
- **Caching Logic**: 7 duplicated implementations
- **Error Handling**: 7 repeated try-catch patterns
- **Metadata Transformation**: 7+ custom mappings
- **API Client Setup**: 7 sets of boilerplate

**Examples**:
- `archive-org.ts:163-168`: Custom User-Agent + retry config
- `batch-isbndb.ts:108-114`: Custom Authorization + headers
- `google-books.ts:217-228`: Duplicate rate limit + User-Agent setup

#### 2. Hard-Coded Service Discovery

**Impact**:
- `cover-fetcher.ts` manually calls each provider in sequence
- `resolution-orchestrator.ts` hard-codes resolver chain
- Adding/removing providers requires editing **5+ files**
- Cannot A/B test provider chains
- Cannot dynamically route based on availability

#### 3. Scattered Quota Management

**Issues**:
- `async-backfill.ts` has custom quota logic
- `cover-fetcher.ts` imports its own `QuotaManager`
- `batch-isbndb.ts` bypasses quota checks
- No centralized enforcement → risk of quota exhaustion

#### 4. No Service Capability Contracts

**Problems**:
- Services don't declare what they offer
- Workflows must manually know which service supports which operation
- No runtime capability negotiation
- Missing abstraction layer for service metadata

---

## Proposed Solution: Service Provider Framework

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│          ServiceProviderRegistry                     │
│  - Register services with capabilities               │
│  - Runtime service discovery                         │
│  - getByCapability(), getAvailableProviders()       │
└─────────────────────────────────────────────────────┘
           ▲                    ▲                    ▲
           │                    │                    │
    ┌──────┴──────┐      ┌─────┴──────┐     ┌──────┴──────┐
    │ IISBNResolver│      │ICoverProvider│   │IMetadataProvider│
    │   Interface  │      │   Interface  │   │   Interface     │
    └──────┬──────┘      └─────┬──────┘     └──────┬──────┘
           │                    │                    │
    ┌──────┴──────┐      ┌─────┴──────┐     ┌──────┴──────┐
    │ OpenLibrary │      │ Archive.org│     │ Google Books│
    │   Provider  │      │  Provider  │     │   Provider  │
    └─────────────┘      └────────────┘     └─────────────┘
```

### Core Components

#### 1. Capability-Based Interfaces

**Location**: `worker/lib/external-services/capabilities.ts`

```typescript
/**
 * Base capability interface - all services implement at minimum
 */
export interface IServiceProvider {
  readonly name: string;
  readonly providerType: 'free' | 'paid' | 'ai';
  readonly capabilities: ServiceCapability[];
  isAvailable(env: Env): Promise<boolean>;
}

/**
 * Service capabilities enum
 */
export enum ServiceCapability {
  ISBN_RESOLUTION = 'isbn-resolution',
  METADATA_ENRICHMENT = 'metadata-enrichment',
  COVER_IMAGES = 'cover-images',
  AUTHOR_BIOGRAPHY = 'author-biography',
  SUBJECT_ENRICHMENT = 'subject-enrichment',
  BOOK_GENERATION = 'book-generation',
}

/**
 * ISBN Resolution capability
 */
export interface IISBNResolver extends IServiceProvider {
  resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult>;
}

/**
 * Metadata Enrichment capability
 */
export interface IMetadataProvider extends IServiceProvider {
  fetchMetadata(
    isbn: string,
    context: ServiceContext
  ): Promise<BookMetadata | null>;

  batchFetchMetadata?(
    isbns: string[],
    context: ServiceContext
  ): Promise<Map<string, BookMetadata>>;
}

/**
 * Cover Image capability
 */
export interface ICoverProvider extends IServiceProvider {
  fetchCover(
    isbn: string,
    context: ServiceContext
  ): Promise<CoverResult | null>;
}

/**
 * Author Biography capability
 */
export interface IAuthorBiographyProvider extends IServiceProvider {
  fetchBiography(
    authorKey: string,
    context: ServiceContext
  ): Promise<AuthorBiography | null>;
}

/**
 * Subject/Genre Enrichment capability
 */
export interface ISubjectProvider extends IServiceProvider {
  fetchSubjects(
    isbn: string,
    context: ServiceContext
  ): Promise<string[]>;
}
```

#### 2. Unified Service Context

**Location**: `worker/lib/external-services/service-context.ts`

```typescript
/**
 * Unified context passed to all service providers
 * Eliminates parameter duplication across service calls
 */
export interface ServiceContext {
  env: Env;
  logger: Logger;
  quotaManager?: QuotaManager;
  cacheStrategy?: 'read-write' | 'read-only' | 'write-only' | 'disabled';
  rateLimitStrategy?: 'enforce' | 'log-only' | 'disabled';
  timeoutMs?: number;
}
```

#### 3. Service Provider Registry

**Location**: `worker/lib/external-services/provider-registry.ts`

```typescript
/**
 * Central registry for all external service providers
 * Enables runtime service discovery and capability-based routing
 */
export class ServiceProviderRegistry {
  private providers: Map<string, IServiceProvider> = new Map();

  /**
   * Register a service provider
   */
  register(provider: IServiceProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Get providers by capability
   */
  getByCapability<T extends IServiceProvider>(
    capability: ServiceCapability
  ): T[] {
    return Array.from(this.providers.values())
      .filter(p => p.capabilities.includes(capability)) as T[];
  }

  /**
   * Get available providers (check API keys, quota)
   */
  async getAvailableProviders<T extends IServiceProvider>(
    capability: ServiceCapability,
    context: ServiceContext
  ): Promise<T[]> {
    const providers = this.getByCapability<T>(capability);
    const available: T[] = [];

    for (const provider of providers) {
      if (await provider.isAvailable(context.env)) {
        available.push(provider);
      }
    }

    return available;
  }
}
```

#### 4. Unified HTTP Client

**Location**: `worker/lib/external-services/http-client.ts`

```typescript
/**
 * Unified HTTP client with built-in rate limiting, caching, retry logic
 * Eliminates boilerplate from individual service implementations
 */
export class ServiceHttpClient {
  constructor(
    private readonly providerName: string,
    private readonly config: HttpClientConfig
  ) {}

  async fetch<T>(
    url: string,
    options: RequestInit,
    context: ServiceContext
  ): Promise<T | null> {
    // 1. Check cache (if enabled)
    if (context.cacheStrategy !== 'write-only' && context.cacheStrategy !== 'disabled') {
      const cached = await this.getFromCache<T>(url, context);
      if (cached) return cached;
    }

    // 2. Enforce rate limit (if enabled)
    if (context.rateLimitStrategy === 'enforce') {
      await this.enforceRateLimit(context);
    }

    // 3. Execute request with retry logic
    const response = await fetchWithRetry(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent': buildUserAgent(this.providerName, this.config.purpose),
      },
    }, {
      maxRetries: this.config.maxRetries ?? 3,
      timeoutMs: context.timeoutMs ?? this.config.defaultTimeout ?? 15000,
    });

    if (!response.ok) {
      context.logger.warn('HTTP request failed', {
        provider: this.providerName,
        url,
        status: response.status,
      });
      return null;
    }

    const data = await response.json() as T;

    // 4. Cache response (if enabled)
    if (context.cacheStrategy !== 'read-only' && context.cacheStrategy !== 'disabled') {
      await this.saveToCache(url, data, context);
    }

    return data;
  }

  private async enforceRateLimit(context: ServiceContext): Promise<void> {
    await enforceRateLimit(
      context.env.CACHE,
      buildRateLimitKey(this.providerName),
      this.config.rateLimitMs,
      context.logger
    );
  }

  private async getFromCache<T>(url: string, context: ServiceContext): Promise<T | null> {
    const cacheKey = buildCacheKey(this.providerName, 'http', url);
    return getCachedResponse<T>(context.env.CACHE, cacheKey, context.logger);
  }

  private async saveToCache<T>(url: string, data: T, context: ServiceContext): Promise<void> {
    const cacheKey = buildCacheKey(this.providerName, 'http', url);
    await setCachedResponse(
      context.env.CACHE,
      cacheKey,
      data,
      this.config.cacheTtlSeconds,
      context.logger
    );
  }
}
```

#### 5. Example Service Provider Implementation

**Location**: `worker/lib/external-services/providers/open-library-provider.ts`

```typescript
/**
 * OpenLibrary Service Provider
 * Implements ISBN resolution and metadata enrichment
 */
export class OpenLibraryProvider implements IISBNResolver, IMetadataProvider {
  readonly name = 'open-library';
  readonly providerType = 'free' as const;
  readonly capabilities = [
    ServiceCapability.ISBN_RESOLUTION,
    ServiceCapability.METADATA_ENRICHMENT,
  ];

  private client = new ServiceHttpClient('open-library', {
    rateLimitMs: 3000, // 1 req per 3 seconds
    cacheTtlSeconds: 604800, // 7 days
    purpose: 'Book metadata enrichment and ISBN resolution',
  });

  async isAvailable(_env: Env): Promise<boolean> {
    return true; // Free service, always available
  }

  async resolveISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    const metadata = await this.searchByTitleAuthor(title, author, context);

    if (!metadata?.isbns?.length) {
      return { isbn: null, confidence: 0, source: 'open-library' };
    }

    // Validate match before returning
    const validated = await this.validateISBN(metadata.isbns[0], title, author, context);

    return validated
      ? { isbn: metadata.isbns[0], confidence: metadata.confidence, source: 'open-library' }
      : { isbn: null, confidence: 0, source: 'open-library' };
  }

  async fetchMetadata(
    isbn: string,
    context: ServiceContext
  ): Promise<BookMetadata | null> {
    const url = `https://openlibrary.org/search.json?isbn=${isbn}`;
    const data = await this.client.fetch<OpenLibrarySearchResponse>(url, {}, context);

    if (!data?.docs?.[0]) return null;

    return this.transformToStandardMetadata(data.docs[0]);
  }

  // Private helper methods...
}
```

#### 6. Workflow Orchestration

**Location**: `worker/lib/external-services/orchestrators/`

```typescript
/**
 * ISBN Resolution Orchestrator - Uses registry instead of hard-coded chain
 */
export class ISBNResolutionOrchestrator {
  constructor(private registry: ServiceProviderRegistry) {}

  async findISBN(
    title: string,
    author: string,
    context: ServiceContext
  ): Promise<ISBNResolutionResult> {
    // Get available ISBN resolvers from registry
    const resolvers = await this.registry.getAvailableProviders<IISBNResolver>(
      ServiceCapability.ISBN_RESOLUTION,
      context
    );

    context.logger.info('Starting ISBN resolution', {
      title,
      author,
      availableResolvers: resolvers.map(r => r.name),
    });

    // Try each resolver until one succeeds
    for (const resolver of resolvers) {
      try {
        const result = await resolver.resolveISBN(title, author, context);

        if (result.isbn) {
          context.logger.info('ISBN resolved', {
            title,
            author,
            isbn: result.isbn,
            resolver: resolver.name,
            confidence: result.confidence,
          });
          return result;
        }
      } catch (error) {
        context.logger.warn('Resolver failed', {
          resolver: resolver.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { isbn: null, confidence: 0, source: 'not_found' };
  }
}

/**
 * Cover Fetcher Orchestrator - Uses registry instead of hard-coded chain
 */
export class CoverFetchOrchestrator {
  constructor(private registry: ServiceProviderRegistry) {}

  async fetchBestCover(
    isbn: string,
    context: ServiceContext
  ): Promise<CoverResult | null> {
    // Get available cover providers from registry
    const providers = await this.registry.getAvailableProviders<ICoverProvider>(
      ServiceCapability.COVER_IMAGES,
      context
    );

    // Try each provider in order
    for (const provider of providers) {
      try {
        const cover = await provider.fetchCover(isbn, context);
        if (cover) return cover;
      } catch (error) {
        context.logger.warn('Cover provider failed', {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }
}
```

---

## Benefits Quantified

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **LOC per service** | ~400-600 | ~200-300 | 50% reduction |
| **Files to modify (add service)** | 5+ | 2 | 60% reduction |
| **Files to modify (remove service)** | 5+ | 1 | 80% reduction |
| **Rate limiting implementations** | 7 | 1 | 85% reduction |
| **Caching implementations** | 7 | 1 | 85% reduction |
| **Testability** | Mock 7 services | Mock 1 registry | Massive improvement |
| **Configuration-driven chains** | No | Yes | Feature unlock |

---

## Implementation Roadmap

### Phase 1: Core Infrastructure (1-2 days)

- [ ] Create `worker/lib/external-services/capabilities.ts`
  - [ ] Define `IServiceProvider` base interface
  - [ ] Define `ServiceCapability` enum
  - [ ] Define capability-specific interfaces (`IISBNResolver`, `IMetadataProvider`, etc.)
- [ ] Create `worker/lib/external-services/service-context.ts`
  - [ ] Define `ServiceContext` interface
- [ ] Create `worker/lib/external-services/provider-registry.ts`
  - [ ] Implement `ServiceProviderRegistry` class
  - [ ] Add `register()`, `getByCapability()`, `getAvailableProviders()` methods
- [ ] Create `worker/lib/external-services/http-client.ts`
  - [ ] Implement `ServiceHttpClient` class
  - [ ] Integrate rate limiting from `open-api-utils.ts`
  - [ ] Integrate caching from `open-api-utils.ts`
  - [ ] Integrate retry logic from `fetch-utils.ts`
- [ ] Write unit tests for all core components

### Phase 2: Migrate Existing Services (3-4 days)

- [ ] Create `worker/lib/external-services/providers/` directory
- [ ] Migrate **OpenLibrary**
  - [ ] Create `open-library-provider.ts`
  - [ ] Implement `IISBNResolver` interface
  - [ ] Implement `IMetadataProvider` interface
  - [ ] Port logic from `services/open-library.ts`
- [ ] Migrate **Google Books**
  - [ ] Create `google-books-provider.ts`
  - [ ] Implement `ICoverProvider` interface
  - [ ] Implement `IMetadataProvider` interface
  - [ ] Implement `ISubjectProvider` interface
  - [ ] Port logic from `services/google-books.ts`
- [ ] Migrate **Archive.org**
  - [ ] Create `archive-org-provider.ts`
  - [ ] Implement `ICoverProvider` interface
  - [ ] Implement `IMetadataProvider` interface
  - [ ] Port logic from `services/archive-org.ts`
- [ ] Migrate **Wikidata**
  - [ ] Create `wikidata-provider.ts`
  - [ ] Implement `IMetadataProvider` interface
  - [ ] Implement `ICoverProvider` interface
  - [ ] Port SPARQL logic from `services/wikidata.ts`
- [ ] Migrate **Wikipedia**
  - [ ] Create `wikipedia-provider.ts`
  - [ ] Implement `IAuthorBiographyProvider` interface
  - [ ] Port logic from `services/wikipedia.ts`
- [ ] Migrate **ISBNdb**
  - [ ] Create `isbndb-provider.ts`
  - [ ] Implement `IISBNResolver` interface
  - [ ] Implement `IMetadataProvider` interface
  - [ ] Implement `ICoverProvider` interface
  - [ ] Integrate with `QuotaManager`
  - [ ] Port logic from `services/batch-isbndb.ts`
- [ ] Migrate **Gemini**
  - [ ] Create `gemini-provider.ts`
  - [ ] Implement `IBookGenerator` interface (new)
  - [ ] Port logic from `src/services/gemini-backfill.ts`

### Phase 3: Update Workflows (2-3 days)

- [ ] Create `worker/lib/external-services/orchestrators/` directory
- [ ] **ISBN Resolution Orchestrator**
  - [ ] Create `isbn-resolution-orchestrator.ts`
  - [ ] Port logic from `src/services/book-resolution/resolution-orchestrator.ts`
  - [ ] Use registry for dynamic resolver discovery
- [ ] **Cover Fetch Orchestrator**
  - [ ] Create `cover-fetch-orchestrator.ts`
  - [ ] Port logic from `services/cover-fetcher.ts`
  - [ ] Use registry for dynamic provider discovery
- [ ] **Metadata Enrichment Orchestrator**
  - [ ] Create `metadata-enrichment-orchestrator.ts`
  - [ ] Extract logic from `src/services/enrichment-service.ts`
  - [ ] Use registry for provider fallback chain
- [ ] **Author Enrichment Orchestrator**
  - [ ] Create `author-enrichment-orchestrator.ts`
  - [ ] Extract logic from `src/services/author-service.ts`
  - [ ] Use registry for biography providers
- [ ] **Update Backfill Pipeline**
  - [ ] Update `src/services/async-backfill.ts`
  - [ ] Replace direct service calls with orchestrator calls
- [ ] **Update Queue Handlers**
  - [ ] Update `src/services/queue-handlers.ts`
  - [ ] Replace direct service calls with orchestrator calls

### Phase 4: Testing & Validation (1-2 days)

- [ ] **Unit Tests**
  - [ ] Test each provider implementation in isolation
  - [ ] Mock `ServiceHttpClient` for provider tests
  - [ ] Test registry registration and discovery
- [ ] **Integration Tests**
  - [ ] Test orchestrators with mocked registry
  - [ ] Test full workflow (backfill pipeline)
  - [ ] Validate quota enforcement
- [ ] **Performance Benchmarks**
  - [ ] Compare response times vs current implementation
  - [ ] Measure cache hit rates
  - [ ] Validate rate limiting enforcement
- [ ] **End-to-End Tests**
  - [ ] Run backfill job with new orchestrators
  - [ ] Verify database writes
  - [ ] Check queue processing

### Phase 5: Documentation & Cleanup (1 day)

- [ ] **Documentation**
  - [ ] Write service provider developer guide
  - [ ] Document migration guide for future services
  - [ ] Update `CLAUDE.md` with new architecture
  - [ ] Add API reference for core components
- [ ] **Cleanup**
  - [ ] Delete old service files in `worker/services/`
  - [ ] Remove deprecated orchestrators
  - [ ] Clean up imports across codebase
  - [ ] Archive migration notes

---

## Quick Wins (Can Do Today)

1. **Standardize Logger Usage**
   - Replace all `console.log/error/warn` with injected `Logger`
   - Files: All services in `worker/services/`

2. **Centralize User-Agent**
   - Remove local `USER_AGENT` constants
   - Always use `buildUserAgent()` from `open-api-utils.ts`

3. **Consolidate QuotaManager**
   - Merge all quota logic into `src/services/quota-manager.ts`
   - Remove custom implementations in `async-backfill.ts`, `cover-fetcher.ts`

---

## Long-Term Strategic Opportunities

1. **Configuration-Driven Orchestration**
   - Move provider priority chains to config/KV
   - Enable A/B testing of different provider sequences
   - Allow runtime adjustments without deployments

2. **Declarative API Client Generation**
   - Use OpenAPI/Swagger specs to auto-generate clients
   - Improve type safety for API interactions
   - Reduce manual schema maintenance

3. **Comprehensive API Monitoring**
   - Add latency, success rate, error code metrics per provider
   - Integrate with Cloudflare Analytics Engine
   - Create dashboards for API health

4. **Automated Quota Alerts**
   - Enhance `QuotaManager` with alert thresholds
   - Send Slack/PagerDuty alerts when approaching limits
   - Proactive intervention before quota exhaustion

---

## Migration Strategy

### Parallel Run Approach (Recommended)

1. **Build new framework alongside existing code**
   - No disruption to current workflows
   - Can test in isolation

2. **Feature flag for new providers**
   - Gradual rollout per service
   - Easy rollback if issues arise

3. **Deprecation timeline**
   - Phase 2: Mark old services as `@deprecated`
   - Phase 3: Switch orchestrators to new providers
   - Phase 5: Remove old code

### Incremental Migration Approach (Lower Risk)

1. **Start with one service (e.g., OpenLibrary)**
   - Build complete framework around single provider
   - Validate approach before scaling

2. **Add services one at a time**
   - Lower cognitive load
   - Easier debugging

3. **Parallel run for extended period**
   - Keep old + new systems until confidence high
   - Longer timeline, but safer

---

## Success Criteria

- [ ] All 7 services migrated to provider framework
- [ ] 60%+ reduction in code duplication
- [ ] Adding new service requires ≤2 file changes
- [ ] Zero performance regression vs current implementation
- [ ] All quota enforcement centralized
- [ ] Registry-driven orchestration for all workflows
- [ ] Comprehensive test coverage (>80%)
- [ ] Documentation complete and reviewed

---

## Risk Mitigation

**Risk**: Performance regression from abstraction layers
**Mitigation**: Benchmark early, optimize ServiceHttpClient if needed

**Risk**: Breaking existing workflows during migration
**Mitigation**: Parallel run approach, extensive integration tests

**Risk**: Complexity increase for simple services
**Mitigation**: ServiceHttpClient eliminates boilerplate, net reduction in complexity

**Risk**: Team unfamiliar with new patterns
**Mitigation**: Comprehensive documentation, pair programming during migration

---

## Next Actions

1. **Review and approve this plan**
2. **Commit plan to repository**
3. **Start Phase 1 (Core Infrastructure)**
4. **Schedule kickoff meeting for implementation**

---

**Plan prepared by**: Claude Code (Sonnet 4.5)
**Analysis agent**: PAL MCP Analyze (Gemini 2.5 Flash)
**Review status**: Pending approval
