---
description: Verify Alexandria infrastructure health (tunnel + database)
model: haiku
---

Check the health of the entire Alexandria infrastructure stack.

## Steps

1. Check tunnel status (expect 4 active connections):
   ```bash
   ./scripts/tunnel-status.sh
   ```

2. Verify database and run sample query:
   ```bash
   ./scripts/db-check.sh
   ```

3. Test Worker deployment:
   ```bash
   curl https://alexandria.ooheynerds.com
   ```

4. Report status:
   - ✅ Tunnel connections active
   - ✅ Database accessible with correct record counts
   - ✅ Worker responding
   - Any issues found

If any check fails, consult CLAUDE.md troubleshooting section.
