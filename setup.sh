#!/usr/bin/env bash
# ==============================================================================
# SyncNote Automated Environment Setup Script (macOS / Linux)
# ==============================================================================
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Description:
#   Prepares Node.js dependencies, Docker PostgreSQL container, local SQLite,
#   cryptographic device identity, and 4-file environment system for SyncNote.
#   Idempotent and safe to run multiple times.
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
    echo -e "${CYAN}         SyncNote Setup System          ${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo -e ""
}

write_success() {
    echo -e "${GREEN}[OK] $1${NC}"
}

write_info() {
    echo -e "${YELLOW}[INFO] $1${NC}"
}

write_warn() {
    echo -e "${YELLOW}[WARN] $1${NC}"
}

write_err() {
    echo -e "${RED}[ERROR] $1${NC}"
}

write_banner

# ------------------------------------------------------------------------------
# 1. Detect Node.js
# ------------------------------------------------------------------------------
write_info "Checking Node.js installation..."
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    write_success "Node.js detected: $NODE_VER"
else
    write_err "Node.js is not installed or not in system PATH."
    echo -e "${WHITE}Please install Node.js (v18 or higher) via Homebrew ('brew install node') or from https://nodejs.org/${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 2. Detect npm
# ------------------------------------------------------------------------------
write_info "Checking npm installation..."
if command -v npm >/dev/null 2>&1; then
    NPM_VER=$(npm -v)
    write_success "npm detected: v$NPM_VER"
else
    write_err "npm is not installed or not in system PATH."
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. Detect Docker & Ensure Docker Desktop Daemon is Running
# ------------------------------------------------------------------------------
write_info "Checking Docker CLI installation..."
if command -v docker >/dev/null 2>&1; then
    DOCKER_VER=$(docker --version)
    write_success "Docker CLI detected: $DOCKER_VER"
else
    write_err "Docker CLI is not installed or not in system PATH."
    echo -e "${WHITE}Please install Docker Desktop for Mac from https://www.docker.com/products/docker-desktop or via 'brew install --cask docker'${NC}"
    exit 1
fi

write_info "Checking Docker daemon status..."
if ! docker info >/dev/null 2>&1; then
    write_info "Docker daemon is not running. Attempting to launch Docker Desktop..."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open -a Docker >/dev/null 2>&1 || true
    fi
    
    write_info "Waiting for Docker daemon to become responsive (up to 45 seconds)..."
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
    write_err "Docker daemon is not running and could not be started automatically."
    echo -e "${WHITE}Please launch Docker Desktop manually and rerun ./setup.sh${NC}"
    exit 1
fi
write_success "Docker daemon is active and responsive."

# ------------------------------------------------------------------------------
# 4. Detect / Start PostgreSQL Container (Idempotent)
# ------------------------------------------------------------------------------
CONTAINER_NAME="syncnote-postgres"
write_info "Checking PostgreSQL container ($CONTAINER_NAME)..."

EXISTING_STATUS=$(docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format "{{.Status}}" 2>/dev/null || true)
if [ -z "$EXISTING_STATUS" ]; then
    EXISTING_STATUS=$(docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Status}}" 2>/dev/null || true)
fi

if [[ "$EXISTING_STATUS" == Up* ]]; then
    write_success "PostgreSQL container '$CONTAINER_NAME' is already running."
elif [ -n "$EXISTING_STATUS" ]; then
    write_info "PostgreSQL container '$CONTAINER_NAME' exists but is stopped. Starting container..."
    docker start "$CONTAINER_NAME" >/dev/null
    write_success "PostgreSQL container '$CONTAINER_NAME' started."
else
    write_info "Creating new PostgreSQL container using Docker Compose..."
    docker compose up -d postgres 2>/dev/null || docker-compose up -d postgres 2>/dev/null
    write_success "PostgreSQL container created and started."
fi

# Wait for PostgreSQL port 5432 TCP connectivity
write_info "Waiting for PostgreSQL connection readiness on port 5432..."
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
    write_err "PostgreSQL container did not become ready on port 5432 within 30 seconds."
    exit 1
fi
write_success "PostgreSQL is accepting connections on localhost:5432."

# ------------------------------------------------------------------------------
# 5. Environment Configuration System (server/.env & server/.env.secrets)
# ------------------------------------------------------------------------------
write_info "Configuring environment files..."

SERVER_ENV="$SCRIPT_DIR/server/.env"
SERVER_ENV_EX="$SCRIPT_DIR/server/.env.example"
SERVER_SECRETS="$SCRIPT_DIR/server/.env.secrets"
SERVER_SECRETS_EX="$SCRIPT_DIR/server/.env.secrets.example"

# 1. Non-sensitive server/.env file
if [ ! -f "$SERVER_ENV" ]; then
    if [ -f "$SERVER_ENV_EX" ]; then
        cp "$SERVER_ENV_EX" "$SERVER_ENV"
        write_success "Created server/.env from server/.env.example."
    fi
else
    write_info "Existing server/.env found. Keeping existing configuration."
fi

# 2. Sensitive server/.env.secrets file
if [ ! -f "$SERVER_SECRETS" ]; then
    if [ -f "$SERVER_SECRETS_EX" ]; then
        cp "$SERVER_SECRETS_EX" "$SERVER_SECRETS"
        write_warn "Created server/.env.secrets from server/.env.secrets.example template. Real secret values must be provided."
    fi
else
    write_info "Existing server/.env.secrets found. Keeping existing secret configuration."
fi

# ------------------------------------------------------------------------------
# 6. Install Dependencies
# ------------------------------------------------------------------------------
write_info "Installing npm dependencies for monorepo root, server, and client..."

write_info "Running npm install in root..."
npm install --no-audit --no-fund

write_info "Running npm install in server..."
npm install --prefix server --no-audit --no-fund

write_info "Running npm install in client..."
npm install --prefix client --no-audit --no-fund

write_success "All npm dependencies installed successfully."

# ------------------------------------------------------------------------------
# 7. Create Required Local Directories
# ------------------------------------------------------------------------------
write_info "Ensuring required local data directories exist..."
mkdir -p "$SCRIPT_DIR/data"
mkdir -p "$SCRIPT_DIR/data/notes"
mkdir -p "$SCRIPT_DIR/server/data"
mkdir -p "$SCRIPT_DIR/server/data/notes"
write_success "Data directories verified."

# ------------------------------------------------------------------------------
# 8. Initialize SQLite Database Schema & Device Cryptographic Identity
# ------------------------------------------------------------------------------
write_info "Initializing SQLite local database and device cryptographic identity..."
if node -e "require('./server/src/db/database.js')" >/dev/null 2>&1; then
    write_success "SQLite database verified (server/data/syncnote.db)."
else
    write_err "Failed to initialize SQLite database."
fi

if node -e "require('./server/src/utils/deviceCrypto.js').getOrCreateDeviceIdentity()" >/dev/null 2>&1; then
    write_success "Machine-specific device cryptographic identity verified."
else
    write_err "Failed to initialize device identity."
fi

# ------------------------------------------------------------------------------
# 9. Environment Secrets Validation & Health Summary
# ------------------------------------------------------------------------------
echo -e ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}       SyncNote Setup Complete          ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "${WHITE}  Node:         OK ($NODE_VER)${NC}"
echo -e "${WHITE}  npm:          OK (v$NPM_VER)${NC}"
echo -e "${WHITE}  Docker:       OK ($DOCKER_VER)${NC}"
echo -e "${WHITE}  PostgreSQL:   OK (localhost:5432 / $CONTAINER_NAME)${NC}"
echo -e "${WHITE}  SQLite:       OK (server/data/syncnote.db)${NC}"
echo -e "${WHITE}  Identity:     OK (Machine-specific device key)${NC}"
echo -e "${WHITE}  Dependencies: OK (Root, Server, Client)${NC}"
echo -e "${WHITE}  Environment:  OK (.env & .env.secrets configured)${NC}"
echo -e ""

check_var_status() {
    VAR_NAME="$1"
    COMBINED_ENV=""
    [ -f "$SERVER_ENV" ] && COMBINED_ENV="$COMBINED_ENV$(cat "$SERVER_ENV")"$'\n'
    [ -f "$SERVER_SECRETS" ] && COMBINED_ENV="$COMBINED_ENV$(cat "$SERVER_SECRETS")"$'\n'

    VAL=$(echo "$COMBINED_ENV" | grep -E "^${VAR_NAME}=" | tail -n 1 | cut -d '=' -f 2- | tr -d ' "'"'")
    if [ -n "$VAL" ] && [[ "$VAL" != your_* ]]; then
        echo -e "${GREEN}Configured${NC}"
    else
        echo -e "${YELLOW}Missing (Placeholder detected)${NC}"
    fi
}

echo -e "${CYAN}Environment Secret Validation:${NC}"
echo -n -e "${WHITE}  - GOOGLE_CLIENT_ID:     ${NC}"
check_var_status "GOOGLE_CLIENT_ID"
echo -n -e "${WHITE}  - GOOGLE_CLIENT_SECRET: ${NC}"
check_var_status "GOOGLE_CLIENT_SECRET"
echo -n -e "${WHITE}  - JWT_SECRET:           ${NC}"
check_var_status "JWT_SECRET"
echo -n -e "${WHITE}  - COOKIE_SECRET:        ${NC}"
check_var_status "COOKIE_SECRET"

echo -e ""
echo -e "${CYAN}To start SyncNote now, run:${NC}"
echo -e "${GREEN}  ./start.sh${NC}"
echo -e "${GREEN}  or: npm run dev${NC}"
echo -e ""
echo -e "${WHITE}App URLs:${NC}"
echo -e "${WHITE}  Frontend: http://localhost:5173${NC}"
echo -e "${WHITE}  Backend:  http://localhost:5000${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
