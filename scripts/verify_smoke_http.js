/**
 * Smoke HTTP: arranca la API en puerto 3099, hace GET /health y verifica 200 + body.ok.
 * Luego cierra el proceso. Máximo ~10s. Uso: npm run verify:smoke
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;
const HEALTH_URL = `${BASE}/health`;
const WAIT_READY_MS = 6000;
const POLL_MS = 200;

const child = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});

let exited = false;
let exitCode = null;

child.on('error', (err) => {
  console.error('[verify:smoke] Error al arrancar:', err.message);
  process.exit(1);
});
child.on('exit', (code) => {
  exited = true;
  exitCode = code;
});

function waitReady() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + WAIT_READY_MS;
    const tick = async () => {
      if (exited) {
        reject(new Error('Servidor terminó antes de estar listo'));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('Timeout esperando a que el servidor responda'));
        return;
      }
      try {
        const res = await fetch(HEALTH_URL);
        if (res.ok) {
          resolve(res);
          return;
        }
      } catch (_) {}
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  });
}

async function run() {
  try {
    const res = await waitReady();
    if (res.status !== 200) {
      console.error('[verify:smoke] GET /health devolvió', res.status);
      process.exit(1);
    }
    const body = await res.json();
    if (body && body.ok !== true) {
      console.error('[verify:smoke] GET /health sin body.ok: true', body);
      process.exit(1);
    }
    console.log('[verify:smoke] GET /health 200 ok');
  } catch (err) {
    console.error('[verify:smoke]', err.message);
    process.exit(1);
  } finally {
    if (!exited) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
        process.exit(0);
      }, 500);
    } else {
      process.exit(0);
    }
  }
}

run();
