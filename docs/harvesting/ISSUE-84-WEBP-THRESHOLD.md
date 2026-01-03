# Issue #84: Skip WebP Conversion for Small Images

**Status:** ✅ COMPLETE (January 2, 2026)
**Implementation:** `worker/services/jsquash-processor.ts`
**Tests:** `worker/services/__tests__/jsquash-processor.test.ts`

## Problem

Small images (especially placeholders and low-resolution covers) experience **negative compression** when converted to WebP. The WebP format overhead (metadata, headers) can result in files larger than the original JPEG/PNG.

**Example:**
- Original JPEG: 3KB
- WebP conversion: 4.2KB ❌ (40% larger!)

This defeats the purpose of WebP conversion for bandwidth/storage savings.

## Solution

Implemented a **5KB threshold** below which images are stored in their original format:

```typescript
const MIN_SIZE_FOR_WEBP = 5000; // 5KB threshold

if (buffer.byteLength < MIN_SIZE_FOR_WEBP) {
  // Store original JPEG/PNG instead of converting to WebP
  console.log(`Image too small for WebP conversion (${buffer.byteLength} < ${MIN_SIZE_FOR_WEBP} bytes)`);
  // ... upload original format to all 3 size slots
}
```

## Implementation Details

### Location
`worker/services/jsquash-processor.ts` lines 40-328

### Behavior

**For images < 5KB:**
1. Decode image to verify format (JPEG/PNG)
2. **Skip** resize and WebP encoding
3. Store original buffer in **all 3 size slots** (large/medium/small)
4. Upload to R2 with original content type (`image/jpeg` or `image/png`)
5. Set metadata flag: `webpSkipped: true`, `reason: below_size_threshold`

**For images ≥ 5KB:**
- Normal pipeline: decode → resize → WebP encode → upload

### Storage Format

Small images are stored in R2 as:
```
isbn/{isbn}/large.jpg     (original)
isbn/{isbn}/medium.jpg    (original)
isbn/{isbn}/small.jpg     (original)
```

Instead of:
```
isbn/{isbn}/large.webp
isbn/{isbn}/medium.webp
isbn/{isbn}/small.webp
```

### Metadata

R2 objects include custom metadata:
```json
{
  "uploadedAt": "2026-01-02T...",
  "sourceUrl": "https://covers.openlibrary.org/...",
  "originalSize": "3000",
  "originalType": "jpeg",
  "webpSkipped": "true",
  "reason": "below_size_threshold"
}
```

## Test Coverage

**All 30 tests passing** ✅

Key tests for this feature:
- `should skip WebP conversion for small images (<5KB)` - Verifies threshold logic
- `should convert to WebP for normal-sized images (>5KB)` - Verifies normal path still works
- Domain whitelist, error handling, dimension scaling, R2 storage tests

### Run Tests
```bash
cd worker/
npm test -- jsquash-processor.test.ts
```

## Performance Impact

**Positive impacts:**
- No wasted CPU on unnecessary WebP encoding for small images
- Smaller file sizes for placeholder images (keeps original 3KB vs inflated 4KB WebP)
- Faster processing (skips decode → resize → encode pipeline)

**Tradeoffs:**
- Very small images served as JPEG/PNG instead of WebP
- Minimal impact: most cover images are > 20KB anyway

## Metrics

The `CoverProcessingResult` includes:
```typescript
{
  status: 'processed',
  metrics: {
    webpSkipped: true  // Only present for small images
  },
  compression: {
    webpSkipped: true,
    ratio: '0%'  // No compression applied
  }
}
```

## Production Usage

This fix is **automatically applied** during:
1. **Queue-based cover processing** (`alexandria-cover-queue`)
2. **Direct cover processing** (`POST /covers/:isbn/process`)
3. **Batch cover processing** (`POST /covers/batch`)
4. **Bulk author harvesting** (`scripts/bulk-author-harvest.js`)

No configuration changes needed - the 5KB threshold is hardcoded as a sensible default.

## Future Considerations

If the 5KB threshold proves too aggressive/conservative, it can be adjusted:
- Lower (e.g., 3KB) - Convert more images to WebP, accept some inflation
- Higher (e.g., 8KB) - Keep more small images in original format
- Make configurable via environment variable

Currently hardcoded at 5KB based on empirical testing showing consistent negative compression below this threshold.

---

**References:**
- Implementation: `worker/services/jsquash-processor.ts:40-328`
- Tests: `worker/services/__tests__/jsquash-processor.test.ts:346-415`
- TODO.md: Line 22-26
