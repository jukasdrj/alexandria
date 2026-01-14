#!/bin/bash
# Tower Docker Optimization Script
# Run on Tower: ssh tower "bash -s" < optimize-docker.sh

set -e

echo "=== Tower Docker Optimization ==="
echo "Date: $(date)"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cd /mnt/user/domains/docker-compose

# Step 1: Fix Prometheus
echo -e "${YELLOW}[1/5] Checking Prometheus...${NC}"
if docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -q "prometheus.*Created"; then
    echo -e "${RED}Prometheus is dead (Created state)${NC}"
    echo "Uncomment prometheus section in docker-compose.yml and run:"
    echo "  docker-compose up -d prometheus"
else
    echo -e "${GREEN}Prometheus OK${NC}"
fi
echo ""

# Step 2: Check restart policies
echo -e "${YELLOW}[2/5] Checking restart policies...${NC}"
echo "Containers without restart policy:"
docker inspect $(docker ps -aq) --format='{{.Name}}: {{.HostConfig.RestartPolicy.Name}}' | grep ': no$' || echo -e "${GREEN}All have restart policies${NC}"
echo ""

# Step 3: Check for version tags
echo -e "${YELLOW}[3/5] Checking image versions...${NC}"
echo "Containers without version tags:"
docker ps --format='{{.Names}}: {{.Image}}' | grep -v ':' || echo -e "${GREEN}All have version tags${NC}"
echo ""

# Step 4: Check management split
echo -e "${YELLOW}[4/5] Checking container management...${NC}"
echo ""
echo "Docker Compose managed:"
docker ps --format='{{.Names}}' --filter "label=com.docker.compose.project" | wc -l | xargs echo "  Count:"
echo ""
echo "Unraid managed:"
docker ps --format='{{.Names}}' --filter "label=net.unraid.docker.managed=dockerman" | wc -l | xargs echo "  Count:"
echo ""

# Step 5: Postgres check
echo -e "${YELLOW}[5/5] Checking Postgres...${NC}"
if docker exec postgres psql -U openlibrary -d openlibrary -c "SELECT version();" 2>/dev/null | grep -q "PostgreSQL 18"; then
    echo -e "${GREEN}Postgres 18 ✓${NC}"
else
    echo -e "${RED}Postgres version mismatch (should be 18)${NC}"
fi

echo ""
echo "Current Postgres config:"
docker exec postgres psql -U openlibrary -d openlibrary -c "
SELECT 
  'shared_buffers' as setting, current_setting('shared_buffers') as value
UNION ALL
SELECT 'effective_cache_size', current_setting('effective_cache_size')
UNION ALL
SELECT 'maintenance_work_mem', current_setting('maintenance_work_mem')
UNION ALL  
SELECT 'work_mem', current_setting('work_mem')
UNION ALL
SELECT 'max_connections', current_setting('max_connections');" 2>/dev/null || echo "Could not connect to postgres"

echo ""
echo "=== Summary ==="
echo "See TOWER_DOCKER_AUDIT.md for full analysis and action plan"
