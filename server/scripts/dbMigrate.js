/**
 * Aplica la migración 001_init.sql usando el cliente pg (sin depender de psql en PATH).
 * Uso: npm run db:migrate
 * Requiere: DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD (pueden estar en .env)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const envPath = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');

async function main() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[db:migrate] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error('[db:migrate] No encontrado:', MIGRATIONS_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const migrationPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    try {
      await query(sql);
      console.log('[db:migrate]', file, 'aplicado correctamente.');
    } catch (err) {
      console.error('[db:migrate] Error en', file, ':', err.message);
      process.exit(1);
    }
  }
  await closePool();
}

main();
