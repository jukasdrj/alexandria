// =================================================================================
// Identifier Resolver Tests
// =================================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveIdentifier } from '../identifier-resolver.js';

// Mock fetch globally - use vi.spyOn to override global fetch
const originalFetch = global.fetch;
const mockFetch = vi.fn();

describe('Identifier Resolver', () => {
  let mockCache: KVNamespace;

  beforeEach(() => {
    // Override global fetch with our mock
    global.fetch = mockFetch as any;
    mockFetch.mockReset();

    // Mock KV cache
    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace;
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('VIAF Resolution', () => {
    it('should resolve VIAF ID to Wikidata Q-ID via linked data', async () => {
      const mockViafResponse = {
        viafID: '97113511',
        mainHeadings: {
          data: [{ text: 'King, Stephen, 1947-' }],
        },
        '@graph': [
          {
            '@type': 'Person',
            'schema:name': 'Stephen King',
            'schema:sameAs': [
              'http://www.wikidata.org/entity/Q39829',
              'https://www.imdb.com/name/nm0000175/',
            ],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockViafResponse,
      });

      const result = await resolveIdentifier('viaf', '97113511', mockCache);

      expect(result).toMatchObject({
        identifier_type: 'viaf',
        identifier_value: '97113511',
        wikidata_id: 'Q39829',
        author_name: 'King, Stephen, 1947-',
        source: 'viaf',
        cached: false,
        resolution_method: 'viaf_linked_data',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://viaf.org/viaf/97113511/viaf.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );

      // Should cache the result
      expect(mockCache.put).toHaveBeenCalledWith(
        'identifier:viaf:97113511',
        expect.any(String),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
      );
    });

    it('should normalize VIAF ID (remove prefixes)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          viafID: '97113511',
          '@graph': [
            {
              '@type': 'Person',
              'schema:sameAs': ['http://www.wikidata.org/entity/Q39829'],
            },
          ],
        }),
      });

      await resolveIdentifier('viaf', 'viaf:97113511', mockCache);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://viaf.org/viaf/97113511/viaf.json',
        expect.any(Object)
      );
    });

    it('should reject invalid VIAF ID format', async () => {
      await expect(resolveIdentifier('viaf', 'not-a-number', mockCache)).rejects.toThrow(
        'Invalid VIAF ID format'
      );
    });

    it('should fallback to Wikidata SPARQL when VIAF has no Wikidata link', async () => {
      // First call: VIAF returns no Wikidata link
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          viafID: '97113511',
          '@graph': [
            {
              '@type': 'Person',
              'schema:name': 'Stephen King',
              'schema:sameAs': ['https://www.imdb.com/name/nm0000175/'],
            },
          ],
        }),
      });

      // Second call: Wikidata SPARQL returns Q-ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                author: { value: 'http://www.wikidata.org/entity/Q39829' },
                authorLabel: { value: 'Stephen King' },
              },
            ],
          },
        }),
      });

      const result = await resolveIdentifier('viaf', '97113511', mockCache);

      expect(result).toMatchObject({
        identifier_type: 'viaf',
        wikidata_id: 'Q39829',
        source: 'wikidata_sparql',
        resolution_method: 'wikidata_sparql_lookup',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return cached VIAF result when available', async () => {
      const cachedResult = {
        identifier_type: 'viaf' as const,
        identifier_value: '97113511',
        wikidata_id: 'Q39829',
        author_name: 'Stephen King',
        source: 'viaf' as const,
        cached: false,
      };

      mockCache.get = vi.fn().mockResolvedValue(cachedResult);

      const result = await resolveIdentifier('viaf', '97113511', mockCache);

      expect(result).toMatchObject({
        ...cachedResult,
        cached: true,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('ISNI Resolution', () => {
    it('should resolve ISNI to Wikidata Q-ID via linked data', async () => {
      const mockIsniResponse = {
        '@graph': [
          {
            '@id': 'https://isni.org/isni/0000000121441970',
            '@type': 'Person',
            'foaf:name': 'Douglas Adams',
            'owl:sameAs': [
              'http://www.wikidata.org/entity/Q42',
              'https://viaf.org/viaf/113230702',
            ],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockIsniResponse,
      });

      const result = await resolveIdentifier('isni', '0000 0001 2144 1970', mockCache);

      expect(result).toMatchObject({
        identifier_type: 'isni',
        identifier_value: '0000 0001 2144 1970',
        wikidata_id: 'Q42',
        author_name: 'Douglas Adams',
        source: 'isni',
        cached: false,
        resolution_method: 'isni_linked_data',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://isni.org/isni/0000000121441970',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/ld+json, application/json',
          }),
        })
      );
    });

    it('should normalize ISNI (remove spaces/dashes)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@graph': [
            {
              'owl:sameAs': ['http://www.wikidata.org/entity/Q42'],
            },
          ],
        }),
      });

      await resolveIdentifier('isni', '0000-0001-2144-1970', mockCache);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://isni.org/isni/0000000121441970',
        expect.any(Object)
      );
    });

    it('should reject invalid ISNI format', async () => {
      await expect(resolveIdentifier('isni', '12345', mockCache)).rejects.toThrow(
        'Invalid ISNI format'
      );

      await expect(resolveIdentifier('isni', 'not-a-number', mockCache)).rejects.toThrow(
        'Invalid ISNI format'
      );
    });

    it('should fallback to Wikidata SPARQL when ISNI has no Wikidata link', async () => {
      // First call: ISNI returns no Wikidata link
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@graph': [
            {
              'foaf:name': 'Douglas Adams',
              'owl:sameAs': ['https://viaf.org/viaf/113230702'],
            },
          ],
        }),
      });

      // Second call: Wikidata SPARQL returns Q-ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                author: { value: 'http://www.wikidata.org/entity/Q42' },
                authorLabel: { value: 'Douglas Adams' },
              },
            ],
          },
        }),
      });

      const result = await resolveIdentifier('isni', '0000 0001 2144 1970', mockCache);

      expect(result).toMatchObject({
        identifier_type: 'isni',
        wikidata_id: 'Q42',
        source: 'wikidata_sparql',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Wikidata SPARQL Fallback', () => {
    it('should query Wikidata SPARQL when primary resolution fails', async () => {
      // First call: VIAF API error
      mockFetch.mockRejectedValueOnce(new Error('VIAF API error'));

      // Second call: Wikidata SPARQL success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [
              {
                author: { value: 'http://www.wikidata.org/entity/Q39829' },
                authorLabel: { value: 'Stephen King' },
              },
            ],
          },
        }),
      });

      const result = await resolveIdentifier('viaf', '97113511', mockCache);

      expect(result).toMatchObject({
        identifier_type: 'viaf',
        wikidata_id: 'Q39829',
        source: 'wikidata_sparql',
      });
    });

    it('should return null wikidata_id when not found in Wikidata', async () => {
      mockFetch.mockRejectedValueOnce(new Error('VIAF API error'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            bindings: [],
          },
        }),
      });

      const result = await resolveIdentifier('viaf', '99999999', mockCache);

      expect(result).toMatchObject({
        identifier_type: 'viaf',
        wikidata_id: null,
        source: 'wikidata_sparql',
      });

      // Should cache failures for 1 day (not 30 days)
      expect(mockCache.put).toHaveBeenCalledWith(
        'identifier:viaf:99999999',
        expect.any(String),
        { expirationTtl: 24 * 60 * 60 } // 1 day
      );
    });
  });

  describe('Caching', () => {
    it('should work without cache (cache is optional)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@graph': [
            {
              '@type': 'Person',
              'schema:sameAs': ['http://www.wikidata.org/entity/Q39829'],
            },
          ],
        }),
      });

      const result = await resolveIdentifier('viaf', '97113511'); // No cache param

      expect(result).toMatchObject({
        wikidata_id: 'Q39829',
        cached: false,
      });
    });

    it('should cache successful resolutions for 30 days', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          viafID: '97113511',
          '@graph': [
            {
              '@type': 'Person',
              'schema:sameAs': ['http://www.wikidata.org/entity/Q39829'],
            },
          ],
        }),
      });

      await resolveIdentifier('viaf', '97113511', mockCache);

      expect(mockCache.put).toHaveBeenCalledWith(
        'identifier:viaf:97113511',
        expect.any(String),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );
    });

    it('should cache failures for 1 day', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API error'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: { bindings: [] },
        }),
      });

      await resolveIdentifier('viaf', '99999999', mockCache);

      expect(mockCache.put).toHaveBeenCalledWith(
        'identifier:viaf:99999999',
        expect.any(String),
        { expirationTtl: 24 * 60 * 60 } // 1 day (not 30)
      );
    });
  });

  describe('Q-ID Extraction', () => {
    it('should extract Q-ID from various Wikidata URI formats', async () => {
      const testCases = [
        'http://www.wikidata.org/entity/Q42',
        'https://www.wikidata.org/entity/Q42',
        'https://www.wikidata.org/wiki/Q42',
        'Q42',
      ];

      for (const uri of testCases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            viafID: '12345678',
            '@graph': [
              {
                '@type': 'Person',
                'schema:sameAs': [uri],
              },
            ],
          }),
        });

        const result = await resolveIdentifier('viaf', '12345678', mockCache);
        expect(result.wikidata_id).toBe('Q42');
      }
    });
  });
});
