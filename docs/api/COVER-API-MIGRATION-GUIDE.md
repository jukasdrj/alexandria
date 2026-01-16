# Cover API Migration Guide - v2.9.0

**Breaking Changes**: Legacy cover endpoints removed in v2.9.0 (deployed 2026-01-16)

---

## Overview

Alexandria v2.9.0 removes all legacy cover API routes in favor of a unified `/api/covers/*` structure. This guide provides complete migration instructions for any external consumers.

---

## Breaking Changes Summary

| Legacy Endpoint | Status | Replacement | Notes |
|----------------|---------|-------------|-------|
| `GET /covers/{isbn}/status` | ❌ Removed | `GET /api/covers/status/{isbn}` | Improved response format |
| `GET /covers/{isbn}/{size}` | ❌ Removed | `GET /api/covers/{work_key}/{size}` | Requires work_key instead of ISBN |
| `POST /covers/{isbn}/process` | ❌ Removed | `POST /api/covers/process` | Same functionality, different request format |
| `POST /covers/batch` | ❌ Removed | `POST /api/covers/queue` | Async queue-based, max 100 (vs 10) |

---

## Migration Instructions

### 1. Cover Status Check

**Legacy (Removed)**:
```bash
GET /covers/{isbn}/status
```

**New**:
```bash
GET /api/covers/status/{isbn}
```

**Example Request**:
```bash
curl 'https://alexandria.ooheynerds.com/api/covers/status/9780439064873'
```

**Response (Cover Exists)**:
```json
{
  "exists": true,
  "isbn": "9780439064873",
  "format": "webp",
  "sizes": {
    "large": 45678,
    "medium": 23456,
    "small": 12345
  },
  "uploaded": "2026-01-15T12:00:00.000Z",
  "urls": {
    "large": "/covers/9780439064873/large",
    "medium": "/covers/9780439064873/medium",
    "small": "/covers/9780439064873/small"
  }
}
```

**Response (Cover Not Found)**:
```json
{
  "exists": false,
  "isbn": "9780439064873"
}
```

**Key Differences**:
- ✅ More detailed metadata (format, file sizes, upload timestamp)
- ✅ Consistent URL structure (`/api/covers/*`)
- ✅ Better error handling

---

### 2. Serve Cover Image

**Legacy (Removed)**:
```bash
GET /covers/{isbn}/{size}
```

**New**:
```bash
GET /api/covers/{work_key}/{size}
```

**⚠️ Important Change**: The new endpoint requires a `work_key` instead of an ISBN.

**How to Get work_key**:
1. Use search API: `GET /api/search/combined?q=isbn:{isbn}`
2. Extract `work_key` from response
3. Use in cover endpoint

**Example**:
```bash
# Step 1: Get work_key from ISBN
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=isbn:9780439064873'
# Response includes: "work_key": "OL45804W"

# Step 2: Fetch cover using work_key
curl 'https://alexandria.ooheynerds.com/api/covers/OL45804W/large'
```

**Sizes**:
- `large` - 512x768px
- `medium` - 256x384px
- `small` - 128x192px

**Alternative (ISBN-based serving still works)**:
If you only have an ISBN, you can still use the legacy path pattern:
```bash
GET /covers/{isbn}/{size}
```
This route is NOT deprecated and continues to work via the new handler.

---

### 3. Single Cover Processing

**Legacy (Removed)**:
```bash
POST /covers/{isbn}/process
```

**New**:
```bash
POST /api/covers/process
```

**Request Format Change**:

**Legacy Request**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/covers/9780439064873/process?force=true'
```

**New Request**:
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/process' \
  -H 'Content-Type: application/json' \
  -d '{
    "isbn": "9780439064873",
    "provider_url": "https://covers.openlibrary.org/b/id/8091323-L.jpg",
    "work_key": "/works/OL45804W"
  }'
```

**Key Differences**:
- ❌ ISBN moved from URL path to request body
- ❌ `force` query param removed (always processes)
- ✅ Explicit `provider_url` required
- ✅ Optional `work_key` for metadata

**Response**:
```json
{
  "success": true,
  "urls": {
    "large": "https://alexandria.ooheynerds.com/covers/9780439064873/large",
    "medium": "https://alexandria.ooheynerds.com/covers/9780439064873/medium",
    "small": "https://alexandria.ooheynerds.com/covers/9780439064873/small"
  },
  "metadata": {
    "processedAt": "2026-01-16T10:30:00.000Z",
    "originalSize": 245678,
    "r2Key": "isbn/9780439064873/original.jpg",
    "sourceUrl": "https://covers.openlibrary.org/b/id/8091323-L.jpg",
    "workKey": "/works/OL45804W",
    "isbn": "9780439064873"
  }
}
```

---

### 4. Batch Cover Processing

**Legacy (Removed)**:
```bash
POST /covers/batch
```

**New**:
```bash
POST /api/covers/queue
```

**⚠️ Important Changes**:
1. **Async Processing**: Jobs are queued for background processing (not synchronous)
2. **Increased Limit**: Max 100 books (vs legacy max 10)
3. **Different Response Format**: Returns queue status, not processing results

**Request Format Change**:

**Legacy Request**:
```json
{
  "isbns": ["9780439064873", "9781492666868", "9780545010221"]
}
```

**New Request**:
```json
{
  "books": [
    {
      "isbn": "9780439064873",
      "work_key": "/works/OL45804W",
      "priority": "normal",
      "title": "Harry Potter and the Philosopher's Stone",
      "author": "J.K. Rowling"
    },
    {
      "isbn": "9781492666868",
      "priority": "high"
    }
  ]
}
```

**Field Requirements**:
- ✅ `isbn` - Required
- ⚪ `work_key` - Optional (recommended)
- ⚪ `priority` - Optional (`low`, `normal`, `high`) - default: `normal`
- ⚪ `source` - Optional (for analytics)
- ⚪ `title`, `author` - Optional (for logging)

**Response**:
```json
{
  "queued": 2,
  "failed": 0,
  "errors": []
}
```

**Key Differences**:
- ❌ No immediate processing results (async queue)
- ✅ Much higher throughput (max 100 vs 10)
- ✅ Priority levels supported
- ✅ Better error handling and retry logic

**How to Check Processing Status**:
After queuing, use the status endpoint:
```bash
curl 'https://alexandria.ooheynerds.com/api/covers/status/9780439064873'
```

---

## Code Examples

### JavaScript/TypeScript

**Before (Legacy)**:
```typescript
// Check status
const status = await fetch(`https://alexandria.ooheynerds.com/covers/${isbn}/status`);

// Fetch cover
const cover = await fetch(`https://alexandria.ooheynerds.com/covers/${isbn}/large`);

// Process single cover
const result = await fetch(`https://alexandria.ooheynerds.com/covers/${isbn}/process`, {
  method: 'POST'
});

// Batch process
const batch = await fetch('https://alexandria.ooheynerds.com/covers/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ isbns: ['9780439064873', '9781492666868'] })
});
```

**After (v2.9.0)**:
```typescript
// Check status
const status = await fetch(`https://alexandria.ooheynerds.com/api/covers/status/${isbn}`);

// Fetch cover (requires work_key)
const cover = await fetch(`https://alexandria.ooheynerds.com/api/covers/${workKey}/large`);

// Process single cover
const result = await fetch('https://alexandria.ooheynerds.com/api/covers/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    isbn: '9780439064873',
    provider_url: 'https://covers.openlibrary.org/b/id/8091323-L.jpg',
    work_key: '/works/OL45804W'
  })
});

// Queue batch processing (async)
const batch = await fetch('https://alexandria.ooheynerds.com/api/covers/queue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    books: [
      { isbn: '9780439064873', priority: 'normal' },
      { isbn: '9781492666868', priority: 'high' }
    ]
  })
});
```

---

## Python Example

**Before (Legacy)**:
```python
import requests

# Check status
r = requests.get(f'https://alexandria.ooheynerds.com/covers/{isbn}/status')

# Batch process
r = requests.post('https://alexandria.ooheynerds.com/covers/batch', json={
    'isbns': ['9780439064873', '9781492666868']
})
```

**After (v2.9.0)**:
```python
import requests

# Check status
r = requests.get(f'https://alexandria.ooheynerds.com/api/covers/status/{isbn}')

# Queue batch processing
r = requests.post('https://alexandria.ooheynerds.com/api/covers/queue', json={
    'books': [
        {'isbn': '9780439064873', 'priority': 'normal'},
        {'isbn': '9781492666868', 'priority': 'high'}
    ]
})
```

---

## Common Pitfalls

### 1. Missing work_key for Cover Serving

**Problem**: Cover serving now requires `work_key` instead of `isbn`

**Solution**: Query the search API first to get `work_key`:
```bash
# Get work_key
curl 'https://alexandria.ooheynerds.com/api/search/combined?q=isbn:9780439064873' | jq '.works[0].work_key'

# Use in cover URL
curl 'https://alexandria.ooheynerds.com/api/covers/OL45804W/large'
```

**Alternative**: If you only have ISBNs, the legacy serving path still works:
```bash
# This continues to work (not deprecated)
curl 'https://alexandria.ooheynerds.com/covers/9780439064873/large'
```

### 2. Expecting Synchronous Batch Results

**Problem**: New batch endpoint (`/api/covers/queue`) is asynchronous

**Solution**: Queue the jobs, then poll the status endpoint:
```bash
# Queue processing
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' -d '...'

# Wait a few seconds, then check status
sleep 5
curl 'https://alexandria.ooheynerds.com/api/covers/status/9780439064873'
```

### 3. Incorrect Request Format for Processing

**Problem**: Legacy used URL params, new uses JSON body

**Solution**: Move ISBN and params to request body:
```bash
# ❌ Old (doesn't work)
POST /covers/9780439064873/process?force=true

# ✅ New (correct)
POST /api/covers/process
{
  "isbn": "9780439064873",
  "provider_url": "https://covers.openlibrary.org/b/id/8091323-L.jpg"
}
```

---

## Testing Your Migration

### 1. Test Status Endpoint
```bash
curl 'https://alexandria.ooheynerds.com/api/covers/status/9780439064873' | jq
```

Expected: JSON with `exists`, `isbn`, `format`, `sizes`, `urls`

### 2. Test Cover Serving
```bash
curl -I 'https://alexandria.ooheynerds.com/api/covers/OL45804W/large'
```

Expected: HTTP 200 with `Content-Type: image/webp` or HTTP 302 redirect

### 3. Test Queue Processing
```bash
curl -X POST 'https://alexandria.ooheynerds.com/api/covers/queue' \
  -H 'Content-Type: application/json' \
  -d '{"books":[{"isbn":"9780439064873"}]}' | jq
```

Expected: `{"queued": 1, "failed": 0, "errors": []}`

---

## Support

**Issues**: https://github.com/jukasdrj/alexandria/issues
**Documentation**: https://github.com/jukasdrj/alexandria/tree/main/docs/api
**OpenAPI Spec**: https://alexandria.ooheynerds.com/openapi.json

---

## Timeline

- **v2.8.0** (2026-01-14): Legacy routes deprecated with warnings
- **v2.9.0** (2026-01-16): Legacy routes removed (this version)
- **Migration Window**: No migration window - immediate breaking change (internal-only API)

---

## FAQ

**Q: Can I still use ISBN-based cover serving?**
A: Yes! `GET /covers/{isbn}/{size}` still works and is NOT deprecated. Only the status/processing endpoints changed.

**Q: Why does batch processing require async now?**
A: To support up to 100 covers per request (vs legacy 10) and improve reliability with queue-based processing.

**Q: What if my old code breaks?**
A: File an issue at https://github.com/jukasdrj/alexandria/issues with your use case.

**Q: Is there a grace period?**
A: No - this was an internal-only API with no identified external consumers.

---

**Last Updated**: 2026-01-16
**Version**: v2.9.0
