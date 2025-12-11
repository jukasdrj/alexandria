---
description: Deploy Worker with full pre/post validation
model: sonnet
---

Deploy the Cloudflare Worker with comprehensive checks.

think harder about potential deployment risks and validation steps

## Pre-deployment

1. Verify infrastructure health:
   ```bash
   ./scripts/tunnel-status.sh
   ./scripts/db-check.sh
   ```

2. Test Worker locally first:
   ```bash
   cd worker && npm run dev
   ```

3. Ask user to confirm local testing passed

## Deployment

4. Deploy to Cloudflare:
   ```bash
   cd worker && npx wrangler deploy
   ```

## Post-deployment

5. Check Worker logs:
   ```bash
   cd worker && npm run tail
   ```

6. Test live endpoint:
   ```bash
   curl https://alexandria.ooheynerds.com
   ```

7. Report deployment status and any issues

## If deployment fails

- Check Wrangler auth: `npx wrangler whoami`
- Review logs for errors
- Verify wrangler.toml configuration
