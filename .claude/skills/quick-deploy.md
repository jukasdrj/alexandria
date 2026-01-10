---
description: Quick Worker deployment without full validation (use for hotfixes)
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(cd worker && *)
  - Bash(npx wrangler *)
  - Bash(curl https://alexandria.ooheynerds.com*)
hooks:
  PreToolUse:
    - matcher: "Bash(npx wrangler deploy)"
      hooks:
        - type: prompt
          prompt: "Are you sure you want to deploy? This skips full validation."
          once: true
---

Fast Worker deployment for hotfixes and emergency changes.

## ⚠️ Warning

This skill skips comprehensive pre-deployment checks. Use `/deploy-check` for production deploys.

## When to Use

- Hotfixes for production issues
- Configuration-only changes
- Emergency patches
- After running `/verify-infra` separately

## Steps

1. **Quick build check**:
   ```bash
   cd worker && npm run build
   ```

2. **Deploy**:
   ```bash
   cd worker && npx wrangler deploy
   ```

3. **Smoke test**:
   ```bash
   curl -w "\nStatus: %{http_code}\nTime: %{time_total}s\n" https://alexandria.ooheynerds.com/health
   ```

4. **Monitor for 30 seconds**:
   ```bash
   cd worker && npx wrangler tail --format pretty | head -20
   ```

## Success Criteria

- ✅ Health endpoint returns 200
- ✅ Response time < 200ms
- ✅ No errors in tail logs

## If Deploy Fails

Run full validation:
```bash
./scripts/tunnel-status.sh && ./scripts/db-check.sh
```

Then retry or use `/deploy-check` instead.
