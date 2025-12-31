#!/bin/bash

# Alexandria Bulk Author Harvest Runner with Cloudflare Access Authentication
#
# This script helps you run the bulk author harvest with proper authentication.
# You need to provide Cloudflare Access Service Token credentials.

echo "🔐 Alexandria Bulk Author Harvest - Authentication Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if credentials are already in environment
if [ -n "$CF_ACCESS_CLIENT_ID" ] && [ -n "$CF_ACCESS_CLIENT_SECRET" ]; then
    echo "✅ Found existing credentials in environment"
    echo "   Client ID: ${CF_ACCESS_CLIENT_ID:0:20}..."
else
    echo "Please enter your Cloudflare Access Service Token credentials:"
    echo "(You can find these at: https://one.dash.cloudflare.com/d03bed0be6d976acd8a1707b55052f79/access/service-auth)"
    echo ""

    read -p "Client ID: " CF_ACCESS_CLIENT_ID
    read -sp "Client Secret: " CF_ACCESS_CLIENT_SECRET
    echo ""
    echo ""

    export CF_ACCESS_CLIENT_ID
    export CF_ACCESS_CLIENT_SECRET
fi

# Verify credentials work by testing the API
echo "🔍 Testing API authentication..."
HEALTH_RESPONSE=$(curl -s -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
                        -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
                        "https://alexandria.ooheynerds.com/health")

if echo "$HEALTH_RESPONSE" | grep -q "status"; then
    echo "✅ Authentication successful!"
else
    echo "❌ Authentication failed!"
    echo "Response: $HEALTH_RESPONSE"
    echo ""
    echo "Please check your credentials and try again."
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Starting Bulk Author Harvest"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Parse command line arguments or use default
TIER="${1:-top-1000}"
EXTRA_ARGS="${@:2}"

# Run the harvest script with credentials in environment
node scripts/bulk-author-harvest.js --tier "$TIER" $EXTRA_ARGS
