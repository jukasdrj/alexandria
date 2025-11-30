# Alexandria Image Processing Pipeline

**Purpose:** Download, convert, resize, and cache book cover images  
**Target:** 3 sizes in WebP format stored in R2  
**Source:** Port from bendv3's existing image utilities

---

## Overview

Alexandria needs to process cover images from various providers (OpenLibrary, ISBNdb, Google Books) and store optimized versions in R2 for fast CDN delivery.

**Input:** Provider cover URL (various formats, sizes)  
**Output:** 3 WebP images in R2 + CDN URLs

---

## Architecture

```
Provider URL
  ↓
Download original → Validate → Convert to WebP → Generate 3 sizes
  ↓              ↓            ↓                  ↓
Large (800px)  Medium (400px)  Small (200px)  Upload to R2
  ↓
Return CDN URLs
```

---

## bendv3 Image Processing Code to Port

### Location in bendv3
Look for these modules in bendv3 repo:

```
bendv3/
├── src/
│   ├── utils/
│   │   ├── image-processor.js     ← Core image processing
│   │   ├── webp-converter.js      ← WebP conversion logic
│   │   └── r2-upload.js           ← R2 upload helpers
│   └── services/
│       └── cover-service.js        ← Cover fetching/selection
```

### Key Functions to Port

#### 1. Image Download & Validation
```javascript
// src/utils/image-processor.js (bendv3)

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Alexandria/1.0 (covers@ooheynerds.com)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  
  const contentType = response.headers.get('content-type');
  if (!contentType?.startsWith('image/')) {
    throw new Error(`Invalid content type: ${contentType}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  
  // Validate file size (max 10MB)
  if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
    throw new Error('Image too large (>10MB)');
  }
  
  return new Uint8Array(arrayBuffer);
}
```

#### 2. WebP Conversion
```javascript
// src/utils/webp-converter.js (bendv3)

async function convertToWebP(imageBuffer, options = {}) {
  const {
    quality = 85,
    width = null,
    height = null,
    preserveAspectRatio = true
  } = options;
  
  // Use Cloudflare Image Resizing API or sharp.js
  // bendv3 should have this implemented already
  
  // Example using fetch with CF image resizing:
  const params = new URLSearchParams({
    format: 'webp',
    quality: quality.toString(),
    ...(width && { width: width.toString() }),
    ...(height && { height: height.toString() }),
    fit: preserveAspectRatio ? 'scale-down' : 'cover'
  });
  
  // This is pseudocode - check bendv3 for actual implementation
  const resizedImage = await resizeImage(imageBuffer, params);
  
  return resizedImage;
}
```

#### 3. Multi-Size Generation
```javascript
// src/utils/image-processor.js (bendv3)

const SIZES = {
  large: { width: 800, maxFileSize: 200 * 1024 },  // 200KB
  medium: { width: 400, maxFileSize: 50 * 1024 },  // 50KB
  small: { width: 200, maxFileSize: 20 * 1024 }    // 20KB
};

async function generateSizes(originalImage) {
  const results = {};
  
  for (const [sizeName, config] of Object.entries(SIZES)) {
    try {
      let quality = 85;
      let webpImage = await convertToWebP(originalImage, {
        width: config.width,
        quality
      });
      
      // Reduce quality if file too large
      while (webpImage.byteLength > config.maxFileSize && quality > 50) {
        quality -= 5;
        webpImage = await convertToWebP(originalImage, {
          width: config.width,
          quality
        });
      }
      
      results[sizeName] = {
        buffer: webpImage,
        size: webpImage.byteLength,
        quality
      };
      
    } catch (err) {
      console.error(`Failed to generate ${sizeName}:`, err);
      results[sizeName] = null;
    }
  }
  
  return results;
}
```

#### 4. R2 Upload
```javascript
// src/utils/r2-upload.js (bendv3)

async function uploadToR2(env, key, buffer, metadata = {}) {
  await env.COVER_IMAGES.put(key, buffer, {
    httpMetadata: {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: {
      uploadedAt: new Date().toISOString(),
      ...metadata
    }
  });
}

async function uploadCoverSizes(env, workKey, sizes) {
  const urls = {};
  
  for (const [sizeName, data] of Object.entries(sizes)) {
    if (!data) continue;
    
    const key = `covers/${workKey}/${sizeName}.webp`;
    
    await uploadToR2(env, key, data.buffer, {
      originalSize: data.size.toString(),
      quality: data.quality.toString()
    });
    
    urls[sizeName] = `https://covers.alexandria.ooheynerds.com/${workKey}/${sizeName}.webp`;
  }
  
  return urls;
}
```

---

## Complete Cover Processing Flow

### Main Function for Alexandria
```javascript
// src/handlers/process-cover.js (NEW in Alexandria)

export async function processCover(env, workKey, providerUrl) {
  try {
    // 1. Download original
    console.log(`Downloading cover from ${providerUrl}`);
    const originalImage = await downloadImage(providerUrl);
    
    // 2. Generate 3 sizes
    console.log('Generating WebP sizes...');
    const sizes = await generateSizes(originalImage);
    
    // Validate at least one size succeeded
    if (!sizes.large && !sizes.medium && !sizes.small) {
      throw new Error('All size generations failed');
    }
    
    // 3. Upload to R2
    console.log('Uploading to R2...');
    const urls = await uploadCoverSizes(env, workKey, sizes);
    
    // 4. Return CDN URLs
    return {
      success: true,
      urls: {
        large: urls.large || null,
        medium: urls.medium || urls.large || null,  // Fallback chain
        small: urls.small || urls.medium || urls.large || null
      },
      metadata: {
        processedAt: new Date().toISOString(),
        originalSize: originalImage.byteLength,
        compressedSizes: {
          large: sizes.large?.size,
          medium: sizes.medium?.size,
          small: sizes.small?.size
        }
      }
    };
    
  } catch (error) {
    console.error('Cover processing failed:', error);
    return {
      success: false,
      error: error.message,
      urls: {
        large: null,
        medium: null,
        small: null
      }
    };
  }
}
```

---

## Integration with Enrichment Endpoints

### In POST /api/enrich/edition
```javascript
// src/handlers/enrich-edition.js

export async function enrichEdition(env, request) {
  const data = await request.json();
  
  // ... validate ISBN, work_key, etc.
  
  // Process cover image if URL provided
  let coverUrls = { large: null, medium: null, small: null };
  
  if (data.cover_url) {
    const result = await processCover(env, data.work_key, data.cover_url);
    
    if (result.success) {
      coverUrls = result.urls;
    } else {
      console.warn('Cover processing failed, storing provider URL as fallback');
      // Store provider URL as fallback
      coverUrls.large = data.cover_url;
    }
  }
  
  // Insert/update enriched_editions
  await env.DB.prepare(`
    INSERT INTO enriched_editions (
      isbn, work_key, title, publisher, 
      cover_url_large, cover_url_medium, cover_url_small,
      cover_source, primary_provider, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    ON CONFLICT (isbn) DO UPDATE SET
      cover_url_large = EXCLUDED.cover_url_large,
      cover_url_medium = EXCLUDED.cover_url_medium,
      cover_url_small = EXCLUDED.cover_url_small,
      updated_at = NOW()
  `).bind(
    data.isbn,
    data.work_key,
    data.title,
    data.publisher,
    coverUrls.large,
    coverUrls.medium,
    coverUrls.small,
    data.provider,
    data.provider
  ).run();
  
  return new Response(JSON.stringify({
    success: true,
    edition: {
      isbn: data.isbn,
      work_key: data.work_key,
      cover_urls: coverUrls
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

---

## Provider Cover URL Patterns

### OpenLibrary
```
Large:  https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg
Medium: https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg
Small:  https://covers.openlibrary.org/b/isbn/{isbn}-S.jpg

Alt:    https://covers.openlibrary.org/b/id/{cover_id}-L.jpg
```

### Google Books
```
Thumbnail:  {volumeInfo.imageLinks.thumbnail}      (128x192)
Small:      {volumeInfo.imageLinks.smallThumbnail}  (80x120)
Medium:     {volumeInfo.imageLinks.medium}          (variable)
Large:      {volumeInfo.imageLinks.large}           (variable)
ExtraLarge: {volumeInfo.imageLinks.extraLarge}      (variable)

Note: Google often provides low-res. May need upscaling.
```

### ISBNdb
```
Direct URL in response: {book.image}
Usually high quality, variable size
```

---

## Cover Selection Strategy (from bendv3)

**Priority Order:**
1. ISBNdb cover (highest quality, if available)
2. Google Books `extraLarge` or `large`
3. OpenLibrary Large (-L.jpg)
4. Google Books `medium`
5. OpenLibrary Medium (-M.jpg)
6. Google Books `thumbnail`
7. Placeholder image

**Quality Hints:**
```javascript
function getCoverQualityHint(providerUrl) {
  if (providerUrl.includes('isbndb.com')) return 'high';
  if (providerUrl.includes('books.google.com') && providerUrl.includes('large')) return 'high';
  if (providerUrl.includes('openlibrary.org') && providerUrl.includes('-L.jpg')) return 'medium';
  if (providerUrl.includes('books.google.com') && providerUrl.includes('thumbnail')) return 'low';
  return 'unknown';
}
```

---

## Testing Checklist

### Unit Tests
- [ ] Download image from valid URL
- [ ] Handle 404/403 errors gracefully
- [ ] Validate image format (reject non-images)
- [ ] Reject oversized images (>10MB)
- [ ] Convert JPEG to WebP
- [ ] Convert PNG to WebP
- [ ] Generate 800px width image
- [ ] Generate 400px width image
- [ ] Generate 200px width image
- [ ] Compress to target file sizes
- [ ] Upload to R2 successfully
- [ ] Generate correct CDN URLs

### Integration Tests
- [ ] Process OpenLibrary cover
- [ ] Process Google Books cover
- [ ] Process ISBNdb cover
- [ ] Handle missing cover URL (skip gracefully)
- [ ] Handle provider 404 (fallback to placeholder)
- [ ] Verify R2 storage after upload
- [ ] Verify CDN serves images correctly
- [ ] Test concurrent uploads (race conditions)

### Performance Tests
- [ ] Process 100 covers concurrently
- [ ] Measure average processing time (<500ms target)
- [ ] Verify R2 rate limits not exceeded
- [ ] Check Worker CPU usage (<100ms ideal)

---

## Monitoring & Alerts

### Metrics to Track
```javascript
env.ANALYTICS_ENGINE.writeDataPoint({
  blobs: [
    'cover_processing',
    workKey,
    provider,
    success ? 'success' : 'failure'
  ],
  doubles: [
    processingTimeMs,
    originalSizeBytes,
    compressedSizeLarge,
    compressedSizeMedium,
    compressedSizeSmall
  ]
});
```

### Dashboard Queries
- Cover processing success rate
- Average processing time
- R2 storage growth (GB/day)
- Failed providers (which sources fail most)
- Compression ratio (original vs WebP)

---

## Next Steps

1. **Find bendv3 image code:**
   ```bash
   cd /Users/juju/dev_repos/bendv3
   grep -r "webp\|convertImage\|processcover" src/
   ```

2. **Copy to Alexandria:**
   ```bash
   cd /Users/juju/dev_repos/alex
   mkdir -p src/utils
   # Copy relevant files from bendv3
   ```

3. **Test image processing:**
   ```javascript
   // Quick test in Worker
   const testUrl = 'https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg';
   const result = await processCover(env, '/works/OL45804W', testUrl);
   console.log(result);
   ```

4. **Deploy to dev:**
   ```bash
   npx wrangler dev
   # Test with curl or Postman
   ```

---

## Questions for bendv3 Code Review

When porting from bendv3, check for:
- Which library does bendv3 use for image processing? (sharp.js? CF Image Resizing?)
- Are there utility functions for provider URL selection?
- How does bendv3 handle cover fallbacks?
- Any edge cases or gotchas discovered during bendv3 development?
- Performance optimizations learned?

**Action:** Review bendv3 codebase and document findings here.
