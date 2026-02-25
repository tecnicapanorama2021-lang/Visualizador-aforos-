/**
 * Comprueba que el esquema esté listo para ETL conteos_resumen (migraciones 014 y 016).
 * Requiere: DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD (carga .env de raíz y server/).
 * Sale 0 si: interval_minutes existe y UNIQUE (estudio_id, sentido, intervalo_ini, intervalo_fin) por columnas exactas.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

const EXPECTED_UNIQUE_COLS = ['estudio_id', 'sentido', 'intervalo_ini', 'intervalo_fin'].sort();
const DATABASE_URL_HINT = "DATABASE_URL no está definido. En PowerShell: $env:DATABASE_URL = 'postgresql://postgres:TU_PASSWORD@localhost:5432/aforos' — o crea/edita .env en la raíz del proyecto con DATABASE_URL=... o PGHOST, PGDATABASE, PGUSER, PGPASSWORD.";

function loadEnv() {
  const paths = [
    path.join(PROJECT_ROOT, '.env'),
    path.join(PROJECT_ROOT, 'server', '.env'),
  ];
  for (const envPath of paths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
}

function toColumnArray(v) {
  if (Array.isArray(v)) return v.map(String);
  if (v == null) return [];
  if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim());
  return [];
}

function sameColumnSet(actual) {
  const arr = toColumnArray(actual);
  const sorted = [...arr].sort();
  return sorted.length === EXPECTED_UNIQUE_COLS.length && sorted.every((c, i) => c === EXPECTED_UNIQUE_COLS[i]);
}

async function main() {
  loadEnv();

  const hasUrl = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim().length > 0;
  const hasPgParams = process.env.PGHOST || process.env.PGDATABASE;
  if (!hasUrl && !hasPgParams) {
    console.error('[check_db_schema]', DATABASE_URL_HINT);
    process.exit(1);
  }

  let ok = true;

  try {
    const colRes = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'conteos_resumen' AND column_name = 'interval_minutes'`
    );
    if (colRes.rows.length === 0) {
      console.error('[check_db_schema] Falta columna interval_minutes en conteos_resumen. Aplica migración 014.');
      ok = false;
    } else {
      console.log('[check_db_schema] Columna interval_minutes: OK');
    }

    const constraintRes = await query(
      `SELECT array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS cols
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.conrelid = 'public.conteos_resumen'::regclass AND c.contype = 'u' AND c.conname = 'uq_conteos_estudio_sentido_ini_fin'
       GROUP BY c.oid, c.conkey`
    );

    let uniqueOk = false;
    let wrongColumns = false;

    if (constraintRes.rows.length > 0) {
      const arr = toColumnArray(constraintRes.rows[0].cols);
      if (sameColumnSet(arr)) {
        uniqueOk = true;
      } else {
        wrongColumns = true;
      }
    }

    if (!uniqueOk && !wrongColumns) {
      const indexRes = await query(
        `SELECT array_agg(a.attname ORDER BY k.ord) AS cols
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_class tc ON tc.oid = i.indrelid AND tc.relname = 'conteos_resumen'
         JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum AND a.attnum > 0 AND NOT a.attisdropped
         WHERE tc.relnamespace = 'public'::regnamespace AND i.indisunique AND ic.relname = 'uq_conteos_estudio_sentido_ini_fin'
         GROUP BY ic.oid`
      );
      if (indexRes.rows.length > 0) {
        const arr = toColumnArray(indexRes.rows[0].cols);
        if (sameColumnSet(arr)) {
          uniqueOk = true;
        } else {
          wrongColumns = true;
        }
      }
    }

    if (wrongColumns) {
      console.error('[check_db_schema] UNIQUE incorrecto: se esperaba (estudio_id, sentido, intervalo_ini, intervalo_fin). Aplica migración 016 actualizada.');
      ok = false;
    } else if (!uniqueOk) {
      console.error('[check_db_schema] Falta unique ini_fin correcto (constraint o índice con columnas estudio_id, sentido, intervalo_ini, intervalo_fin). Aplica migración 016.');
      ok = false;
    } else {
      console.log('[check_db_schema] unique ini_fin (columns match): OK');
    }
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (msg.includes('password authentication failed') || msg.includes('auth') || msg.includes('ECONNREFUSED')) {
      console.error('[check_db_schema] Credenciales Postgres inválidas o servidor inaccesible; revisa DATABASE_URL o .env (usuario, PGPASSWORD, host, puerto).');
    } else {
      console.error('[check_db_schema] Error:', msg);
    }
    process.exit(1);
  } finally {
    await closePool();
  }

  if (ok) {
    console.log('[check_db_schema] Esquema listo para ETL --write.');
    process.exit(0);
  }
  process.exit(1);
}

main();
