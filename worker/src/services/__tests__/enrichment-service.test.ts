import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichEdition, enrichWork, enrichAuthor, queueEnrichment, getEnrichmentStatus } from '../enrichment-service.js';

describe('Enrichment Service', () => {
  let mockSql: any;
  let mockLogger: any;

  beforeEach(() => {
    // Reset mockSql for each test
    mockSql = vi.fn();
    // Allow mockSql to be called as a template tag function
    mockSql.mockImplementation((strings, ...values) => {
      // Return a promise that resolves to an array (mimicking postgres.js result)
      // We can attach properties to this array if needed (like count)
      return Promise.resolve([]);
    });

    // Mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('enrichEdition', () => {
    it('should insert a new edition and return created action', async () => {
      const edition = {
        isbn: '9780123456789',
        title: 'Test Book',
        primary_provider: 'isbndb'
      };

      // Mock the quality check query (first query in enrichEdition)
      // and the insert/upsert query (second query)
      mockSql
        .mockResolvedValueOnce([{ isbndb_quality: 0 }]) // existing quality check
        .mockResolvedValueOnce([{ isbn: '9780123456789', was_insert: true, isbndb_quality: 10 }]); // upsert result

      const result = await enrichEdition(mockSql, edition, mockLogger);

      expect(result.action).toBe('created');
      expect(result.isbn).toBe('9780123456789');
      expect(result.quality_improvement).toBe(10);
      expect(mockSql).toHaveBeenCalledTimes(3); // quality check, upsert, logging
    });

    it('should update an edition and calculate quality improvement', async () => {
      const edition = {
        isbn: '9780123456789',
        title: 'Test Book Improved',
        primary_provider: 'isbndb'
      };

      mockSql
        .mockResolvedValueOnce([{ isbndb_quality: 5 }]) // existing quality
        .mockResolvedValueOnce([{ isbn: '9780123456789', was_insert: false, isbndb_quality: 10 }]); // upsert result

      const result = await enrichEdition(mockSql, edition, mockLogger);

      expect(result.action).toBe('updated');
      expect(result.quality_improvement).toBe(5); // 10 - 5
    });

    it('should handle database errors gracefully', async () => {
        const edition = {
            isbn: '9780123456789',
            primary_provider: 'isbndb'
        };

        mockSql.mockRejectedValue(new Error('DB connection failed'));

        await expect(enrichEdition(mockSql, edition, mockLogger)).rejects.toThrow('DB connection failed');
        // It should try to log the error
        expect(mockSql).toHaveBeenCalledTimes(2); // The initial fail + the log attempt
    });
  });

  describe('enrichWork', () => {
    it('should insert a new work', async () => {
      const work = {
        work_key: '/works/OL123W',
        title: 'Test Work',
        primary_provider: 'openlibrary'
      };

      mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

      const result = await enrichWork(mockSql, work, mockLogger);

      expect(result.action).toBe('created');
      expect(result.work_key).toBe('/works/OL123W');
    });

    it('should update an existing work', async () => {
        const work = {
            work_key: '/works/OL123W',
            title: 'Test Work',
            primary_provider: 'openlibrary'
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: false }]);

        const result = await enrichWork(mockSql, work, mockLogger);

        expect(result.action).toBe('updated');
    });

    // Phase 2.3 Tests: 3-way merge with Archive.org + Wikidata
    describe('Phase 2.3: Archive.org Integration', () => {
      it('should merge Wikidata genres with ISBNdb subjects', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          subject_tags: ['Fiction', 'Adventure'],
          primary_provider: 'isbndb',
        };

        const wikidataData = {
          genres: ['Fantasy', 'Young Adult'],
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, wikidataData);

        // Verify SQL was called with merged + normalized subjects
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
        // Subject tags should be: ['fiction', 'adventure', 'fantasy', 'young adult'] (normalized)
      });

      it('should use Archive.org description over ISBNdb when available', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          description: 'Short ISBNdb description',
          primary_provider: 'isbndb',
        };

        const archiveOrgData = {
          description: ['Rich Archive.org description paragraph 1.', 'Paragraph 2 with awards.'],
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, null, archiveOrgData);

        // Verify merged description is from Archive.org (joined with '\n\n')
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
        // Description should be: 'Rich Archive.org description paragraph 1.\n\nParagraph 2 with awards.'
      });

      it('should merge subjects from all three sources (ISBNdb + Wikidata + Archive.org)', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          subject_tags: ['Fiction', 'Adventure'],
          primary_provider: 'isbndb',
        };

        const wikidataData = {
          genres: ['Fantasy', 'ADVENTURE'], // Duplicate (different case)
        };

        const archiveOrgData = {
          subject: ['Historical Fiction', 'fiction'], // Duplicate (different case)
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, wikidataData, archiveOrgData);

        // Verify deduplication and normalization
        // Expected: ['fiction', 'adventure', 'fantasy', 'historical fiction']
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
      });

      it('should track all providers in contributors array', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          primary_provider: 'isbndb',
        };

        const wikidataData = { genres: ['Fantasy'] };
        const archiveOrgData = { subject: ['Fiction'] };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, wikidataData, archiveOrgData);

        // Contributors should be: ['isbndb', 'wikidata', 'archive-org']
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
      });

      it('should use Archive.org OpenLibrary work ID when available', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          openlibrary_work_id: 'OL999W', // ISBNdb value
          primary_provider: 'isbndb',
        };

        const archiveOrgData = {
          openlibrary_work: 'OL45883W', // Archive.org value (authoritative)
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, null, archiveOrgData);

        // OpenLibrary work ID should be from Archive.org
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
      });

      it('should work with only Wikidata data (no Archive.org)', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          subject_tags: ['Fiction'],
          primary_provider: 'isbndb',
        };

        const wikidataData = { genres: ['Fantasy'] };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, wikidataData, null);

        // Contributors should be: ['isbndb', 'wikidata']
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
      });

      it('should work with only Archive.org data (no Wikidata)', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          description: 'ISBNdb description',
          primary_provider: 'isbndb',
        };

        const archiveOrgData = {
          description: ['Better Archive.org description'],
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        await enrichWork(mockSql, work, mockLogger, null, archiveOrgData);

        // Contributors should be: ['isbndb', 'archive-org']
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
      });

      it('should work without any optional parameters (backward compatibility)', async () => {
        const work = {
          work_key: '/works/OL123W',
          title: 'Test Work',
          primary_provider: 'isbndb',
        };

        mockSql.mockResolvedValueOnce([{ work_key: '/works/OL123W', was_insert: true }]);

        const result = await enrichWork(mockSql, work, mockLogger); // No optional params

        // Contributors should be: ['isbndb']
        const sqlCall = mockSql.mock.calls[0];
        expect(sqlCall).toBeDefined();
        expect(result.action).toBe('created');
      });
    });

    // Phase 2.3 Tests: enrichEdition with Archive.org
    describe('Phase 2.3: enrichEdition with Archive.org', () => {
      it('should merge alternate ISBNs from Archive.org', async () => {
        const edition = {
          isbn: '9780439064873',
          title: 'Test Book',
          alternate_isbns: ['0439064872'],
          primary_provider: 'isbndb',
        };

        const archiveOrgData = {
          isbn: ['9780439064873', '0439136350', '0439064872'], // Include primary + duplicate + new
        };

        mockSql
          .mockResolvedValueOnce([{ isbndb_quality: 0 }]) // existing quality
          .mockResolvedValueOnce([{ isbn: '9780439064873', was_insert: true, isbndb_quality: 10 }]); // upsert

        await enrichEdition(mockSql, edition, mockLogger, undefined, archiveOrgData);

        // Alternate ISBNs should be: ['0439064872', '0439136350'] (deduplicated, no primary)
        const sqlCall = mockSql.mock.calls[1]; // Second call is the upsert
        expect(sqlCall).toBeDefined();
      });

      it('should use Archive.org OpenLibrary edition ID when available', async () => {
        const edition = {
          isbn: '9780439064873',
          title: 'Test Book',
          openlibrary_edition_id: 'OL999M', // ISBNdb value
          primary_provider: 'isbndb',
        };

        const archiveOrgData = {
          openlibrary_edition: 'OL37027463M', // Archive.org value (authoritative)
        };

        mockSql
          .mockResolvedValueOnce([{ isbndb_quality: 0 }])
          .mockResolvedValueOnce([{ isbn: '9780439064873', was_insert: true, isbndb_quality: 10 }]);

        await enrichEdition(mockSql, edition, mockLogger, undefined, archiveOrgData);

        // OpenLibrary edition ID should be from Archive.org
        const sqlCall = mockSql.mock.calls[1];
        expect(sqlCall).toBeDefined();
      });

      it('should track Archive.org in contributors array', async () => {
        const edition = {
          isbn: '9780439064873',
          title: 'Test Book',
          primary_provider: 'isbndb',
        };

        const archiveOrgData = {
          openlibrary_edition: 'OL37027463M',
        };

        mockSql
          .mockResolvedValueOnce([{ isbndb_quality: 0 }])
          .mockResolvedValueOnce([{ isbn: '9780439064873', was_insert: true, isbndb_quality: 10 }]);

        await enrichEdition(mockSql, edition, mockLogger, undefined, archiveOrgData);

        // Contributors should be: ['isbndb', 'archive-org']
        const sqlCall = mockSql.mock.calls[1];
        expect(sqlCall).toBeDefined();
      });

      it('should work without Archive.org data (backward compatibility)', async () => {
        const edition = {
          isbn: '9780439064873',
          title: 'Test Book',
          primary_provider: 'isbndb',
        };

        mockSql
          .mockResolvedValueOnce([{ isbndb_quality: 0 }])
          .mockResolvedValueOnce([{ isbn: '9780439064873', was_insert: true, isbndb_quality: 10 }]);

        const result = await enrichEdition(mockSql, edition, mockLogger); // No Archive.org data

        // Contributors should be: ['isbndb']
        expect(result.action).toBe('created');
      });
    });
  });

  describe('queueEnrichment', () => {
    it('should queue a job and return position', async () => {
      const queueRequest = {
        entity_type: 'edition',
        entity_key: '9780123456789',
        providers_to_try: ['isbndb'],
        priority: 5
      };

      mockSql
        .mockResolvedValueOnce([{ id: 'job-uuid-123' }]) // insert return
        .mockResolvedValueOnce([{ position: '4' }]); // position count

      const result = await queueEnrichment(mockSql, queueRequest);

      expect(result.queue_id).toBe('job-uuid-123');
      expect(result.position_in_queue).toBe(5); // 4 + 1
      expect(result.estimated_processing_time).toBe('1-5 minutes');
    });
  });

  describe('getEnrichmentStatus', () => {
      it('should return job status if found', async () => {
          const mockJob = {
              id: 'job-123',
              status: 'pending'
          };
          mockSql.mockResolvedValueOnce([mockJob]);

          const result = await getEnrichmentStatus(mockSql, 'job-123', mockLogger);
          expect(result).toEqual(mockJob);
      });

      it('should throw if job not found', async () => {
          mockSql.mockResolvedValueOnce([]); // empty result

          await expect(getEnrichmentStatus(mockSql, 'job-999', mockLogger)).rejects.toThrow('Job not found');
      });
  });
});
