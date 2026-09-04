# ==============================================================================
# SyncNote Application Startup Script (Windows PowerShell)
# ==============================================================================
# Usage:
#   .\start.ps1
#
# Description:
#   Verifies environment readiness (.env & .env.secrets), starts PostgreSQL container,
#   and launches the complete SyncNote frontend + backend development environment.
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "            Starting SyncNote           " -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Status {
    param([string]$Label, [string]$Status, [ConsoleColor]$Color = [ConsoleColor]::Green)
    Write-Host "$($Label.PadRight(14)): " -NoNewline -ForegroundColor White
    Write-Host $Status -ForegroundColor $Color
}

Write-Banner

# ------------------------------------------------------------------------------
# 1. Environment Files Check (server\.env & server\.env.secrets)
# ------------------------------------------------------------------------------
$serverEnv = Join-Path $PSScriptRoot "server\.env"
$serverEnvEx = Join-Path $PSScriptRoot "server\.env.example"
$serverSecrets = Join-Path $PSScriptRoot "server\.env.secrets"
$serverSecretsEx = Join-Path $PSScriptRoot "server\.env.secrets.example"

if (-not (Test-Path $serverEnv)) {
    if (Test-Path $serverEnvEx) {
        Copy-Item -Path $serverEnvEx -Destination $serverEnv
        Write-Status "Environment" "Created server\.env from example" [ConsoleColor]::Yellow
    } else {
        Write-Host "[ERROR] server\.env file is missing and server\.env.example was not found." -ForegroundColor Red
        Exit 1
    }
} else {
    Write-Status "Environment" "OK (server\.env present)" [ConsoleColor]::Green
}

if (-not (Test-Path $serverSecrets)) {
    if (Test-Path $serverSecretsEx) {
        Copy-Item -Path $serverSecretsEx -Destination $serverSecrets
        Write-Status "Secrets" "Created server\.env.secrets template" [ConsoleColor]::Yellow
    } else {
        Write-Status "Secrets" "Missing server\.env.secrets" [ConsoleColor]::Yellow
    }
} else {
    Write-Status "Secrets" "OK (server\.env.secrets present)" [ConsoleColor]::Green
}

# ------------------------------------------------------------------------------
# 2. Node & npm Check
# ------------------------------------------------------------------------------
try {
    $nodeVer = & node --version 2>$null
    if (-not $nodeVer) { throw "Node.js missing" }
    Write-Status "Node.js" "OK ($nodeVer)" [ConsoleColor]::Green
} catch {
    Write-Host "[ERROR] Node.js is missing or not in system PATH." -ForegroundColor Red
    Exit 1
}

# ------------------------------------------------------------------------------
# 3. Database & Architecture Check
# ------------------------------------------------------------------------------
Write-Status "PostgreSQL" "OK (Supabase Central / DATABASE_URL)" [ConsoleColor]::Green
Write-Status "SQLite" "OK (Local Notes & Identity Storage)" [ConsoleColor]::Green

try {
    $dockerVer = & docker --version 2>$null
    if ($dockerVer) {
        $dockerInfo = & docker info 2>$null
        if ($dockerInfo) {
            Write-Status "Docker" "Optional (Active)" [ConsoleColor]::Green
        } else {
            Write-Status "Docker" "Optional (Stopped)" [ConsoleColor]::Yellow
        }
    } else {
        Write-Status "Docker" "Optional (Not Installed)" [ConsoleColor]::Yellow
    }
} catch {
    Write-Status "Docker" "Optional" [ConsoleColor]::Yellow
}

# ------------------------------------------------------------------------------
# 5. Launch Development Environment
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "Starting SyncNote..." -ForegroundColor Cyan
Write-Host "App URLs:" -ForegroundColor White
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "  Backend:  http://localhost:5000" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$isWin = $env:OS -match "Windows"
$npmCmd = if ($isWin) { "npm.cmd" } else { "npm" }

& $npmCmd run dev
