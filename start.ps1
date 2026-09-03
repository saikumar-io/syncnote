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
# 3. Docker CLI & Daemon Check
# ------------------------------------------------------------------------------
try {
    $dockerVer = & docker --version 2>$null
    if (-not $dockerVer) { throw "Docker CLI missing" }
} catch {
    Write-Host "[ERROR] Docker CLI is not installed or not in PATH." -ForegroundColor Red
    Exit 1
}

$dockerInfo = & docker info 2>$null
if (-not $dockerInfo) {
    Write-Host "[INFO] Docker Desktop daemon is not running. Attempting to launch..." -ForegroundColor Yellow
    
    $dockerPaths = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
    )
    
    $started = $false
    foreach ($path in $dockerPaths) {
        if (Test-Path $path) {
            Start-Process -FilePath $path
            $started = $true
            break
        }
    }
    
    if (-not $started) {
        try {
            Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
            $started = $true
        } catch {}
    }
    
    if ($started) {
        $retries = 0
        while ($retries -lt 45) {
            Start-Sleep -Seconds 1
            $dockerInfo = & docker info 2>$null
            if ($dockerInfo) { break }
            $retries++
        }
    }
}

$dockerInfo = & docker info 2>$null
if (-not $dockerInfo) {
    Write-Host "[ERROR] Docker daemon is not running. Please start Docker Desktop manually." -ForegroundColor Red
    Exit 1
}
Write-Status "Docker" "OK (Daemon active)" [ConsoleColor]::Green

# ------------------------------------------------------------------------------
# 4. PostgreSQL Container Check & Startup
# ------------------------------------------------------------------------------
$containerName = "syncnote-postgres"

$existingStatus = & docker ps -a --filter "name=^/${containerName}$" --format "{{.Status}}" 2>$null
if (-not $existingStatus) {
    $existingStatus = & docker ps -a --filter "name=${containerName}" --format "{{.Status}}" 2>$null
}

if ($existingStatus -and $existingStatus.StartsWith("Up")) {
    Write-Status "PostgreSQL" "OK (Container '$containerName' running)" [ConsoleColor]::Green
} elseif ($existingStatus) {
    Write-Host "[INFO] Starting stopped container '$containerName'..." -ForegroundColor Yellow
    & docker start $containerName | Out-Null
    Write-Status "PostgreSQL" "OK (Started existing container)" [ConsoleColor]::Green
} else {
    Write-Host "[INFO] Container '$containerName' not found. Creating via Docker Compose..." -ForegroundColor Yellow
    & docker compose up -d postgres 2>$null
    if ($LASTEXITCODE -ne 0) {
        & docker-compose up -d postgres 2>$null
    }
    Write-Status "PostgreSQL" "OK (Created container)" [ConsoleColor]::Green
}

# Ensure TCP port 5432 connectivity
$pgReady = $false
$attempts = 0
while ($attempts -lt 30) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 5432)
        if ($tcp.Connected) {
            $tcp.Close()
            $pgReady = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
    $attempts++
}

if (-not $pgReady) {
    Write-Host "[ERROR] PostgreSQL is not accepting connections on port 5432." -ForegroundColor Red
    Exit 1
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
