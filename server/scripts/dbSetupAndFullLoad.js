/**
 * Setup completo: verifica conexión, aplica migración y carga todos los datos desde JSON.
 * Un solo comando para dejar la BD lista para producción.
 *
 * Uso: npm run db:full-load
 * Requiere: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (o DATABASE_URL)
 * Requiere: public/data/studies_dictionary.json, nodos_unificados.json, ia_historial.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const MIGRATION_PATH = path.join(__dirname, '../db/migrations/001_init.sql');

const envPath = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

function ensureEnv() {
  if (process.env.DATABASE_URL) return;
  if (process.env.PGHOST || process.env.PGDATABASE) return;
  console.error('[db:full-load] Configura las variables de entorno de Postgres:');
  console.error('  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD');
  console.error('  o DATABASE_URL');
  process.exit(1);
}

async function runMigration() {
  if (!fs.existsSync(MIGRATION_PATH)) {
    console.error('[db:full-load] No encontrado:', MIGRATION_PATH);
    process.exit(1);
  }
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await query(sql);
  console.log('[db:full-load] Migración 001_init.sql aplicada.');
}

function runScript(name, scriptPath) {
  const fullPath = path.join(PROJECT_ROOT, scriptPath);
  if (!fs.existsSync(fullPath)) {
    console.error('[db:full-load] No encontrado:', fullPath);
    process.exit(1);
  }
  console.log('[db:full-load] Ejecutando:', scriptPath);
  execSync(`node ${scriptPath}`, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

async function logCounts() {
  const [nodos, estudios, conteos] = await Promise.all([
    query('SELECT count(*)::int AS c FROM nodos'),
    query('SELECT count(*)::int AS c FROM estudios'),
    query('SELECT count(*)::int AS c FROM conteos_resumen'),
  ]);
  const n = nodos.rows[0]?.c ?? 0;
  const e = estudios.rows[0]?.c ?? 0;
  const c = conteos.rows[0]?.c ?? 0;
  console.log('\n[db:full-load] Totales en BD:');
  console.log('  Nodos:           ', n);
  console.log('  Estudios:        ', e);
  console.log('  Conteos_resumen: ', c);
  console.log('');
}

async function main() {
  ensureEnv();

  try {
    await query('SELECT 1');
    console.log('[db:full-load] Conexión a Postgres OK.');
  } catch (err) {
    console.error('[db:full-load] No se pudo conectar a Postgres:', err.message);
    process.exit(1);
  }

  try {
    await runMigration();
    runScript('ETL nodos + estudios', 'server/scripts/etl_nodos_estudios_from_json.js');
    runScript('ETL conteos (streaming)', 'server/scripts/etl_conteos_from_historial.js');
    await logCounts();
    console.log('[db:full-load] Carga inicial completada.');
  } catch (err) {
    console.error('[db:full-load] Error:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
