/**
 * LEGACY – Ingesta a obras_canonica (no a incidentes).
 * Canon: server/scripts/ingest/ingest_obras_calendario_to_incidentes.js (npm run ingest:obras:incidentes).
 *
 * Ingesta idempotente: calendario_obras_eventos.json → obras_canonica.
 * Fuente única para capa OBRAS (geom propia, sin depender de nodos).
 *
 * Uso:
 *   node server/scripts/ingest_obras_from_calendario.js           # dry-run
 *   node server/scripts/ingest_obras_from_calendario.js --apply  # aplicar
 *   npm run ingest:obras
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const CALENDAR_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'calendario_obras_eventos.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const SOURCE_SYSTEM = 'CALENDARIO_JSON';

function loadObrasWithCoords() {
  if (!fs.existsSync(CALENDAR_PATH)) {
    console.error('[ingest-obras] No encontrado:', CALENDAR_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('[ingest-obras] JSON inválido:', e.message);
    process.exit(1);
  }
  const obras = Array.isArray(data.obras) ? data.obras : [];
  return obras.filter((o) => o.geometry?.coordinates && o.geometry.coordinates.length >= 2);
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-obras] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  const obras = loadObrasWithCoords();
  console.log('[ingest-obras] Obras con coords en calendario:', obras.length);
  if (obras.length === 0) {
    console.log('[ingest-obras] Nada que ingestar.');
    await closePool();
    process.exit(0);
  }

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'obras_canonica'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[ingest-obras] Ejecuta npm run db:migrate (migración 021).');
    await closePool();
    process.exit(1);
  }

  if (!apply) {
    console.log('[ingest-obras] Modo dry-run. Para aplicar: node server/scripts/ingest_obras_from_calendario.js --apply');
    await closePool();
    process.exit(0);
  }

  const countBefore = await query('SELECT COUNT(*) AS c FROM obras_canonica WHERE source_system = $1', [SOURCE_SYSTEM])
    .then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  for (const o of obras) {
    const sourceId = (o.id != null ? String(o.id) : '').slice(0, 255);
    if (!sourceId) continue;
    const [lng, lat] = o.geometry.coordinates;
    const titulo = (o.nombre || o.descripcion || '').slice(0, 1000) || null;
    const descripcion = (o.descripcion || '').slice(0, 5000) || null;
    const estado = (o.estado || '').slice(0, 100) || null;
    const entidad = (o.entidad || '').slice(0, 255) || null;
    const fuente = (o.fuente || 'IDU').slice(0, 100) || null;
    const fechaIni = o.fecha_inicio ? new Date(o.fecha_inicio).toISOString().slice(0, 10) : null;
    const fechaFin = o.fecha_fin ? new Date(o.fecha_fin).toISOString().slice(0, 10) : null;

    await query(
      `INSERT INTO obras_canonica (source_system, source_id, titulo, descripcion, estado, entidad, fecha_ini, fecha_fin, fuente, geom, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, ST_SetSRID(ST_MakePoint($10::double precision, $11::double precision), 4326), now())
       ON CONFLICT (source_system, source_id)
       DO UPDATE SET titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, estado = EXCLUDED.estado,
                     entidad = EXCLUDED.entidad, fecha_ini = EXCLUDED.fecha_ini, fecha_fin = EXCLUDED.fecha_fin,
                     fuente = EXCLUDED.fuente, geom = EXCLUDED.geom, updated_at = now()`,
      [SOURCE_SYSTEM, sourceId, titulo, descripcion, estado, entidad, fechaIni, fechaFin, fuente, lng, lat]
    );
  }

  const countAfter = await query('SELECT COUNT(*) AS c FROM obras_canonica WHERE source_system = $1', [SOURCE_SYSTEM])
    .then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
  console.log('[ingest-obras] Procesados:', obras.length, '| Total en BD (CALENDARIO_JSON):', countAfter, '| Nuevos:', countAfter - countBefore);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-obras]', err.message);
  process.exit(1);
});
