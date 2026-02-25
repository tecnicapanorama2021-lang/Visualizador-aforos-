/**
 * Bootstrap local: migraciones + jobs:seed. Modifica BD y Redis.
 * Uso: npm run bootstrap:local
 * No corre ingests grandes por defecto; solo prepara BD y colas.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const banner = `
============================================
  BOOTSTRAP LOCAL
  ESTO VA A MODIFICAR BD / REDIS / ARCHIVOS LOCALES
  Solo para entornos locales bajo tu control.
============================================
`;
console.log(banner);

// Precheck: .env
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  console.error('[bootstrap:local] No se encontró .env. Cópialo desde .env.example y configura DATABASE_URL y Redis.');
  process.exit(1);
}
console.log('[bootstrap:local] .env encontrado.');

function run(name, npmScript) {
  console.log(`\n[bootstrap:local] Ejecutando: npm run ${npmScript}`);
  const r = spawnSync('npm', ['run', npmScript], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`[bootstrap:local] Falló: ${name} (exit ${r.status}). Abortando.`);
    process.exit(r.status);
  }
  console.log(`[bootstrap:local] OK: ${name}`);
}

// Paso 1: migraciones (requiere DATABASE_URL en .env)
console.log('\n--- Paso 1: db:migrate ---');
run('db:migrate', 'db:migrate');

// Paso 2: jobs:seed (requiere Redis)
console.log('\n--- Paso 2: jobs:seed ---');
run('jobs:seed', 'jobs:seed');

console.log('\n[bootstrap:local] Listo. No se ejecutaron ingests; úsalos manualmente si los necesitas (ingest:*, etl:*, etc.).');
process.exit(0);
