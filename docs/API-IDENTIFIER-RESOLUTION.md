# Identifier Resolution API

## Overview

Alexandria provides an identifier resolution service that maps external authority identifiers (VIAF, ISNI) to Wikidata Q-IDs. This enables author discovery through standardized global identifiers.

## Supported Identifier Systems

| System | Full Name | Format | Example |
|--------|-----------|--------|---------|
| VIAF | Virtual International Authority File | Numeric ID | `97113511` |
| ISNI | International Standard Name Identifier | 16-digit (with optional spaces/dashes) | `0000 0001 2144 1970` |

## Endpoint

### POST /api/authors/resolve-identifier

Resolves a VIAF or ISNI identifier to a Wikidata Q-ID.

**Request Body:**
```json
{
  "type": "viaf",
  "id": "97113511"
}
```

**Response (Success):**
```json
{
  "identifier_type": "viaf",
  "identifier_value": "97113511",
  "wikidata_id": "Q39829",
  "author_name": "King, Stephen, 1947-",
  "source": "viaf",
  "cached": false,
  "resolution_method": "viaf_linked_data"
}
```

**Response (Not Found):**
```json
{
  "identifier_type": "viaf",
  "identifier_value": "99999999",
  "wikidata_id": null,
  "source": "wikidata_sparql",
  "cached": false,
  "resolution_method": "wikidata_sparql_lookup"
}
```

## Resolution Methods

The service tries multiple strategies to resolve identifiers:

### 1. Primary Resolution (VIAF/ISNI Linked Data)

- **VIAF**: Queries `https://viaf.org/viaf/{id}/viaf.json` for linked data
- **ISNI**: Queries `https://isni.org/isni/{id}` for RDF/JSON-LD

If the VIAF/ISNI record contains a `schema:sameAs` or `owl:sameAs` link to Wikidata, we extract the Q-ID directly.

### 2. Fallback Resolution (Wikidata SPARQL)

If the primary method doesn't return a Wikidata link, the service queries Wikidata SPARQL directly:

**VIAF → Wikidata:**
```sparql
SELECT ?author ?authorLabel WHERE {
  ?author wdt:P214 "97113511".
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

**ISNI → Wikidata:**
```sparql
SELECT ?author ?authorLabel WHERE {
  ?author wdt:P213 "0000000121441970".
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

**Wikidata Properties:**
- `P214`: VIAF ID
- `P213`: ISNI

## Caching

- **Success**: Cached for 30 days
- **Failure**: Cached for 1 day
- **Cache key**: `identifier:{type}:{normalized_id}`

## Examples

### Example 1: VIAF → Wikidata (Stephen King)

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/resolve-identifier' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "viaf",
    "id": "97113511"
  }'
```

**Response:**
```json
{
  "identifier_type": "viaf",
  "identifier_value": "97113511",
  "wikidata_id": "Q39829",
  "author_name": "King, Stephen, 1947-",
  "source": "viaf",
  "cached": false,
  "resolution_method": "viaf_linked_data"
}
```

### Example 2: ISNI → Wikidata (Douglas Adams)

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/resolve-identifier' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "isni",
    "id": "0000 0001 2144 1970"
  }'
```

**Response:**
```json
{
  "identifier_type": "isni",
  "identifier_value": "0000 0001 2144 1970",
  "wikidata_id": "Q42",
  "author_name": "Douglas Adams",
  "source": "isni",
  "cached": false,
  "resolution_method": "isni_linked_data"
}
```

### Example 3: VIAF with prefix normalization

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/resolve-identifier' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "viaf",
    "id": "viaf:97113511"
  }'
```

The service automatically normalizes the ID to `97113511` (removes the `viaf:` prefix).

### Example 4: ISNI with dashes

```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/authors/resolve-identifier' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "isni",
    "id": "0000-0001-2144-1970"
  }'
```

The service automatically normalizes to `0000 0001 2144 1970` (removes dashes, formats with spaces).

## Error Handling

### Invalid Identifier Format

**Request:**
```json
{
  "type": "viaf",
  "id": "not-a-number"
}
```

**Response (400):**
```json
{
  "error": "Invalid identifier format",
  "message": "Invalid VIAF ID format: not-a-number"
}
```

### API Failure

If both VIAF/ISNI and Wikidata APIs fail, returns HTTP 500:

```json
{
  "error": "Failed to resolve identifier",
  "message": "VIAF API error 500: Internal Server Error"
}
```

## Use Cases

### 1. Author Discovery via External Catalogs

Many library systems and bibliographic databases use VIAF/ISNI. This endpoint allows you to:

1. Find an author's VIAF/ISNI from a catalog record
2. Resolve to Wikidata Q-ID
3. Use Q-ID to enrich Alexandria with biographical data

### 2. Deduplication

Different sources may refer to the same author with different identifiers. By mapping to Wikidata, you can:

- Detect duplicates (multiple records → same Q-ID)
- Merge author records
- Maintain canonical Wikidata IDs

### 3. Bibliography Expansion

For authors discovered through VIAF/ISNI but not yet in Alexandria:

1. Resolve identifier → Wikidata Q-ID
2. Use Q-ID to fetch author details from Wikidata
3. Enrich Alexandria database
4. Fetch bibliography from ISBNdb

## Rate Limits

- **VIAF**: No official limit, but be respectful (~1 req/sec recommended)
- **ISNI**: No official limit, but be respectful (~1 req/sec recommended)
- **Wikidata SPARQL**: 1 req/sec (enforced client-side)

The service includes built-in retry logic and fallbacks.

## Database Integration

After running migration `004_add_viaf_isni_identifiers.sql`, the `enriched_authors` table includes:

- `viaf_id TEXT` - VIAF identifier (numeric)
- `isni TEXT` - ISNI identifier (16 digits with spaces)
- Indexes on both columns for fast lookups

### Seeding from OpenLibrary

The migration automatically seeds VIAF/ISNI from OpenLibrary's `authors.data->'remote_ids'`:

```sql
SELECT author_key, name, viaf_id, isni, wikidata_id
FROM enriched_authors
WHERE viaf_id IS NOT NULL OR isni IS NOT NULL
LIMIT 10;
```

## Architecture

```
User Request
    ↓
POST /api/authors/resolve-identifier
    ↓
1. Check KV Cache (30-day TTL)
    ↓ (cache miss)
2. Primary Resolution
    ├─→ VIAF JSON API (viaf.org/viaf/{id}/viaf.json)
    └─→ ISNI RDF API (isni.org/isni/{id})
    ↓
3. Extract Wikidata Q-ID from linked data
    ↓ (if not found)
4. Fallback: Wikidata SPARQL
    └─→ Query by VIAF/ISNI property
    ↓
5. Cache result in KV
    ↓
6. Return response
```

## Testing

Run unit tests:
```bash
cd worker/
npm test -- services/__tests__/identifier-resolver.test.ts
```

All 15 tests should pass, covering:
- VIAF resolution
- ISNI resolution
- ID normalization
- Wikidata SPARQL fallback
- Caching behavior
- Error handling

## See Also

- [Wikidata VIAF Property (P214)](https://www.wikidata.org/wiki/Property:P214)
- [Wikidata ISNI Property (P213)](https://www.wikidata.org/wiki/Property:P213)
- [VIAF API Documentation](https://www.oclc.org/developer/api/oclc-apis/viaf.en.html)
- [ISNI Technical Documentation](https://isni.org/page/technical-documentation/)
