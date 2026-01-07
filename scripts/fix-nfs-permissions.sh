#!/bin/bash
# Quick Fix: NFS Permission Issues (Docker Container PUID)
# Usage: ./fix-nfs-permissions.sh [container_name] [data_path]
#
# Example: ./fix-nfs-permissions.sh qbittorrent /mnt/user/data/adult/torrents_incoming

CONTAINER="${1:-qbittorrent}"
DATA_PATH="${2:-/mnt/user/data}"

echo "🔍 Checking $CONTAINER container permissions..."

# Check current PUID
CURRENT_PUID=$(ssh root@Tower.local "docker inspect $CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PUID" 2>/dev/null | cut -d'=' -f2)

if [ "$CURRENT_PUID" != "99" ]; then
    echo "❌ Container has PUID=$CURRENT_PUID (should be 99)"
    echo ""
    echo "To fix, recreate the container via Unraid UI:"
    echo "1. Stop and remove: docker stop $CONTAINER && docker rm $CONTAINER"
    echo "2. Edit template: Set PUID to 99"
    echo "3. Start container"
    echo ""
    echo "Or use the docker run command from INFRASTRUCTURE.md"
    exit 1
else
    echo "✅ Container PUID is correct (99)"
fi

echo ""
echo "🔧 Fixing file permissions on Tower..."

ssh root@Tower.local << ENDSSH
echo "Changing ownership to nobody:users..."
chown -R nobody:users "$DATA_PATH"

echo "Setting directory permissions to 755..."
find "$DATA_PATH" -type d -exec chmod 755 {} \;

echo "Setting file permissions to 644..."
find "$DATA_PATH" -type f -exec chmod 644 {} \;

echo "✅ Permissions fixed!"
ENDSSH

echo ""
echo "✅ All done! Try moving/deleting files now."
