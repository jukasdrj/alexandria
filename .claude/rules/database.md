# Database Rules for Alexandria

These rules are automatically loaded when working with database-related tasks.

## Query Guidelines

1. **Always use `edition_isbns` table for ISBN lookups** - It's indexed and optimized (49.3M rows)
2. **Never modify OpenLibrary core tables** - They are read-only source of truth
3. **Test queries in psql first** - Use `/db-query` before implementing in Worker
4. **Use parameterized queries** - Prevent SQL injection in all Worker code

## Performance Targets

- ISBN lookup: < 50ms (indexed)
- Title search: < 200ms (trigram fuzzy)
- Author search: < 300ms (joins)
- Cover serving: < 150ms (R2 + edge cache)

## Table Reference

**Core Tables (Read-Only)**:
- `editions` (54.8M rows)
- `works` (40.1M rows)
- `authors` (14.7M rows)
- `edition_isbns` (49.3M rows) - USE THIS FOR ISBN QUERIES
- `author_works` (42.8M rows)

**Enriched Tables (Alexandria-specific)**:
- `enriched_works`
- `enriched_editions`
- `enriched_authors`

## pg_trgm Fuzzy Search

- Use `%` operator: `WHERE title % 'search term'`
- Use `similarity()` function: `similarity(title, 'search term')`
- Default threshold: 0.3 (30% similarity)
