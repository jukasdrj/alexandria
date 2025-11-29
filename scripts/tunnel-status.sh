#!/bin/bash
# Check Cloudflare Tunnel status on Unraid

echo "🔍 Checking Alexandria Tunnel Status..."
echo ""

# Check if tunnel container is running
echo "📦 Container Status:"
ssh root@Tower.local "docker ps --filter name=alexandria-tunnel --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
echo ""

# Show recent logs
echo "📋 Recent Logs (last 20 lines):"
ssh root@Tower.local "docker logs alexandria-tunnel --tail 20 2>&1"
echo ""

# Show active connections
echo "🌐 Active Tunnel Connections:"
ssh root@Tower.local "docker logs alexandria-tunnel 2>&1 | grep 'Registered tunnel' | tail -4"
echo ""

echo "✅ Tunnel check complete"
