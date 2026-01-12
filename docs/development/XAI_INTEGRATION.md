# x.ai (Grok) Integration Guide

**Date**: 2026-01-12
**Status**: ✅ Integration Complete - Ready for Testing
**Purpose**: Compare x.ai's Grok models with Gemini for book metadata generation

---

## Overview

Alexandria now supports **x.ai (Grok)** as an AI provider for book metadata generation, allowing direct comparison with Google's Gemini models. This integration follows Alexandria's Service Provider Framework pattern and enables A/B testing of AI-generated book lists for backfill operations.

### Key Features

- ✅ **OpenAI-Compatible API**: Uses standard chat completions endpoint
- ✅ **JSON Mode**: Structured output for reliable parsing
- ✅ **Token Usage Tracking**: Logs prompt/completion tokens for cost analysis
- ✅ **Side-by-Side Comparison**: Dedicated test route comparing Gemini vs Grok
- ✅ **Service Provider Pattern**: Implements `IBookGenerator` capability interface

---

## API Documentation

- **API Base**: `https://api.x.ai/v1`
- **Official Docs**: [https://docs.x.ai/docs/overview](https://docs.x.ai/docs/overview)
- **API Reference**: [https://docs.x.ai/docs/api-reference](https://docs.x.ai/docs/api-reference)
- **Authentication**: Bearer token (header: `Authorization: Bearer <api_key>`)

### Available Models

| Model | Input Cost | Output Cost | Use Case |
|-------|-----------|-------------|----------|
| **grok-beta** | $5/M tokens | $15/M tokens | Default backfill (fast, balanced) |
| **grok-2-1212** | $2/M tokens | $10/M tokens | High-reasoning tasks (cheaper) |
| **grok-2-vision-1212** | - | - | Vision tasks (not used in Alexandria) |
| **grok-vision-beta** | - | - | Vision tasks (not used in Alexandria) |

**Default Model**: `grok-beta` (used in `XaiProvider`)

---

## Integration Architecture

### File Structure

```
worker/
├── lib/external-services/providers/
│   ├── xai-provider.ts          ← NEW: x.ai provider implementation
│   ├── gemini-provider.ts       ← Existing: Gemini provider for comparison
│   └── index.ts                 ← Updated: Export XaiProvider
├── src/
│   ├── env.ts                   ← Updated: Added XAI_API_KEY binding
│   ├── routes/
│   │   └── ai-comparison.ts     ← NEW: Comparison test route
│   └── index.ts                 ← Updated: Registered ai-comparison route
└── wrangler.jsonc               ← Updated: Added XAI_API_KEY secret binding
```

### XaiProvider Implementation

**Location**: `worker/lib/external-services/providers/xai-provider.ts`

**Capabilities**: `IBookGenerator` (generates synthetic book metadata)

**Key Methods**:
- `isAvailable(env)`: Check if `XAI_API_KEY` is configured
- `generateBooks(prompt, count, context)`: Generate book list from prompt

**Response Format**:
```typescript
interface GeneratedBook {
  title: string;
  author: string;
  publisher?: string;
  publishDate: string; // year as string
  description?: string; // significance explanation
  confidence: number;   // 30 (low - needs ISBN resolution)
  source: 'xai';
}
```

### Configuration

**Environment Variable** (wrangler.jsonc):
```jsonc
{
  "secrets_store_secrets": [
    {
      "binding": "XAI_API_KEY",
      "store_id": "b0562ac16fde468c8af12717a6c88400",
      "secret_name": "XAI_API_KEY"
    }
  ]
}
```

**Type Definition** (env.ts):
```typescript
export interface Env {
  XAI_API_KEY: {
    get(): Promise<string | null>;
  };
}
```

**Local Development** (.dev.vars):
```bash
XAI_API_KEY=xai-your-key-here
```

---

## Comparison Test Route

### Endpoint

**POST** `/api/test/ai-comparison`

### Request

```json
{
  "prompt": "significant science fiction books published in 2020",
  "count": 5
}
```

### Response

```json
{
  "prompt": "significant science fiction books published in 2020",
  "count": 5,
  "gemini": {
    "books": [
      {
        "title": "Network Effect",
        "author": "Martha Wells",
        "publisher": "Tor Books",
        "publishDate": "2020",
        "description": "Hugo Award winner, Murderbot Diaries series",
        "confidence": 30,
        "source": "gemini"
      }
    ],
    "duration_ms": 1234,
    "model": "gemini-2.5-flash"
  },
  "xai": {
    "books": [
      {
        "title": "Network Effect",
        "author": "Martha Wells",
        "publisher": "Tor Books",
        "publishDate": "2020",
        "description": "Fourth novel in the Murderbot Diaries series",
        "confidence": 30,
        "source": "xai"
      }
    ],
    "duration_ms": 987,
    "model": "grok-beta"
  },
  "analysis": {
    "gemini_count": 5,
    "xai_count": 5,
    "gemini_faster": false,
    "speed_difference_ms": 247,
    "unique_titles": {
      "gemini": ["Title 1", "Title 2"],
      "xai": ["Title 3", "Title 4"],
      "overlap": ["Network Effect"]
    }
  }
}
```

### Analysis Metrics

The response includes:
- **Duration**: Time taken by each provider (ms)
- **Speed Winner**: Which provider was faster
- **Title Overlap**: Books suggested by both providers
- **Unique Titles**: Books unique to each provider
- **Error Handling**: Captures API errors without failing entire request

---

## Usage Examples

### Test via curl

```bash
# Compare Gemini vs Grok for sci-fi books
curl -X POST https://alexandria.ooheynerds.com/api/test/ai-comparison \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "significant science fiction books published in 2020",
    "count": 5
  }' | jq .

# Test with historical prompt
curl -X POST https://alexandria.ooheynerds.com/api/test/ai-comparison \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "notable non-fiction books published in January 2019",
    "count": 10
  }' | jq .

# Test with fantasy prompt
curl -X POST https://alexandria.ooheynerds.com/api/test/ai-comparison \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "award-winning fantasy novels from 2021",
    "count": 8
  }' | jq .
```

### Local Development

```bash
# Start local dev server
cd worker/
npm run dev

# Test comparison endpoint
curl -X POST http://localhost:8787/api/test/ai-comparison \
  -H "Content-Type: application/json" \
  -d '{"prompt": "significant books from 2020", "count": 5}'
```

---

## Comparison Methodology

### What to Compare

1. **Accuracy**: Do books actually exist? Verify via Google/Goodreads
2. **Relevance**: Do books match the prompt criteria?
3. **Diversity**: Author diversity, genre diversity, publisher diversity
4. **Quality**: Are these "significant" books or obscure titles?
5. **Overlap**: Do both models suggest the same canonical titles?
6. **Speed**: Which model responds faster?
7. **Cost**: Token usage difference (Grok logs tokens in response)

### Evaluation Criteria

| Metric | How to Measure | Good Result |
|--------|---------------|-------------|
| **Hallucination Rate** | Search titles on Google | <10% non-existent books |
| **Relevance** | Does book match prompt year/genre? | >90% matching criteria |
| **Diversity** | Count unique authors | >80% unique authors |
| **Canonical Quality** | Check Goodreads ratings | Average >4.0 stars |
| **Overlap Rate** | Compare title lists | 30-50% overlap (balanced) |
| **Speed** | Duration_ms comparison | <2s for 10 books |
| **Token Efficiency** | Total tokens used | Lower is better |

---

## Cost Analysis

### Gemini Pricing (gemini-2.5-flash)

- **Input**: $0.075 per 1M tokens
- **Output**: $0.30 per 1M tokens
- **Average prompt**: ~200 tokens
- **Average response**: ~1000 tokens
- **Cost per 10 books**: ~$0.0003

### x.ai Pricing (grok-beta)

- **Input**: $5 per 1M tokens (67x more expensive)
- **Output**: $15 per 1M tokens (50x more expensive)
- **Average prompt**: ~200 tokens
- **Average response**: ~1000 tokens
- **Cost per 10 books**: ~$0.016

**Cost Comparison**: Grok is **~53x more expensive** than Gemini for this use case.

---

## When to Use Which Provider

### Use Gemini (Current Default)

- ✅ **Cost-sensitive**: 53x cheaper for book generation
- ✅ **Production backfill**: Proven track record, stable pricing
- ✅ **Large batches**: Monthly/annual backfill (thousands of books)

### Use Grok (Experimental)

- ✅ **Quality testing**: Compare accuracy/relevance vs Gemini
- ✅ **Specialized prompts**: If Grok shows higher accuracy in A/B tests
- ✅ **Non-cost-sensitive**: Research or one-time tasks

### Recommendation

**Continue using Gemini as primary provider** unless A/B testing shows Grok has significantly better accuracy (>20% improvement) to justify 53x cost increase.

**Use Grok for**: Comparison testing, evaluating new model capabilities, quality benchmarking.

---

## Testing Checklist

### Phase 1: Basic Functionality ✅

- [x] XaiProvider implements IBookGenerator interface
- [x] XAI_API_KEY configured in wrangler.jsonc and env.ts
- [x] Comparison route registered and accessible
- [x] Local development environment configured

### Phase 2: API Integration Testing

- [ ] Test with valid prompt and count=5
- [ ] Verify JSON parsing handles both array and object responses
- [ ] Confirm token usage is logged
- [ ] Test error handling (invalid API key, rate limits)
- [ ] Verify graceful degradation if one provider fails

### Phase 3: Quality Comparison

- [ ] Run 10 comparison tests with different prompts
- [ ] Manually verify book accuracy (Google search)
- [ ] Calculate hallucination rate for both providers
- [ ] Compare relevance and diversity metrics
- [ ] Document speed and cost differences

### Phase 4: Production Decision

- [ ] Analyze test results from Phase 3
- [ ] Determine if Grok accuracy justifies 53x cost
- [ ] Document recommendation in this file
- [ ] Update backfill service if switching providers

---

## Troubleshooting

### Error: "x.ai API key not configured"

**Cause**: `XAI_API_KEY` not found in environment

**Fix**:
```bash
# For local development
echo "XAI_API_KEY=xai-..." >> worker/.dev.vars

# For production (already configured in wrangler.jsonc)
# Secret should be automatically loaded from Cloudflare Secrets Store
```

### Error: "Unexpected x.ai response format"

**Cause**: Grok returned neither array nor `{books: [...]}` object

**Debug**:
```typescript
// Check XaiProvider logs for raw response
logger.error('Unexpected x.ai response format', { content });
```

**Fix**: Update `XaiProvider` parsing logic to handle new format

### Error: "Both providers failed"

**Cause**: Neither Gemini nor x.ai API keys configured

**Fix**: Configure at least one API key (Gemini recommended for cost)

### Slow Response Times (>5s)

**Cause**: Both providers running sequentially instead of parallel

**Check**: Verify `Promise.all()` in `ai-comparison.ts` route handler

---

## Future Enhancements

### Potential Improvements

1. **Model Selection**: Allow client to specify model (grok-beta vs grok-2-1212)
2. **Prompt Templates**: Pre-defined templates for common backfill scenarios
3. **Batch Comparison**: Test 50-100 books at once for statistical significance
4. **Quality Scoring**: Automated hallucination detection via Google Books API
5. **Cost Tracking**: Analytics Engine dataset for per-provider token usage
6. **Hybrid Mode**: Use Grok for initial generation, Gemini for refinement

### Provider Registry Integration

Once quality is validated, register XaiProvider in global registry:

```typescript
// In backfill orchestrator
import { XaiProvider } from '../providers/xai-provider.js';

const registry = getGlobalRegistry();
registry.register(new XaiProvider());

// Use via orchestrator
const generators = registry.getProvidersByCapability(ServiceCapability.BOOK_GENERATION);
// Returns: [GeminiProvider, XaiProvider]
```

---

## References

- **x.ai API Docs**: [https://docs.x.ai/docs/overview](https://docs.x.ai/docs/overview)
- **API Reference**: [https://docs.x.ai/docs/api-reference](https://docs.x.ai/docs/api-reference)
- **Cloudflare AI Gateway**: [https://developers.cloudflare.com/ai-gateway/usage/providers/grok/](https://developers.cloudflare.com/ai-gateway/usage/providers/grok/)
- **Service Provider Guide**: `docs/development/SERVICE_PROVIDER_GUIDE.md`
- **Gemini Provider**: `worker/lib/external-services/providers/gemini-provider.ts`

---

**Last Updated**: 2026-01-12
**Author**: Alexandria AI Team
**Status**: Ready for testing and evaluation
