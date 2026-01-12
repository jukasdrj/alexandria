# Error Handling Guidelines

## Overview

This document defines Alexandria's standardized error handling patterns to ensure consistent debugging, monitoring, and user experience across the codebase.

## Core Principles

1. **Always use Logger, never console.*** - Console logs don't appear in production Workers
2. **Log before throwing** - Capture context before error propagates
3. **Use APIError in routes** - Ensures consistent error responses
4. **Return null for graceful degradation** - Providers should never throw
5. **Structured logging** - Include context, not just messages

## When to Throw vs Return Null

### THROW Errors When:

**Invalid Input (Validation Errors)**
```typescript
import { APIError, ErrorCode } from '../../middleware/error-handler.js';

if (!isValidISBN(isbn)) {
  throw new APIError(ErrorCode.VALIDATION_ERROR, 'Invalid ISBN format', { isbn });
}
```

**Critical Failures (Database Errors)**
```typescript
try {
  await sql`INSERT INTO enriched_editions ...`;
} catch (error) {
  logger.error('Database insert failed', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    isbn
  });
  throw new Error(`Database operation failed: ${error instanceof Error ? error.message : String(error)}`);
}
```

**Unrecoverable Errors (Missing Requirements)**
```typescript
if (!env.ISBNDB_API_KEY) {
  throw new APIError(ErrorCode.INTERNAL_ERROR, 'ISBNdb API key not configured');
}
```

**Route Handlers (Caught by errorHandler)**
```typescript
app.openapi(route, async (c) => {
  const { isbn } = c.req.valid('param');
  const logger = c.get('logger');

  if (!isbn) {
    throw new APIError(ErrorCode.VALIDATION_ERROR, 'ISBN required');
  }

  const result = await enrichEdition(sql, isbn, logger);
  return c.json({ success: true, data: result });
});
```

### RETURN null When:

**Optional External API Calls Fail**
```typescript
async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
  try {
    const response = await fetch(`https://api.provider.com/books/${isbn}`);
    if (!response.ok) {
      context.logger.warn('Provider API returned non-OK status', {
        provider: 'provider-name',
        isbn,
        status: response.status
      });
      return null;
    }
    return await response.json();
  } catch (error) {
    context.logger.warn('Provider API call failed', {
      provider: 'provider-name',
      isbn,
      error: error instanceof Error ? error.message : String(error)
    });
    return null; // Orchestrator will try next provider
  }
}
```

**Resource Not Found is Valid Outcome**
```typescript
async function findWork(sql: Sql, workKey: string, logger: Logger): Promise<Work | null> {
  try {
    const result = await sql`SELECT * FROM works WHERE work_key = ${workKey}`;
    return result[0] || null; // Not found is not an error
  } catch (error) {
    logger.error('Database query failed', {
      error: error instanceof Error ? error.message : String(error),
      workKey
    });
    throw error; // Database failures should throw
  }
}
```

**Graceful Degradation Preferred**
```typescript
// Cover fetch falls back to next provider
const coverUrl = await fetchFromGoogle(isbn, context);
if (!coverUrl) {
  // Try OpenLibrary instead
  return await fetchFromOpenLibrary(isbn, context);
}
```

## Error Logging Patterns

### BAD - Console Usage ❌
```typescript
try {
  await operation();
} catch (error) {
  console.error('Operation failed:', error);
  throw error;
}
```

### GOOD - Logger with Structured Context ✅
```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context: { isbn, operation: 'enrichment', provider: 'isbndb' }
  });
  throw new Error(`Operation failed: ${error instanceof Error ? error.message : String(error)}`);
}
```

### Logging Severity Levels

**error** - Critical failures that prevent operations
```typescript
logger.error('Database connection failed', {
  error: error.message,
  stack: error.stack,
  database: 'openlibrary'
});
```

**warn** - Non-critical issues, graceful degradation
```typescript
logger.warn('Provider API unavailable, falling back', {
  provider: 'wikidata',
  isbn,
  fallback: 'archive-org'
});
```

**info** - Successful operations, important milestones
```typescript
logger.info('Enrichment complete', {
  isbn,
  provider: 'isbndb',
  quality_score: 85,
  duration_ms: 342
});
```

**debug** - Detailed execution flow (disabled in production)
```typescript
logger.debug('Cache hit', {
  key: `isbn:${isbn}`,
  ttl_remaining: 3600
});
```

## Route Error Handling

### Using APIError Class

```typescript
import { APIError, ErrorCode } from '../../middleware/error-handler.js';

// Not Found
throw new APIError(ErrorCode.NOT_FOUND, 'ISBN not found in database', { isbn });

// Validation Error
throw new APIError(ErrorCode.VALIDATION_ERROR, 'Invalid ISBN format', {
  isbn,
  expected: '13 digits'
});

// Rate Limit
throw new APIError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many requests', {
  limit: 100,
  window: '1 minute'
});

// Provider Error
throw new APIError(ErrorCode.PROVIDER_ERROR, 'ISBNdb API unavailable', {
  provider: 'isbndb',
  status: 503
});

// Database Error
throw new APIError(ErrorCode.DATABASE_ERROR, 'Query timeout', {
  query: 'SELECT enriched_editions',
  timeout_ms: 30000
});
```

### Error Response Format

All errors are caught by `errorHandler` middleware and formatted as:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "ISBN not found in database",
    "details": {
      "isbn": "9780000000000"
    }
  },
  "meta": {
    "timestamp": "2026-01-12T10:30:00Z",
    "request_id": "abc-123-def"
  }
}
```

## Provider Error Handling

### Providers MUST Return null, Never Throw

```typescript
export class ExampleProvider implements IMetadataProvider {
  async fetchMetadata(isbn: string, context: ServiceContext): Promise<BookMetadata | null> {
    try {
      // Implementation
      const response = await fetch(...);
      if (!response.ok) {
        context.logger.warn('Provider returned error', {
          provider: this.name,
          isbn,
          status: response.status
        });
        return null;
      }
      return parseResponse(response);
    } catch (error) {
      context.logger.warn('Provider request failed', {
        provider: this.name,
        isbn,
        error: error instanceof Error ? error.message : String(error)
      });
      return null; // Let orchestrator handle fallback
    }
  }
}
```

### Why Providers Return null

- **Orchestrators control retry logic** - Provider shouldn't decide fallback strategy
- **Graceful degradation** - One provider failure doesn't fail entire enrichment
- **Predictable behavior** - Callers know to check for null, not catch exceptions
- **Cleaner code** - No nested try/catch blocks

## Queue Handler Error Handling

### Message Processing Pattern

```typescript
for (const message of batch.messages) {
  try {
    const { isbn } = message.body;

    // Process message
    await processEnrichment(isbn, env, logger);

    // Success - acknowledge message
    message.ack();
    results.processed++;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Message processing failed', {
      isbn: message.body.isbn,
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined
    });

    // Retry on transient failures
    if (isTransientError(error)) {
      message.retry();
      results.retried++;
    } else {
      // Permanent failure - ack to avoid infinite retries
      message.ack();
      results.failed++;
      results.errors.push({ isbn: message.body.isbn, error: errorMsg });
    }
  }
}
```

### Transient vs Permanent Errors

**Transient (should retry):**
- Network timeouts
- 503 Service Unavailable
- Database connection failures
- Temporary quota exhaustion

**Permanent (should ack):**
- 404 Not Found
- 400 Bad Request (invalid data)
- Validation failures
- Data not in provider's database

## Service Layer Error Handling

### Database Operations

```typescript
async function enrichEdition(
  sql: Sql,
  edition: EnrichEditionRequest,
  logger: Logger
): Promise<EnrichmentData> {
  const startTime = Date.now();

  try {
    const result = await sql`INSERT INTO enriched_editions ...`;

    logger.info('Edition enriched successfully', {
      isbn: edition.isbn,
      duration_ms: Date.now() - startTime
    });

    return { isbn: result.isbn, action: 'created' };

  } catch (error) {
    logger.error('enrichEdition database error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      isbn: edition.isbn,
      duration_ms: Date.now() - startTime
    });

    throw new Error(
      `Database operation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

### External API Calls

```typescript
async function fetchFromISBNdb(isbn: string, env: Env, logger: Logger): Promise<BookMetadata | null> {
  try {
    const response = await fetch(`https://api.isbndb.com/book/${isbn}`, {
      headers: { 'Authorization': env.ISBNDB_API_KEY },
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (response.status === 404) {
      logger.debug('ISBN not found in ISBNdb', { isbn });
      return null; // Not an error, just not in database
    }

    if (!response.ok) {
      logger.warn('ISBNdb API error', {
        isbn,
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }

    const data = await response.json();
    return normalizeISBNdbResponse(data);

  } catch (error) {
    logger.warn('ISBNdb fetch failed', {
      isbn,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
```

## Exception Cases

### Migration Scripts

Migration scripts (`worker/src/routes/migrate.ts`) MAY use `console.*` for CLI output:

```typescript
// ✅ Acceptable in migration scripts
console.log('[Migration 003] Starting execution...');
console.log('[Migration 003] ✓ Columns added');
console.error('[Migration 003] Full error:', error);
```

Add comment explaining why:
```typescript
// Console output for CLI visibility (migration scripts run via Wrangler, not production)
console.log('[Migration 003] Starting execution...');
```

### Test Files

Test files (`__tests__/**`) MAY use `console.*` for debugging:

```typescript
// ✅ Acceptable in tests
console.log('🔥 Running smoke tests in CI against:', BASE_URL);
```

### Development Scripts

Scripts in `worker/scripts/` MAY use `console.*` for CLI output.

## ESLint Configuration

Prevent console usage in production code:

```json
{
  "rules": {
    "no-console": ["error", { "allow": [] }]
  },
  "overrides": [
    {
      "files": ["**/__tests__/**", "**/*.test.ts", "**/scripts/**", "**/routes/migrate.ts"],
      "rules": {
        "no-console": "off"
      }
    }
  ]
}
```

## Common Anti-Patterns

### ❌ Don't: Silent Failures
```typescript
try {
  await operation();
} catch (error) {
  // Silent failure - debugging nightmare
}
```

### ✅ Do: Log and Handle
```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  // Decide: throw, return null, or retry
  throw error;
}
```

### ❌ Don't: Generic Error Messages
```typescript
throw new Error('Something went wrong');
```

### ✅ Do: Descriptive Messages with Context
```typescript
throw new APIError(
  ErrorCode.PROVIDER_ERROR,
  'ISBNdb API call failed after 3 retries',
  { isbn, attempts: 3, last_error: 'timeout' }
);
```

### ❌ Don't: Logging Sensitive Data
```typescript
logger.error('Auth failed', {
  api_key: env.ISBNDB_API_KEY, // ❌ Exposes secret
  password: user.password        // ❌ Security risk
});
```

### ✅ Do: Redact Sensitive Information
```typescript
logger.error('Auth failed', {
  api_key_prefix: env.ISBNDB_API_KEY.substring(0, 8) + '...', // ✅ Safe
  user_id: user.id                                             // ✅ Non-sensitive
});
```

## Monitoring & Debugging

### Production Debugging

```bash
# View live logs
npm run tail

# Filter by error severity
npm run tail | grep ERROR

# View specific request
npm run tail | grep "request_id:abc-123"
```

### Structured Logging Benefits

- **Searchable** - Query by isbn, provider, operation
- **Filterable** - Error vs warning vs info
- **Traceable** - Follow request_id through pipeline
- **Analyzable** - Export to observability tools (Datadog, Sentry)

## Summary Checklist

- [ ] Use Logger, never console.* (except tests/migrations)
- [ ] Log errors with structured context before throwing
- [ ] Use APIError in routes for consistent responses
- [ ] Return null from providers for graceful degradation
- [ ] Include error, stack, and context in logs
- [ ] Choose appropriate log level (error/warn/info/debug)
- [ ] Don't log sensitive data (API keys, passwords)
- [ ] Test error paths, not just happy paths
- [ ] Document exception cases (migrations, tests)
- [ ] Configure ESLint to prevent console usage

---

**Version:** 1.0.0
**Last Updated:** 2026-01-12
**Maintained By:** Alexandria Team
**Related:** [CLAUDE.md](../../CLAUDE.md), [SERVICE_PROVIDER_GUIDE.md](./SERVICE_PROVIDER_GUIDE.md)
