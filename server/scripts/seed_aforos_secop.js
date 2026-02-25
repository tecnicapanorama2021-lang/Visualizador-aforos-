/**
 * Seed de aforos SECOP: crea anexos de ejemplo (XLSX + CSV), los registra y los procesa para poblar la BD.
 * Añade nodos EXTERNO, estudios y conteos_resumen sin tocar datos existentes (idempotente).
 *
 * Uso: npm run seed:aforos-secop
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

function run(name, cmd, args) {
  return new Promise((resolve, reject) => {
    console.log('[seed]', name, '...');
    const child = spawn(cmd, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} salió con código ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  await run('secop:ejemplo (crear XLSX+CSV y registrar)', 'node', [
    'server/scripts/secop_crear_ejemplo_anexos.js',
  ]);
  await run('secop:procesar (convertir + ETL a BD)', 'node', ['server/scripts/secop_procesar_anexos.js']);
  console.log('[seed] Listo. Ejecuta npm run stats:fuentes para ver estudios y conteos por origen.');
}

main().catch((err) => {
  console.error('[seed]', err.message);
  process.exit(1);
});
