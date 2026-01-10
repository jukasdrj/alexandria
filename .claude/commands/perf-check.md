---
description: Run comprehensive performance check on API endpoints
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(curl *)
  - Bash(echo *)
---

Test performance of key Alexandria API endpoints.

Think about what endpoints might have performance issues before testing.

## Steps

1. Test health endpoint:
   ```bash
   curl -w "\nTime: %{time_total}s\n" https://alexandria.ooheynerds.com/health
   ```

2. Test ISBN search (indexed lookup):
   ```bash
   curl -w "\nTime: %{time_total}s\n" "https://alexandria.ooheynerds.com/api/search?isbn=9780439064873"
   ```

3. Test title search (trigram fuzzy search):
   ```bash
   curl -w "\nTime: %{time_total}s\n" "https://alexandria.ooheynerds.com/api/search?title=harry%20potter&limit=10"
   ```

4. Test author search (join query):
   ```bash
   curl -w "\nTime: %{time_total}s\n" "https://alexandria.ooheynerds.com/api/search?author=rowling&limit=10"
   ```

5. Test cover endpoint:
   ```bash
   curl -w "\nTime: %{time_total}s\n" -I "https://alexandria.ooheynerds.com/covers/9780439064873/medium"
   ```

## Performance Targets

- Health: < 100ms
- ISBN search: < 50ms (indexed)
- Title search: < 200ms (trigram)
- Author search: < 300ms (joins)
- Cover serving: < 150ms (R2 + edge cache)

Report any endpoints exceeding targets.
