# Implementation Plan: Cross-Repo Contract Testing (Alexandria)

**Date**: January 3, 2026
**Status**: Planning
**Related Issue**: #90

## Goal

Export Alexandria's Hono app type to enable bendv3 to use Hono RPC client (`hc`) for type-safe API consumption and contract testing.

## Context

- Alexandria is a Cloudflare Worker API (54M+ books, OpenLibrary database)
- Built with `@hono/zod-openapi`, TypeScript, exports OpenAPI spec at `/openapi.json`
- Current version: 2.1.0 (published as npm package "alexandria-worker")
- Main entry: `worker/src/index.ts`
- OpenAPI config: `worker/src/openapi.ts`

## Requirements

1. Export the app type from `worker/src/index.ts` as `AlexandriaAppType`
2. Ensure the type is properly exported in `package.json`
3. Consider versioning strategy for breaking changes
4. Document the exported type for consumers

## Implementation Plan

### Phase 1: Type Consolidation

#### 1. Modify `worker/src/index.ts`

Re-export all public types from the root `types.ts` file. This unifies the `AlexandriaAppType` (the Hono app instance) with the Zod schemas and interface definitions (SearchQuery, BookResult, etc.) into a single importable module.

**Action**:
```typescript
// Add to end of worker/src/index.ts
export * from '../types.js';
```

#### 2. Update `worker/package.json`

**Changes**:
- **Types Field**: Change `"types": "types.ts"` to `"types": "src/index.ts"`. This ensures that when a consumer imports the package, TypeScript looks at the main entry point (which now includes all types) instead of the partial `types.ts` file.
- **Version**: Bump to `2.2.1`.

**Rationale**: This makes the package's type exports consistent with its runtime exports, improving developer experience for consumers.

### Phase 2: Documentation & Verification

#### 3. Create `worker/README-CONTRACT-TESTING.md`

Document the usage pattern for `hc` (Hono Client) with examples for configuring the client with the generic `AlexandriaAppType`.

**Contents**:
```markdown
# Contract Testing with Alexandria

## Setup

Install the Alexandria worker package:

```bash
npm install alexandria-worker@latest
```

## Usage with Hono RPC Client

```typescript
import { hc } from 'hono/client';
import type { AlexandriaAppType } from 'alexandria-worker';

// Create type-safe client
const alexandria = hc<AlexandriaAppType>('https://alexandria.ooheynerds.com');

// Fully typed API calls
const books = await alexandria.api.search.$get({
  query: { isbn: '9780439064873' }
});

const result = await alexandria.api.enrich['batch-direct'].$post({
  json: { isbns: ['9780439064873'], source: 'bendv3' }
});
```

## Benefits

- ✅ Compile-time validation (catches breaking changes before deploy)
- ✅ Full autocomplete in VS Code
- ✅ No schema duplication
- ✅ No codegen step needed
```

#### 4. Create Verification Script

Create `worker/scripts/validate-export.ts` to simulate an external consumer importing the types and setting up a typed client.

**Purpose**: Verify that type exports work correctly before publishing to npm.

```typescript
// worker/scripts/validate-export.ts
import type { AlexandriaAppType } from '../src/index.js';
import { hc } from 'hono/client';

// This should compile without errors
const client = hc<AlexandriaAppType>('http://localhost:8787');

console.log('✅ Type exports validated successfully');
```

**Run with**:
```bash
npx tsx worker/scripts/validate-export.ts
```

## Constraints

- Must not break existing API functionality
- Should work with Alexandria's current OpenAPI setup
- Need to maintain backward compatibility

## Versioning Strategy

### Semantic Versioning

- **Patch** (2.2.x): Bug fixes, documentation, internal refactoring
- **Minor** (2.x.0): New endpoints, new optional fields, type exports
- **Major** (x.0.0): Breaking changes to existing endpoints, removed endpoints, changed response schemas

### Breaking Changes

When introducing breaking changes:
1. Deprecate old endpoint/field in minor version
2. Run both old and new in parallel for at least one minor version
3. Remove deprecated code in next major version
4. Document migration path in CHANGELOG.md

## Testing Checklist

- [ ] Type exports compile without errors
- [ ] `validate-export.ts` runs successfully
- [ ] OpenAPI spec at `/openapi.json` remains valid
- [ ] Existing API tests pass
- [ ] README-CONTRACT-TESTING.md is clear and accurate

## Success Criteria

1. ✅ bendv3 can import `AlexandriaAppType` and use Hono RPC client
2. ✅ TypeScript catches breaking changes at compile time
3. ✅ Documentation is clear for external consumers
4. ✅ No regression in existing API functionality

## Next Steps

After Alexandria implementation:
1. Publish `alexandria-worker@2.2.1` to npm (or link locally)
2. Update bendv3 to consume new types
3. Implement contract tests in bendv3
4. Set up CI/CD checks for contract validation

## Related Files

- `worker/src/index.ts` - Main entry point
- `worker/package.json` - Package configuration
- `worker/types.ts` - Type definitions
- `worker/src/openapi.ts` - OpenAPI configuration
- `docs/API-SEARCH-ENDPOINTS.md` - API documentation
