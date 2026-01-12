import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Bug-catching rules - these find real issues
    rules: {
      // Async/Promise bugs (very common)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',

      // Type safety
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Unused code (catches dead code and typos)
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Logic bugs
      'no-constant-condition': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'no-unreachable': 'error',
      'use-isnan': 'error',

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Error handling (Issue #128)
      'no-console': 'error', // Prevent console.* in production code

      // Style rules OFF - we don't care about formatting
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      '**/*.js', // Only lint TypeScript files
    ],
  },
  {
    // Allow console in test files, migration scripts, and development scripts
    files: [
      '**/__tests__/**',
      '**/*.test.ts',
      '**/routes/migrate.ts',
      '**/scripts/**',
    ],
    rules: {
      'no-console': 'off',
    },
  }
);
