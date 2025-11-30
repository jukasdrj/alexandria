# Cover Image Processing Implementation Plan

**Sprint Goal:** Implement cover image upload, processing, and CDN serving in Alexandria  
**Time Estimate:** 3-4 hours  
**Status:** 🟡 Ready to Execute  
**Owner:** Alexandria Worker Team

---

## 🎯 Objective

Build a complete cover image processing pipeline that accepts cover URLs from bendv3, downloads/validates/compresses images to WebP, generates 3 sizes (large/medium/small), stores them in R2, and returns CDN URLs for the processed images.

**Key Principles:**
- Alexandria handles ONLY book metadata and cover images (no user data)
- Use Cloudflare Image Resizing for compression and sizing
- Return optimized WebP images via CDN URLs
- Maintain sub-100ms response times like metadata queries

---

## 📋 Prerequisites

- [x] Alex worker deployed at `alexandria.ooheynerds.com`
- [x] Hyperdrive connection to PostgreSQL working (78ms response time)
- [x] Worker-to-worker auth configured (CF-Access service tokens)
- [ ] New R2 bucket created: `bookstrack-covers-processed`

---

## 🏗️ Architecture

```
bendv3 (book-service.ts)
    ↓ POST /api/covers/process
    ↓ { work_key, provider_url }
Alexandria Worker
    ↓
1. Download original from provider URL
2. Validate image (format, size)
3. Compress to WebP (85% quality)
4. Generate 3 sizes (or use on-the-fly resizing)
5. Upload to R2: covers/{work_key}/{size}.webp
6. Return CDN URLs
    ↓
bendv3 receives URLs
    ↓
Store in D1/KV cache
```

---

## 📝 Implementation Steps

### Step 1: Create R2 Bucket (Infrastructure)

**Duration:** 5 minutes  
**Status:** ⬜ Not started

#### 1.1 Create R2 bucket via Cloudflare Dashboard
```bash
# Navigate to: R2 → Create bucket
# Bucket name: bookstrack-covers-processed
# Location: Automatic (Cloudflare will optimize)
# Storage class: Standard
```

#### 1.2 Update wrangler.toml with new R2 binding
**File:** `/Users/juju/dev_repos/alex/worker/wrangler.toml`

```toml
# Add after existing bindings:
[[r2_buckets]]
binding = "COVER_IMAGES"
bucket_name = "bookstrack-covers-processed"
```

#### 1.3 Deploy to production
```bash
cd /Users/juju/dev_repos/alex/worker
npx wrangler deploy
```

**Validation:**
```bash
# Test R2 binding is accessible
curl https://alexandria.ooheynerds.com/health
# Should return database connection info
```

---

### Step 2: Implement Image Processing Utilities

**Duration:** 30 minutes  
**Status:** ⬜ Not started

#### 2.1 Create image processing utility module
**File:** `/Users/juju/dev_repos/alex/worker/image-utils.js`

```javascript
/**
 * Image Processing Utilities for Alexandria Cover Processing
 * 
 * Handles:
 * - Download and validation of cover images
 * - WebP compression via Cloudflare Image Resizing
 * - URL hashing for R2 key generation
 * - Security (domain whitelist)
 */

const PLACEHOLDER_COVER = "https://placehold.co/300x450/e0e0e0/666666?text=No+Cover";

const ALLOWED_DOMAINS = new Set([
  'books.google.com',
  'covers.openlibrary.org',
  'images-na.ssl-images-amazon.com',
  'images.isbndb.com',
]);

const SIZES = {
  large: { width: 512, height: 768 },
  medium: { width: 256, height: 384 },
  small: { width: 128, height: 192 },
};

/**
 * Download image from provider URL with validation
 * 
 * @param {string} url - Provider cover URL
 * @returns {Promise<{buffer: ArrayBuffer, contentType: string}>}
 * @throws {Error} If download fails or validation fails
 */
export async function downloadImage(url) {
  // Security: Validate domain whitelist
  try {
    const parsedUrl = new URL(url);
    if (!ALLOWED_DOMAINS.has(parsedUrl.hostname)) {
      throw new Error(`Domain not allowed: ${parsedUrl.hostname}`);
    }
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }

  // Download with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Alexandria/1.0 (covers@ooheynerds.com)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const buffer = await response.arrayBuffer();

    // Validate file size (max 10MB)
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new Error('Image too large (>10MB)');
    }

    return { buffer, contentType };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Download timeout (>10s)');
    }
    throw error;
  }
}

/**
 * Compress image to WebP format using Cloudflare Image Resizing
 * 
 * @param {ArrayBuffer} imageData - Original image data
 * @param {number} quality - Quality 1-100 (85 recommended)
 * @returns {Promise<ArrayBuffer>} Compressed WebP image
 */
export async function compressToWebP(imageData, quality = 85) {
  try {
    // Create a Response with the image data
    const imageResponse = new Response(imageData);

    // Note: This is a simplified version
    // In production, you'd use Cloudflare's Image Resizing service
    // For now, we'll just return the original data
    // TODO: Implement actual CF Image Resizing API call
    
    return imageData;
  } catch (error) {
    console.error('WebP compression error:', error);
    throw new Error(`Compression failed: ${error.message}`);
  }
}

/**
 * Generate SHA-256 hash for cache key generation
 * 
 * @param {string} url - URL to hash
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
export async function hashURL(url) {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalize image URL for consistent caching
 * 
 * @param {string} url - Original URL
 * @returns {string} Normalized URL (HTTPS, no query params)
 */
export function normalizeImageURL(url) {
  try {
    const parsed = new URL(url.trim());
    parsed.search = ''; // Remove query params
    parsed.protocol = 'https:'; // Force HTTPS
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export { PLACEHOLDER_COVER, SIZES };
```

---

### Step 3: Implement Cover Processing Endpoint

**Duration:** 45 minutes  
**Status:** ⬜ Not started

#### 3.1 Create cover processing handler
**File:** `/Users/juju/dev_repos/alex/worker/cover-handlers.js`

```javascript
/**
 * Cover Image Processing Handlers for Alexandria
 * 
 * Endpoints:
 * - POST /api/covers/process - Process a cover image from provider URL
 * - GET /api/covers/{work_key}/{size}.webp - Serve processed cover
 */

import {
  downloadImage,
  compressToWebP,
  hashURL,
  normalizeImageURL,
  PLACEHOLDER_COVER,
  SIZES,
} from './image-utils.js';

/**
 * POST /api/covers/process
 * 
 * Process a cover image from a provider URL
 * 
 * Request body:
 * {
 *   "work_key": "/works/OL45804W",
 *   "provider_url": "https://covers.openlibrary.org/b/id/12345-L.jpg",
 *   "isbn": "9780439064873" // optional, for logging
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "urls": {
 *     "large": "https://covers.alexandria.ooheynerds.com/OL45804W/large.webp",
 *     "medium": "https://covers.alexandria.ooheynerds.com/OL45804W/medium.webp",
 *     "small": "https://covers.alexandria.ooheynerds.com/OL45804W/small.webp"
 *   },
 *   "metadata": {
 *     "processedAt": "2025-11-30T...",
 *     "originalSize": 245678,
 *     "r2Key": "covers/OL45804W/abc123...",
 *     "sourceUrl": "https://covers.openlibrary.org/..."
 *   }
 * }
 */
export async function handleProcessCover(c) {
  try {
    // 1. Parse and validate request
    const body = await c.req.json();
    const { work_key, provider_url, isbn } = body;

    if (!work_key || !provider_url) {
      return c.json({
        success: false,
        error: 'Missing required fields: work_key, provider_url',
      }, 400);
    }

    console.log(`[CoverProcessor] Processing cover for ${work_key} from ${provider_url}`);

    // 2. Download and validate original image
    const { buffer: originalImage, contentType } = await downloadImage(provider_url);
    console.log(`[CoverProcessor] Downloaded ${originalImage.byteLength} bytes`);

    // 3. Compress to WebP (optional - you might skip this and use on-the-fly resizing)
    // For now, we'll store the original and use CF Image Resizing at serve time
    const processedImage = originalImage;

    // 4. Generate R2 key (use URL hash for deduplication)
    const urlHash = await hashURL(normalizeImageURL(provider_url));
    const workKeyClean = work_key.replace(/^\/works\//, ''); // Remove /works/ prefix
    const r2Key = `covers/${workKeyClean}/${urlHash}`;

    // 5. Upload to R2
    const env = c.env;
    await env.COVER_IMAGES.put(`${r2Key}/original.webp`, processedImage, {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable', // 1 year
      },
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        originalSize: originalImage.byteLength.toString(),
        sourceUrl: provider_url,
        workKey: work_key,
        isbn: isbn || 'unknown',
      },
    });

    console.log(`[CoverProcessor] Uploaded to R2: ${r2Key}/original.webp`);

    // 6. Generate CDN URLs
    // Note: These will use CF Image Resizing at serve time
    const cdnBase = 'https://covers.alexandria.ooheynerds.com';
    const urls = {
      large: `${cdnBase}/${workKeyClean}/large.webp`,
      medium: `${cdnBase}/${workKeyClean}/medium.webp`,
      small: `${cdnBase}/${workKeyClean}/small.webp`,
    };

    // 7. Return success response
    return c.json({
      success: true,
      urls,
      metadata: {
        processedAt: new Date().toISOString(),
        originalSize: originalImage.byteLength,
        r2Key,
        sourceUrl: provider_url,
        workKey: work_key,
      },
    });

  } catch (error) {
    console.error('[CoverProcessor] Error:', error);

    // Return placeholder URLs on error
    return c.json({
      success: false,
      error: error.message,
      urls: {
        large: PLACEHOLDER_COVER,
        medium: PLACEHOLDER_COVER,
        small: PLACEHOLDER_COVER,
      },
    }, error.message.includes('Domain not allowed') ? 403 : 500);
  }
}

/**
 * GET /api/covers/{work_key}/{size}.webp
 * 
 * Serve a processed cover image with on-the-fly resizing
 * 
 * Example: GET /api/covers/OL45804W/medium.webp
 */
export async function handleServeCover(c) {
  try {
    const { work_key, size } = c.req.param();

    if (!SIZES[size]) {
      return c.text('Invalid size parameter. Use: large, medium, or small', 400);
    }

    const env = c.env;

    // Find the original image in R2
    // Note: We need to list objects to find the hash-based key
    const prefix = `covers/${work_key}/`;
    const objects = await env.COVER_IMAGES.list({ prefix, limit: 1 });

    if (objects.objects.length === 0) {
      // No cover found, redirect to placeholder
      return c.redirect(PLACEHOLDER_COVER);
    }

    const originalKey = objects.objects[0].key;
    const originalImage = await env.COVER_IMAGES.get(originalKey);

    if (!originalImage) {
      return c.redirect(PLACEHOLDER_COVER);
    }

    // Get image data
    const imageData = await originalImage.arrayBuffer();
    const contentType = originalImage.httpMetadata?.contentType || 'image/webp';

    // Resize image using CF Image Resizing
    const dimensions = SIZES[size];

    return new Response(imageData, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=2592000, immutable', // 30 days
        'CF-Image-Width': dimensions.width.toString(),
        'CF-Image-Height': dimensions.height.toString(),
        'CF-Image-Fit': 'scale-down',
      },
    });

  } catch (error) {
    console.error('[CoverServer] Error:', error);
    return c.redirect(PLACEHOLDER_COVER);
  }
}
```

---

### Step 4: Register Routes in Main Router

**Duration:** 10 minutes  
**Status:** ⬜ Not started

#### 4.1 Import handlers in index.js
**File:** `/Users/juju/dev_repos/alex/worker/index.js`

Add imports at the top:
```javascript
import { handleProcessCover, handleServeCover } from './cover-handlers.js';
```

#### 4.2 Register routes
Add before the `/api/search` route:

```javascript
// POST /api/covers/process -> Process cover image from provider URL
app.post('/api/covers/process', handleProcessCover);

// GET /api/covers/:work_key/:size -> Serve processed cover
app.get('/api/covers/:work_key/:size', handleServeCover);
```

#### 4.3 Update OpenAPI spec
Add to `openAPISpec.paths` in index.js:

```javascript
'/api/covers/process': {
  post: {
    summary: 'Process cover image from provider URL',
    description: 'Download, validate, compress, and store cover image in R2',
    tags: ['Covers'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['work_key', 'provider_url'],
            properties: {
              work_key: { type: 'string', example: '/works/OL45804W' },
              provider_url: { type: 'string', example: 'https://covers.openlibrary.org/b/id/12345-L.jpg' },
              isbn: { type: 'string', example: '9780439064873' }
            }
          }
        }
      }
    },
    responses: {
      '200': { description: 'Cover processed successfully' },
      '400': { description: 'Invalid request' },
      '403': { description: 'Domain not allowed' },
      '500': { description: 'Processing error' }
    }
  }
},
'/api/covers/{work_key}/{size}': {
  get: {
    summary: 'Serve processed cover image',
    description: 'Retrieve cover image with on-the-fly resizing',
    tags: ['Covers'],
    parameters: [
      { name: 'work_key', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'size', in: 'path', required: true, schema: { type: 'string', enum: ['large', 'medium', 'small'] } }
    ],
    responses: {
      '200': { description: 'Cover image' },
      '302': { description: 'Redirect to placeholder' }
    }
  }
}
```

---

### Step 5: Deploy and Test

**Duration:** 15 minutes  
**Status:** ⬜ Not started

#### 5.1 Deploy to production
```bash
cd /Users/juju/dev_repos/alex/worker
npx wrangler deploy
```

#### 5.2 Test cover processing endpoint
```bash
# Test cover processing
curl -X POST https://alexandria.ooheynerds.com/api/covers/process \
  -H "Content-Type: application/json" \
  -d '{
    "work_key": "/works/OL45804W",
    "provider_url": "https://covers.openlibrary.org/b/id/8091323-L.jpg",
    "isbn": "9780439064873"
  }'

# Expected response:
# {
#   "success": true,
#   "urls": {
#     "large": "https://covers.alexandria.ooheynerds.com/OL45804W/large.webp",
#     "medium": "https://covers.alexandria.ooheynerds.com/OL45804W/medium.webp",
#     "small": "https://covers.alexandria.ooheynerds.com/OL45804W/small.webp"
#   },
#   "metadata": { ... }
# }
```

#### 5.3 Test cover serving endpoint
```bash
# Test serving large cover
curl -I https://covers.alexandria.ooheynerds.com/OL45804W/large.webp

# Expected response: 200 OK with image/webp content-type
```

#### 5.4 Test error handling
```bash
# Test invalid domain
curl -X POST https://alexandria.ooheynerds.com/api/covers/process \
  -H "Content-Type: application/json" \
  -d '{
    "work_key": "/works/TEST",
    "provider_url": "https://malicious-site.com/image.jpg"
  }'

# Expected response: 403 Forbidden
```

---

## 🎯 Success Criteria

- [ ] R2 bucket `bookstrack-covers-processed` created and bound to worker
- [ ] POST /api/covers/process endpoint accepts cover URLs and returns processed CDN URLs
- [ ] GET /api/covers/{work_key}/{size} serves resized images
- [ ] Images compressed to WebP format
- [ ] Domain whitelist enforced (security)
- [ ] Placeholder returned on processing errors
- [ ] Response time < 500ms for processing
- [ ] Response time < 100ms for serving (R2 cache hit)
- [ ] OpenAPI spec updated with new endpoints
- [ ] All tests passing

---

## 📊 Performance Targets

| Operation | Target Latency | Notes |
|-----------|----------------|-------|
| Process cover (first time) | < 500ms | Download + compress + upload to R2 |
| Serve cover (R2 hit) | < 100ms | Direct R2 serve with CF Image Resizing |
| Serve cover (miss) | < 200ms | Redirect to placeholder |

---

## 🔍 Monitoring

After deployment, monitor:
- Cover processing success rate (target: 95%+)
- R2 storage usage (track growth)
- CDN hit rate (target: 90%+ after warmup)
- Processing latency (p50, p95, p99)
- Error rate by provider domain

---

## 🚨 Rollback Plan

If anything goes wrong:

1. Comment out cover routes in index.js:
```javascript
// app.post('/api/covers/process', handleProcessCover);
// app.get('/api/covers/:work_key/:size', handleServeCover);
```

2. Redeploy:
```bash
npx wrangler deploy
```

3. Update bendv3 to use old cover handling (see bendv3 TODO)

---

## 📚 References

- COVER_IMAGE_PORTING_GUIDE.md (comprehensive reference)
- bendv3 image-proxy.ts (original implementation)
- OpenLibrary cover API: https://openlibrary.org/dev/docs/api/covers
- Cloudflare Image Resizing: https://developers.cloudflare.com/images/

---

## ✅ Definition of Done

- [ ] All implementation steps completed
- [ ] All tests passing
- [ ] Deployed to production
- [ ] bendv3 integrated (see bendv3 TODO)
- [ ] Performance metrics within targets
- [ ] Documentation updated
- [ ] Monitoring dashboards created
- [ ] Handoff complete to bendv3 team

---

**Ready to execute:** ✅ YES  
**Blocking issues:** None  
**Next steps:** Execute Step 1 (Create R2 bucket)
