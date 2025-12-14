#!/bin/bash
# Script: logpush-management.sh
# Purpose: Common operations for managing Cloudflare Logpush jobs
# Usage: ./scripts/logpush-management.sh [command]

set -e

ACCOUNT_ID="d03bed0be6d976acd8a1707b55052f79"
BUCKET_NAME="alexandria-logs"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}ERROR: CLOUDFLARE_API_TOKEN environment variable not set${NC}"
  exit 1
fi

function list_jobs() {
  echo -e "${BLUE}Listing all Logpush jobs...${NC}"
  curl -s "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq -r '
      .result[] |
      "ID: \(.id)\nName: \(.name)\nDataset: \(.dataset)\nEnabled: \(.enabled)\nDestination: \(.destination_conf | split("?")[0])\n---"
    '
}

function get_job() {
  if [ -z "$1" ]; then
    echo -e "${RED}ERROR: Job ID required${NC}"
    echo "Usage: $0 get <job_id>"
    exit 1
  fi

  JOB_ID="$1"
  echo -e "${BLUE}Getting details for job $JOB_ID...${NC}"
  curl -s "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs/${JOB_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq '.result'
}

function enable_job() {
  if [ -z "$1" ]; then
    echo -e "${RED}ERROR: Job ID required${NC}"
    echo "Usage: $0 enable <job_id>"
    exit 1
  fi

  JOB_ID="$1"
  echo -e "${YELLOW}Enabling job $JOB_ID...${NC}"
  curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs/${JOB_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}' | jq '.result | {id, name, enabled}'

  echo -e "${GREEN}Job enabled${NC}"
}

function disable_job() {
  if [ -z "$1" ]; then
    echo -e "${RED}ERROR: Job ID required${NC}"
    echo "Usage: $0 disable <job_id>"
    exit 1
  fi

  JOB_ID="$1"
  echo -e "${YELLOW}Disabling job $JOB_ID...${NC}"
  curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs/${JOB_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}' | jq '.result | {id, name, enabled}'

  echo -e "${GREEN}Job disabled${NC}"
}

function delete_job() {
  if [ -z "$1" ]; then
    echo -e "${RED}ERROR: Job ID required${NC}"
    echo "Usage: $0 delete <job_id>"
    exit 1
  fi

  JOB_ID="$1"
  read -p "Are you sure you want to delete job $JOB_ID? (y/N): " CONFIRM

  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Cancelled"
    exit 0
  fi

  echo -e "${YELLOW}Deleting job $JOB_ID...${NC}"
  curl -s -X DELETE \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/logpush/jobs/${JOB_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq '.result'

  echo -e "${GREEN}Job deleted${NC}"
}

function list_logs() {
  echo -e "${BLUE}Recent log files in R2 bucket '$BUCKET_NAME':${NC}"
  cd "$(dirname "$0")/../worker"
  npx wrangler r2 object list "$BUCKET_NAME" --limit 20
}

function download_log() {
  if [ -z "$1" ]; then
    echo -e "${RED}ERROR: Log file path required${NC}"
    echo "Usage: $0 download <log-file-path>"
    exit 1
  fi

  LOG_PATH="$1"
  OUTPUT_FILE="/tmp/alexandria-log-$(date +%s).log.gz"

  echo -e "${YELLOW}Downloading log file...${NC}"
  cd "$(dirname "$0")/../worker"
  npx wrangler r2 object get "$BUCKET_NAME" "$LOG_PATH" --file="$OUTPUT_FILE"

  echo -e "${GREEN}Downloaded to: $OUTPUT_FILE${NC}"

  # If it's gzipped, offer to decompress
  if [[ "$OUTPUT_FILE" == *.gz ]]; then
    read -p "Decompress? (y/N): " DECOMPRESS
    if [ "$DECOMPRESS" == "y" ] || [ "$DECOMPRESS" == "Y" ]; then
      gunzip "$OUTPUT_FILE"
      DECOMPRESSED="${OUTPUT_FILE%.gz}"
      echo -e "${GREEN}Decompressed to: $DECOMPRESSED${NC}"
      echo -e "${BLUE}View logs:${NC}"
      echo "  cat $DECOMPRESSED | jq"
    fi
  fi
}

function test_logs() {
  echo -e "${BLUE}Generating test traffic to create logs...${NC}"
  for i in {1..5}; do
    echo "Request $i/5..."
    curl -s "https://alexandria.ooheynerds.com/health" > /dev/null
    sleep 0.5
  done

  echo -e "${GREEN}Test traffic generated${NC}"
  echo -e "${YELLOW}Wait 1-2 minutes for logs to appear in R2${NC}"
  echo "Then run: $0 list-logs"
}

function show_help() {
  echo -e "${BLUE}Logpush Management Script${NC}"
  echo ""
  echo "Usage: $0 [command] [args]"
  echo ""
  echo "Commands:"
  echo "  list              List all Logpush jobs"
  echo "  get <job_id>      Get details for specific job"
  echo "  enable <job_id>   Enable a job"
  echo "  disable <job_id>  Disable a job"
  echo "  delete <job_id>   Delete a job"
  echo "  list-logs         List recent log files in R2"
  echo "  download <path>   Download a specific log file"
  echo "  test              Generate test traffic to create logs"
  echo "  help              Show this help message"
  echo ""
  echo "Environment:"
  echo "  CLOUDFLARE_API_TOKEN must be set"
  echo ""
  echo "Examples:"
  echo "  $0 list"
  echo "  $0 get 12345"
  echo "  $0 list-logs"
  echo "  $0 download 2025-12-12/20251212T120000Z_20251212T120030Z_abc123.log.gz"
  echo "  $0 test"
}

# Main
COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  list)
    list_jobs
    ;;
  get)
    get_job "$@"
    ;;
  enable)
    enable_job "$@"
    ;;
  disable)
    disable_job "$@"
    ;;
  delete)
    delete_job "$@"
    ;;
  list-logs)
    list_logs
    ;;
  download)
    download_log "$@"
    ;;
  test)
    test_logs
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    echo -e "${RED}Unknown command: $COMMAND${NC}"
    echo ""
    show_help
    exit 1
    ;;
esac
