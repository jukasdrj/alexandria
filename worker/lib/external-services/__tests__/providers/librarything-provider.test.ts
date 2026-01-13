import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { LibraryThingProvider } from '../../providers/librarything-provider.js';
import type { ServiceContext } from '../../service-context.js';

// Mock the ServiceHttpClient to prevent actual network requests
vi.mock('../../http-client.js', () => {
  // Define mock class inside the factory
  const MockHttpClient = class {
    public fetch = vi.fn();
    constructor() {}
  };

  return {
    ServiceHttpClient: MockHttpClient,
  };
});

describe('LibraryThingProvider', () => {
  let provider: LibraryThingProvider;
  let mockContext: ServiceContext;
  let mockFetch: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LibraryThingProvider();

    // Get the mock instance of fetch from the mocked class
    // @ts-ignore - accessing private property for testing
    mockFetch = (provider['client'] as any).fetch;

    mockContext = {
      env: {
        LIBRARYTHING_API_KEY: {
          get: vi.fn().mockResolvedValue('test-api-key'),
        },
      } as any,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };
  });

  describe('isAvailable', () => {
    it('should return true when API key is present', async () => {
      const isAvailable = await provider.isAvailable(mockContext.env);
      expect(isAvailable).toBe(true);
    });

    it('should return false when API key is missing', async () => {
      mockContext.env.LIBRARYTHING_API_KEY = undefined as any;

      const envWithNullKey = {
        LIBRARYTHING_API_KEY: { get: vi.fn().mockResolvedValue(null) }
      } as any;

      expect(await provider.isAvailable(envWithNullKey)).toBe(false);
    });
  });

  describe('fetchEditionVariants', () => {
    it('should return empty array if API key is missing', async () => {
      mockContext.env.LIBRARYTHING_API_KEY = { get: vi.fn().mockResolvedValue(null) } as any;

      const result = await provider.fetchEditionVariants('9780547928227', mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.error).toHaveBeenCalledWith(expect.stringContaining('not configured'));
    });

    it('should normalize and parse valid XML response correctly', async () => {
      const xmlResponse = `
        <idlist>
          <isbn>9780547928227</isbn>
          <isbn>054792822X</isbn>
          <isbn>9780007440832</isbn>
        </idlist>
      `;
      mockFetch.mockResolvedValue(xmlResponse);

      // Input ISBN-10 to test normalization
      const result = await provider.fetchEditionVariants('054792822X', mockContext);

      expect(result).toHaveLength(2); // Should exclude the input ISBN (normalized)
      expect(result.map(v => v.isbn)).toContain('9780547928227');
      expect(result.map(v => v.isbn)).toContain('9780007440832');
      expect(result[0].source).toBe('librarything');
    });

    it('should handle XML with whitespace and newlines', async () => {
      const xmlResponse = `
        <idlist>
          <isbn>  9780547928227  </isbn>

          <isbn>9780007440832</isbn>
        </idlist>
      `;
      mockFetch.mockResolvedValue(xmlResponse);

      const result = await provider.fetchEditionVariants('9781111111111', mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].isbn).toBe('9780547928227');
    });

    it('should gracefully handle malformed XML', async () => {
      mockFetch.mockResolvedValue('<html><body>Error</body></html>');

      const result = await provider.fetchEditionVariants('9780547928227', mockContext);

      expect(result).toEqual([]);
    });

    it('should gracefully handle null response (network error)', async () => {
      mockFetch.mockResolvedValue(null);

      const result = await provider.fetchEditionVariants('9780547928227', mockContext);

      expect(result).toEqual([]);
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No response'),
        expect.anything()
      );
    });

    it('should handle empty idlist in XML', async () => {
      mockFetch.mockResolvedValue('<idlist></idlist>');
      const result = await provider.fetchEditionVariants('9780547928227', mockContext);
      expect(result).toEqual([]);
    });

    it('should filter out the requested ISBN from results', async () => {
      const targetIsbn = '9780547928227';
      const xmlResponse = `
        <idlist>
          <isbn>${targetIsbn}</isbn>
        </idlist>
      `;
      mockFetch.mockResolvedValue(xmlResponse);

      const result = await provider.fetchEditionVariants(targetIsbn, mockContext);

      expect(result).toEqual([]);
    });
  });

  describe('XML Regex Robustness', () => {
    it('should extract ISBNs but may fail on XML attributes', async () => {
      // Current regex: /<isbn>([^<]+)<\/isbn>/gi
      // Tests behavior with XML attributes
      const xmlResponse = `
        <idlist>
          <isbn type="10">0123456789</isbn>
          <isbn>9780123456789</isbn>
        </idlist>
      `;

      mockFetch.mockResolvedValue(xmlResponse);
      const result = await provider.fetchEditionVariants('9780000000000', mockContext);

      // We expect only the one without attributes to be found
      expect(result.map(r => r.isbn)).toContain('9780123456789');
      expect(result).toHaveLength(1);
    });
  });
});
