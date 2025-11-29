---
description: Plan Phase 2 database integration implementation
---

Create a detailed implementation plan for Phase 2 (database integration).

## Planning Steps

Use "think harder" mode to:

1. Review current Worker code (worker/index.js)
2. Review database schema in CLAUDE.md
3. Decide between:
   - Option A: Direct connection (quick start)
   - Option B: Hyperdrive (production-ready)

4. Create implementation plan covering:
   - PostgreSQL driver installation
   - Wrangler configuration changes
   - Environment variables/secrets needed
   - API endpoint structure (/api/search?isbn=XXX)
   - Error handling strategy
   - Input validation approach
   - Testing strategy

5. Present plan to user for approval before coding

6. Ask clarifying questions about:
   - Which approach (A or B)?
   - What query endpoints to prioritize?
   - Error handling preferences?
   - Rate limiting requirements?

## Important

- DO NOT start coding until plan is approved
- Test all queries in psql first
- Follow patterns in CLAUDE.md "Code Patterns" section
- Remember: USE edition_isbns table for ISBN lookups
