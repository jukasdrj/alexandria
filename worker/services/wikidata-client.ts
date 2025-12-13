/**
 * Wikidata SPARQL Client for Author Diversity Enrichment
 *
 * Fetches diversity data (gender, nationality, birth place, etc.) from Wikidata
 * for authors with known Q-IDs.
 *
 * Rate limit: 1 request/second (be respectful to Wikidata)
 * Batch size: 50 Q-IDs per query
 */

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const BATCH_SIZE = 50;
const REQUEST_DELAY_MS = 1000; // 1 second between requests

export interface WikidataAuthorData {
  qid: string;
  gender?: string;
  gender_qid?: string;
  citizenship?: string;
  citizenship_qid?: string;
  birth_year?: number;
  death_year?: number;
  birth_place?: string;
  birth_place_qid?: string;
  birth_country?: string;
  birth_country_qid?: string;
  death_place?: string;
  death_place_qid?: string;
  occupations?: string[];
  image_url?: string;
}

interface SparqlBinding {
  value: string;
  type: string;
}

interface SparqlResult {
  author: SparqlBinding;
  genderLabel?: SparqlBinding;
  gender?: SparqlBinding;
  citizenshipLabel?: SparqlBinding;
  citizenship?: SparqlBinding;
  dob?: SparqlBinding;
  dod?: SparqlBinding;
  birthPlaceLabel?: SparqlBinding;
  birthPlace?: SparqlBinding;
  birthCountryLabel?: SparqlBinding;
  birthCountry?: SparqlBinding;
  deathPlaceLabel?: SparqlBinding;
  deathPlace?: SparqlBinding;
  image?: SparqlBinding;
  occupations?: SparqlBinding;
}

/**
 * Build SPARQL query for a batch of Q-IDs
 */
function buildSparqlQuery(qids: string[]): string {
  const values = qids.map(q => `wd:${q}`).join(' ');

  return `
    SELECT ?author ?genderLabel ?gender ?citizenshipLabel ?citizenship
           ?dob ?dod ?birthPlaceLabel ?birthPlace ?birthCountryLabel ?birthCountry
           ?deathPlaceLabel ?deathPlace ?image
           (GROUP_CONCAT(DISTINCT ?occupationLabel; separator="|") as ?occupations)
    WHERE {
      VALUES ?author { ${values} }

      OPTIONAL { ?author wdt:P21 ?gender. }
      OPTIONAL { ?author wdt:P27 ?citizenship. }
      OPTIONAL { ?author wdt:P569 ?dob. }
      OPTIONAL { ?author wdt:P570 ?dod. }
      OPTIONAL {
        ?author wdt:P19 ?birthPlace.
        OPTIONAL { ?birthPlace wdt:P17 ?birthCountry. }
      }
      OPTIONAL { ?author wdt:P20 ?deathPlace. }
      OPTIONAL { ?author wdt:P18 ?image. }
      OPTIONAL {
        ?author wdt:P106 ?occupation.
        ?occupation rdfs:label ?occupationLabel.
        FILTER(LANG(?occupationLabel) = "en")
      }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?author ?genderLabel ?gender ?citizenshipLabel ?citizenship
             ?dob ?dod ?birthPlaceLabel ?birthPlace ?birthCountryLabel ?birthCountry
             ?deathPlaceLabel ?deathPlace ?image
  `;
}

/**
 * Extract Q-ID from Wikidata entity URI
 * e.g., "http://www.wikidata.org/entity/Q692" -> "Q692"
 */
function extractQid(uri: string): string {
  const match = uri.match(/Q\d+$/);
  return match ? match[0] : uri;
}

/**
 * Extract year from Wikidata date string
 * e.g., "1564-04-23T00:00:00Z" -> 1564
 */
function extractYear(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const match = dateStr.match(/^-?(\d+)/);
  if (match) {
    const year = parseInt(match[1], 10);
    // Handle BCE dates (negative years in Wikidata)
    return dateStr.startsWith('-') ? -year : year;
  }
  return undefined;
}

/**
 * Parse SPARQL results into WikidataAuthorData objects
 */
function parseSparqlResults(results: SparqlResult[]): Map<string, WikidataAuthorData> {
  const authors = new Map<string, WikidataAuthorData>();

  for (const result of results) {
    const qid = extractQid(result.author.value);

    const author: WikidataAuthorData = {
      qid,
      gender: result.genderLabel?.value,
      gender_qid: result.gender ? extractQid(result.gender.value) : undefined,
      citizenship: result.citizenshipLabel?.value,
      citizenship_qid: result.citizenship ? extractQid(result.citizenship.value) : undefined,
      birth_year: result.dob ? extractYear(result.dob.value) : undefined,
      death_year: result.dod ? extractYear(result.dod.value) : undefined,
      birth_place: result.birthPlaceLabel?.value,
      birth_place_qid: result.birthPlace ? extractQid(result.birthPlace.value) : undefined,
      birth_country: result.birthCountryLabel?.value,
      birth_country_qid: result.birthCountry ? extractQid(result.birthCountry.value) : undefined,
      death_place: result.deathPlaceLabel?.value,
      death_place_qid: result.deathPlace ? extractQid(result.deathPlace.value) : undefined,
      occupations: result.occupations?.value ? result.occupations.value.split('|').filter(Boolean) : undefined,
      image_url: result.image?.value,
    };

    authors.set(qid, author);
  }

  return authors;
}

/**
 * Fetch author data from Wikidata for a batch of Q-IDs
 */
export async function fetchWikidataBatch(qids: string[]): Promise<Map<string, WikidataAuthorData>> {
  if (qids.length === 0) {
    return new Map();
  }

  if (qids.length > BATCH_SIZE) {
    throw new Error(`Batch size ${qids.length} exceeds maximum ${BATCH_SIZE}`);
  }

  const query = buildSparqlQuery(qids);

  const response = await fetch(WIKIDATA_SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'Alexandria/1.0 (https://alexandria.ooheynerds.com; book metadata enrichment)'
    },
    body: `query=${encodeURIComponent(query)}`
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wikidata SPARQL error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await response.json() as { results: { bindings: SparqlResult[] } };
  return parseSparqlResults(data.results.bindings);
}

/**
 * Fetch author data for multiple batches with rate limiting
 */
export async function fetchWikidataMultipleBatches(
  qids: string[],
  onBatchComplete?: (batchNum: number, totalBatches: number, results: Map<string, WikidataAuthorData>) => void
): Promise<Map<string, WikidataAuthorData>> {
  const allResults = new Map<string, WikidataAuthorData>();
  const batches: string[][] = [];

  // Split into batches
  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    batches.push(qids.slice(i, i + BATCH_SIZE));
  }

  console.log(`[Wikidata] Processing ${qids.length} Q-IDs in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      const results = await fetchWikidataBatch(batch);

      // Merge results
      for (const [qid, data] of results) {
        allResults.set(qid, data);
      }

      if (onBatchComplete) {
        onBatchComplete(i + 1, batches.length, results);
      }

      console.log(`[Wikidata] Batch ${i + 1}/${batches.length}: fetched ${results.size}/${batch.length} authors`);

      // Rate limit: wait before next request (except for last batch)
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      }
    } catch (error) {
      console.error(`[Wikidata] Batch ${i + 1} failed:`, error);
      // Continue with next batch on error
    }
  }

  console.log(`[Wikidata] Complete: fetched ${allResults.size}/${qids.length} authors`);
  return allResults;
}

/**
 * Test the Wikidata client with a few known authors
 */
export async function testWikidataClient(): Promise<{
  success: boolean;
  results: WikidataAuthorData[];
  error?: string;
}> {
  const testQids = [
    'Q692',    // William Shakespeare
    'Q33977',  // Jules Verne
    'Q35610',  // Arthur Conan Doyle
    'Q42511',  // H. G. Wells
    'Q36322',  // J.R.R. Tolkien
  ];

  try {
    const results = await fetchWikidataBatch(testQids);
    return {
      success: true,
      results: Array.from(results.values())
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
