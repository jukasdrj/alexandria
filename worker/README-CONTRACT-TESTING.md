# Contract Testing with Alexandria

## Setup

Install the Alexandria worker package:

```bash
npm install alexandria-worker@latest
```

## Usage with Hono RPC Client

```typescript
import { hc } from 'hono/client';
import type { AlexandriaAppType } from 'alexandria-worker';

// Create type-safe client
const alexandria = hc<AlexandriaAppType>('https://alexandria.ooheynerds.com');

// Fully typed API calls
const books = await alexandria.api.search.$get({
  query: { isbn: '9780439064873' }
});

const result = await alexandria.api.enrich['batch-direct'].$post({
  json: { isbns: ['9780439064873'], source: 'bendv3' }
});
```

## Benefits

- ✅ Compile-time validation (catches breaking changes before deploy)
- ✅ Full autocomplete in VS Code
- ✅ No schema duplication
- ✅ No codegen step needed
