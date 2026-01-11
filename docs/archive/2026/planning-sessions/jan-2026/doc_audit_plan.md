# Documentation Audit Plan

**Date**: 2026-01-11
**Purpose**: Ensure all Alexandria documentation is accurate, concise, organized, and current

## Recommendations

### HIGH PRIORITY - Correctness Issues

#### 1. Fix CLAUDE.md Queue Configuration Error
**File**: `/Users/juju/dev_repos/alex/CLAUDE.md`
**Issue**: States "enrichment-queue (100 batch/1 concurrent)" but actual config is 10 batch
**Line**: Search for "100 batch" in Queue Architecture section
**Fix**: Change to "enrichment-queue (10 batch/1 concurrent)"
**Impact**: Misleading information could cause confusion during queue tuning

#### 2. Delete Orphaned Planning Files from Root
**Files to Delete**:
- `/Users/juju/dev_repos/alex/gemini_debug_findings.md` (15KB, Jan 11)
- `/Users/juju/dev_repos/alex/gemini_debug_task_plan.md` (2.7KB, Jan 11)
- `/Users/juju/dev_repos/alex/findings.md` (8.6KB, Jan 10)
- `/Users/juju/dev_repos/alex/task_plan.md` (10KB, Jan 10)
- `/Users/juju/dev_repos/alex/progress.md` (17KB, Jan 10)

**Rationale**: These are leftover planning-with-files artifacts from completed tasks (Gemini debug session, generic planning sessions). The work is complete and these files clutter the root directory. Alexandria has a clean policy: only README, CLAUDE, TODO, CHANGELOG, MASTER-TODO in root.

**Verification**: These files are NOT referenced in any documentation (checked INDEX.md, README.md, CLAUDE.md)

---

### MEDIUM PRIORITY - Organization Improvements

#### 3. Relocate Documentation from Root to docs/
**Files to Move**:

Move to `docs/features/`:
- `SYNTHETIC_WORKS_ENRICHMENT_FLOW.md` (21KB, Jan 10) → `docs/features/SYNTHETIC-WORKS-ENRICHMENT-FLOW.md`
- `SYNTHETIC_ENHANCEMENT_SUMMARY.md` (9KB, Jan 10) → `docs/features/SYNTHETIC-ENHANCEMENT-SUMMARY.md`

Move to `docs/operations/`:
- `CRON_CONFIGURATION.md` (11KB, Jan 10) → `docs/operations/CRON-CONFIGURATION.md`
- `QUOTA_EXHAUSTION_HANDLING.md` (12KB, Jan 10) → `docs/operations/QUOTA-EXHAUSTION-HANDLING.md`

Move to `docs/database/`:
- `schema_analysis.md` (17KB, Jan 10) → `docs/database/SCHEMA-ANALYSIS.md`

Move to `docs/planning/`:
- `EXTERNAL_API_ARCHITECTURE_PLAN.md` (23KB, Jan 11) → `docs/planning/EXTERNAL-API-ARCHITECTURE-PLAN.md`
- `SPRINT-PLAN-2026.md` (7.8KB, Jan 8) → `docs/planning/SPRINT-PLAN-2026.md`
- `PLANNING-SETUP-COMPLETE.md` (10KB, Jan 9) → `docs/planning/PLANNING-SETUP-COMPLETE.md` (or delete if obsolete)

**Rationale**: Alexandria's documented standard is to keep only 5 files in root: README, CLAUDE, TODO, CHANGELOG, MASTER-TODO. These 8 files belong in organized subdirectories. This improves discoverability via docs/INDEX.md navigation.

**Impact**: After moving, update any references in docs/INDEX.md

#### 4. Update docs/INDEX.md References
**After moving files above**, update INDEX.md to reference new locations:
- Add synthetic works docs to "Features" section
- Add cron config to "Operations" section
- Add quota exhaustion to "Operations" section
- Add schema analysis to "Database" section (if relevant)

#### 5. Consolidate or Archive MASTER-TODO.md
**File**: `/Users/juju/dev_repos/alex/MASTER-TODO.md`
**Issue**: Redundant with TODO.md and outdated (Jan 5 vs Jan 10)
**Options**:
  a) **Delete** if TODO.md serves the same purpose (recommended)
  b) **Merge** unique content into TODO.md and delete
  c) **Clarify purpose** in both files if they serve different audiences

**Current State**:
- MASTER-TODO.md: 86 lines, task-centric, "P1/P2/P3/P4" priority system
- TODO.md: 194 lines, phase-based roadmap, "Recently Completed" tracking
- Both claim to track future work

**Recommendation**: Delete MASTER-TODO.md and update docs/INDEX.md to remove the reference. TODO.md is more comprehensive and actively maintained.

---

### LOW PRIORITY - Enhancements

#### 6. Update README.md with Recent Features
**File**: `/Users/juju/dev_repos/alex/README.md`
**Missing**:
- Synthetic works enhancement system (daily cron at midnight UTC)
- Multi-source ISBN resolution (v2.5.0) is mentioned but not prominent
- Version still shows 2.4.0 (should be 2.5.0 based on TODO.md)

**Additions Needed**:
Add to "Current Status" section (line 15-23):
```markdown
**Recent Features (Jan 2026):**
- 🔄 Multi-source ISBN resolution (5-tier fallback when ISBNdb quota exhausted)
- 🤖 Synthetic works enhancement (daily automated upgrade of AI-generated books)
- 👤 Author JIT enrichment (view-triggered metadata enhancement)
```

Update version on line 435: "Version: 2.4.0" → "Version: 2.5.0"

#### 7. Document Synthetic Enhancement in CURRENT-STATUS.md
**File**: `/Users/juju/dev_repos/alex/docs/CURRENT-STATUS.md`
**Issue**: Does not mention synthetic works enhancement system (daily cron at midnight UTC)
**Fix**: Add to "Active Features" or "Recently Completed" section with reference to docs in features/

#### 8. Consider Modularizing CLAUDE.md
**File**: `/Users/juju/dev_repos/alex/CLAUDE.md`
**Issue**: 42KB file is comprehensive but potentially overwhelming
**Suggestion**: Consider breaking into sections:
- `CLAUDE.md` - Core developer guide (architecture, commands, patterns)
- `docs/CLAUDE-ARCHITECTURE.md` - Detailed architecture
- `docs/CLAUDE-SKILLS.md` - Skills and agents reference
- `docs/CLAUDE-API.md` - API endpoints and integration

**Trade-off**: Single file is convenient for AI consumption, but harder for human navigation. Current structure is acceptable if too verbose for humans but optimal for AI.

**Recommendation**: Keep as-is for now, but add a table of contents at the top

#### 9. Update Last Updated Dates
**Files needing date updates**:
- `MASTER-TODO.md` - Last Updated: Jan 5 (if keeping file)
- Any docs moved should get "Last Updated: Jan 11, 2026"

---

### SUMMARY OF CHANGES

**Files to Delete** (5 orphaned planning files):
- gemini_debug_findings.md
- gemini_debug_task_plan.md
- findings.md
- task_plan.md
- progress.md

**Files to Move** (8 documentation files):
- 2 to docs/features/
- 2 to docs/operations/
- 1 to docs/database/
- 3 to docs/planning/

**Files to Update** (4 core documentation files):
- CLAUDE.md (fix queue config)
- README.md (add recent features, update version)
- docs/INDEX.md (update moved file references)
- docs/CURRENT-STATUS.md (document synthetic enhancement)

**Optional**:
- Delete or merge MASTER-TODO.md
- Add table of contents to CLAUDE.md

