const { execSync, spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

// Zero-dependency .env & .env.secrets loader
function loadEnvFile(envPath, override = false) {
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (override || !process.env[key] || process.env[key].startsWith('your_')) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (e) { }
}

// 1. Load non-sensitive .env
loadEnvFile(path.join(__dirname, '../server/.env'));
loadEnvFile(path.join(__dirname, '../.env'));

// 2. Load sensitive .env.secrets (overrides placeholders with real secret values if present)
loadEnvFile(path.join(__dirname, '../server/.env.secrets'), true);
loadEnvFile(path.join(__dirname, '../.env.secrets'), true);

const CONTAINER_NAME = 'syncnote-postgres';
const PG_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);

function printBanner() {
  console.log('\n╭──────────────────────────────╮');
  console.log('│        SyncNote Dev          │');
  console.log('╰──────────────────────────────╯\n');
}

function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function ensureDependencies() {
  const serverCookieParser = path.join(__dirname, '../server/node_modules/cookie-parser');
  const serverPg = path.join(__dirname, '../server/node_modules/pg');
  if (!fs.existsSync(serverCookieParser) || !fs.existsSync(serverPg)) {
    console.log('[!] Installing server dependencies (cookie-parser, pg, etc.)...');
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    execSync(`${npmCmd} install --prefix server`, { stdio: 'inherit' });
    console.log('✓ Server dependencies installed successfully.');
  }
}

async function checkDockerInstalled() {
  console.log('[1/5] Checking Docker...');
  const version = runCmd('docker --version');
  if (!version) {
    console.error('\n✗ Docker Desktop is not installed.');
    console.error('  SyncNote requires Docker for PostgreSQL authentication.');
    console.error('  Please install Docker Desktop and run `npm run dev` again.\n');
    process.exit(1);
  }
  console.log(`✓ Docker detected: ${version}`);
}

async function checkDockerRunning() {
  const info = runCmd('docker info');
  if (!info) {
    console.error('\n✗ Docker is installed but Docker Desktop is not running.');
    console.error('  Please start Docker Desktop and try again.\n');
    process.exit(1);
  }
}

async function ensurePostgresContainer() {
  console.log('\n[2/5] Checking PostgreSQL container...');

  // Check if container exists
  const status = runCmd(`docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Status}}"`);

  if (status && status.startsWith('Up')) {
    console.log(`✓ ${CONTAINER_NAME} already running`);
    return;
  }

  if (status) {
    console.log(`→ Starting existing ${CONTAINER_NAME} container...`);
    const startResult = runCmd(`docker start ${CONTAINER_NAME}`) || runCmd('docker compose up -d postgres');
    if (!startResult) {
      console.error(`✗ Failed to start existing ${CONTAINER_NAME} container.`);
      process.exit(1);
    }
    console.log(`✓ Container ${CONTAINER_NAME} started`);
    return;
  }

  console.log(`[2/5] PostgreSQL container not found`);
  console.log(`→ Creating ${CONTAINER_NAME} using Docker Compose...`);

  const composeResult = runCmd('docker compose up -d postgres') || runCmd('docker-compose up -d postgres');
  if (!composeResult) {
    console.error(`✗ Failed to create ${CONTAINER_NAME} container.`);
    process.exit(1);
  }
  console.log(`✓ PostgreSQL container created`);
}

function checkTcpPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isConnected = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      isConnected = true;
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function waitForPostgresHealth() {
  console.log('\n[3/5] Checking PostgreSQL health...');

  const maxAttempts = 30;
  let attempts = 0;
  let healthy = false;

  while (attempts < maxAttempts) {
    attempts++;

    // Check TCP port connectivity
    const isPortOpen = await checkTcpPort('127.0.0.1', PG_PORT, 800);

    if (isPortOpen) {
      // Also check Docker health attribute if present
      const healthStatus = runCmd(`docker inspect --format="{{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}}" ${CONTAINER_NAME}`);
      if (!healthStatus || healthStatus === 'healthy' || healthStatus === 'starting') {
        healthy = true;
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!healthy) {
    console.error(`\n✗ PostgreSQL failed to become ready on port ${PG_PORT}.`);
    console.error('\nDiagnostic logs (docker logs):');
    const logs = runCmd(`docker logs ${CONTAINER_NAME} --tail 20`);
    if (logs) console.error(logs);
    process.exit(1);
  }

  console.log(`✓ PostgreSQL ready on localhost:${PG_PORT}`);
}

function spawnService(name, command, args, cwd) {
  const isWin = process.platform === 'win32';
  const proc = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: process.env
  });

  proc.on('error', (err) => {
    console.error(`[${name}] Failed to start:`, err.message);
  });

  return proc;
}

function startServices() {
  console.log('\n[4/5] Starting backend...');
  console.log('[5/5] Starting frontend...\n');
  console.log('✓ SyncNote is ready. Launching development processes...\n');

  const rootDir = path.join(__dirname, '..');
  const isWin = process.platform === 'win32';
  const npmBin = isWin ? 'npm.cmd' : 'npm';

  const serverProc = spawnService('SERVER', npmBin, ['run', 'dev', '--prefix', 'server'], rootDir);
  const clientProc = spawnService('CLIENT', npmBin, ['run', 'dev', '--prefix', 'client'], rootDir);

  function shutdown() {
    console.log('\nShutting down SyncNote services...');
    try { serverProc.kill(); } catch (e) { }
    try { clientProc.kill(); } catch (e) { }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  printBanner();
  ensureDependencies();
  await checkDockerInstalled();
  await checkDockerRunning();
  await ensurePostgresContainer();
  await waitForPostgresHealth();
  startServices();
}

main().catch((err) => {
  console.error('\n✗ Startup failed:', err.message);
  process.exit(1);
});
