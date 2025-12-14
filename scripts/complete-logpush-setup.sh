#!/bin/bash
set -e

# Script: complete-logpush-setup.sh
# Purpose: Complete Logpush setup with pre-configured R2 credentials
#
# USAGE:
#   1. Create API token at: https://dash.cloudflare.com/profile/api-tokens
#      - Template: "Edit Cloudflare Workers"
#      - OR custom with "Logs Edit" permission
#   2. Run:
#      export CLOUDFLARE_API_TOKEN='your-token-here'
#      ./scripts/complete-logpush-setup.sh

# Pre-configured values (from user's R2 API token "Alex_logpush")
ACCOUNT_ID="d03bed0be6d976acd8a1707b55052f79"
BUCKET_NAME="alexandria-logs"
JOB_NAME="alexandria-workers-logpush"
DATASET="workers_trace_events"

# R2 credentials (Alex_logpush token, expires Dec 12, 2026)
R2_ACCESS_KEY_ID="2b6f9caebde4b1935e6a28fbbca7d39e"
R2_SECRET_ACCESS_KEY="82c78d4f604620be6b792b6046829a507f850312c979a6944ee2a5a1745cfe28"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Alexandria Logpush Setup${NC}"
echo -e "${BLUE}R2 credentials pre-configured${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check for API token
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}ERROR: CLOUDFLARE_API_TOKEN not set${NC}"
  echo ""
  echo "Create an API token at:"
  echo "  https://dash.cloudflare.com/profile/api-tokens"
  echo ""
  echo "Token needs 'Logs Edit' permission. Quick option:"
  echo "  1. Click 'Create Token'"
  echo "  2. Use template: 'Edit Cloudflare Workers'"
  echo "  3. Copy the token"
  echo ""
  echo "Then run:"
  echo "  export CLOUDFLARE_API_TOKEN='your-token'"
  echo "  ./scripts/complete-logpush-setup.sh"
  exit 1
fi

# Build destination config
DESTINATION_CONF="r2://${BUCKET_NAME}/{DATE}?account-id=${ACCOUNT_ID}&access-key-id=${R2_ACCESS_KEY_ID}&secret-access-key=${R2_SECRET_ACCESS_KEY}"

echo -e "${YELLOW}Step 1: Verifying R2 bucket ownership...${NC}"

OWNERSHIP_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/ownership" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"destination_conf\": \"${DESTINATION_CONF}\"}")

# Check for errors
if echo "$OWNERSHIP_RESPONSE" | jq -e '.success == false' > /dev/null 2>&1; then
  echo -e "${RED}ERROR: Ownership verification failed${NC}"
  echo "$OWNERSHIP_RESPONSE" | jq '.errors'
  exit 1
fi

OWNERSHIP_CHALLENGE=$(echo "$OWNERSHIP_RESPONSE" | jq -r '.result.filename')

if [ -z "$OWNERSHIP_CHALLENGE" ] || [ "$OWNERSHIP_CHALLENGE" == "null" ]; then
  echo -e "${RED}ERROR: Failed to get ownership challenge${NC}"
  echo "$OWNERSHIP_RESPONSE" | jq
  exit 1
fi

echo -e "${GREEN}Ownership verified!${NC}"
echo ""

# Check for existing job
echo -e "${YELLOW}Step 2: Checking for existing Logpush jobs...${NC}"

EXISTING_JOBS=$(curl -s \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

EXISTING_JOB_ID=$(echo "$EXISTING_JOBS" | jq -r ".result[] | select(.name == \"${JOB_NAME}\") | .id")

if [ -n "$EXISTING_JOB_ID" ] && [ "$EXISTING_JOB_ID" != "null" ]; then
  echo -e "${GREEN}Logpush job already exists (ID: $EXISTING_JOB_ID)${NC}"
  echo ""
  echo "To view job details:"
  echo "  curl 'https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs/${EXISTING_JOB_ID}' \\"
  echo "    -H 'Authorization: Bearer \$CLOUDFLARE_API_TOKEN' | jq"
  exit 0
fi

# Create Logpush job
echo -e "${YELLOW}Step 3: Creating Logpush job...${NC}"

# Fields for Workers trace events
FIELDS="EventTimestampMs,EventType,Outcome,ScriptName,Exceptions,Logs,CPUTimeMs,WallTimeMs"

CREATE_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"${JOB_NAME}\",
    \"dataset\": \"${DATASET}\",
    \"destination_conf\": \"${DESTINATION_CONF}\",
    \"logpull_options\": \"fields=${FIELDS}&timestamps=rfc3339\",
    \"ownership_challenge\": \"${OWNERSHIP_CHALLENGE}\",
    \"enabled\": true,
    \"frequency\": \"high\",
    \"max_upload_bytes\": 5000000,
    \"max_upload_interval_seconds\": 30
  }")

if echo "$CREATE_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
  JOB_ID=$(echo "$CREATE_RESPONSE" | jq -r '.result.id')
  echo -e "${GREEN}Logpush job created successfully!${NC}"
  echo -e "${GREEN}Job ID: $JOB_ID${NC}"
  echo ""
  echo -e "${BLUE}Job Details:${NC}"
  echo "$CREATE_RESPONSE" | jq '.result | {id, name, dataset, enabled, frequency}'
else
  echo -e "${RED}ERROR: Failed to create Logpush job${NC}"
  echo "$CREATE_RESPONSE" | jq '.errors'
  exit 1
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Deploy the worker (logpush: true already in wrangler.jsonc)"
echo "   cd worker && npm run deploy"
echo ""
echo "2. Generate some traffic:"
echo "   curl https://alexandria.ooheynerds.com/health"
echo ""
echo "3. Wait 30-60 seconds, then check R2 for logs:"
echo "   npx wrangler r2 object list alexandria-logs --limit 10"
echo ""
