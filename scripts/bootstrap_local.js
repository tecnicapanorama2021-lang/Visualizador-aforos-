/**
 * Bootstrap local: migraciones + jobs:seed. Modifica BD y Redis.
 * Uso: npm run bootstrap:local          → pide confirmación (Type YES to continue)
 *      npm run bootstrap:local -- --yes  → sin prompt (automatizar local)
 */
import { spawnSync } from 'child_process';
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const hasYesFlag = process.argv.slice(2).includes('--yes');

const banner = `
============================================
  BOOTSTRAP LOCAL
  ESTO VA A MODIFICAR BD / REDIS / ARCHIVOS LOCALES
  Solo para entornos locales bajo tu control.
============================================
`;
console.log(banner);

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

function doBootstrap() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('[bootstrap:local] No se encontró .env. Cópialo desde .env.example y configura DATABASE_URL y Redis.');
    process.exit(1);
  }
  console.log('[bootstrap:local] .env encontrado.');

  console.log('\n--- Paso 1: db:migrate ---');
  run('db:migrate', 'db:migrate');

  console.log('\n--- Paso 2: jobs:seed ---');
  run('jobs:seed', 'jobs:seed');

  console.log('\n[bootstrap:local] Listo. No se ejecutaron ingests; úsalos manualmente si los necesitas (ingest:*, etl:*, etc.).');
  process.exit(0);
}

if (hasYesFlag) {
  doBootstrap();
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Type YES to continue: ', (answer) => {
    rl.close();
    if (answer.trim() !== 'YES') {
      console.error('[bootstrap:local] Confirmación no recibida. Abortando.');
      process.exit(1);
    }
    doBootstrap();
  });
}
