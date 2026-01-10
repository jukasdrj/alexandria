---
description: Monitor Cloudflare Tunnel health and restart if needed
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(./scripts/tunnel-status.sh)
  - Bash(ssh root@Tower.local *)
  - AskUserQuestion
---

Monitor the Cloudflare Tunnel health for Alexandria infrastructure.

## What This Does

Checks the tunnel status and offers to restart if connections are down.

## Steps

1. **Check tunnel status** (expect 4 active connections):
   ```bash
   ./scripts/tunnel-status.sh
   ```

2. **Analyze results**:
   - ✅ 4 connections = Healthy
   - ⚠️ 1-3 connections = Degraded
   - ❌ 0 connections = Down

3. **If degraded or down**, ask user if they want to restart:
   ```bash
   ssh root@Tower.local "docker restart alexandria-tunnel"
   ```

4. **Wait 10 seconds** and re-check status

## Expected Output

```
Tunnel Status: ✅ Healthy
Active Connections: 4/4
```

## Troubleshooting

If restart doesn't fix it:
- Check Docker: `ssh root@Tower.local "docker ps | grep tunnel"`
- Check logs: `ssh root@Tower.local "docker logs alexandria-tunnel --tail 50"`
- Verify Cloudflare dashboard for tunnel configuration
