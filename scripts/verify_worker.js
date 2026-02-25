/**
 * Verificación: ejecuta el entry del worker unos segundos y lo apaga.
 * Si el worker revienta al iniciar (ej. Redis no disponible), el script falla. Red de seguridad pre-limpieza.
 * El worker no tiene --help/--version; se valida que no crashee al cargar.
 * Uso: npm run verify:worker
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RUN_MS = 3500;

const child = spawn('node', ['server/worker/index.js'], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: 'pipe',
});
let exited = false;

child.on('error', (err) => {
  console.error('[verify:worker] Error al arrancar:', err.message);
  process.exit(1);
});
child.on('exit', (code) => {
  exited = true;
  if (code !== 0 && code !== null) {
    console.error('[verify:worker] Worker salió con código', code);
    process.exit(1);
  }
});

setTimeout(() => {
  if (exited) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!exited) child.kill('SIGKILL');
    console.log('[verify:worker] Worker arrancó y se cerró correctamente');
    process.exit(0);
  }, 500);
}, RUN_MS);
