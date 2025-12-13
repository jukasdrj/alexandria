import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEnrichEdition, handleQueueEnrichment } from '../enrich-handlers.js';
import * as enrichmentService from '../enrichment-service.js';

// Mock the service functions
vi.mock('../enrichment-service.js', () => ({
  enrichEdition: vi.fn(),
  enrichWork: vi.fn(),
  enrichAuthor: vi.fn(),
  queueEnrichment: vi.fn(),
  getEnrichmentStatus: vi.fn(),
}));

describe('Enrichment Handlers', () => {
  let mockContext;
  let mockSql;

  beforeEach(() => {
    mockSql = vi.fn();
    mockContext = {
      req: {
        json: vi.fn(),
      },
      get: vi.fn((key) => {
        if (key === 'sql') return mockSql;
        return null;
      }),
      json: vi.fn((data, status) => ({ data, status })),
    };
  });

  describe('handleEnrichEdition', () => {
    it('should return 400 if validation fails (missing required fields)', async () => {
      mockContext.req.json.mockResolvedValue({}); // Empty body

      const response = await handleEnrichEdition(mockContext);

      expect(response.status).toBe(400);
      expect(response.data.error).toBe('Validation failed');
    });

    it('should return 400 if ISBN is invalid', async () => {
      mockContext.req.json.mockResolvedValue({
        isbn: 'invalid-isbn',
        primary_provider: 'isbndb'
      });

      const response = await handleEnrichEdition(mockContext);

      expect(response.status).toBe(400);
      // The validator returns 'Validation failed' with details because checkISBN is part of validation?
      // Actually, looking at code: validateEnrichmentRequest calls validateISBN and adds error to errors list.
      // So it returns 400 with error: "Validation failed" and details: ["Invalid ISBN format..."]
      expect(response.data.error).toBe('Validation failed');
      expect(response.data.details[0]).toContain('Invalid ISBN length');
    });

    it('should call enrichEdition and return 201 on success (created)', async () => {
      const validBody = {
        isbn: '9780439064873',
        primary_provider: 'isbndb',
        title: 'Harry Potter'
      };
      mockContext.req.json.mockResolvedValue(validBody);

      enrichmentService.enrichEdition.mockResolvedValue({
        isbn: '9780439064873',
        action: 'created',
        quality_improvement: 10
      });

      const response = await handleEnrichEdition(mockContext);

      expect(enrichmentService.enrichEdition).toHaveBeenCalledWith(
        mockSql,
        expect.objectContaining({ isbn: '9780439064873' }),
        undefined  // env not set in mock context
      );
      expect(response.status).toBe(201);
      expect(response.data.success).toBe(true);
    });

    it('should handle service errors', async () => {
        const validBody = {
            isbn: '9780439064873',
            primary_provider: 'isbndb',
        };
        mockContext.req.json.mockResolvedValue(validBody);

        enrichmentService.enrichEdition.mockRejectedValue(new Error('Service failure'));

        const response = await handleEnrichEdition(mockContext);

        expect(response.status).toBe(500);
        expect(response.data.error).toBe('Internal server error');
    });
  });

  describe('handleQueueEnrichment', () => {
      it('should return 400 for invalid entity type', async () => {
          mockContext.req.json.mockResolvedValue({
              entity_type: 'invalid',
              entity_key: '123',
              providers_to_try: ['test']
          });

          const response = await handleQueueEnrichment(mockContext);
          expect(response.status).toBe(400);
      });

      it('should successfully queue a job', async () => {
          const body = {
              entity_type: 'edition',
              entity_key: '9780439064873',
              providers_to_try: ['isbndb']
          };
          mockContext.req.json.mockResolvedValue(body);

          enrichmentService.queueEnrichment.mockResolvedValue({
              queue_id: '123',
              position_in_queue: 1
          });

          const response = await handleQueueEnrichment(mockContext);

          expect(response.status).toBe(201);
          expect(response.data.success).toBe(true);
      });
  });
});
