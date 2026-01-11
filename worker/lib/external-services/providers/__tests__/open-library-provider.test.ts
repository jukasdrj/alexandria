import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenLibraryProvider } from '../open-library-provider.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

describe('OpenLibraryProvider', () => {
  let provider: OpenLibraryProvider;
  let mockContext: ServiceContext;

  beforeEach(() => {
    provider = new OpenLibraryProvider();
    mockContext = {
      env: {} as Env,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  describe('provider metadata', () => {
    it('should have correct name', () => {
      expect(provider.name).toBe('open-library');
    });

    it('should be a free provider', () => {
      expect(provider.providerType).toBe('free');
    });

    it('should support correct capabilities', () => {
      expect(provider.capabilities).toEqual([
        ServiceCapability.ISBN_RESOLUTION,
        ServiceCapability.METADATA_ENRICHMENT,
      ]);
    });
  });

  describe('isAvailable', () => {
    it('should always return true (no API key required)', async () => {
      const available = await provider.isAvailable({} as Env);
      expect(available).toBe(true);
    });
  });

  describe('resolveISBN', () => {
    it('should return null for invalid ISBN', async () => {
      const result = await provider.resolveISBN(
        'The Hobbit',
        'J.R.R. Tolkien',
        mockContext
      );

      // Since no mock is set up, should fail gracefully
      expect(result.isbn).toBeNull();
      expect(result.confidence).toBe(0);
    });
  });

  describe('fetchMetadata', () => {
    it('should validate ISBN before making API call', async () => {
      const result = await provider.fetchMetadata('invalid-isbn', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'Invalid ISBN format, skipping OpenLibrary API call',
        { isbn: 'invalid-isbn' }
      );
    });

    it('should accept valid ISBN-10', async () => {
      // Valid ISBN-10 format should pass validation
      const result = await provider.fetchMetadata('0123456789', mockContext);

      // Will fail due to no mock, but should not fail validation
      expect(mockContext.logger.debug).not.toHaveBeenCalledWith(
        'Invalid ISBN format, skipping OpenLibrary API call',
        expect.anything()
      );
    });

    it('should accept valid ISBN-13', async () => {
      const result = await provider.fetchMetadata('9780123456789', mockContext);

      expect(mockContext.logger.debug).not.toHaveBeenCalledWith(
        'Invalid ISBN format, skipping OpenLibrary API call',
        expect.anything()
      );
    });
  });
});
