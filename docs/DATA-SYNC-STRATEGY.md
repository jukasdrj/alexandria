# Alexandria Data Sync Strategy

**Created**: November 28, 2025
**Your Current Dump**: August 31, 2025 (based on MAX(last_modified))

---

## 📊 Current Database State

```
Your Data (August 2025 Dump):
├── editions:     54,881,444
├── works:        40,158,110
├── authors:      14,717,841
├── edition_isbns: 49.3M (derived)
└── author_works:  42.8M (derived)

Data Range: 2008-04-01 → 2025-08-31
Monthly Churn: ~500K-1M edition modifications
```

---

## 🔍 How to Verify Your Dump Version

### Method 1: Check MAX(last_modified)
```sql
-- Quick version check
SELECT 
    'editions' as table_name, MAX(last_modified) as dump_date
FROM editions
UNION ALL
SELECT 'works', MAX(last_modified) FROM works
UNION ALL
SELECT 'authors', MAX(last_modified) FROM authors;

-- Result: 2025-08-31 means you have the August 2025 dump
```

### Method 2: Check Row Counts vs OpenLibrary Stats
Compare your counts against https://openlibrary.org/stats

### Method 3: Store Metadata (Recommended for Future)
```sql
-- Create a metadata tracking table
CREATE TABLE IF NOT EXISTS dump_metadata (
    id SERIAL PRIMARY KEY,
    dump_date DATE NOT NULL,
    imported_at TIMESTAMP DEFAULT NOW(),
    editions_count BIGINT,
    works_count BIGINT,
    authors_count BIGINT,
    source_url TEXT,
    notes TEXT
);

-- Record current state
INSERT INTO dump_metadata (dump_date, editions_count, works_count, authors_count, notes)
SELECT 
    '2025-08-31'::date,
    (SELECT COUNT(*) FROM editions),
    (SELECT COUNT(*) FROM works),
    (SELECT COUNT(*) FROM authors),
    'Initial import via LibrariesHacked scripts';
```

---

## 📦 OpenLibrary Dump Format

### File Structure
Dumps are TSV files with columns:
```
type        key                 revision  last_modified  JSON
/type/edition  /books/OL1M       3         2023-01-15    {"title": "...", ...}
/type/work     /works/OL15W      2         2022-12-01    {"title": "...", ...}
/type/author   /authors/OL25A    1         2021-06-20    {"name": "...", ...}
```

### Download URLs
```bash
# Latest dumps (redirects to current month)
https://openlibrary.org/data/ol_dump_editions_latest.txt.gz
https://openlibrary.org/data/ol_dump_works_latest.txt.gz  
https://openlibrary.org/data/ol_dump_authors_latest.txt.gz

# Specific month dumps (archive.org)
https://archive.org/download/ol_dump_2025-08-31/ol_dump_editions_2025-08-31.txt.gz

# Browse all dumps
https://archive.org/details/ol_exports?sort=-publicdate
```

### Release Schedule
- Monthly (usually end of month)
- Sometimes delayed or broken (monitor GitHub issues)
- Torrents available for faster downloads

---

## 🔄 Update Strategies

### Strategy A: Full Reload (Simple, Safe)
**When to use**: Major version jumps, schema changes, or quarterly refreshes

**Process**:
1. Download new complete dumps
2. Process with existing scripts
3. Load into staging database
4. Swap staging → production
5. Rebuild derived tables (author_works, edition_isbns)

**Pros**: Clean slate, no data corruption risk
**Cons**: 4-8 hours downtime, high disk I/O

### Strategy B: Incremental UPSERT (Efficient)
**When to use**: Monthly updates after initial load

**Process**:
1. Download new dumps
2. Filter to records where `last_modified > your_max_date`
3. UPSERT changed records
4. Update derived tables incrementally

**Pros**: Faster, less disk I/O
**Cons**: More complex, requires careful handling

### Strategy C: Hybrid (Recommended)
- Use **incremental** for monthly updates
- Use **full reload** quarterly for data integrity

---

## 🛠️ Incremental Update Implementation

### Step 1: Extract Changed Records

Create a Python script to filter new/changed records:

```python
#!/usr/bin/env python3
"""
Filter OpenLibrary dump to records modified after a cutoff date.
Usage: python filter_updates.py ol_dump_editions.txt 2025-08-31 > updates.txt
"""

import sys
import csv
from datetime import datetime

def filter_updates(input_file, cutoff_date_str):
    cutoff = datetime.strptime(cutoff_date_str, '%Y-%m-%d').date()
    
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        writer = csv.writer(sys.stdout, delimiter='\t')
        
        for row in reader:
            if len(row) >= 4:
                try:
                    last_modified = datetime.strptime(row[3], '%Y-%m-%d').date()
                    if last_modified > cutoff:
                        writer.writerow(row)
                except ValueError:
                    continue

if __name__ == '__main__':
    filter_updates(sys.argv[1], sys.argv[2])
```

### Step 2: Create UPSERT SQL

```sql
-- For editions (similar for works/authors)
CREATE TEMP TABLE editions_staging (
    type TEXT,
    key TEXT,
    revision INTEGER,
    last_modified DATE,
    data JSONB
);

-- Load filtered updates
\copy editions_staging FROM 'updates_editions.csv' WITH (FORMAT csv, DELIMITER E'\t');

-- UPSERT into main table
INSERT INTO editions (type, key, revision, last_modified, data, work_key)
SELECT 
    type, key, revision, last_modified, data,
    data->'works'->0->>'key' as work_key
FROM editions_staging
ON CONFLICT (key) DO UPDATE SET
    revision = EXCLUDED.revision,
    last_modified = EXCLUDED.last_modified,
    data = EXCLUDED.data,
    work_key = EXCLUDED.data->'works'->0->>'key'
WHERE editions.revision < EXCLUDED.revision;

-- Update derived tables
INSERT INTO edition_isbns (edition_key, isbn)
SELECT DISTINCT
    e.key,
    jsonb_array_elements_text(
        COALESCE(e.data->'isbn_13', '[]'::jsonb) || 
        COALESCE(e.data->'isbn_10', '[]'::jsonb)
    )
FROM editions_staging e
ON CONFLICT DO NOTHING;
```

### Step 3: Automation Script

```bash
#!/bin/bash
# sync-openlibrary.sh - Monthly sync script

set -e

DUMP_DATE=$(date +%Y-%m-01)  # First of current month
CUTOFF_DATE=$(psql -h localhost -U openlibrary -d openlibrary -t -c \
    "SELECT MAX(last_modified) FROM editions;")

echo "Current data cutoff: $CUTOFF_DATE"
echo "Downloading dump: $DUMP_DATE"

# Download new dumps
mkdir -p /mnt/user/data/openLibrary/updates
cd /mnt/user/data/openLibrary/updates

for type in editions works authors; do
    wget -N "https://archive.org/download/ol_dump_${DUMP_DATE}/ol_dump_${type}_${DUMP_DATE}.txt.gz"
    
    # Decompress and filter to updates only
    gzip -cd ol_dump_${type}_${DUMP_DATE}.txt.gz | \
        python3 filter_updates.py - ${CUTOFF_DATE} > updates_${type}.txt
        
    echo "Filtered ${type}: $(wc -l < updates_${type}.txt) records"
done

# Apply updates (run in psql)
psql -h localhost -U openlibrary -d openlibrary -f apply_updates.sql

# Record metadata
psql -h localhost -U openlibrary -d openlibrary -c \
    "INSERT INTO dump_metadata (dump_date, notes) VALUES ('${DUMP_DATE}', 'Incremental update');"

echo "Sync complete!"
```

---

## 📍 Your Existing Scripts Location

```
/mnt/user/data/openLibrary/setup/openlibrary-search/
├── openlibrary_data_process.py   # Chunks large files into CSVs
├── openlibrary-db.sql             # Database schema
└── db_scripts/
    ├── load.sql                   # Master load script
    ├── tbl_editions.sql           # Table definitions
    ├── tbl_editions_indexes.sql   # Index definitions
    ├── tbl_edition_isbns.sql      # Derived ISBN table
    └── ...
```

These scripts are designed for **full reload**. For incremental updates, you'll need the filtering + UPSERT approach above.

---

## 📅 Recommended Sync Schedule

| Frequency | Action | Purpose |
|-----------|--------|---------|
| Monthly | Incremental UPSERT | Keep data fresh |
| Quarterly | Full reload | Data integrity check |
| Ad-hoc | ISBN spot-check | Verify specific books |

### Cron Job (Monthly First Sunday)
```bash
# Add to Unraid crontab
0 3 * * 0 [ $(date +\%d) -le 7 ] && /mnt/user/data/openLibrary/sync-openlibrary.sh >> /var/log/ol-sync.log 2>&1
```

---

## ⚠️ Important Considerations

### 1. OpenLibrary Dump Availability
- Dumps are sometimes late or broken
- Check GitHub issues before sync: https://github.com/internetarchive/openlibrary/issues?q=dump
- Have fallback to previous month if current unavailable

### 2. Works vs Editions Model
OpenLibrary uses FRBR-inspired model:
- **Work**: Abstract creative work (e.g., "Harry Potter and the Sorcerer's Stone")
- **Edition**: Physical/digital manifestation (e.g., 1999 Scholastic Paperback)
- One Work → Many Editions
- Your `author_works` and `edition_isbns` are derived from this

### 3. Orphaned Editions
~5M editions have no associated work (early OL imports). These still have ISBNs and are searchable.

### 4. Disk Space Requirements
```
Compressed dumps:    ~15GB total
Uncompressed:        ~80GB total
Processed CSVs:      ~60GB
Database:            ~250GB
Working space:       ~100GB needed during import
```

---

## 🎯 Next Steps

1. **Create metadata table** to track dump versions
2. **Set up sync directory** at `/mnt/user/data/openLibrary/updates/`
3. **Create filter_updates.py** script
4. **Create apply_updates.sql** UPSERT script
5. **Test incremental update** with September 2025 dump
6. **Set up monthly cron job**

---

## 📚 Resources

- OpenLibrary Dumps: https://openlibrary.org/developers/dumps
- Archive.org Dumps: https://archive.org/details/ol_exports?sort=-publicdate
- LibrariesHacked Scripts: https://github.com/LibrariesHacked/openlibrary-search
- OpenLibrary GitHub: https://github.com/internetarchive/openlibrary
- Data Schema: https://github.com/internetarchive/openlibrary-client/tree/master/olclient/schemata

---

**TL;DR**: You have the August 2025 dump. Download September+ dumps, filter to `last_modified > 2025-08-31`, UPSERT into existing tables, update derived tables. Do full reload quarterly for safety.
