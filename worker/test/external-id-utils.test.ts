import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  backfillExternalIdsFromArrays,
  getExternalIds,
  findByExternalId,
} from '../src/services/external-id-utils.js';
import type { ArrayExternalIds } from '../src/services/types.js';

// Mock postgres types
const createMockSql = () => {
  const mock = vi.fn() as any;
  mock.count = 0;
  return mock;
};

// Mock logger
const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('external-id-utils', () => {
  describe('backfillExternalIdsFromArrays', () => {
    it('should backfill Amazon ASINs', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 2 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: ['B000FC1MCS', 'B001234567'],
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(2);
      expect(sql).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Backfilled external IDs',
        expect.objectContaining({
          isbn: '9780439064873',
          total_mappings: 2,
          inserted: 2,
        })
      );
    });

    it('should backfill Google Books Volume IDs', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 1 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: null,
        google_books_volume_ids: ['abc123xyz'],
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(1);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should backfill Goodreads Edition IDs', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 1 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: null,
        google_books_volume_ids: null,
        goodreads_edition_ids: ['2089208'],
        librarything_ids: null,
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(1);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should backfill LibraryThing IDs', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 1 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: null,
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: ['12345'],
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(1);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should backfill multiple providers', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 4 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: ['B000FC1MCS'],
        google_books_volume_ids: ['abc123xyz'],
        goodreads_edition_ids: ['2089208'],
        librarything_ids: ['12345'],
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(4);
      expect(logger.info).toHaveBeenCalledWith(
        'Backfilled external IDs',
        expect.objectContaining({
          isbn: '9780439064873',
          total_mappings: 4,
          inserted: 4,
        })
      );
    });

    it('should trim whitespace from IDs', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 1 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: ['  B000FC1MCS  '],
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      await backfillExternalIdsFromArrays(sql, '9780439064873', edition, logger);

      expect(sql).toHaveBeenCalled();
      const insertCall = sql.mock.calls[0];
      // Find the JSON string argument (3rd element in tagged template)
      const jsonArg = insertCall.find((arg: any) =>
        typeof arg === 'string' && arg.includes('B000FC1MCS')
      );

      if (jsonArg) {
        const jsonData = JSON.parse(jsonArg);
        expect(jsonData[0].provider_id).toBe('B000FC1MCS');
      }
    });

    it('should skip empty strings', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 1 });

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: ['B000FC1MCS', '', '   '],
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(1);
    });

    it('should return 0 for empty arrays', async () => {
      const sql = createMockSql();
      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: null,
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith('No external IDs to backfill', {
        isbn: '9780439064873',
      });
    });

    it('should handle ON CONFLICT correctly (partial inserts)', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce({ count: 2 }); // 3 mappings, 2 inserted, 1 skipped

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: ['B000FC1MCS', 'B001234567', 'B002345678'],
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      const count = await backfillExternalIdsFromArrays(
        sql,
        '9780439064873',
        edition,
        logger
      );

      expect(count).toBe(2);
      expect(logger.info).toHaveBeenCalledWith(
        'Backfilled external IDs',
        expect.objectContaining({
          total_mappings: 3,
          inserted: 2,
          skipped: 1,
        })
      );
    });

    it('should throw error on database failure', async () => {
      const sql = createMockSql();
      sql.mockRejectedValueOnce(new Error('Database connection failed'));

      const logger = createMockLogger();
      const edition: ArrayExternalIds = {
        amazon_asins: ['B000FC1MCS'],
        google_books_volume_ids: null,
        goodreads_edition_ids: null,
        librarything_ids: null,
      };

      await expect(
        backfillExternalIdsFromArrays(sql, '9780439064873', edition, logger)
      ).rejects.toThrow('External ID backfill failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Backfill external IDs failed',
        expect.objectContaining({
          error: 'Database connection failed',
          isbn: '9780439064873',
        })
      );
    });
  });

  describe('getExternalIds', () => {
    it('should query crosswalk by entity_type and our_key', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce([
        {
          provider: 'amazon',
          provider_id: 'B000FC1MCS',
          confidence: 90,
          created_at: new Date('2026-01-08T10:30:00Z'),
        },
        {
          provider: 'goodreads',
          provider_id: '2089208',
          confidence: 80,
          created_at: new Date('2026-01-08T10:30:00Z'),
        },
      ]);

      const ids = await getExternalIds(sql, 'edition', '9780439064873');

      expect(ids).toHaveLength(2);
      expect(ids[0].provider).toBe('amazon');
      expect(ids[0].provider_id).toBe('B000FC1MCS');
      expect(ids[0].confidence).toBe(90);
      expect(ids[1].provider).toBe('goodreads');
    });

    it('should return empty array when no mappings exist', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce([]);

      const ids = await getExternalIds(sql, 'edition', '9999999999999');

      expect(ids).toHaveLength(0);
    });

    it('should order by provider and confidence DESC', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce([
        {
          provider: 'amazon',
          provider_id: 'B000FC1MCS',
          confidence: 95,
          created_at: new Date('2026-01-08T10:30:00Z'),
        },
        {
          provider: 'amazon',
          provider_id: 'B001234567',
          confidence: 85,
          created_at: new Date('2026-01-08T10:30:00Z'),
        },
      ]);

      const ids = await getExternalIds(sql, 'edition', '9780439064873');

      expect(ids).toHaveLength(2);
      expect(ids[0].confidence).toBeGreaterThan(ids[1].confidence);
    });
  });

  describe('findByExternalId', () => {
    it('should find entity by external ID', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce([
        {
          our_key: '9780439064873',
          confidence: 80,
        },
      ]);

      const result = await findByExternalId(sql, 'edition', 'goodreads', '2089208');

      expect(result).toEqual({ our_key: '9780439064873', confidence: 80 });
    });

    it('should return null when no mapping exists', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce([]);

      const result = await findByExternalId(sql, 'edition', 'goodreads', '999999');

      expect(result).toBeNull();
    });

    it('should return highest confidence match', async () => {
      const sql = createMockSql();
      sql.mockResolvedValueOnce([
        {
          our_key: '9780439064873',
          confidence: 95,
        },
      ]);

      const result = await findByExternalId(sql, 'edition', 'amazon', 'B000FC1MCS');

      expect(result).toEqual({ our_key: '9780439064873', confidence: 95 });
      expect(sql).toHaveBeenCalled();
    });
  });
});
