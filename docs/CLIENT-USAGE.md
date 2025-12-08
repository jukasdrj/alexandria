# Alexandria API Client Usage Guide

This guide shows how to consume the Alexandria API from various programming languages. The API is fully documented with OpenAPI 3.1, making it easy to generate type-safe clients.

## Table of Contents
- [TypeScript/JavaScript](#typescriptjavascript)
- [Python](#python)
- [Go](#go)
- [Rust](#rust)
- [General Tips](#general-tips)

---

## TypeScript/JavaScript

### Recommended: openapi-fetch (Type-Safe)

The best TypeScript experience uses `openapi-fetch` with generated types from the OpenAPI spec.

**1. Generate types from OpenAPI spec:**

```bash
# Install openapi-typescript globally or as dev dependency
npm install -D openapi-typescript

# Generate types from the live API spec
npx openapi-typescript https://alexandria.ooheynerds.com/openapi.json -o ./src/alexandria-types.ts

# Or from local file if you have the spec saved
npx openapi-typescript ./openapi.json -o ./src/alexandria-types.ts
```

**2. Install openapi-fetch:**

```bash
npm install openapi-fetch
```

**3. Use the generated types:**

```typescript
import createClient from "openapi-fetch";
import type { paths } from "./alexandria-types";

// Create typed client
const client = createClient<paths>({
  baseUrl: "https://alexandria.ooheynerds.com"
});

// ISBN search - fully typed!
const { data, error } = await client.GET("/api/search", {
  params: {
    query: { isbn: "9780439064873" }
  }
});

if (error) {
  console.error("Search failed:", error);
} else {
  // data is fully typed with IntelliSense
  console.log(`Found ${data.total} results`);
  data.results.forEach(book => {
    console.log(`${book.title} by ${book.author}`);
  });
}

// Title search with pagination
const { data: titleResults } = await client.GET("/api/search", {
  params: {
    query: {
      title: "harry potter",
      limit: 20,
      offset: 0
    }
  }
});

// Get cover image
const { data: coverData } = await client.GET("/covers/{isbn}/{size}", {
  params: {
    path: {
      isbn: "9780439064873",
      size: "medium"
    }
  }
});
```

**Benefits:**
- 100% type safety from OpenAPI spec
- Auto-completion for all endpoints
- Compile-time validation of parameters
- Minimal runtime overhead
- Automatic error handling

### Alternative: Fetch API (Simple)

For simpler use cases, use the native Fetch API:

```typescript
interface SearchParams {
  isbn?: string;
  title?: string;
  author?: string;
  limit?: number;
  offset?: number;
}

interface SearchResult {
  title: string;
  author: string;
  isbn: string;
  work_key: string;
  cover_url?: string;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}

async function searchBooks(params: SearchParams): Promise<SearchResponse> {
  const queryString = new URLSearchParams(
    Object.entries(params)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  ).toString();

  const response = await fetch(
    `https://alexandria.ooheynerds.com/api/search?${queryString}`
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json();
}

// Usage
const results = await searchBooks({
  title: "1984",
  limit: 10
});
```

---

## Python

### Recommended: httpx + pydantic (Type-Safe)

Use `httpx` for async HTTP requests and `pydantic` for type validation.

**1. Install dependencies:**

```bash
pip install httpx pydantic
```

**2. Generate Pydantic models from OpenAPI:**

```bash
# Install datamodel-code-generator
pip install datamodel-code-generator

# Generate models from OpenAPI spec
datamodel-codegen \
  --url https://alexandria.ooheynerds.com/openapi.json \
  --output alexandria_models.py \
  --input-file-type openapi
```

**3. Use the generated models:**

```python
import httpx
from alexandria_models import SearchResponse, CoverProcessRequest
from typing import Optional

class AlexandriaClient:
    def __init__(self, base_url: str = "https://alexandria.ooheynerds.com"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(base_url=base_url)

    async def search_by_isbn(self, isbn: str) -> SearchResponse:
        """Search for a book by ISBN"""
        response = await self.client.get(
            "/api/search",
            params={"isbn": isbn}
        )
        response.raise_for_status()
        return SearchResponse(**response.json())

    async def search_by_title(
        self,
        title: str,
        limit: int = 20,
        offset: int = 0
    ) -> SearchResponse:
        """Search for books by title"""
        response = await self.client.get(
            "/api/search",
            params={
                "title": title,
                "limit": limit,
                "offset": offset
            }
        )
        response.raise_for_status()
        return SearchResponse(**response.json())

    async def search_by_author(
        self,
        author: str,
        limit: int = 20,
        offset: int = 0
    ) -> SearchResponse:
        """Search for books by author"""
        response = await self.client.get(
            "/api/search",
            params={
                "author": author,
                "limit": limit,
                "offset": offset
            }
        )
        response.raise_for_status()
        return SearchResponse(**response.json())

    async def get_cover_url(
        self,
        isbn: str,
        size: str = "medium"
    ) -> str:
        """Get cover image URL"""
        return f"{self.base_url}/covers/{isbn}/{size}"

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()

# Usage example
async def main():
    client = AlexandriaClient()

    try:
        # ISBN search
        result = await client.search_by_isbn("9780439064873")
        print(f"Found {result.total} results")
        for book in result.results:
            print(f"{book.title} by {book.author}")

        # Title search with pagination
        page1 = await client.search_by_title("harry potter", limit=10, offset=0)
        page2 = await client.search_by_title("harry potter", limit=10, offset=10)

    finally:
        await client.close()

# Run
import asyncio
asyncio.run(main())
```

### Alternative: requests (Simple, Synchronous)

For simpler synchronous use cases:

```python
import requests
from typing import Optional, List, Dict, Any

def search_books(
    isbn: Optional[str] = None,
    title: Optional[str] = None,
    author: Optional[str] = None,
    limit: int = 20,
    offset: int = 0
) -> Dict[str, Any]:
    """Search Alexandria API"""
    params = {"limit": limit, "offset": offset}

    if isbn:
        params["isbn"] = isbn
    if title:
        params["title"] = title
    if author:
        params["author"] = author

    response = requests.get(
        "https://alexandria.ooheynerds.com/api/search",
        params=params
    )
    response.raise_for_status()
    return response.json()

# Usage
results = search_books(title="1984", limit=10)
for book in results["results"]:
    print(f"{book['title']} by {book['author']}")
```

---

## Go

### Recommended: oapi-codegen (Type-Safe)

Generate a type-safe Go client from the OpenAPI spec.

**1. Install oapi-codegen:**

```bash
go install github.com/deepmap/oapi-codegen/v2/cmd/oapi-codegen@latest
```

**2. Generate Go client:**

```bash
# Download OpenAPI spec
curl https://alexandria.ooheynerds.com/openapi.json -o openapi.json

# Generate client code
oapi-codegen -package alexandria -generate types,client openapi.json > alexandria/client.go
```

**3. Use the generated client:**

```go
package main

import (
    "context"
    "fmt"
    "log"

    "yourmodule/alexandria"
)

func main() {
    // Create client
    client, err := alexandria.NewClient("https://alexandria.ooheynerds.com")
    if err != nil {
        log.Fatal(err)
    }

    ctx := context.Background()

    // ISBN search
    isbn := "9780439064873"
    searchResp, err := client.GetApiSearch(ctx, &alexandria.GetApiSearchParams{
        Isbn: &isbn,
    })
    if err != nil {
        log.Fatal(err)
    }
    defer searchResp.Body.Close()

    // Parse response
    var result alexandria.SearchResponse
    if err := json.NewDecoder(searchResp.Body).Decode(&result); err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Found %d results\n", result.Total)
    for _, book := range result.Results {
        fmt.Printf("%s by %s\n", book.Title, book.Author)
    }

    // Title search with pagination
    title := "harry potter"
    limit := 20
    offset := 0

    titleResp, err := client.GetApiSearch(ctx, &alexandria.GetApiSearchParams{
        Title:  &title,
        Limit:  &limit,
        Offset: &offset,
    })
    // ... handle response
}
```

### Alternative: Standard Library (Simple)

For simpler use cases without code generation:

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "net/url"
)

type SearchResult struct {
    Title    string `json:"title"`
    Author   string `json:"author"`
    ISBN     string `json:"isbn"`
    WorkKey  string `json:"work_key"`
    CoverURL string `json:"cover_url,omitempty"`
}

type SearchResponse struct {
    Results []SearchResult `json:"results"`
    Total   int            `json:"total"`
    Limit   int            `json:"limit"`
    Offset  int            `json:"offset"`
}

func searchBooks(params map[string]string) (*SearchResponse, error) {
    baseURL := "https://alexandria.ooheynerds.com/api/search"

    // Build query string
    values := url.Values{}
    for k, v := range params {
        values.Add(k, v)
    }

    resp, err := http.Get(baseURL + "?" + values.Encode())
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("API error: %s", resp.Status)
    }

    var result SearchResponse
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }

    return &result, nil
}

func main() {
    // ISBN search
    result, err := searchBooks(map[string]string{
        "isbn": "9780439064873",
    })
    if err != nil {
        panic(err)
    }

    fmt.Printf("Found %d results\n", result.Total)
    for _, book := range result.Results {
        fmt.Printf("%s by %s\n", book.Title, book.Author)
    }
}
```

---

## Rust

### Recommended: openapi-generator (Type-Safe)

Generate a Rust client using openapi-generator.

**1. Install openapi-generator:**

```bash
# Using Homebrew (macOS/Linux)
brew install openapi-generator

# Or download JAR
wget https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/7.1.0/openapi-generator-cli-7.1.0.jar -O openapi-generator-cli.jar
```

**2. Generate Rust client:**

```bash
# Download OpenAPI spec
curl https://alexandria.ooheynerds.com/openapi.json -o openapi.json

# Generate client
openapi-generator generate \
  -i openapi.json \
  -g rust \
  -o ./alexandria-client
```

**3. Add to Cargo.toml:**

```toml
[dependencies]
alexandria-client = { path = "./alexandria-client" }
tokio = { version = "1", features = ["full"] }
```

**4. Use the generated client:**

```rust
use alexandria_client::{apis::configuration::Configuration, apis::search_api};

#[tokio::main]
async fn main() {
    let config = Configuration {
        base_path: "https://alexandria.ooheynerds.com".to_string(),
        ..Default::default()
    };

    // ISBN search
    match search_api::get_api_search(
        &config,
        Some("9780439064873"),
        None,
        None,
        None,
        None
    ).await {
        Ok(response) => {
            println!("Found {} results", response.total);
            for book in response.results {
                println!("{} by {}", book.title, book.author);
            }
        }
        Err(e) => eprintln!("Error: {:?}", e),
    }
}
```

### Alternative: reqwest (Simple)

For simpler use cases:

```rust
use serde::{Deserialize, Serialize};
use reqwest;

#[derive(Debug, Deserialize)]
struct SearchResult {
    title: String,
    author: String,
    isbn: String,
    work_key: String,
    cover_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<SearchResult>,
    total: usize,
    limit: usize,
    offset: usize,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    // ISBN search
    let response: SearchResponse = client
        .get("https://alexandria.ooheynerds.com/api/search")
        .query(&[("isbn", "9780439064873")])
        .send()
        .await?
        .json()
        .await?;

    println!("Found {} results", response.total);
    for book in response.results {
        println!("{} by {}", book.title, book.author);
    }

    Ok(())
}
```

---

## General Tips

### Rate Limiting

The Alexandria API uses Cloudflare's rate limiting. Be respectful:

- **Recommended**: Max 10 requests/second per IP
- **Burst**: Up to 20 requests for short bursts
- **Batch operations**: Use batch endpoints when available (e.g., `/covers/batch`)

### Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "details": "Additional context (optional)"
}
```

HTTP status codes:
- `200 OK`: Success
- `400 Bad Request`: Invalid parameters
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

### Pagination

Search endpoints support pagination:

```
GET /api/search?title=potter&limit=20&offset=40
```

- `limit`: Results per page (default: 20, max: 100)
- `offset`: Number of results to skip (default: 0)
- Response includes `total` for total match count

### Cover Images

Cover images are available in three sizes:

- `large`: ~500px (best quality)
- `medium`: ~300px (recommended for lists)
- `small`: ~100px (thumbnails)

Direct URL pattern:
```
https://alexandria.ooheynerds.com/covers/{isbn}/{size}
```

### Caching

The API uses Cloudflare's edge caching:

- Search results: Cached for 5 minutes
- Cover images: Cached for 24 hours
- Stats endpoint: Cached for 1 hour

Include `Cache-Control: no-cache` header to bypass cache.

### Best Practices

1. **Use the OpenAPI spec** for type generation whenever possible
2. **Implement exponential backoff** for retries on 429/500 errors
3. **Cache results locally** when appropriate
4. **Batch operations** when processing multiple ISBNs
5. **Use specific searches**: ISBN searches are fastest (~10-50ms)
6. **Monitor response times**: Report slow queries (>1s) as they may indicate issues

### OpenAPI Spec Location

The live OpenAPI specification is available at:
```
https://alexandria.ooheynerds.com/openapi.json
```

Download it for offline development:
```bash
curl https://alexandria.ooheynerds.com/openapi.json -o alexandria-openapi.json
```

### Support

- **Issues**: https://github.com/yourusername/alexandria/issues
- **Docs**: https://github.com/yourusername/alexandria/tree/main/docs
- **API Status**: Check `/health` endpoint

---

## Example Projects

### Full-Stack TypeScript Example

```typescript
// backend/alexandria.ts
import createClient from "openapi-fetch";
import type { paths } from "./alexandria-types";

export const alexandria = createClient<paths>({
  baseUrl: process.env.ALEXANDRIA_API_URL || "https://alexandria.ooheynerds.com"
});

// frontend/components/BookSearch.tsx
import { alexandria } from "../lib/alexandria";
import { useState } from "react";

export function BookSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  const handleSearch = async () => {
    const { data } = await alexandria.GET("/api/search", {
      params: { query: { title: query, limit: 10 } }
    });

    if (data) {
      setResults(data.results);
    }
  };

  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button onClick={handleSearch}>Search</button>

      {results.map(book => (
        <div key={book.isbn}>
          <img src={`https://alexandria.ooheynerds.com/covers/${book.isbn}/medium`} />
          <h3>{book.title}</h3>
          <p>{book.author}</p>
        </div>
      ))}
    </div>
  );
}
```

### Python FastAPI Proxy

```python
from fastapi import FastAPI, HTTPException
from alexandria_models import SearchResponse
import httpx

app = FastAPI()
alexandria = httpx.AsyncClient(base_url="https://alexandria.ooheynerds.com")

@app.get("/search", response_model=SearchResponse)
async def search(
    isbn: str = None,
    title: str = None,
    author: str = None,
    limit: int = 20,
    offset: int = 0
):
    params = {"limit": limit, "offset": offset}
    if isbn:
        params["isbn"] = isbn
    if title:
        params["title"] = title
    if author:
        params["author"] = author

    response = await alexandria.get("/api/search", params=params)

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code)

    return response.json()
```

---

**Last Updated**: December 2025
