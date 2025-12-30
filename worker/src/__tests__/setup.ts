/**
 * Vitest Test Setup
 *
 * Initializes MSW server for mocking external APIs (ISBNdb, Google Books, OpenLibrary).
 * Runs before all tests to intercept HTTP requests.
 */

import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers.js';

// Create MSW server with all handlers
export const server = setupServer(...handlers);

// Start server before all tests
beforeAll(() => {
  server.listen({
    onUnhandledRequest: 'warn', // Warn about unmocked requests instead of erroring
  });
  console.log('✅ MSW server started - external APIs mocked');
});

// Reset handlers after each test to prevent test pollution
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
  console.log('✅ MSW server closed');
});
