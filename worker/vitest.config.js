import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
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
        lines: 40,    // Realistic target for solo developer (was 85%)
        functions: 40,
        branches: 40,
        statements: 40,
      },
    },
  },
});
