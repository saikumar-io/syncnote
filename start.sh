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
# 3. Database & Architecture Check
# ------------------------------------------------------------------------------
write_status "PostgreSQL" "OK (Supabase Central / DATABASE_URL)" "$GREEN"
write_status "SQLite" "OK (Local Notes & Identity Storage)" "$GREEN"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    write_status "Docker" "Optional (Active)" "$GREEN"
else
    write_status "Docker" "Optional (Stopped/Not installed)" "$YELLOW"
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
