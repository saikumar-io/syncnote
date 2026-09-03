#!/usr/bin/env bash
# ==============================================================================
# SyncNote Application Startup Script (macOS / Linux)
# ==============================================================================
# Usage:
#   chmod +x start.sh
#   ./start.sh
#
# Description:
#   Verifies environment readiness (.env & .env.secrets), starts PostgreSQL container,
#   and launches the complete SyncNote frontend + backend development environment.
# ==============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

write_banner() {
    echo -e ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}            Starting SyncNote           ${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo -e ""
}

write_status() {
    LABEL="$1"
    STATUS="$2"
    COLOR="$3"
    printf "%-15s: %b%s%b\n" "$LABEL" "$COLOR" "$STATUS" "$NC"
}

write_banner

# ------------------------------------------------------------------------------
# 1. Environment Files Check (server/.env & server/.env.secrets)
# ------------------------------------------------------------------------------
SERVER_ENV="$SCRIPT_DIR/server/.env"
SERVER_ENV_EX="$SCRIPT_DIR/server/.env.example"
SERVER_SECRETS="$SCRIPT_DIR/server/.env.secrets"
SERVER_SECRETS_EX="$SCRIPT_DIR/server/.env.secrets.example"

if [ ! -f "$SERVER_ENV" ]; then
    if [ -f "$SERVER_ENV_EX" ]; then
        cp "$SERVER_ENV_EX" "$SERVER_ENV"
        write_status "Environment" "Created server/.env from example" "$YELLOW"
    else
        echo -e "${RED}[ERROR] server/.env file is missing and server/.env.example was not found.${NC}"
        exit 1
    fi
else
    write_status "Environment" "OK (server/.env present)" "$GREEN"
fi

if [ ! -f "$SERVER_SECRETS" ]; then
    if [ -f "$SERVER_SECRETS_EX" ]; then
        cp "$SERVER_SECRETS_EX" "$SERVER_SECRETS"
        write_status "Secrets" "Created server/.env.secrets template" "$YELLOW"
    else
        write_status "Secrets" "Missing server/.env.secrets" "$YELLOW"
    fi
else
    write_status "Secrets" "OK (server/.env.secrets present)" "$GREEN"
fi

# ------------------------------------------------------------------------------
# 2. Node & npm Check
# ------------------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    write_status "Node.js" "OK ($NODE_VER)" "$GREEN"
else
    echo -e "${RED}[ERROR] Node.js is missing or not in system PATH.${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. Docker CLI & Daemon Check
# ------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Docker CLI is not installed or not in PATH.${NC}"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo -e "${YELLOW}[INFO] Docker Desktop daemon is not running. Attempting to launch...${NC}"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open -a Docker >/dev/null 2>&1 || true
    fi
    
    RETRIES=0
    while [ $RETRIES -lt 45 ]; do
        sleep 1
        if docker info >/dev/null 2>&1; then
            break
        fi
        RETRIES=$((RETRIES + 1))
    done
fi

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Docker daemon is not running. Please start Docker Desktop manually.${NC}"
    exit 1
fi
write_status "Docker" "OK (Daemon active)" "$GREEN"

# ------------------------------------------------------------------------------
# 4. PostgreSQL Container Check & Startup
# ------------------------------------------------------------------------------
CONTAINER_NAME="syncnote-postgres"

EXISTING_STATUS=$(docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format "{{.Status}}" 2>/dev/null || true)
if [ -z "$EXISTING_STATUS" ]; then
    EXISTING_STATUS=$(docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Status}}" 2>/dev/null || true)
fi

if [[ "$EXISTING_STATUS" == Up* ]]; then
    write_status "PostgreSQL" "OK (Container '$CONTAINER_NAME' running)" "$GREEN"
elif [ -n "$EXISTING_STATUS" ]; then
    echo -e "${YELLOW}[INFO] Starting stopped container '$CONTAINER_NAME'...${NC}"
    docker start "$CONTAINER_NAME" >/dev/null
    write_status "PostgreSQL" "OK (Started existing container)" "$GREEN"
else
    echo -e "${YELLOW}[INFO] Container '$CONTAINER_NAME' not found. Creating via Docker Compose...${NC}"
    docker compose up -d postgres 2>/dev/null || docker-compose up -d postgres 2>/dev/null
    write_status "PostgreSQL" "OK (Created container)" "$GREEN"
fi

# Ensure TCP port 5432 connectivity
PG_READY=0
ATTEMPTS=0
while [ $ATTEMPTS -lt 30 ]; do
    if node -e "const net = require('net'); const socket = net.connect(5432, '127.0.0.1', () => { socket.destroy(); process.exit(0); }); socket.on('error', () => process.exit(1));" >/dev/null 2>&1; then
        PG_READY=1
        break
    fi
    sleep 1
    ATTEMPTS=$((ATTEMPTS + 1))
done

if [ $PG_READY -eq 0 ]; then
    echo -e "${RED}[ERROR] PostgreSQL is not accepting connections on port 5432.${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 5. Launch Development Environment
# ------------------------------------------------------------------------------
echo -e ""
echo -e "${CYAN}Starting SyncNote...${NC}"
echo -e "${WHITE}App URLs:${NC}"
echo -e "${WHITE}  Frontend: http://localhost:5173${NC}"
echo -e "${WHITE}  Backend:  http://localhost:5000${NC}"
echo -e "${CYAN}========================================${NC}"
echo -e ""

exec npm run dev
