// worker/scripts/validate-export.ts
import type { AlexandriaAppType } from '../src/index.js';
import { hc } from 'hono/client';

// This should compile without errors
const client = hc<AlexandriaAppType>('http://localhost:8787');

console.log('✅ Type exports validated successfully');
