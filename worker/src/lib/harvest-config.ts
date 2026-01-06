/**
 * Cover Harvest Configuration Parser
 *
 * Provides centralized configuration management for cover harvesting constraints.
 * Replaces hardcoded values with configurable environment variables while maintaining
 * 100% backward compatibility through sensible defaults.
 */

export interface HarvestConfig {
  minYear: number;
  maxYear: number;
  isbnPrefixes: string[];
  batchSize: number;
  sortBy: 'publication_date' | 'created_at';
  queueByDefault: boolean;
}

export const DEFAULT_CONFIG: HarvestConfig = {
  minYear: 2000,
  maxYear: new Date().getFullYear(),
  isbnPrefixes: ['9780', '9781'],
  batchSize: 1000,
  sortBy: 'publication_date',
  queueByDefault: false,
};

export function parseHarvestConfig(env: Record<string, string | undefined>): HarvestConfig {
  const currentYear = new Date().getFullYear();

  const minYearStr = env.HARVEST_MIN_YEAR;
  const minYear = minYearStr ? parseInt(minYearStr, 10) : DEFAULT_CONFIG.minYear;

  const maxYearStr = env.HARVEST_MAX_YEAR;
  const maxYear = maxYearStr ? parseInt(maxYearStr, 10) : DEFAULT_CONFIG.maxYear;

  const isbnPrefixesStr = env.HARVEST_ISBN_PREFIXES;
  let isbnPrefixes = DEFAULT_CONFIG.isbnPrefixes;
  if (isbnPrefixesStr) {
    const parsed = isbnPrefixesStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
    // Sanitize: ensure prefixes are strictly numeric (protect against SQL injection)
    const sanitized = parsed.filter(p => /^\d+$/.test(p));
    if (sanitized.length > 0) {
      isbnPrefixes = sanitized;
    }
  }

  const batchSizeStr = env.HARVEST_BATCH_SIZE;
  const batchSize = batchSizeStr ? parseInt(batchSizeStr, 10) : DEFAULT_CONFIG.batchSize;

  const sortByStr = env.HARVEST_SORT_BY;
  const sortBy = (sortByStr === 'created_at') ? 'created_at' : 'publication_date';

  const queueByDefault = env.HARVEST_QUEUE_DEFAULT === 'true';

  return {
    minYear: (isNaN(minYear) || minYear < 1000 || minYear > currentYear) ? DEFAULT_CONFIG.minYear : minYear,
    maxYear: (isNaN(maxYear) || maxYear < minYear || maxYear > currentYear + 1) ? DEFAULT_CONFIG.maxYear : maxYear,
    isbnPrefixes,
    batchSize: (isNaN(batchSize) || batchSize < 1 || batchSize > 1000) ? DEFAULT_CONFIG.batchSize : batchSize,
    sortBy,
    queueByDefault,
  };
}

export function buildISBNPrefixFilter(prefixes: string[]): string {
  return prefixes.map(p => `isbn LIKE '${p}%'`).join(' OR ');
}

export function buildYearFilter(minYear: number, maxYear: number): string {
  return `publication_date BETWEEN '${minYear}' AND '${maxYear}'`;
}
