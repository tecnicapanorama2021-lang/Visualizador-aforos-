/**
 * Verificación: arranca la API en puerto alterno (3099) unos segundos y la apaga.
 * Si server.js revienta al iniciar, el script falla. Red de seguridad pre-limpieza.
 * Uso: npm run verify:dev:api
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3099;
const RUN_MS = 3000;

const child = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});
let exited = false;
let exitCode = null;

child.on('error', (err) => {
  console.error('[verify:dev:api] Error al arrancar:', err.message);
  process.exit(1);
});
child.on('exit', (code) => {
  exited = true;
  exitCode = code;
  if (code !== 0 && code !== null) {
    console.error('[verify:dev:api] Proceso salió con código', code);
    process.exit(1);
  }
});

setTimeout(() => {
  if (exited) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!exited) child.kill('SIGKILL');
    console.log('[verify:dev:api] API arrancó y se cerró correctamente (puerto', PORT + ')');
    process.exit(0);
  }, 500);
}, RUN_MS);
