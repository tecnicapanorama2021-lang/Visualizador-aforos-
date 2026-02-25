/**
 * Verificación: ejecuta npm run build. Usado como red de seguridad antes de limpiezas.
 * Uso: npm run verify:build
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const r = spawnSync('npm', ['run', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status ?? 1);
