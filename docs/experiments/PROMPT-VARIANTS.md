# Gemini Prompt Variants for A/B Testing
Created: 2026-01-07

## Test Objective
Optimize Gemini prompts to maximize discovery of historically significant books while minimizing duplicate enrichments (already in database).

## Why Monthly Prompts?

Following Gemini Pro's recommendation, we use **monthly-focused prompts** rather than quarterly or annual:

**Advantages**:
1. **Higher Quality**: Clearer temporal context → more accurate book selection
2. **Faster Response**: 30-60s per call vs. minutes for larger timeframes
3. **Better ISBN Accuracy**: Model has tighter focus → fewer hallucinations
4. **Comparable Units**: Each month is independent → easier A/B testing
5. **Manageable Scope**: 100 books/month = ~1,200/year (sustainable)

**Model Selection**:
- Monthly: `gemini-2.5-flash` (fast, cost-effective)
- Annual (if needed): `gemini-2.5-pro` (better reasoning for bulk)

## Success Metrics
- **Primary**: Hit rate (new ISBNs / total generated)
- **Secondary**: Dedup distribution, invalid ISBN rate, quality scores
- **Target**: >15% hit rate, <15% invalid ISBNs, quality >3.5/5

---

## Variant A: BASELINE (Control)

**Current prompt from `gemini-backfill.ts:216-242`**

**Strategy**: Broad coverage across categories (bestsellers, awards, debuts, genre fiction, non-fiction, international).

**Prompt**:
```
You are a specialized bibliographic archivist. Generate a comprehensive list of exactly 100 books that were published or reached significant cultural prominence in {MONTH} {YEAR}.

Organize your internal retrieval by these categories to ensure variety:
- NYT Bestsellers (Fiction & Non-fiction)
- Award winners or finalists (Pulitzer, Booker, Hugo, National Book Award, etc.)
- High-impact debuts and indie hits
- Popular genre fiction (mystery, romance, sci-fi, fantasy, thriller)
- Notable non-fiction (memoirs, history, science, self-help)
- International translations that reached English-speaking markets

For each book:
1. Provide the ISBN-13 (strongly preferred) or ISBN-10
2. If you are CERTAIN of the ISBN from your training data, set confidence_isbn to "high"
3. If you are estimating based on typical edition patterns, set to "low"
4. If no ISBN is available or you're unsure, provide an empty string and set to "unknown"

IMPORTANT: Only include ISBNs you have high confidence in. It's better to mark confidence as "low" or "unknown" than to guess incorrectly.

Return ONLY a valid JSON array. No markdown, no explanations, no code blocks.
```

**Hypothesis**: Good baseline, but may skew toward bestsellers and major publishers that are already enriched.

---

## Variant B: DIVERSITY-EMPHASIS

**Strategy**: Prioritize non-English, indie publishers, regional presses to reduce overlap with mainstream databases.

**Prompt**:
```
You are a specialized bibliographic archivist. Generate a list of exactly 100 historically or culturally significant books from {MONTH} {YEAR}.

PRIORITIZE (in order of importance):
1. Non-English language editions (Spanish, French, German, Japanese, Chinese, Arabic, etc.)
2. Small and independent publishers
3. Regional presses from underrepresented areas (Latin America, Africa, Asia, Eastern Europe)
4. Translated works that reached international audiences
5. Books that shaped specific communities or movements (not necessarily bestsellers)

AVOID:
- Mainstream bestsellers from major publishers (Random House, Penguin, HarperCollins, Simon & Schuster)
- Books that would be in every major library's collection
- US/UK-only perspectives

For each book:
1. Provide the ISBN-13 (strongly preferred) or ISBN-10
2. Set confidence_isbn based on your certainty: "high" (certain), "low" (estimated), "unknown" (unsure)
3. Empty string for ISBN if unavailable

Geographic diversity is critical. Aim for at least 30-40 non-English or non-US/UK titles.

Return ONLY a valid JSON array. No markdown, no explanations.
```

**Hypothesis**: Lower exact dedup rate (fewer bestsellers), higher discovery of underrepresented works.

---

## Variant C: OVERLOOKED-SIGNIFICANCE

**Strategy**: Focus on culturally significant but not commercially successful books.

**Prompt**:
```
You are a specialized bibliographic archivist. Generate a list of exactly 100 books from {MONTH} {YEAR} that were culturally or historically significant but NOT commercial bestsellers.

Focus on books that:
- Influenced specific academic fields (literature, philosophy, science, politics)
- Were debut works by later-famous authors
- Were controversial, banned, or censored at the time
- Shaped subcultures, movements, or communities
- Are considered "cult classics" or "hidden gems"
- Were published by university presses or small publishers
- Won critical acclaim but not commercial success

AVOID:
- NYT Bestseller list titles
- Blockbuster commercial fiction
- Books with major movie/TV adaptations
- Household-name authors (unless it's their obscure early work)

For each book:
1. Provide the ISBN-13 (strongly preferred) or ISBN-10
2. Set confidence_isbn: "high" (certain), "low" (estimated), "unknown" (unsure)
3. Empty string for ISBN if unavailable

Prioritize books that historians and scholars consider important but the general public may not know.

Return ONLY a valid JSON array. No markdown, no explanations.
```

**Hypothesis**: Finds gaps in mainstream-focused databases, lower exact dedup, higher quality scores.

---

## Variant D: GENRE-ROTATION

**Strategy**: Deep per-genre coverage instead of broad sampling. Rotate genre focus across runs.

**Prompt Template** (with rotating genre):
```
You are a specialized bibliographic archivist. Generate a list of exactly 100 {GENRE} books from {MONTH} {YEAR} that represent the best and most significant works in this genre.

Genre Focus for this run: {GENRE}
[Fiction | Non-Fiction | Mystery/Thriller | Science Fiction/Fantasy | Poetry | Academic/Scholarly | Graphic Novels/Comics | Young Adult | Romance]

For {GENRE}, prioritize:
- Genre classics and award winners
- Works that defined or influenced the genre
- Breakout debuts and cult favorites
- Both mainstream and indie/small press
- International works that reached English readers
- Diverse voices and perspectives within the genre

For each book:
1. Provide the ISBN-13 (strongly preferred) or ISBN-10
2. Set confidence_isbn: "high" (certain), "low" (estimated), "unknown" (unsure)
3. Empty string for ISBN if unavailable

Go DEEP on this genre rather than breadth across many categories.

Return ONLY a valid JSON array. No markdown, no explanations.
```

**Hypothesis**: Reduces overlap between runs, improves coverage within specific categories.

**Genre Rotation Sequence**: Fiction → Non-Fiction → Mystery/Thriller → Sci-Fi/Fantasy → Academic → Poetry

---

## Variant E: ERA-CONTEXTUALIZED

**Strategy**: Adapt prompt tone and focus based on decade context.

**Prompt Template**:
```
You are a specialized bibliographic archivist. Generate a list of exactly 100 books from {MONTH} {YEAR} that {ERA_CONTEXT}.

{ERA_CONTEXT} by decade:
- 1920s-1930s: "defined the modernist movement and interwar period"
- 1940s-1950s: "captured post-war culture and the beginning of the contemporary era"
- 1960s-1970s: "embodied the social revolutions and counterculture movements"
- 1980s-1990s: "defined the late Cold War era and rise of globalization"
- 2000s: "captured the post-9/11 world and early digital age"
- 2010s: "defined the social media era and contemporary cultural debates"
- 2020s: "represent the pandemic era and current global challenges"

For {YEAR}, focus on books that:
- Reflected the zeitgeist of the time
- Addressed era-specific themes and concerns
- Became emblematic of the period (even if not immediate bestsellers)
- Represented diverse perspectives from that era
- Are considered essential to understanding {YEAR}

Categories to include:
- Literary fiction and genre fiction
- Non-fiction (current events, social commentary, memoirs)
- International works
- Debut authors who later became significant

For each book:
1. Provide the ISBN-13 (strongly preferred) or ISBN-10
2. Set confidence_isbn: "high" (certain), "low" (estimated), "unknown" (unsure)
3. Empty string for ISBN if unavailable

Return ONLY a valid JSON array. No markdown, no explanations.
```

**Hypothesis**: Era-appropriate framing improves relevance and reduces generic bestseller lists.

---

## Variant F: ISBN-FORMAT-AWARE

**Strategy**: Explicitly request ISBN-10 (pre-2007) or ISBN-13 (post-2007) to reduce hallucinations.

**Prompt Template**:
```
You are a specialized bibliographic archivist. Generate a list of exactly 100 historically significant books from {MONTH} {YEAR}.

ISBN FORMAT REQUIREMENTS (CRITICAL):
{ISBN_INSTRUCTION}

For years 1970-2006:
- Request ISBN-10 format (10 digits, may end with 'X')
- System will auto-convert to ISBN-13

For years 2007+:
- Request ISBN-13 format (13 digits starting with 978 or 979)

Categories to ensure variety:
- Award winners and literary fiction
- Commercial bestsellers
- Genre fiction (mystery, sci-fi, fantasy, romance, thriller)
- Non-fiction (memoirs, history, science, current events)
- International and translated works
- Notable debuts and indie hits

For each book:
1. Provide the {ISBN_FORMAT} for the first edition published in {YEAR}
2. Set confidence_isbn: "high" (certain), "low" (estimated), "unknown" (unsure)
3. Empty string if ISBN unavailable or uncertain

VALIDATION: Each ISBN must have exactly {EXPECTED_LENGTH} characters (excluding hyphens).
If you cannot verify the ISBN length, mark as "unknown" and leave blank.

Return ONLY a valid JSON array. No markdown, no explanations.
```

**ISBN_INSTRUCTION**:
- Pre-2007: "Return ISBN-10 (exactly 10 characters, last digit may be 'X')"
- Post-2007: "Return ISBN-13 (exactly 13 digits starting with 978 or 979)"

**Hypothesis**: Reduces invalid ISBNs by explicitly guiding format expectations per era.

---

## Experimental Design

### Phase 1: Dry-Run Testing (No ISBNdb Enrichment)

**Test Months**:
- June 1985 (pre-ISBN-13)
- March 2015 (modern)

**Run Sequence**:
1. Baseline on both months (2 runs)
2. Variants B-F on June 1985 (5 runs)
3. Variants B-F on March 2015 (5 runs)

**Total**: 12 dry-runs

### Phase 2: Winner Selection

**Criteria**:
1. Highest hit rate (new_isbns / total)
2. Lowest exact dedup % (avoid bestsellers)
3. Invalid ISBNs <15%
4. Cross-era consistency (both months perform well)

Select top 2 variants for quality review.

### Phase 3: Quality Review

**Sample**: First 20 ISBNs from each top variant (40 books total)

**Review Metrics**:
- Historical/cultural significance (1-5)
- Publisher type (major/indie)
- Language/geographic diversity
- Publication date accuracy
- User appeal ("Would users want this?")

### Phase 4: Full Enrichment Validation

**Test winner on 2 new months**:
- September 1997
- January 2020

Confirm hit rate, quality, and cost efficiency.

---

## Cost Estimates

**Gemini API** (2.5 Flash):
- Input: ~$0.075 per 1M tokens
- Output: ~$0.30 per 1M tokens
- Per run: ~500 input tokens + ~8K output tokens ≈ $0.003 per run
- 12 dry-runs: ~$0.04

**ISBNdb API** (Phase 4 validation only):
- ~200 calls for quality review + validation
- No $ cost (counted against daily quota)

**Total Estimated Cost**: <$0.10 for entire experiment

---

## Implementation Notes

1. All variants use same `SYSTEM_INSTRUCTION` from `gemini-backfill.ts`
2. Temperature: 0.3 (factual accuracy)
3. Model: `gemini-2.5-flash` for all monthly tests
4. Response schema: Same as current (title, author, isbn, confidence_isbn)
5. Validation: All ISBNs go through `isValidISBN()` checksum validation

---

## Next Steps

1. ✅ Create experiment tracking schema
2. ✅ Document prompt variants
3. [ ] Implement dry-run mode in harvest endpoint
4. [ ] Add experiment_id and prompt_override parameters
5. [ ] Run 12 dry-run experiments
6. [ ] Analyze results and select winner
7. [ ] Quality review top 2 variants
8. [ ] Full enrichment validation
9. [ ] Deploy winning prompt to production
