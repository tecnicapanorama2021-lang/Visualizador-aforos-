/**
 * Ingesta idempotente: calendario_obras_eventos.json → incidentes (tipo=OBRA).
 * Fuente canónica única. Guarda payload en incidentes_sources.
 *
 * Uso:
 *   node server/scripts/ingest/ingest_obras_calendario_to_incidentes.js           # dry-run
 *   node server/scripts/ingest/ingest_obras_calendario_to_incidentes.js --apply   # aplicar
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const CALENDAR_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'calendario_obras_eventos.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const FUENTE_PRINCIPAL = 'IDU';

function loadObrasWithCoords() {
  if (!fs.existsSync(CALENDAR_PATH)) {
    console.error('[ingest-obras-incidentes] No encontrado:', CALENDAR_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('[ingest-obras-incidentes] JSON inválido:', e.message);
    process.exit(1);
  }
  const obras = Array.isArray(data.obras) ? data.obras : [];
  return obras.filter((o) => o.geometry?.coordinates && o.geometry.coordinates.length >= 2);
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-obras-incidentes] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  const obras = loadObrasWithCoords();
  console.log('[ingest-obras-incidentes] Obras con coords en calendario:', obras.length);
  if (obras.length === 0) {
    console.log('[ingest-obras-incidentes] Nada que ingestar.');
    await closePool();
    process.exit(0);
  }

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incidentes'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[ingest-obras-incidentes] Ejecuta npm run db:migrate (migración 022).');
    await closePool();
    process.exit(1);
  }

  if (!apply) {
    console.log('[ingest-obras-incidentes] Modo dry-run. Para aplicar: node server/scripts/ingest/ingest_obras_calendario_to_incidentes.js --apply');
    await closePool();
    process.exit(0);
  }

  let inserted = 0;
  let updated = 0;

  for (const o of obras) {
    const sourceId = (o.id != null ? String(o.id) : '').slice(0, 255);
    if (!sourceId) continue;
    const [lng, lat] = o.geometry.coordinates;
    const titulo = (o.nombre || o.descripcion || '').slice(0, 1000) || null;
    const descripcion = (o.descripcion || '').slice(0, 5000) || null;
    const estado = (o.estado && /activa|en curso|construcción/i.test(o.estado)) ? 'ACTIVO' : 'ACTIVO';
    const startAt = o.fecha_inicio ? new Date(o.fecha_inicio).toISOString() : null;
    const endAt = o.fecha_fin ? new Date(o.fecha_fin).toISOString() : null;
    const payload = JSON.stringify({ id: o.id, nombre: o.nombre, estado: o.estado, fuente: o.fuente, geometry: o.geometry });

    const exists = await query(
      `SELECT id FROM incidentes WHERE fuente_principal = $1 AND source_id = $2`,
      [FUENTE_PRINCIPAL, sourceId]
    ).then((x) => x.rows[0]);

    const r = await query(
      `INSERT INTO incidentes (
        tipo, subtipo, titulo, descripcion, fuente_principal, source_id, estado,
        start_at, end_at, geom, geom_kind, confidence_geo, confidence_tipo, metadata, updated_at
      ) VALUES (
        'OBRA', NULL, $1, $2, $3, $4, $5,
        $6::timestamptz, $7::timestamptz,
        ST_SetSRID(ST_MakePoint($8::double precision, $9::double precision), 4326), 'POINT',
        90, 90, '{}'::jsonb, now()
      )
      ON CONFLICT (fuente_principal, source_id) WHERE source_id IS NOT NULL
      DO UPDATE SET
        titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, estado = EXCLUDED.estado,
        start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, geom = EXCLUDED.geom,
        updated_at = now()
      RETURNING id`,
      [titulo, descripcion, FUENTE_PRINCIPAL, sourceId, estado, startAt, endAt, lng, lat]
    );

    const incidenteId = r.rows[0]?.id;
    if (!incidenteId) continue;
    if (!exists) inserted++;
    else updated++;

    await query(
      `INSERT INTO incidentes_sources (incidente_id, fuente, source_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (incidente_id, fuente, source_id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
      [incidenteId, FUENTE_PRINCIPAL, sourceId, payload]
    );
  }

  console.log('[ingest-obras-incidentes] Insertados:', inserted, 'Actualizados:', updated);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-obras-incidentes]', err.message);
  process.exit(1);
});
