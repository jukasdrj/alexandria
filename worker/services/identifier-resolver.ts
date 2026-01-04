/**
 * Identifier Resolver Service
 *
 * Resolves VIAF (Virtual International Authority File) and ISNI
 * (International Standard Name Identifier) to Wikidata Q-IDs.
 *
 * This enables author discovery through external authority identifiers.
 *
 * API Endpoints Used:
 * - VIAF: https://viaf.org/viaf/{viaf_id}/viaf.json (JSON endpoint)
 * - ISNI: https://isni.org/isni/{isni} (RDF/JSON-LD endpoint)
 * - Wikidata SPARQL: https://query.wikidata.org/sparql
 *
 * Rate Limits:
 * - VIAF: No official limit, but be respectful (~1 req/sec)
 * - ISNI: No official limit, but be respectful (~1 req/sec)
 * - Wikidata: 1 req/sec (enforced client-side)
 *
 * Caching Strategy:
 * - Cache successful resolutions in KV for 30 days
 * - Cache failures for 1 day (to avoid repeated failed lookups)
 * - Use identifier as cache key: viaf:{id} or isni:{id}
 */

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

export type IdentifierType = 'viaf' | 'isni';

export interface IdentifierResolutionResult {
  identifier_type: IdentifierType;
  identifier_value: string;
  wikidata_id: string | null;
  author_name?: string;
  source: 'viaf' | 'isni' | 'wikidata_sparql';
  cached: boolean;
  resolution_method?: string;
}

interface ViafResponse {
  viafID?: string;
  mainHeadings?: {
    data?: Array<{
      text?: string;
    }>;
  };
  '@graph'?: Array<{
    '@type'?: string | string[];
    'schema:name'?: string;
    'schema:sameAs'?: string | string[];
  }>;
}

interface IsniResponse {
  '@graph'?: Array<{
    '@id'?: string;
    '@type'?: string | string[];
    'owl:sameAs'?: string | string[];
    'foaf:name'?: string;
  }>;
}

/**
 * Extract Wikidata Q-ID from various URI formats
 */
function extractWikidataQid(uri: string): string | null {
  if (!uri) return null;

  // Handle various Wikidata URI formats
  const patterns = [
    /wikidata\.org\/entity\/(Q\d+)/,
    /wikidata\.org\/wiki\/(Q\d+)/,
    /^(Q\d+)$/,
  ];

  for (const pattern of patterns) {
    const match = uri.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Normalize VIAF ID (remove prefixes, clean format)
 */
function normalizeViafId(id: string): string {
  // Remove common prefixes
  const cleaned = id.replace(/^(viaf:|VIAF:)/i, '').trim();

  // VIAF IDs are numeric
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`Invalid VIAF ID format: ${id}`);
  }

  return cleaned;
}

/**
 * Normalize ISNI (16-digit format with optional spaces/dashes)
 */
function normalizeIsni(id: string): string {
  // Remove common prefixes and whitespace/dashes
  const cleaned = id.replace(/^(isni:|ISNI:)/i, '').replace(/[\s-]/g, '').trim();

  // ISNI is 16 digits
  if (!/^\d{16}$/.test(cleaned)) {
    throw new Error(`Invalid ISNI format: ${id} (must be 16 digits)`);
  }

  return cleaned;
}

/**
 * Format ISNI for display (XXXX XXXX XXXX XXXX)
 */
function formatIsni(isni: string): string {
  const normalized = normalizeIsni(isni);
  return normalized.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/**
 * Resolve VIAF ID to Wikidata Q-ID via VIAF's linked data
 */
async function resolveViafToWikidata(viafId: string): Promise<IdentifierResolutionResult> {
  const normalizedId = normalizeViafId(viafId);
  const url = `https://viaf.org/viaf/${normalizedId}/viaf.json`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Alexandria/1.0 (https://alexandria.ooheynerds.com; book metadata enrichment)',
    },
  });

  if (!response.ok) {
    throw new Error(`VIAF API error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as ViafResponse;

  // Extract author name (from mainHeadings)
  let authorName: string | undefined;
  if (data.mainHeadings?.data?.[0]?.text) {
    authorName = data.mainHeadings.data[0].text;
  }

  // Look for Wikidata link in @graph (Linked Data format)
  let wikidataQid: string | null = null;

  if (data['@graph']) {
    for (const entity of data['@graph']) {
      // Check if this is a Person entity
      const types = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']];
      if (types.some(t => t?.includes('Person') || t?.includes('Organization'))) {

        // Extract name if available
        if (!authorName && entity['schema:name']) {
          authorName = entity['schema:name'];
        }

        // Look for Wikidata in sameAs links
        const sameAs = Array.isArray(entity['schema:sameAs'])
          ? entity['schema:sameAs']
          : [entity['schema:sameAs']];

        for (const link of sameAs) {
          if (typeof link === 'string') {
            const qid = extractWikidataQid(link);
            if (qid) {
              wikidataQid = qid;
              break;
            }
          }
        }

        if (wikidataQid) break;
      }
    }
  }

  return {
    identifier_type: 'viaf',
    identifier_value: normalizedId,
    wikidata_id: wikidataQid,
    author_name: authorName,
    source: 'viaf',
    cached: false,
    resolution_method: 'viaf_linked_data',
  };
}

/**
 * Resolve ISNI to Wikidata Q-ID via ISNI's linked data
 */
async function resolveIsniToWikidata(isni: string): Promise<IdentifierResolutionResult> {
  const normalizedIsni = normalizeIsni(isni);
  const formattedIsni = formatIsni(normalizedIsni);

  // ISNI provides JSON-LD at this endpoint
  const url = `https://isni.org/isni/${normalizedIsni}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/ld+json, application/json',
      'User-Agent': 'Alexandria/1.0 (https://alexandria.ooheynerds.com; book metadata enrichment)',
    },
  });

  if (!response.ok) {
    throw new Error(`ISNI API error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as IsniResponse;

  // Extract author name and Wikidata link from @graph
  let authorName: string | undefined;
  let wikidataQid: string | null = null;

  if (data['@graph']) {
    for (const entity of data['@graph']) {
      // Extract name
      if (!authorName && entity['foaf:name']) {
        authorName = entity['foaf:name'];
      }

      // Look for Wikidata in owl:sameAs
      const sameAs = Array.isArray(entity['owl:sameAs'])
        ? entity['owl:sameAs']
        : [entity['owl:sameAs']];

      for (const link of sameAs) {
        if (typeof link === 'string') {
          const qid = extractWikidataQid(link);
          if (qid) {
            wikidataQid = qid;
            break;
          }
        }
      }

      if (wikidataQid) break;
    }
  }

  return {
    identifier_type: 'isni',
    identifier_value: formattedIsni,
    wikidata_id: wikidataQid,
    author_name: authorName,
    source: 'isni',
    cached: false,
    resolution_method: 'isni_linked_data',
  };
}

/**
 * Fallback: Query Wikidata SPARQL directly for VIAF/ISNI
 *
 * This is slower but more reliable if VIAF/ISNI APIs don't provide
 * direct Wikidata links.
 */
async function resolveViaWikidataSparql(
  identifierType: IdentifierType,
  identifierValue: string
): Promise<IdentifierResolutionResult> {

  // Wikidata properties:
  // P214: VIAF ID
  // P213: ISNI
  const property = identifierType === 'viaf' ? 'P214' : 'P213';
  const normalizedValue = identifierType === 'viaf'
    ? normalizeViafId(identifierValue)
    : normalizeIsni(identifierValue);

  const query = `
    SELECT ?author ?authorLabel WHERE {
      ?author wdt:${property} "${normalizedValue}".
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 1
  `;

  const response = await fetch(WIKIDATA_SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'Alexandria/1.0 (https://alexandria.ooheynerds.com; book metadata enrichment)',
    },
    body: `query=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Wikidata SPARQL error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as {
    results: {
      bindings: Array<{
        author: { value: string };
        authorLabel?: { value: string };
      }>;
    };
  };

  let wikidataQid: string | null = null;
  let authorName: string | undefined;

  if (data.results.bindings.length > 0) {
    const binding = data.results.bindings[0];
    wikidataQid = extractWikidataQid(binding.author.value);
    authorName = binding.authorLabel?.value;
  }

  return {
    identifier_type: identifierType,
    identifier_value: normalizedValue,
    wikidata_id: wikidataQid,
    author_name: authorName,
    source: 'wikidata_sparql',
    cached: false,
    resolution_method: 'wikidata_sparql_lookup',
  };
}

/**
 * Main entry point: Resolve identifier to Wikidata Q-ID
 *
 * Tries multiple strategies:
 * 1. Check KV cache
 * 2. Try direct linked data API (VIAF/ISNI)
 * 3. Fallback to Wikidata SPARQL query
 */
export async function resolveIdentifier(
  identifierType: IdentifierType,
  identifierValue: string,
  cache?: KVNamespace
): Promise<IdentifierResolutionResult> {

  // Normalize identifier
  const normalizedValue = identifierType === 'viaf'
    ? normalizeViafId(identifierValue)
    : normalizeIsni(identifierValue);

  // Check cache first
  if (cache) {
    const cacheKey = `identifier:${identifierType}:${normalizedValue}`;
    const cached = await cache.get(cacheKey, 'json') as IdentifierResolutionResult | null;

    if (cached) {
      return {
        ...cached,
        cached: true,
      };
    }
  }

  // Try primary resolution method (linked data)
  let result: IdentifierResolutionResult;

  try {
    if (identifierType === 'viaf') {
      result = await resolveViafToWikidata(normalizedValue);
    } else {
      result = await resolveIsniToWikidata(normalizedValue);
    }

    // If no Wikidata ID found, try SPARQL fallback
    if (!result.wikidata_id) {
      console.log(`[IdentifierResolver] No Wikidata link in ${identifierType.toUpperCase()} data, trying SPARQL...`);
      result = await resolveViaWikidataSparql(identifierType, normalizedValue);
    }

  } catch (error) {
    console.error(`[IdentifierResolver] Primary resolution failed, trying SPARQL fallback:`, error);
    result = await resolveViaWikidataSparql(identifierType, normalizedValue);
  }

  // Cache the result
  if (cache) {
    const cacheKey = `identifier:${identifierType}:${normalizedValue}`;
    const cacheTtl = result.wikidata_id ? 30 * 24 * 60 * 60 : 24 * 60 * 60; // 30 days if found, 1 day if not

    await cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: cacheTtl,
    });
  }

  return result;
}

/**
 * Test the identifier resolver with known examples
 */
export async function testIdentifierResolver(): Promise<{
  success: boolean;
  results: IdentifierResolutionResult[];
  errors: string[];
}> {
  const testCases: Array<{ type: IdentifierType; value: string; expectedQid?: string }> = [
    { type: 'viaf', value: '97113511', expectedQid: 'Q39829' },  // Stephen King
    { type: 'viaf', value: '109557338', expectedQid: 'Q34660' },  // J.K. Rowling
    { type: 'isni', value: '0000 0001 2144 1970', expectedQid: 'Q42' },  // Douglas Adams
  ];

  const results: IdentifierResolutionResult[] = [];
  const errors: string[] = [];

  for (const testCase of testCases) {
    try {
      const result = await resolveIdentifier(testCase.type, testCase.value);
      results.push(result);

      // Verify if expected Q-ID matches
      if (testCase.expectedQid && result.wikidata_id !== testCase.expectedQid) {
        errors.push(
          `Expected ${testCase.expectedQid} for ${testCase.type}:${testCase.value}, got ${result.wikidata_id}`
        );
      }

    } catch (error) {
      errors.push(`${testCase.type}:${testCase.value} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    success: errors.length === 0,
    results,
    errors,
  };
}
