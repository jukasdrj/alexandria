import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichEdition, enrichWork, enrichAuthor, queueEnrichment, getEnrichmentStatus } from '../enrichment-service.js';

describe('Enrichment Service', () => {
  let mockSql;

  beforeEach(() => {
    // Reset mockSql for each test
    mockSql = vi.fn();
    // Allow mockSql to be called as a template tag function
    mockSql.mockImplementation((strings, ...values) => {
      // Return a promise that resolves to an array (mimicking postgres.js result)
      // We can attach properties to this array if needed (like count)
      return Promise.resolve([]);
    });
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

      const result = await enrichEdition(mockSql, edition);

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

      const result = await enrichEdition(mockSql, edition);

      expect(result.action).toBe('updated');
      expect(result.quality_improvement).toBe(5); // 10 - 5
    });

    it('should handle database errors gracefully', async () => {
        const edition = {
            isbn: '9780123456789',
            primary_provider: 'isbndb'
        };

        mockSql.mockRejectedValue(new Error('DB connection failed'));

        await expect(enrichEdition(mockSql, edition)).rejects.toThrow('Database operation failed: DB connection failed');
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

      const result = await enrichWork(mockSql, work);

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

        const result = await enrichWork(mockSql, work);

        expect(result.action).toBe('updated');
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

          const result = await getEnrichmentStatus(mockSql, 'job-123');
          expect(result).toEqual(mockJob);
      });

      it('should throw if job not found', async () => {
          mockSql.mockResolvedValueOnce([]); // empty result

          await expect(getEnrichmentStatus(mockSql, 'job-999')).rejects.toThrow('Job not found');
      });
  });
});
