import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    // Integration tests will be skipped if HYPERDRIVE_CONNECTION_STRING is not set
    // To run integration tests: HYPERDRIVE_CONNECTION_STRING="postgresql://..." npm test
    // Exclude integration tests that require full Worker runtime (WASM modules)
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/integration/worker-runtime.test.ts', // Full Miniflare runtime (requires real Worker env)
      '**/integration/endpoints.test.ts',      // Endpoint tests (import app causes WASM issues)
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,js}', 'services/**/*.{ts,js}'],
      exclude: [
        'src/__tests__/**',
        'src/**/__tests__/**',
        'services/__tests__/**',
        'src/types.ts',
        'src/env.ts',
        'src/schemas/**',
      ],
      thresholds: {
        lines: 50,    // Week 3: Increase from 40% to 50%
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
});
