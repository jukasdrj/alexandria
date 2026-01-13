import { defineConfig } from 'vitest/config';

/**
 * Sprint 0 Live-Fire Test Configuration
 *
 * Disables MSW to allow real API calls for integration testing.
 * Used to validate Service Provider Framework resilience without ISBNdb.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // NO setupFiles - this disables MSW completely
    include: ['**/lib/external-services/__tests__/sprint0-validation.test.ts'],
    testTimeout: 300000, // 5 minutes for real API calls
  },
});
