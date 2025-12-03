# Alexandria v2.1.0 Integration Update

**To:** bendv3 & iOS Teams  
**From:** Alexandria API Team  
**Date:** December 3, 2025  
**Subject:** New Combined Search Endpoint & Pagination Support

## 🎉 What's New

Alexandria API has been upgraded to **v2.1.0** with exciting new features:

### 1. Combined Search Endpoint (New)
A unified search endpoint that intelligently detects query type:

```
GET /api/search/combined?q={query}&limit={limit}&offset={offset}
```

**Features:**
- **Auto-detection**: Automatically identifies ISBN vs text queries
- **Fast ISBN lookups**: ~60ms with indexed database queries
- **Smart text search**: Parallel title + author search (~1-2s)
- **Built-in deduplication**: No duplicate results
- **Full pagination**: Integrated limit/offset/hasMore support

**Example Usage:**
```typescript
// ISBN search (auto-detected)
const result = await fetch('https://alexandria.ooheynerds.com/api/search/combined?q=9780439064873');

// Text search (auto-detected)
const result = await fetch('https://alexandria.ooheynerds.com/api/search/combined?q=Harry Potter&limit=20');

// Response includes:
{
  "query": "9780439064873",
  "search_type": "isbn",
  "query_duration_ms": 62,
  "results": [...],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 4,
    "hasMore": false,
    "returnedCount": 4
  }
}
```

### 2. Pagination Support (All Endpoints)
All search endpoints now support pagination parameters:

- `limit` - Results per page (default: 10, max: 100)
- `offset` - Starting position (default: 0)

**Updated Endpoints:**
```
GET /api/search?isbn={isbn}&limit=10&offset=0
GET /api/search?title={title}&limit=10&offset=0
GET /api/search?author={author}&limit=10&offset=0
GET /api/search/combined?q={query}&limit=10&offset=0
```

## ⚠️ Breaking Change

**Response structure has changed** - all search endpoints now return `pagination` object:

### Before (v2.0.0)
```json
{
  "query": { ... },
  "count": 1234,
  "results": [ ... ]
}
```

### After (v2.1.0)
```json
{
  "query": { ... },
  "count": 1234,  // Deprecated - use pagination.total
  "results": [ ... ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 1234,
    "hasMore": true,
    "returnedCount": 10,
    "totalEstimated": false
  }
}
```

## 📱 iOS Integration

### Update URLSession Calls
```swift
// Old way
struct SearchResponse: Codable {
    let count: Int
    let results: [Book]
}

// New way - v2.1.0
struct SearchResponse: Codable {
    let count: Int?  // Deprecated
    let results: [Book]
    let pagination: PaginationMetadata
}

struct PaginationMetadata: Codable {
    let limit: Int
    let offset: Int
    let total: Int
    let hasMore: Bool
    let returnedCount: Int
    let totalEstimated: Bool?
}

// Usage
let response = try decoder.decode(SearchResponse.self, from: data)
let totalResults = response.pagination.total
let hasMorePages = response.pagination.hasMore
```

### New Combined Search
```swift
// Simpler API - auto-detects query type
func searchAlexandria(query: String, limit: Int = 10, offset: Int = 0) async throws -> SearchResponse {
    let url = URL(string: "https://alexandria.ooheynerds.com/api/search/combined")!
    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    components.queryItems = [
        URLQueryItem(name: "q", value: query),
        URLQueryItem(name: "limit", value: "\(limit)"),
        URLQueryItem(name: "offset", value: "\(offset)")
    ]
    
    let (data, _) = try await URLSession.shared.data(from: components.url!)
    return try JSONDecoder().decode(SearchResponse.self, from: data)
}

// Use for any query type
let isbnResults = try await searchAlexandria(query: "9780439064873")
let textResults = try await searchAlexandria(query: "Harry Potter", limit: 20)
```

### Implement Pagination
```swift
class BookSearchViewModel: ObservableObject {
    @Published var books: [Book] = []
    @Published var isLoading = false
    @Published var hasMore = false
    
    private var currentOffset = 0
    private let pageSize = 20
    
    func loadMore(query: String) async {
        guard !isLoading else { return }
        isLoading = true
        
        do {
            let response = try await searchAlexandria(
                query: query,
                limit: pageSize,
                offset: currentOffset
            )
            
            books.append(contentsOf: response.results)
            hasMore = response.pagination.hasMore
            currentOffset += response.pagination.returnedCount
        } catch {
            print("Search failed: \(error)")
        }
        
        isLoading = false
    }
}
```

## 🖥️ bendv3 Integration

### Update npm Package
```bash
npm install alexandria-worker@2.1.0
```

### Update TypeScript Types
```typescript
import type {
  CombinedSearchQuery,
  CombinedSearchResult,
  PaginationMetadata,
  SearchResult,
  BookResult
} from 'alexandria-worker/types';

// Update service to use pagination
class AlexandriaService {
  async search(params: SearchQuery): Promise<BookResult[]> {
    const response = await fetch(`${this.baseUrl}/api/search?${params}`);
    const data: SearchResult = await response.json();
    
    // Old way (deprecated)
    // const total = data.count;
    
    // New way
    const total = data.pagination.total;
    const hasMore = data.pagination.hasMore;
    
    return data.results;
  }
  
  // New combined search method
  async searchCombined(query: string, limit = 10, offset = 0): Promise<CombinedSearchResult> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      offset: offset.toString()
    });
    
    const response = await fetch(`${this.baseUrl}/api/search/combined?${params}`);
    return response.json();
  }
}
```

### Implement Pagination
```typescript
// React example
function BookSearch() {
  const [results, setResults] = useState<BookResult[]>([]);
  const [pagination, setPagination] = useState<PaginationMetadata | null>(null);
  const [query, setQuery] = useState('');
  
  const loadMore = async () => {
    if (!pagination?.hasMore) return;
    
    const response = await alexandria.searchCombined(
      query,
      20,
      pagination.offset + pagination.returnedCount
    );
    
    setResults(prev => [...prev, ...response.results]);
    setPagination(response.pagination);
  };
  
  return (
    <div>
      {results.map(book => <BookCard key={book.isbn} book={book} />)}
      {pagination?.hasMore && (
        <button onClick={loadMore}>
          Load More ({pagination.total - pagination.offset - pagination.returnedCount} remaining)
        </button>
      )}
    </div>
  );
}
```

## 🚀 Migration Steps

### For iOS
1. Update `SearchResponse` model to include `pagination` field
2. Update all code reading `response.count` to use `response.pagination.total`
3. Optionally implement new `/api/search/combined` endpoint
4. Add pagination support using `offset` parameter
5. Use `pagination.hasMore` for infinite scroll/load more

### For bendv3
1. Run: `npm install alexandria-worker@2.1.0`
2. Update imports to include new types
3. Update all code reading `result.count` to use `result.pagination.total`
4. Update service methods to return `PaginationMetadata`
5. Optionally adopt `/api/search/combined` for simpler search logic
6. Test integration thoroughly
7. Update bendv3 version and notify your consumers

## 📊 Performance Benefits

- **Combined search**: Single endpoint simplifies client logic
- **Pagination**: Better UX with `hasMore` flag for infinite scroll
- **Accurate counts**: Parallel COUNT queries don't block data fetching
- **Type safety**: Enhanced TypeScript types catch errors at compile time

## 🔗 Resources

- **npm Package**: https://www.npmjs.com/package/alexandria-worker
- **GitHub Release**: https://github.com/jukasdrj/alexandria/releases/tag/v2.1.0
- **CHANGELOG**: https://github.com/jukasdrj/alexandria/blob/main/CHANGELOG.md
- **Integration Guide**: https://github.com/jukasdrj/alexandria/blob/main/worker/README-INTEGRATION.md
- **Live API**: https://alexandria.ooheynerds.com
- **OpenAPI Spec**: https://alexandria.ooheynerds.com/openapi.json

## 💬 Support

Questions or issues? Open an issue on GitHub:
https://github.com/jukasdrj/alexandria/issues

---

**API Endpoints Summary:**

| Endpoint | Method | Purpose | New in v2.1.0 |
|----------|--------|---------|---------------|
| `/api/search/combined` | GET | Unified search with auto-detection | ✅ New |
| `/api/search` | GET | Multi-field search | ✅ Pagination added |
| `/health` | GET | Health check | - |
| `/api/stats` | GET | Database statistics | - |

**All endpoints live and tested at https://alexandria.ooheynerds.com**
