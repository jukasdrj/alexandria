import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveOrgProvider } from '../archive-org-provider.js';
import { ServiceCapability } from '../../capabilities.js';
import type { ServiceContext } from '../../service-context.js';
import type { Env } from '../../../../src/env.js';

describe('ArchiveOrgProvider', () => {
  let provider: ArchiveOrgProvider;
  let mockContext: ServiceContext;

  beforeEach(() => {
    provider = new ArchiveOrgProvider();
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
      expect(provider.name).toBe('archive.org');
    });

    it('should be a free provider', () => {
      expect(provider.providerType).toBe('free');
    });

    it('should support correct capabilities', () => {
      expect(provider.capabilities).toEqual([
        ServiceCapability.COVER_IMAGES,
        ServiceCapability.METADATA_ENRICHMENT,
        ServiceCapability.ISBN_RESOLUTION,
        ServiceCapability.PUBLIC_DOMAIN,
      ]);
    });
  });

  describe('isAvailable', () => {
    it('should always return true (no API key required)', async () => {
      const available = await provider.isAvailable({} as Env);
      expect(available).toBe(true);
    });
  });

  describe('checkPublicDomain', () => {
    it('should return null for invalid ISBN', async () => {
      const result = await provider.checkPublicDomain('invalid-isbn', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'Invalid ISBN format, skipping Archive.org API call',
        { isbn: 'invalid-isbn' }
      );
    });

    it('should handle books published before 1928 (definitely public domain)', async () => {
      // Mock response for a pre-1928 book
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'prideandprejudic00aust',
              date: '1813',
            },
          ],
        },
      });

      // Inject mock into provider's client
      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780141439518', mockContext);

      expect(result).not.toBeNull();
      expect(result?.isPublicDomain).toBe(true);
      expect(result?.confidence).toBe(90); // High confidence
      expect(result?.reason).toBe('publication-date');
      expect(result?.copyrightExpiry).toBe(1813);
      expect(result?.downloadUrl).toBe('https://archive.org/details/prideandprejudic00aust');
      expect(result?.source).toBe('archive.org');
    });

    it('should handle books published 1928-1977 (possibly public domain)', async () => {
      // Mock response for a mid-century book
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'nineteeneightyfou00orwe',
              date: '1949',
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780451524935', mockContext);

      expect(result).not.toBeNull();
      expect(result?.isPublicDomain).toBe(true);
      expect(result?.confidence).toBe(60); // Medium confidence (uncertain about renewal)
      expect(result?.reason).toBe('publication-date');
      expect(result?.copyrightExpiry).toBeUndefined(); // Not set for uncertain cases
      expect(result?.downloadUrl).toBe('https://archive.org/details/nineteeneightyfou00orwe');
      expect(result?.source).toBe('archive.org');
    });

    it('should handle books published after 1977 (not public domain)', async () => {
      // Mock response for a modern book
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'harrypotterphilo00rowl',
              date: '1997',
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780439708180', mockContext);

      expect(result).not.toBeNull();
      expect(result?.isPublicDomain).toBe(false);
      expect(result?.confidence).toBe(90); // High confidence
      expect(result?.reason).toBe('publication-date');
      expect(result?.copyrightExpiry).toBeUndefined(); // Not public domain
      expect(result?.downloadUrl).toBe('https://archive.org/details/harrypotterphilo00rowl');
      expect(result?.source).toBe('archive.org');
    });

    it('should handle date in YYYY-MM-DD format', async () => {
      // Mock response with full date
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'test_id',
              date: '1925-06-15', // Full date format
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780123456789', mockContext);

      expect(result).not.toBeNull();
      expect(result?.isPublicDomain).toBe(true);
      expect(result?.confidence).toBe(90); // Pre-1928
    });

    it('should return null when no results found', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9999999999999', mockContext);

      expect(result).toBeNull();
    });

    it('should return null when date field is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'test_id',
              // date field missing
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780123456789', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'No publication date available for public domain check',
        expect.objectContaining({
          isbn: '9780123456789',
          identifier: 'test_id',
        })
      );
    });

    it('should handle invalid date format gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'test_id',
              date: 'invalid-date',
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780123456789', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        'Invalid publication year format',
        expect.objectContaining({
          isbn: '9780123456789',
          date: 'invalid-date',
        })
      );
    });

    it('should handle missing identifier gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              // identifier missing
              date: '1920',
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      const result = await provider.checkPublicDomain('9780123456789', mockContext);

      expect(result).not.toBeNull();
      expect(result?.isPublicDomain).toBe(true);
      expect(result?.downloadUrl).toBeUndefined(); // No download URL without identifier
    });

    it('should log debug info when checking public domain status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [
            {
              identifier: 'test_id',
              date: '1920',
            },
          ],
        },
      });

      (provider as any).client.fetch = mockFetch;

      await provider.checkPublicDomain('9780123456789', mockContext);

      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'Public domain status checked (heuristic)',
        expect.objectContaining({
          isbn: '9780123456789',
          publicationYear: 1920,
          isPublicDomain: true,
          confidence: 90,
          hasDownloadUrl: true,
        })
      );
    });
  });

  describe('fetchCover', () => {
    it('should validate ISBN before making API call', async () => {
      const result = await provider.fetchCover('invalid-isbn', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'Invalid ISBN format, skipping Archive.org API call',
        { isbn: 'invalid-isbn' }
      );
    });
  });

  describe('fetchMetadata', () => {
    it('should validate ISBN before making API call', async () => {
      const result = await provider.fetchMetadata('invalid-isbn', mockContext);

      expect(result).toBeNull();
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        'Invalid ISBN format, skipping Archive.org API call',
        { isbn: 'invalid-isbn' }
      );
    });
  });

  describe('resolveISBN', () => {
    it('should escape Lucene special characters to prevent query injection', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        response: {
          docs: [],
        },
      });

      (provider as any).client.fetch = mockFetch;

      await provider.resolveISBN(
        'Test + Book - (Part 1)',
        'Author & Co.',
        mockContext
      );

      // Check that special characters were escaped
      const callUrl = mockFetch.mock.calls[0][0] as string;
      // URL encoding: spaces become +, backslashes become %5C
      expect(callUrl).toContain('%5C%2B'); // \+ (escaped + in Lucene)
      expect(callUrl).toContain('%5C-'); // \- (escaped - in Lucene)
      expect(callUrl).toContain('%5C%26'); // \& (escaped & in Lucene)
      expect(callUrl).toContain('%5C%28'); // \( (escaped ( in Lucene)
    });
  });
});
