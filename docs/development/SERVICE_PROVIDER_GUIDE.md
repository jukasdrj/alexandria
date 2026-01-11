# Service Provider Developer Guide

**Version**: 1.0
**Last Updated**: January 2026
**Framework**: External Services Provider Framework

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

- **60% LOC Reduction**: Eliminates boilerplate across 7 providers
- **Easy Extensibility**: Adding a new service requires ≤2 file changes
- **Performance Optimized**: Sub-10ms initialization, <5ms registry lookups
- **Worker-Safe**: Designed for Cloudflare Workers constraints

---

## Quick Start

### Adding a New Provider (5 Steps)

**Example**: Integrating LibraryThing API

#### 1. Create Provider File

```typescript
// worker/lib/external-services/providers/librarything-provider.ts

import type { IMetadataProvider, BookMetadata } from '../capabilities.js';
import type { ServiceContext } from '../service-context.js';
import type { Env } from '../../../src/env.js';
import { ServiceHttpClient } from '../http-client.js';
import { ServiceCapability } from '../capabilities.js';
import { normalizeISBN } from '../../isbn-utils.js';

export class LibraryThingProvider implements IMetadataProvider {
  readonly name = 'librarything';
  readonly providerType = 'free' as const;
  readonly capabilities = [ServiceCapability.METADATA_ENRICHMENT];

  private client = new ServiceHttpClient({
    providerName: 'librarything',
    rateLimitMs: 1000, // 1 req/sec
    cacheTtlSeconds: 604800, // 7 days
    purpose: 'Book metadata enrichment',
  });

  async isAvailable(_env: Env): Promise<boolean> {
    return true; // Free service, no API key required
  }

  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    const { logger } = context;

    // Validate ISBN before API call
    const normalizedISBN = normalizeISBN(isbn);
    if (!normalizedISBN) {
      logger.debug('Invalid ISBN format, skipping LibraryThing', { isbn });
      return null;
    }

    try {
      const url = `https://www.librarything.com/api/thingISBN/${normalizedISBN}`;
      const data = await this.client.fetch<LibraryThingResponse>(url, {}, context);

      if (!data) return null;

      // Transform to BookMetadata format
      return {
        title: data.title,
        authors: data.authors,
        isbn13: normalizedISBN,
        subjects: data.subjects,
      };
    } catch (error) {
      logger.error('LibraryThing API error', { isbn, error });
      return null; // Graceful degradation
    }
  }
}

interface LibraryThingResponse {
  title: string;
  authors: string[];
  subjects?: string[];
}
```

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
│  │  (Interfaces)│      │   (7 total)  │      │ (Singleton)│ │
│  └──────────────┘      └──────────────┘      └───────────┘  │
│         │                      │                     │       │
│         │                      ▼                     │       │
│         │              ┌──────────────┐              │       │
│         └─────────────►│ HTTP Client  │◄─────────────┘       │
│                        │ (Unified)    │                      │
│                        └──────────────┘                      │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Orchestrators (3 total)                 │   │
│  │  - ISBN Resolution   - Cover Fetch   - Metadata       │   │
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

- `IISBNResolver`: `resolveISBN(title, author, context)` → ISBN
- `IMetadataProvider`: `fetchMetadata(isbn, context)` → BookMetadata
- `ICoverProvider`: `fetchCover(isbn, context)` → CoverResult
- `ISubjectProvider`: `fetchSubjects(isbn, context)` → string[]
- `IAuthorBiographyProvider`: `fetchBiography(authorKey, context)` → AuthorBiography
- `IBookGenerator`: `generateBooks(prompt, count, context)` → GeneratedBook[]

#### ServiceContext

Shared context passed to all provider methods:

```typescript
interface ServiceContext {
  env: Env;           // Worker environment (bindings)
  logger: Logger;     // Request-scoped logger
  quotaManager?: QuotaManager; // Optional quota tracking
}
```

---

## Creating a Provider

### Step-by-Step Guide

#### 1. Choose Capabilities

Decide which interfaces your provider implements:

```typescript
// Single capability
class MyProvider implements IMetadataProvider { ... }

// Multiple capabilities
class MyProvider implements IMetadataProvider, ICoverProvider { ... }
```

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

- **Providers**: `worker/lib/external-services/providers/`
  - `open-library-provider.ts`
  - `google-books-provider.ts`
  - `archive-org-provider.ts`
  - `wikidata-provider.ts`
  - `wikipedia-provider.ts`
  - `isbndb-provider.ts`
  - `gemini-provider.ts`
  - `index.ts` - Centralized exports

- **Orchestrators**: `worker/lib/external-services/orchestrators/`
  - `isbn-resolution-orchestrator.ts`
  - `cover-fetch-orchestrator.ts`
  - `metadata-enrichment-orchestrator.ts`
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
