# Complete API Capabilities Research: 6 Book Metadata Providers (2026)

**Research Date**: January 12, 2026
**Focus**: Comprehensive capabilities analysis - what data providers CAN deliver vs. what Alexandria currently uses

---

## 1. OPENLIBRARY API

**Official Documentation**: https://openlibrary.org/dev/docs/api

### Available Endpoints

| Endpoint | Purpose | Current Use in Alexandria |
|----------|---------|--------------------------|
| **Books API** (`/api/books.json`) | Batch book lookup by ISBN/identifier | ✅ Used for ISBN resolution |
| **Search API** (`/search.json`) | Full-text search with filters | ✅ Used for title/author search |
| **Works API** (`/works/{key}.json`) | Work metadata and edition listings | ⚠️ Partially used |
| **Editions API** (`/books/{key}.json`) | Edition-specific details | ✅ Limited use |
| **Authors API** (`/authors/{key}.json`) | Author biography and works | ✅ Limited use |
| **Subjects API** (`/subjects/{name}.json`) | Books by subject/genre | ❌ Not implemented |
| **Covers API** (`/covers/{id}_{size}.jpg`) | Cover images | ✅ Used |
| **Lists API** | User reading lists and curated lists | ❌ Not implemented |
| **My Books API** | Patron reading activity (authenticated) | ❌ N/A for public data |
| **Recent Changes API** | Track all database modifications | ❌ Not implemented |
| **Search Inside API** | Full-text search within books | ❌ Not implemented |
| **Partner API** | Query by OCLC, LCCN identifiers | ❌ Not implemented |

### Metadata Fields Returned

#### Books API (jscmd=viewapi - Default)
```json
{
  "bib_key": "ISBN:...",
  "info_url": "https://openlibrary.org/books/...",
  "preview": "noview|full|partial",
  "preview_url": "https://openlibrary.org/books/.../read",
  "thumbnail_url": "https://covers.openlibrary.org/b/..."
}
```

#### Books API (jscmd=data - Comprehensive)
```json
{
  "url": "https://openlibrary.org/books/...",
  "title": "...",
  "subtitle": "...",
  "authors": [
    {
      "url": "https://openlibrary.org/authors/OL23919A",
      "name": "Author Name"
    }
  ],
  "identifiers": {
    "isbn_10": ["..."],
    "isbn_13": ["..."],
    "lccn": ["..."],
    "oclc": ["..."],
    "goodreads": ["..."],
    "librarything": ["..."]
  },
  "classifications": {
    "lc_classifications": ["..."],
    "dewey_decimal_class": ["..."]
  },
  "subjects": ["..."],
  "subject_places": ["Geography subjects"],
  "subject_people": ["Historical figures"],
  "subject_times": ["Historical periods"],
  "publishers": ["..."],
  "publish_places": ["..."],
  "publish_date": "...",
  "excerpts": [
    {
      "text": "...",
      "comment": "..."
    }
  ],
  "links": [
    {
      "title": "...",
      "url": "..."
    }
  ],
  "cover": {
    "small": "https://covers.openlibrary.org/b/id/...-S.jpg",
    "medium": "https://covers.openlibrary.org/b/id/...-M.jpg",
    "large": "https://covers.openlibrary.org/b/id/...-L.jpg"
  },
  "ebooks": [
    {
      "preview_url": "...",
      "formats": {
        "epub": { "url": "..." },
        "kindle": { "url": "..." },
        "pdf": { "url": "..." }
      }
    }
  ],
  "number_of_pages": 320,
  "weight": "500 grams"
}
```

#### Books API (jscmd=details - Extended)
- All viewapi + data fields
- Table of contents (`table_of_contents`)
- Languages (`languages`)
- Physical format details
- Source records information

#### Works API Metadata
- Work key and edition count
- First publication date
- Author information with role
- All subjects and classifications
- Description/synopsis
- Related works and editions

#### Editions API Fields
- FRBR level edition details
- Binding type
- Physical dimensions
- Format/language
- ISBN variants
- OCLC/LCCN numbers

#### Authors API Fields (Search)
- Author key (e.g., `OL23919A`)
- Name and alternate names
- Birth/death dates
- Top works (up to 5)
- Work count
- Top subjects
- Personal URLs (when available)

#### Authors API Fields (Detailed - .json endpoint)
- Complete biographical data
- Birth/death locations
- Wikipedia URL
- Personal website
- VIAF ID
- All published works with pagination

### Unique Capabilities NOT Currently Used

| Capability | Value for Alexandria |
|-----------|----------------------|
| **Subject browsing** | Could power "Books by Genre" feature - fetch all books in a category |
| **Related works** | Discover related editions/translations automatically |
| **Full-text search** (Search Inside) | Find specific passages within books |
| **Ebook access metadata** | Identify which books have free online versions |
| **LCCN/OCLC identifiers** | Library identifier crosswalk (useful with library systems) |
| **Goodreads/LibraryThing IDs** | Already available in `identifiers` - could cross-link ratings |
| **Table of contents** | Chapter-level metadata for structured exploration |
| **Excerpts with comments** | Community-curated text samples |
| **User reading lists** | Browse curated lists by community members |
| **Recent changes tracking** | Real-time sync of OpenLibrary database updates |

### Rate Limits
- **No official rate limit documented**
- Practical: ~100 requests per 5 minutes (adaptive throttling)
- Recommended delay: 30-100ms between requests

### Notable Observations
- Provides **Goodreads IDs** in identifiers (no API call needed for crosswalk)
- **Free text search** supports 9 filter parameters (author, publisher, language, etc.)
- **RDF/YAML exports** also available for any page (in addition to JSON)
- Covers API returns **3 sizes** (S, M, L) - Alexandria could offer more granular control

---

## 2. GOOGLE BOOKS API

**Official Documentation**: https://developers.google.com/books/docs/v1/reference

### Available Endpoints

| Endpoint | Method | Purpose | Current Use |
|----------|--------|---------|------------|
| **Volumes Search** | GET `/volumes?q={query}` | Full-text search with filters | ✅ Used (fallback) |
| **Volumes Get** | GET `/volumes/{volumeId}` | Detailed volume metadata | ⚠️ Limited |
| **Volumes List** | GET `/mylibrary/bookshelves/{shelf}/volumes` | User bookshelves (auth required) | ❌ Not implemented |
| **Bookshelves Get** | GET `/mylibrary/bookshelves/{shelf}` | Bookshelf details | ❌ Not implemented |
| **Bookshelves List** | GET `/mylibrary/bookshelves` | User's bookshelves | ❌ Not implemented |

### Complete Volume Metadata Schema

```json
{
  "kind": "books#volume",
  "id": "volumeId",
  "etag": "...",
  "selfLink": "https://www.googleapis.com/books/v1/volumes/...",

  "volumeInfo": {
    "title": "...",
    "subtitle": "...",
    "authors": ["..."],
    "publisher": "...",
    "publishedDate": "YYYY-MM-DD",
    "description": "...",
    "industryIdentifiers": [
      {
        "type": "ISBN_13|ISBN_10|ISSN|...",
        "identifier": "..."
      }
    ],
    "readingModes": {
      "text": true,
      "image": true
    },
    "pageCount": 320,
    "printType": "BOOK",
    "categories": ["Category1", "Category2"],
    "maturityRating": "NOT_MATURE",
    "allowAnonLogging": true,
    "contentVersion": "...",
    "imageLinks": {
      "smallThumbnail": "http://books.google.com/books/content?...",
      "thumbnail": "http://books.google.com/books/content?...",
      "small": "...",
      "medium": "...",
      "large": "...",
      "extraLarge": "..."
    },
    "language": "en",
    "previewLink": "https://books.google.com/books?id=...",
    "infoLink": "https://books.google.com/books?id=...",
    "canonicalVolumeLink": "https://books.google.com/books?id=..."
  },

  "layerInfo": {
    "layers": [
      {
        "layerId": "geo",
        "layerType": "geo"
      }
    ]
  },

  "saleInfo": {
    "country": "US",
    "saleability": "FOR_SALE|FREE|NOT_FOR_SALE",
    "isEbook": true,
    "listPrice": {
      "amount": 9.99,
      "currencyCode": "USD"
    },
    "retailPrice": {
      "amount": 7.99,
      "currencyCode": "USD"
    },
    "buyLink": "https://play.google.com/store/books/details?id=...",
    "onSaleDate": "YYYY-MM-DD"
  },

  "accessInfo": {
    "country": "US",
    "viewability": "PARTIAL|ALL_PAGES|NO_PAGES",
    "embeddable": true,
    "publicDomain": true,
    "textToSpeechPermission": "ALLOWED",
    "epub": {
      "isAvailable": true,
      "downloadLink": "..."
    },
    "pdf": {
      "isAvailable": true,
      "downloadLink": "..."
    },
    "webReaderLink": "https://play.google.com/books/reader?id=...",
    "accessViewStatus": "SAMPLE|FULL_FREE|PAID_ONLY|...",
    "quoteSharingAllowed": true
  },

  "searchInfo": {
    "textSnippet": "Matching text snippet from search..."
  },

  "userInfo": {
    "review": "User's review text",
    "readingPosition": {
      "epubCfiPosition": "...",
      "pdfPosition": "...",
      "updated": "2026-01-12T..."
    },
    "isPurchased": true,
    "isPreordered": false,
    "updated": "2026-01-12T..."
  }
}
```

### Search Parameters (Volumes Search)

```
q={query}              # Search term (supports advanced operators)
intitle={title}        # Title search
inauthor={author}      # Author search
inpublisher={pub}      # Publisher search
subject={subject}      # Subject filter
isbn={isbn}            # ISBN lookup
maxResults={1-40}      # Results per page (default: 10)
startIndex={offset}    # Pagination offset
langRestrict={lang}    # Language filter
orderBy=relevance|newest  # Sort order
printType=books|magazines  # Content type filter
filter=full|partial|free|paid|ebooks  # View filter
projection=full|lite   # Field set
```

### Unique Capabilities NOT Currently Used

| Capability | Value |
|-----------|-------|
| **Multiple image sizes** (6 variants) | Could offer responsive cover sizing |
| **eBook metadata** | `epub`, `pdf` download links and availability |
| **Public domain status** | Identify free-to-download books |
| **Text-to-speech permission** | Accessibility feature metadata |
| **Web reader link** | Direct preview in Google Books viewer |
| **Quote sharing permission** | DRM/copyright metadata |
| **Maturity rating** | Content classification |
| **User ratings** (viewability/embeddable) | Licensing restrictions |
| **Layers API** | Geographic/annotation data overlay |
| **User bookshelves** (authenticated) | Social features (requires OAuth) |

### Rate Limits
- **Free tier**: 1,000,000 queries/day
- **Requires API key** (no batch operations for free tier)
- Search-based (no batch ISBN lookup like ISBNdb)

### Notable Observations
- **No direct ratings/review counts** (unlike OpenLibrary metadata)
- **Excellent cover image coverage** with 6 resolution variants
- **Public domain detection** - useful for free distribution
- **eBook accessibility** - can identify DRM-free formats
- **Much stricter rate limits** than OpenLibrary

---

## 3. ARCHIVE.ORG API

**Official Documentation**:
- Advanced Search: https://archive.org/advancedsearch.php
- JSON API: https://archive.org/help/json.php
- Metadata Endpoint: https://archive.org/metadata/{identifier}

### Available Endpoints

| Endpoint | Purpose | Current Use |
|----------|---------|------------|
| **Search API** | Advanced search with Lucene syntax | ✅ Used for cover retrieval |
| **Metadata API** (`/metadata/{id}`) | Complete item metadata | ⚠️ Limited |
| **Open Library Books API** | Partner integration | ✅ Used |
| **Loan Status API** (`/services/loans/loan/...`) | Borrow availability | ❌ Not implemented |
| **BookReader API** | Full-text access | ❌ Not implemented |

### Searchable Metadata Fields (Lucene Syntax)

```
title:              Book title
creator:            Author/creator
date:               Publication date
year:               Publication year
description:        Book description
publisher:          Publisher name
subject:            Subject/genre
licenseurl:         License URL
mediatype:          Item type (texts, audio, video)
collection:         Archive collection
language:           Language code
identifier:         Unique ID
type:               Document type
isbn:               ISBN number
lccn:               Library of Congress Number
oclc_numbers:       OCLC identifiers
```

### Metadata Response Fields (JSON)

**Item-level metadata** (`/metadata/{id}` endpoint):

```json
{
  "metadata": {
    "identifier": "...",
    "title": "...",
    "creator": ["Author 1", "Author 2"],
    "description": "...",
    "date": "YYYY-MM-DD",
    "publisher": "...",
    "subject": ["Subject 1", "Subject 2"],
    "language": "English",
    "licenseurl": "https://creativecommons.org/...",
    "licensekey": "cc-by-sa",
    "type": "Text|Audio|Video",
    "isbn": ["...", "..."],
    "lccn": ["..."],
    "oclc_numbers": ["..."],
    "collection": ["community_texts", "..."],
    "uploader": "username",
    "addeddate": "2020-01-01T...",
    "modificationdate": "2025-12-01T...",
    "reviews": [
      {
        "reviewer": "username",
        "reviewtext": "...",
        "stars": 5,
        "createdate": "2020-01-01T..."
      }
    ],
    "toc": [
      {
        "level": 0,
        "label": "Chapter 1",
        "page": 10
      }
    ],
    "external-identifier": "urn:isbn:...",
    "downloaded": 5000,
    "lending": "interest_match|open|dark"
  },
  "files": [
    {
      "name": "book_djvu.xml",
      "source": "derivative",
      "size": "12345",
      "format": "DjVu XML",
      "mtime": "2020-01-01T..."
    },
    {
      "name": "cover_small.jpg",
      "source": "derivative",
      "size": "45678",
      "format": "Image",
      "original": "cover.jpg"
    }
  ]
}
```

### Search Response Fields

```json
{
  "response": {
    "numFound": 1234,
    "start": 0,
    "docs": [
      {
        "identifier": "...",
        "title": "...",
        "creator": ["..."],
        "date": "YYYY-MM-DD",
        "mediatype": "texts",
        "publisher": "...",
        "isbn": ["..."],
        "description": "...",
        "first_publish_year": 1950,
        "language": ["eng"],
        "lending_edition": "OL...",
        "lending_identifier": "...",
        "has_fulltext": true,
        "public_scan_b": true,
        "preview_url": "https://archive.org/details/..."
      }
    ]
  }
}
```

### Unique Capabilities NOT Currently Used

| Capability | Value |
|-----------|-------|
| **Full-text access** | Search within book content via BookReader API |
| **Borrow/loan API** | Check lending availability status |
| **Table of contents** | Chapter-level granular navigation |
| **Review system** | Community reviews and ratings |
| **Lending status** | Classification (open, dark, interest_match) |
| **License metadata** | CC-by-SA, public domain, etc. |
| **Uploader information** | Data provenance tracking |
| **Download statistics** | Popular books ranking |
| **Modification tracking** | When metadata was last updated |
| **Original file format** | DjVu, PDF, EPUB derivatives |

### Rate Limits
- **No official rate limit** per se
- Practical: 1 request/second recommended
- Cached responses: 7 days (Alexandria uses this)

### Notable Observations
- **Excellent for pre-2000 books** (public domain coverage)
- **Table of contents available** - better than most providers
- **Community reviews** - only provider with ratings
- **Lending metadata** - useful for availability tracking
- **DjVu format support** - unique OCR preservation format

---

## 4. WIKIDATA SPARQL ENDPOINT

**Official Documentation**: https://query.wikidata.org (endpoint: https://query.wikidata.org/sparql)

### Query Capabilities

Wikidata uses SPARQL for querying with these book-related properties:

### Core Book Properties

| Property | ID | Example Value |
|----------|-----|----------------|
| **Instance of** | P31 | Q571 (book), Q187685 (novel), Q1760610 (written work) |
| **Author** | P50 | Q3184 (J.R.R. Tolkien) |
| **ISBN-13** | P212 | 978-0552140163 |
| **ISBN-10** | P957 | 0552140163 |
| **Publication date** | P577 | 1954-07-29 |
| **Inception date** | P571 | Date when work created |
| **Publisher** | P123 | Q3435559 (Allen & Unwin) |
| **Language** | P407 | Q1860 (English) |
| **Genre** | P136 | Q34839 (Fantasy), Q474734 (Mystery) |
| **Subject** | P921 | Q177220 (Mythology) |
| **Number of pages** | P1104 | 423 |

### Extended Book Properties

| Property | ID | Information |
|----------|-----|-------------|
| **Original language** | P364 | Language of original publication |
| **Translator** | P655 | Q123456 (Translator name) |
| **Edition** | P393 | Edition number (as qualifier) |
| **Illustrator** | P674 | Q234567 (Illustrator name) |
| **Narrator** | P2047 | Q345678 (Audiobook narrator) |
| **Series** | P179 | Q14544 (Harry Potter series) |
| **Series ordinal** | P1545 | Position in series |
| **Work location** | P840 | Q2 (Earth) / Q123 (London) |
| **Followed by** | P156 | Q456789 (Sequel) |
| **Follows** | P155 | Q456788 (Prequel) |
| **Based on** | P144 | Q789 (Source material) |
| **Adaptation of** | P408 | Q890 (Original work) |

### Author/Creator Properties

| Property | ID | Information |
|----------|-----|-------------|
| **Birth date** | P569 | Date of birth |
| **Birth place** | P19 | Q123456 (City) |
| **Death date** | P570 | Date of death |
| **Death place** | P20 | Q123456 (City) |
| **VIAF ID** | P214 | VIAF identifier |
| **ISNI** | P213 | International Author ID |
| **IMDB ID** | P345 | Movie database ID |
| **Notable works** | P800 | Q234 (Book title) |
| **Pseudonym** | P742 | Alternative pen name |
| **Spouse** | P26 | Q567 (Person) |
| **Occupation** | P106 | Q36180 (Writer) |
| **Award received** | P166 | Q7191 (Nobel Prize) |

### Example SPARQL Query Structure

```sparql
SELECT ?book ?bookLabel ?author ?authorLabel ?isbn ?pubDate
WHERE {
  ?book wdt:P31 wd:Q571 .                    # Instance of book
  ?book wdt:P50 ?author .                    # Has author
  ?book wdt:P212 ?isbn .                     # ISBN-13
  ?book wdt:P577 ?pubDate .                  # Publication date
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
  }
}
LIMIT 100
```

### Unique Capabilities NOT Currently Used

| Capability | Value |
|-----------|-------|
| **Series detection** | Link book to series and position |
| **Adaptation mapping** | Find movie/play adaptations of books |
| **Sequel/prequel chains** | Automatic series reconstruction |
| **Author awards** | Nobel Prize, Hugo, Booker, etc. |
| **Work location** | Geographic setting of narrative |
| **Translation tracking** | Identify all translations and translators |
| **Named entity extraction** | People/places mentioned in subjects |
| **Illustrator metadata** | Separate from author credit |
| **Author biographical data** | Birth/death dates, place, occupation |
| **VIAF/ISNI crosswalk** | Link to international authority files |

### Rate Limits
- **30 queries/minute** per IP
- **Timeout**: 60 seconds per query
- **Long-running queries** may be blocked

### Notable Observations
- **SPARQL complexity** vs. other APIs (steeper learning curve)
- **Most comprehensive metadata** for descriptive properties
- **Crowd-sourced accuracy** varies (community-edited)
- **Excellent for relationships** (sequels, adaptations, awards)
- **Slowest provider** (SPARQL execution time 3-10 seconds typical)

---

## 5. WIKIPEDIA API (MediaWiki)

**Official Documentation**: https://www.mediawiki.org/wiki/API:Query

### Query Modules (Selected for Books/Authors)

| Module | Purpose | Current Use |
|--------|---------|------------|
| **query** | General page information | ✅ Used for author bios |
| **extracts** | Page summary/introduction | ✅ Used |
| **pageimages** | Primary image from page | ✅ Used for author photos |
| **categories** | Page categories | ⚠️ Limited use |
| **links** | Links within page | ❌ Not used |
| **langlinks** | Inter-wiki language links | ❌ Not used |
| **imageinfo** | Image metadata (size, license) | ⚠️ Limited |
| **parse** | Full page parse with structure | ❌ Not used |
| **info** | Page metadata (edit count, views) | ❌ Not used |
| **revisions** | Edit history | ❌ Not used |
| **externallinks** | External references | ❌ Not used |

### Response Fields (Core Query Module)

```json
{
  "query": {
    "pages": {
      "123456": {
        "pageid": 123456,
        "ns": 0,
        "title": "J. R. R. Tolkien",
        "contentmodel": "wikitext",
        "pagelanguage": "en",
        "pagelanguagedir": "ltr",
        "touched": "2026-01-11T...",
        "lastrevid": 1234567890,
        "length": 45678,

        # extracts module
        "extract": "J. R. R. Tolkien was an English writer...",
        "extracthtml": "<p>J. R. R. Tolkien was an English writer...</p>",

        # pageimages module
        "pageimage": "J._R._R._Tolkien_1.jpg",
        "thumbnail": {
          "source": "https://upload.wikimedia.org/...",
          "width": 200,
          "height": 300
        },

        # categories module
        "categories": [
          {
            "sortkey": "Tolkien, J. R. R.",
            "title": "Category:1892 births",
            "hidden": false
          },
          {
            "sortkey": "Tolkien",
            "title": "Category:British fantasy writers"
          }
        ],

        # links module
        "links": [
          {
            "ns": 0,
            "title": "Oxford University"
          },
          {
            "ns": 0,
            "title": "The Lord of the Rings"
          }
        ],

        # langlinks module
        "langlinks": [
          {
            "lang": "de",
            "title": "J. R. R. Tolkien",
            "autonym": "Deutsch"
          }
        ],

        # imageinfo module
        "imageinfo": [
          {
            "timestamp": "2020-01-01T...",
            "user": "WikiUploader",
            "userid": 12345,
            "size": 456789,
            "width": 1200,
            "height": 1800,
            "url": "https://upload.wikimedia.org/...",
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:...",
            "uploadtext": "Portrait of J.R.R. Tolkien"
          }
        ],

        # info module
        "pageinfo": {
          "edits": 1234,
          "views": 5000000,
          "watchers": 45678
        }
      }
    }
  }
}
```

### Advanced Options: Parse Module

When `action=parse` is used instead of `action=query`:

```json
{
  "parse": {
    "title": "J. R. R. Tolkien",
    "pageid": 123456,
    "sections": [
      {
        "toclevel": 1,
        "level": 2,
        "line": "Early life",
        "number": 1,
        "fromtitle": "J. R. R. Tolkien",
        "byteoffset": 1234,
        "anchor": "Early_life"
      }
    ],
    "text": "<div class=\"mw-parser-output\">...</div>",
    "langlinks": [...],
    "categories": [...],
    "links": [...],
    "templates": [...],
    "images": [...],
    "externallinks": [...],
    "references": [
      {
        "key": "ref1",
        "content": "Reference text"
      }
    ],
    "parsewarnings": []
  }
}
```

### Infobox Data (Special Parsing)

Infobox data is available via page parse, includes fields like:
- Birth date/place
- Death date/place
- Nationality
- Occupation
- Known for
- Awards
- Spouse/family
- Education
- Notable works

### Unique Capabilities NOT Currently Used

| Capability | Value |
|-----------|-------|
| **Full page structure** | Sections, headers, table of contents |
| **Page parse** | Complete wiki markup parsing |
| **Edit history** | Revision tracking (quality indicator) |
| **View statistics** | Page popularity metric |
| **Category browsing** | Contextual categorization |
| **Inter-wiki links** | Multilingual article linking |
| **Reference extraction** | Citation/source tracking |
| **Image metadata** | Photo licensing, dimensions, uploader |
| **External links** | Reference URLs within article |
| **Template expansion** | Infobox field extraction |

### Rate Limits
- **No official limit** documented
- Practical: ~10 requests/second (adaptive)
- User-Agent required with contact email

### Notable Observations
- **Infobox parsing requires special handling** (not directly structured)
- **Very comprehensive extraction** if page parse is used
- **Image copyright** metadata available (licensing)
- **Edit metrics** provide quality signal (heavily edited = popular/contentious)
- **Multiple image formats** (original + thumbnail)

---

## 6. ISBNdb PREMIUM API

**Official Documentation**: https://isbndb.com/isbndb-api-documentation-v2

### Available Endpoints

| Endpoint | Method | Purpose | Current Use |
|----------|--------|---------|------------|
| **Books** | POST/GET `/books?query=...&isbn=...` | Batch/search lookup | ✅ Primary provider |
| **Author** | GET `/author/{name}?page=` | Bibliography by author | ⚠️ Limited |
| **Book** | GET `/book/{isbn}` | Individual ISBN lookup | ✅ Used |
| **Authors** | GET `/authors?query=` | Author search | ❌ Not used |

### Metadata Fields Returned (Complete Schema)

```json
{
  "data": {
    "isbn": "9780552140163",
    "isbn10": "0552140163",
    "isbn13": "9780552140163",
    "title": "The Hobbit",
    "authors": [
      {
        "name": "J. R. R. Tolkien",
        "id": "tolkien-jrr"
      }
    ],
    "publisher": "Bantam",
    "language": "English",
    "language_code": "en",
    "publication_date": "1989-04-01",
    "edition": "Reissue",
    "binding": "Paperback|Hardcover|...",
    "pages": 423,
    "dimensions": {
      "height": "8.5 in",
      "length": "5.5 in",
      "thickness": "1.25 in",
      "weight": "8.5 oz"
    },
    "image": "https://images.isbndb.com/...",
    "image_url": "https://images.isbndb.com/covers/.../secure_...",
    "ratings_count": 5000,
    "rating": 4.5,
    "price": "$8.99",
    "price_currency": "USD",
    "msrp": "$12.99",
    "discount": "25%",
    "synopsys": "Long description of the book...",
    "synopsis": "Short description...",
    "subjects": [
      "Fantasy",
      "Adventure",
      "Fiction"
    ],
    "related": [
      "9780552140170",
      "9780552140187"
    ],
    "reviews": [
      {
        "isbn": "9780552140163",
        "review_id": "12345",
        "reviewer": "User123",
        "rating": 5,
        "review_text": "Amazing book!",
        "date": "2025-12-01T..."
      }
    ],
    "awards": [
      {
        "award_name": "Hugo Award",
        "award_year": 1956
      }
    ],
    "formats": [
      {
        "format": "Paperback|Hardcover|eBook",
        "isbn": "978...",
        "edition": "1st Edition"
      }
    ],
    "discrepancies": [],
    "physical_description_url": "...",
    "amazon_asin": "B001",
    "goodreads_id": "3",
    "google_books_id": "123ABC",
    "openlibrary_id": "OL123M",
    "librarything_id": "456"
  }
}
```

### Premium Plan Features

| Feature | Free Tier | Premium Tier |
|---------|-----------|--------------|
| **Requests/sec** | 1 | 3 |
| **Batch size** | 10 ISBNs/call | 1000 ISBNs/call |
| **Metadata fields** | 9 basic | 19+ comprehensive |
| **Ratings/reviews** | ❌ | ✅ |
| **Synopses/descriptions** | Short | Full |
| **Cover images** | Limited | Full URL |
| **Awards metadata** | ❌ | ✅ |
| **Format/edition variants** | ❌ | ✅ |
| **Author bibliography** | ❌ | ✅ |

### Author Bibliography Endpoint

```
GET /author/{author_name}?page={n}&pageSize=1000

Response:
{
  "data": {
    "author_id": "tolkien-jrr",
    "name": "J. R. R. Tolkien",
    "page": 1,
    "pageSize": 1000,
    "total_results": 47,
    "results": [
      {
        "isbn": "...",
        "title": "...",
        "year": 1954,
        "edition": "..."
      }
    ]
  }
}
```

### Unique Capabilities NOT Currently Used

| Capability | Value |
|-----------|-------|
| **Ratings & reviews** | 5-star ratings + user reviews |
| **Awards metadata** | Hugo, Booker, etc. |
| **Full synopses** | Complete book descriptions |
| **Physical dimensions** | Height, width, thickness, weight |
| **Related editions** | ISBN variants and formats |
| **MSRP/pricing** | Original and sale prices |
| **External ID mapping** | Amazon ASIN, Goodreads, Google Books, OpenLibrary, LibraryThing |
| **Author bibliography** | Complete works with pagination (1000/page) |
| **Format variants** | Track all editions (hardcover, paperback, eBook) |
| **Discrepancy tracking** | Data quality flags |

### Rate Limits
- **Premium**: 3 requests/second
- **Batch**: 1000 ISBNs per POST call
- **Each call counts as 1 request** (not per result)
- Daily quota: ~259,000 calls/day (15K limit minus 2K buffer = 13K practical)

### Notable Observations
- **Most expensive data source** ($29.95/month)
- **Highest accuracy** for metadata
- **Excellent for premium features** (ratings, awards, full descriptions)
- **External ID crosswalk included** - no separate API calls needed
- **Contact info** and **URL references** available

---

## COMPARATIVE ANALYSIS: What Alexandria Doesn't Use

### High-Value Untapped Capabilities

| Feature | Best Source | Use Case | Difficulty |
|---------|------------|----------|-----------|
| **Book ratings & reviews** | ISBNdb Premium | Recommendation engine | Medium |
| **Series detection & ordering** | Wikidata | Series browsing | High |
| **Sequel/prequel mapping** | Wikidata | Book continuity | High |
| **Award tracking** | ISBNdb + Wikidata | Best books by year | Medium |
| **Translations metadata** | Wikidata | Multilingual catalog | High |
| **Table of contents** | Archive.org | Chapter-level search | Medium |
| **Full-text search** | Archive.org | Passage lookup | High |
| **Subject browsing** | OpenLibrary | Genre navigation | Low |
| **Related editions** | ISBNdb | Format variants | Low |
| **Author awards** | Wikidata | Author credentials | Medium |
| **Physical dimensions** | ISBNdb | Inventory metadata | Low |
| **Public domain status** | Google Books + Archive.org | Legal distribution | Low |
| **eBook access** | Google Books | Format availability | Medium |
| **Author biography** | Wikipedia | Author profiles | Medium |
| **Work/edition distinction** | OpenLibrary + Wikidata | FRBR modeling | High |

### Quick Wins (Easy to Implement)

1. **Subject browsing** (OpenLibrary) - Add `/api/subjects/{name}` endpoint
2. **Related editions** (ISBNdb) - Surface format variants
3. **Physical dimensions** (ISBNdb) - Display in book details
4. **Public domain status** (Google Books) - Add free availability indicator
5. **Author awards** (Wikidata) - Display credentials

### Medium Effort Wins

1. **Series detection** (Wikidata) - Rebuild Series capability
2. **Table of contents** (Archive.org) - Chapter browsing
3. **Author biography** (Wikipedia) - Richer author profiles
4. **eBook formats** (Google Books) - Show format availability

### Major Investments

1. **Full-text search** (Archive.org) - Passage lookup across library
2. **Ratings/reviews system** (ISBNdb) - User engagement feature
3. **Translation tracking** (Wikidata) - Multilingual catalog
4. **Work/edition modeling** (FRBR) - Semantic book structure

---

## Recommendations for Alexandria Capability Expansion

### Phase 1: Quick Wins (Minimal Change)
- [ ] Add **subject browsing** via OpenLibrary
- [ ] Add **format variants** display from ISBNdb
- [ ] Add **public domain detection** from Google Books
- [ ] Surface **author awards** from Wikidata

### Phase 2: Medium Effort (Moderate Complexity)
- [ ] Implement **table of contents** from Archive.org
- [ ] Add **series detection** via Wikidata SPARQL
- [ ] Enhance **author profiles** with Wikipedia extracts
- [ ] Add **eBook availability** metadata

### Phase 3: Major Features (Significant Engineering)
- [ ] Build **ratings & reviews** system (ISBNdb + user ratings)
- [ ] Implement **full-text passage search** (Archive.org)
- [ ] Add **work/edition distinction** modeling (FRBR)
- [ ] Create **translation tracking** across languages

---

## Data Integration Matrix

```
Provider         | ISBN   | Metadata | Covers | Authors | Subjects | Ratings
-----------------+--------+----------+--------+---------+----------+--------
OpenLibrary      | ✅     | ✅✅✅   | ✅     | ✅      | ✅       | ❌
Google Books     | ✅     | ✅✅     | ✅✅✅  | ✅      | ⚠️      | ✅
Archive.org      | ⚠️     | ✅      | ✅     | ❌      | ✅       | ✅
Wikidata         | ✅     | ✅✅✅   | ⚠️     | ✅✅    | ✅✅     | ❌
Wikipedia        | ❌     | ⚠️      | ✅     | ✅✅    | ✅       | ❌
ISBNdb Premium   | ✅✅   | ✅✅✅   | ✅     | ✅      | ✅       | ✅✅
```

---

## Sources

- [Open Library API Documentation](https://openlibrary.org/dev/docs/api)
- [Google Books API Reference](https://developers.google.com/books/docs/v1/reference)
- [Google Books API Using Guide](https://developers.google.com/books/docs/v1/using)
- [Archive.org Advanced Search](https://archive.org/advancedsearch.php)
- [Archive.org JSON API Documentation](https://archive.org/help/json.php)
- [Wikidata SPARQL Tutorial](https://www.wikidata.org/wiki/Wikidata:SPARQL_tutorial)
- [Wikidata WikiProject Books](https://www.wikidata.org/wiki/Wikidata:WikiProject_Books)
- [MediaWiki API Query Module](https://www.mediawiki.org/wiki/API:Query)
- [ISBNdb API Documentation v2](https://isbndb.com/isbndb-api-documentation-v2)
- [ISBNdb Premium Features](https://isbndb.com/isbn-database)
