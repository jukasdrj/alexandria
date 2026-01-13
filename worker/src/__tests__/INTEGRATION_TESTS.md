# Integration Tests Guide

## Overview

The backfill scheduler test suite includes comprehensive **PostgreSQL advisory lock contention integration tests** that validate real concurrent lock behavior under load.

## Test Coverage

### Advisory Lock Contention Tests

**Location**: `worker/src/__tests__/backfill-scheduler.test.ts` (lines 1071-1488)

**Coverage**:
1. ✅ Concurrent lock acquisition (3 workers, same month) - only 1 succeeds
2. ✅ Lock release enables next worker to acquire lock
3. ✅ Automatic lock release on connection close
4. ✅ `withMonthLock` wrapper ensures cleanup on error
5. ✅ Concurrent locks for different months (all succeed)
6. ✅ Lock timeout behavior (returns false without throwing)
7. ✅ `isMonthLocked()` utility function validation
8. ✅ `getAllAdvisoryLocks()` debugging utility validation

## Running Integration Tests

### Prerequisites

1. **PostgreSQL database** (local or remote)
2. **HYPERDRIVE_CONNECTION_STRING** environment variable

### Quick Start

```bash
# Set connection string (replace with your database URL)
export HYPERDRIVE_CONNECTION_STRING="postgresql://user:password@localhost:5432/database"

# Run all tests (including integration tests)
npm test

# Run only backfill scheduler tests
npm test backfill-scheduler
```

### Running Without Database

If `HYPERDRIVE_CONNECTION_STRING` is **not set**, integration tests are automatically **skipped** (using Vitest's `it.skipIf()` API).

```bash
# No database connection - integration tests skipped
npm test

# Output: ⏭️  Skipping advisory lock integration tests - HYPERDRIVE_CONNECTION_STRING not set
```

### Using Local PostgreSQL

```bash
# Start PostgreSQL (Docker)
docker run -d \
  --name postgres-test \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:15

# Set connection string
export HYPERDRIVE_CONNECTION_STRING="postgresql://postgres:testpass@localhost:5432/testdb"

# Run tests
npm test backfill-scheduler

# Clean up
docker stop postgres-test && docker rm postgres-test
```

### Using Alexandria Production Database

```bash
# SSH tunnel to Unraid (if needed)
ssh -L 5432:localhost:5432 root@Tower.local

# Use Alexandria's Hyperdrive connection string
export HYPERDRIVE_CONNECTION_STRING="$HYPERDRIVE_CONNECTIONSTRING"

# Run tests
npm test backfill-scheduler
```

**⚠️ WARNING**: Integration tests create and release advisory locks on real database. While locks are automatically cleaned up, avoid running tests during active backfill operations.

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - run: npm ci
      - run: npm test
        env:
          HYPERDRIVE_CONNECTION_STRING: postgresql://postgres:testpass@localhost:5432/testdb
```

## Test Characteristics

### Performance
- **Lock acquisition**: 3 concurrent attempts with 5s timeout
- **Lock timeout test**: 200ms timeout validation
- **Lock release**: Immediate (< 10ms)
- **Total suite time**: ~10-15 seconds (with database)

### Idempotency
- ✅ Tests use unique year-month combinations to avoid conflicts
- ✅ All locks released in `finally` blocks
- ✅ Connection cleanup via `Promise.allSettled()` (never throws)
- ✅ Can run multiple times without interference

### Concurrency Safety
- ✅ Multiple database connections simulate real Worker instances
- ✅ Advisory locks tested under true parallel execution
- ✅ No mocks - real PostgreSQL `pg_try_advisory_lock()` calls
- ✅ Validates timeout, release, auto-cleanup behavior

## Debugging Failed Tests

### Common Issues

**Issue**: Tests timeout or hang
```bash
# Check for orphaned locks
psql -U postgres -d testdb -c "SELECT * FROM pg_locks WHERE locktype = 'advisory';"

# Release all advisory locks (force cleanup)
psql -U postgres -d testdb -c "SELECT pg_advisory_unlock_all();"
```

**Issue**: Connection refused
```bash
# Verify PostgreSQL is running
docker ps | grep postgres

# Check connection string format
echo $HYPERDRIVE_CONNECTION_STRING
# Should be: postgresql://user:password@host:port/database
```

**Issue**: Permission denied
```bash
# Ensure user has CONNECT privilege
psql -U postgres -d testdb -c "GRANT ALL ON DATABASE testdb TO your_user;"
```

### Verbose Logging

Enable detailed test output:

```bash
# Vitest verbose mode
npm test -- --reporter=verbose

# Check advisory lock activity in database logs
docker logs postgres-test --follow
```

## Architecture Notes

### Why Integration Tests?

**Unit tests** (mocked SQL) **cannot validate**:
- ❌ Real lock contention under concurrent load
- ❌ PostgreSQL session-scoped lock lifecycle
- ❌ Automatic cleanup on connection close
- ❌ Lock timeout behavior with retry loops

**Integration tests** (real database) **validate**:
- ✅ Only 1 worker acquires lock for same month
- ✅ Lock released after processing enables next worker
- ✅ Automatic release when connection closes (no explicit unlock)
- ✅ Timeout returns `false` without throwing (graceful degradation)

### Test Strategy

**Unit tests**: Business logic, status transitions, retry counts
**Integration tests**: Advisory lock semantics, concurrent execution, database connection lifecycle

Both test types run in CI/CD pipeline, with integration tests automatically skipped if database unavailable.

## Test Maintenance

### Adding New Lock Tests

```typescript
it.skipIf(!shouldRunIntegrationTests)(
  'your test description',
  async () => {
    const postgres = (await import('postgres')).default;
    const { acquireMonthLock, releaseMonthLock } = await import('../services/advisory-locks.js');

    const sql = postgres(process.env.HYPERDRIVE_CONNECTION_STRING!, {
      max: 1,
      fetch_types: false,
      prepare: false,
    });

    try {
      // Test logic
      const locked = await acquireMonthLock(sql, 2020, 11, 5000);
      expect(locked).toBe(true);

      // ... assertions ...

      await releaseMonthLock(sql, 2020, 11);
    } finally {
      await sql.end();
    }
  }
);
```

### Month Selection

**Use unique year-month combinations to avoid test conflicts**:
- Test 1: 2020-01 (202001)
- Test 2: 2020-02 (202002)
- Test 3: 2020-03 (202003)
- ...
- Test 10: 2020-10 (202010)

This ensures tests can run in parallel without lock contention.

## References

- **Advisory Locks Implementation**: `worker/src/services/advisory-locks.ts`
- **Async Backfill Consumer**: `worker/src/services/async-backfill.ts` (lines 224-258)
- **PostgreSQL Docs**: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
- **Vitest Conditional Tests**: https://vitest.dev/api/#test-skipif

## Success Criteria

✅ **All 8 integration tests pass** when database available
✅ **Tests gracefully skip** when `HYPERDRIVE_CONNECTION_STRING` unset
✅ **No orphaned locks** after test completion
✅ **< 15 seconds** total suite execution time
✅ **Idempotent** - can run multiple times without cleanup

---

**Last Updated**: January 13, 2026
**Author**: Claude Code (Alexandria Task Orchestrator)
