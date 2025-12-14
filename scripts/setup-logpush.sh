#!/bin/bash
set -e

# Script: setup-logpush.sh
# Purpose: Configure Cloudflare Logpush to send Workers logs to R2
# Usage: ./scripts/setup-logpush.sh
#
# Prerequisites:
# 1. R2 bucket 'alexandria-logs' exists (created via wrangler)
# 2. R2 API token created via Dashboard (see docs/LOGPUSH-SETUP.md)
# 3. Cloudflare API token with "Logs Edit" permission
# 4. Environment variable: CLOUDFLARE_API_TOKEN

ACCOUNT_ID="d03bed0be6d976acd8a1707b55052f79"
BUCKET_NAME="alexandria-logs"
JOB_NAME="alexandria-workers-logpush"
DATASET="workers_trace_events"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Alexandria Logpush Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check prerequisites
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}ERROR: CLOUDFLARE_API_TOKEN environment variable not set${NC}"
  echo "Please set your Cloudflare API token:"
  echo "  export CLOUDFLARE_API_TOKEN='your-token-here'"
  exit 1
fi

# Prompt for R2 credentials
echo -e "${YELLOW}Step 1: R2 API Token${NC}"
echo "You need R2 API credentials for Logpush to access the bucket."
echo "If you haven't created these yet, follow the guide:"
echo "  https://dash.cloudflare.com/$ACCOUNT_ID/r2/api-tokens"
echo ""
read -p "R2 Access Key ID: " R2_ACCESS_KEY_ID
read -sp "R2 Secret Access Key: " R2_SECRET_ACCESS_KEY
echo ""
echo ""

if [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
  echo -e "${RED}ERROR: R2 credentials are required${NC}"
  exit 1
fi

# Build destination config
DESTINATION_CONF="r2://${BUCKET_NAME}/{DATE}?account-id=${ACCOUNT_ID}&access-key-id=${R2_ACCESS_KEY_ID}&secret-access-key=${R2_SECRET_ACCESS_KEY}"

echo -e "${YELLOW}Step 2: Get Ownership Challenge${NC}"
echo "Verifying R2 bucket ownership..."

OWNERSHIP_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/ownership" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"destination_conf\": \"${DESTINATION_CONF}\"
  }")

# Check for API errors
if echo "$OWNERSHIP_RESPONSE" | jq -e '.success == false' > /dev/null 2>&1; then
  echo -e "${RED}ERROR: Ownership challenge failed${NC}"
  echo "$OWNERSHIP_RESPONSE" | jq '.errors'
  exit 1
fi

OWNERSHIP_CHALLENGE=$(echo "$OWNERSHIP_RESPONSE" | jq -r '.result.filename')

if [ -z "$OWNERSHIP_CHALLENGE" ] || [ "$OWNERSHIP_CHALLENGE" == "null" ]; then
  echo -e "${RED}ERROR: Failed to get ownership challenge${NC}"
  echo "$OWNERSHIP_RESPONSE" | jq
  exit 1
fi

echo -e "${GREEN}Ownership challenge received: $OWNERSHIP_CHALLENGE${NC}"
echo ""

# Check if job already exists
echo -e "${YELLOW}Step 3: Check Existing Jobs${NC}"
EXISTING_JOBS=$(curl -s \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

EXISTING_JOB_ID=$(echo "$EXISTING_JOBS" | jq -r ".result[] | select(.name == \"${JOB_NAME}\" and .dataset == \"${DATASET}\") | .id")

if [ -n "$EXISTING_JOB_ID" ] && [ "$EXISTING_JOB_ID" != "null" ]; then
  echo -e "${YELLOW}Found existing Logpush job (ID: $EXISTING_JOB_ID)${NC}"
  read -p "Delete and recreate? (y/N): " RECREATE

  if [ "$RECREATE" == "y" ] || [ "$RECREATE" == "Y" ]; then
    echo "Deleting existing job..."
    DELETE_RESPONSE=$(curl -s -X DELETE \
      "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs/${EXISTING_JOB_ID}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

    if echo "$DELETE_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
      echo -e "${GREEN}Existing job deleted${NC}"
    else
      echo -e "${RED}ERROR: Failed to delete existing job${NC}"
      echo "$DELETE_RESPONSE" | jq '.errors'
      exit 1
    fi
  else
    echo "Keeping existing job. Exiting."
    exit 0
  fi
fi
echo ""

# Create Logpush job
echo -e "${YELLOW}Step 4: Create Logpush Job${NC}"
echo "Creating job: $JOB_NAME"
echo "Dataset: $DATASET"
echo "Destination: R2 bucket '$BUCKET_NAME'"
echo ""

# Fields requested in issue #73: Outcome, ScriptName, Exceptions, Logs, EventTimestampMs, EventType
# Plus bonus fields: CPUTimeMs, WallTimeMs for performance analysis
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

# Check for success
if echo "$CREATE_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
  JOB_ID=$(echo "$CREATE_RESPONSE" | jq -r '.result.id')
  echo -e "${GREEN}Logpush job created successfully!${NC}"
  echo -e "${GREEN}Job ID: $JOB_ID${NC}"
  echo ""
  echo -e "${BLUE}Job Details:${NC}"
  echo "$CREATE_RESPONSE" | jq '.result'
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
echo "1. Add 'logpush: true' to worker/wrangler.jsonc"
echo "2. Deploy the worker: cd worker && npm run deploy"
echo "3. Generate some traffic to create logs"
echo "4. Wait 1-2 minutes for logs to appear in R2"
echo "5. Check logs: npx wrangler r2 object list $BUCKET_NAME"
echo ""
echo -e "${YELLOW}Verification:${NC}"
echo "# List Logpush jobs"
echo "curl 'https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs' \\"
echo "  -H 'Authorization: Bearer \$CLOUDFLARE_API_TOKEN' | jq"
echo ""
echo "# Check R2 bucket"
echo "npx wrangler r2 object list $BUCKET_NAME --limit 20"
echo ""
echo -e "${YELLOW}Documentation:${NC}"
echo "See docs/LOGPUSH-SETUP.md for full details"
echo ""
