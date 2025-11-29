#!/bin/bash
# Deploy Alexandria Worker to Cloudflare

set -e

echo "🚀 Deploying Alexandria Worker..."

cd "$(dirname "$0")/../worker"

# Check if wrangler is available
if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Please install Node.js"
    exit 1
fi

# Deploy
echo "📦 Deploying to Cloudflare..."
npx wrangler deploy

echo "✅ Deployment complete!"
echo "🌐 Visit: https://alexandria.ooheynerds.com"
