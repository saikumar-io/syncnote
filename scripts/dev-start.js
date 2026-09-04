const { execSync, spawn } = require('child_process');
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

function printBanner() {
  console.log('\n╭──────────────────────────────╮');
  console.log('│        SyncNote Dev          │');
  console.log('╰──────────────────────────────╯\n');
}

function ensureDependencies() {
  console.log('[1/5] Checking Node/npm dependencies...');
  const serverCookieParser = path.join(__dirname, '../server/node_modules/cookie-parser');
  const serverPg = path.join(__dirname, '../server/node_modules/pg');
  if (!fs.existsSync(serverCookieParser) || !fs.existsSync(serverPg)) {
    console.log('[!] Installing server dependencies (cookie-parser, pg, etc.)...');
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    execSync(`${npmCmd} install --prefix server`, { stdio: 'inherit' });
    console.log('✓ Server dependencies installed successfully.');
  } else {
    console.log('✓ Monorepo dependencies verified.');
  }
}

function validateEnvironment() {
  console.log('\n[2/5] Validating environment configuration...');
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const isSupabase = dbUrl.includes('supabase') || dbUrl.includes('pooler');
    console.log(`✓ PostgreSQL DATABASE_URL configured (${isSupabase ? 'Supabase Central' : 'PostgreSQL'})`);
  } else {
    console.log('ℹ PostgreSQL DATABASE_URL not set (will fall back to local SQLite user store)');
  }
}

function ensureLocalStorage() {
  console.log('\n[3/5] Preparing local SQLite storage & device identity...');
  const rootDir = path.join(__dirname, '..');
  const dirs = [
    path.join(rootDir, 'data'),
    path.join(rootDir, 'data', 'notes'),
    path.join(rootDir, 'server', 'data'),
    path.join(rootDir, 'server', 'data', 'notes')
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  try {
    require('../server/src/db/database.js');
    console.log('✓ Local SQLite database verified');
  } catch (err) {
    console.warn('⚠️ Local SQLite init warning:', err.message);
  }

  try {
    const { getOrCreateDeviceIdentity } = require('../server/src/utils/deviceCrypto.js');
    getOrCreateDeviceIdentity();
    console.log('✓ Device cryptographic identity verified');
  } catch (err) {
    console.warn('⚠️ Device identity warning:', err.message);
  }
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
  console.log('\n[4/5] Starting backend service (port 5000)...');
  console.log('[5/5] Starting frontend service (port 5173)...\n');
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
  validateEnvironment();
  ensureLocalStorage();
  startServices();
}

main().catch((err) => {
  console.error('\n✗ Startup failed:', err.message);
  process.exit(1);
});
