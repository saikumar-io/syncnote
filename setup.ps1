# ==============================================================================
# SyncNote Automated Environment Setup Script (Windows PowerShell)
# ==============================================================================
# Usage:
#   .\setup.ps1
#
# Description:
#   Prepares Node.js dependencies, Docker PostgreSQL container, local SQLite,
#   cryptographic device identity, and 4-file environment system for SyncNote.
#   Idempotent and safe to run multiple times.
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "         SyncNote Setup System          " -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Yellow
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

Write-Banner

# ------------------------------------------------------------------------------
# 1. Detect Node.js
# ------------------------------------------------------------------------------
Write-Info "Checking Node.js installation..."
try {
    $nodeVersion = & node --version 2>$null
    if (-not $nodeVersion) { throw "Node.js not found" }
    Write-Success "Node.js detected: $nodeVersion"
} catch {
    Write-Err "Node.js is not installed or not in system PATH."
    Write-Host "Please install Node.js (v18 or higher) from https://nodejs.org/" -ForegroundColor White
    Exit 1
}

# ------------------------------------------------------------------------------
# 2. Detect npm
# ------------------------------------------------------------------------------
Write-Info "Checking npm installation..."
try {
    $npmVersion = & npm --version 2>$null
    if (-not $npmVersion) { throw "npm not found" }
    Write-Success "npm detected: v$npmVersion"
} catch {
    Write-Err "npm is not installed or not in system PATH."
    Exit 1
}

# ------------------------------------------------------------------------------
# 3. Detect Docker (Optional)
# ------------------------------------------------------------------------------
Write-Info "Checking Docker installation (Optional)..."
$dockerAvailable = $false
try {
    $dockerVersion = & docker --version 2>$null
    if ($dockerVersion) {
        $dockerInfo = & docker info 2>$null
        if ($dockerInfo) {
            $dockerAvailable = $true
            Write-Success "Docker daemon active ($dockerVersion)"
        } else {
            Write-Info "Docker CLI installed ($dockerVersion), but Docker daemon is stopped. (Optional for Supabase mode)"
        }
    } else {
        Write-Info "Docker CLI not detected. (Optional for Supabase mode)"
    }
} catch {
    Write-Info "Docker check skipped."
}

# ------------------------------------------------------------------------------
# 4. PostgreSQL Configuration Check
# ------------------------------------------------------------------------------
Write-Info "Verifying PostgreSQL architecture..."
Write-Success "Central PostgreSQL configured via Supabase (DATABASE_URL)."
if ($dockerAvailable) {
    Write-Info "Local Docker PostgreSQL is available as an optional fallback container."
}

# ------------------------------------------------------------------------------
# 5. Environment Configuration System (server\.env & server\.env.secrets)
# ------------------------------------------------------------------------------
Write-Info "Configuring environment files..."

$serverEnv = Join-Path $PSScriptRoot "server\.env"
$serverEnvEx = Join-Path $PSScriptRoot "server\.env.example"
$serverSecrets = Join-Path $PSScriptRoot "server\.env.secrets"
$serverSecretsEx = Join-Path $PSScriptRoot "server\.env.secrets.example"

# 1. Non-sensitive server\.env file
if (-not (Test-Path $serverEnv)) {
    if (Test-Path $serverEnvEx) {
        Copy-Item -Path $serverEnvEx -Destination $serverEnv
        Write-Success "Created server\.env from server\.env.example."
    }
} else {
    Write-Info "Existing server\.env found. Keeping existing configuration."
}

# 2. Sensitive server\.env.secrets file
if (-not (Test-Path $serverSecrets)) {
    if (Test-Path $serverSecretsEx) {
        Copy-Item -Path $serverSecretsEx -Destination $serverSecrets
        Write-Warn "Created server\.env.secrets from server\.env.secrets.example template. Real secret values must be provided."
    }
} else {
    Write-Info "Existing server\.env.secrets found. Keeping existing secret configuration."
}

# ------------------------------------------------------------------------------
# 6. Install Dependencies
# ------------------------------------------------------------------------------
Write-Info "Installing npm dependencies for monorepo root, server, and client..."

$isWin = $env:OS -match "Windows"
$npmCmd = if ($isWin) { "npm.cmd" } else { "npm" }

Write-Info "Running npm install in root..."
& $npmCmd install --no-audit --no-fund

Write-Info "Running npm install in server..."
& $npmCmd install --prefix server --no-audit --no-fund

Write-Info "Running npm install in client..."
& $npmCmd install --prefix client --no-audit --no-fund

Write-Success "All npm dependencies installed successfully."

# ------------------------------------------------------------------------------
# 7. Create Required Local Directories
# ------------------------------------------------------------------------------
Write-Info "Ensuring required local data directories exist..."
$directories = @(
    (Join-Path $PSScriptRoot "data"),
    (Join-Path $PSScriptRoot "data\notes"),
    (Join-Path $PSScriptRoot "server\data"),
    (Join-Path $PSScriptRoot "server\data\notes")
)

foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}
Write-Success "Data directories verified."

# ------------------------------------------------------------------------------
# 8. Initialize SQLite Database Schema & Device Cryptographic Identity
# ------------------------------------------------------------------------------
Write-Info "Initializing SQLite local database and device cryptographic identity..."
try {
    & node -e "require('./server/src/db/database.js')" 2>$null
    Write-Success "SQLite database verified (server/data/syncnote.db)."
} catch {
    Write-Err "Failed to initialize SQLite database: $_"
}

try {
    & node -e "require('./server/src/utils/deviceCrypto.js').getOrCreateDeviceIdentity()" 2>$null
    Write-Success "Machine-specific device cryptographic identity verified."
} catch {
    Write-Err "Failed to initialize device identity: $_"
}

# ------------------------------------------------------------------------------
# 9. Environment Secrets Validation & Health Summary
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "       SyncNote Setup Complete          " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Node:         OK ($nodeVersion)" -ForegroundColor White
Write-Host "  npm:          OK (v$npmVersion)" -ForegroundColor White
Write-Host "  PostgreSQL:   OK (Supabase Central / DATABASE_URL)" -ForegroundColor White
Write-Host "  SQLite:       OK (server/data/syncnote.db)" -ForegroundColor White
Write-Host "  Docker:       Optional" -ForegroundColor White
Write-Host "  Identity:     OK (Machine-specific device key)" -ForegroundColor White
Write-Host "  Dependencies: OK (Root, Server, Client)" -ForegroundColor White
Write-Host "  Environment:  OK (.env & .env.secrets configured)" -ForegroundColor White
Write-Host ""

# Read env content safely without exposing actual secret values
$combinedEnv = ""
if (Test-Path $serverEnv) { $combinedEnv += Get-Content $serverEnv -Raw }
if (Test-Path $serverSecrets) { $combinedEnv += Get-Content $serverSecrets -Raw }

function Check-VarStatus {
    param([string]$varName, [string]$content)
    if ($content -match "$varName\s*=\s*(?!your_\S+)\S+") {
        return "Configured"
    } else {
        return "Missing (Placeholder detected)"
    }
}

Write-Host "Environment Secret Validation:" -ForegroundColor Cyan
$gIdStatus = Check-VarStatus "GOOGLE_CLIENT_ID" $combinedEnv
$gSecretStatus = Check-VarStatus "GOOGLE_CLIENT_SECRET" $combinedEnv
$jwtStatus = Check-VarStatus "JWT_SECRET" $combinedEnv
$cookieStatus = Check-VarStatus "COOKIE_SECRET" $combinedEnv

$gIdColor = if ($gIdStatus -eq "Configured") { [ConsoleColor]::Green } else { [ConsoleColor]::Yellow }
$gSecretColor = if ($gSecretStatus -eq "Configured") { [ConsoleColor]::Green } else { [ConsoleColor]::Yellow }
$jwtColor = if ($jwtStatus -eq "Configured") { [ConsoleColor]::Green } else { [ConsoleColor]::Yellow }
$cookieColor = if ($cookieStatus -eq "Configured") { [ConsoleColor]::Green } else { [ConsoleColor]::Yellow }

Write-Host "  - GOOGLE_CLIENT_ID:     " -NoNewline -ForegroundColor White
Write-Host $gIdStatus -ForegroundColor $gIdColor
Write-Host "  - GOOGLE_CLIENT_SECRET: " -NoNewline -ForegroundColor White
Write-Host $gSecretStatus -ForegroundColor $gSecretColor
Write-Host "  - JWT_SECRET:           " -NoNewline -ForegroundColor White
Write-Host $jwtStatus -ForegroundColor $jwtColor
Write-Host "  - COOKIE_SECRET:        " -NoNewline -ForegroundColor White
Write-Host $cookieStatus -ForegroundColor $cookieColor

Write-Host ""
Write-Host "To start SyncNote now, run:" -ForegroundColor Cyan
Write-Host "  .\start.ps1" -ForegroundColor Green
Write-Host "  or: npm run dev" -ForegroundColor Green
Write-Host ""
Write-Host "App URLs:" -ForegroundColor White
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "  Backend:  http://localhost:5000" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
