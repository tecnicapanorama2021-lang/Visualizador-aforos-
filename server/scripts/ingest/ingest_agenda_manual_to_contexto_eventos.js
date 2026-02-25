/**
 * Ingesta idempotente: public/data/agenda_eventos.json → contexto_eventos.
 * Fuente: AGENDA_MANUAL. tipo = EVENTO_CULTURAL, origen_id = sha256(titulo+start_at+lat+lon).
 * Uso: node .../ingest_agenda_manual_to_contexto_eventos.js [--apply]
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const AGENDA_JSON_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agenda_eventos.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const FUENTE = 'AGENDA_MANUAL';

function stableOrigenId(ev) {
  const str = `${ev.titulo || ''}|${ev.start_at || ''}|${ev.lat ?? ''}|${ev.lon ?? ''}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

async function main() {
  const apply = process.argv.includes('--apply');

  let raw;
  try {
    raw = await fs.readFile(AGENDA_JSON_PATH, 'utf8');
  } catch (err) {
    console.error('[ingest-agenda-manual] No se pudo leer', AGENDA_JSON_PATH, err.message);
    process.exit(1);
  }

  let events;
  try {
    events = JSON.parse(raw);
    if (!Array.isArray(events)) events = [];
  } catch (err) {
    console.error('[ingest-agenda-manual] JSON inválido:', err.message);
    process.exit(1);
  }

  console.log('[ingest-agenda-manual] Eventos en JSON:', events.length);

  if (!apply) {
    console.log('[ingest-agenda-manual] Dry-run. Para aplicar: node server/scripts/ingest/ingest_agenda_manual_to_contexto_eventos.js --apply');
    process.exit(0);
  }

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[ingest-agenda-manual] No existe tabla contexto_eventos. Ejecuta npm run db:migrate.');
    await closePool();
    process.exit(1);
  }

  let processed = 0;
  for (const ev of events) {
    const lat = ev.lat != null ? parseFloat(ev.lat) : null;
    const lon = ev.lon != null ? parseFloat(ev.lon) : null;
    const origenId = stableOrigenId(ev);
    const descripcion = (ev.titulo || '').slice(0, 500) || null;
    const startAt = ev.start_at ? new Date(ev.start_at).toISOString() : null;
    const endAt = ev.end_at ? new Date(ev.end_at).toISOString() : null;

    if (lon == null || lat == null) {
      console.warn('[ingest-agenda-manual] Sin coordenadas:', ev.titulo);
      continue;
    }

    const wkt = `POINT(${lon} ${lat})`;
    const datosExtra = JSON.stringify({
      lugar: ev.lugar,
      entidad: ev.entidad,
      aforo_estimado: ev.aforo_estimado,
      zona_influencia_m: ev.zona_influencia_m,
    });

    try {
      await query(
        `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota, datos_extra)
         VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_GeomFromText($5), 4326), $6, NULL, $7::jsonb)
         ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
         DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, datos_extra = EXCLUDED.datos_extra, geom = EXCLUDED.geom`,
        [FUENTE, descripcion, startAt, endAt, wkt, origenId, datosExtra]
      );
      processed++;
    } catch (err) {
      console.warn('[ingest-agenda-manual] Error upsert', origenId, err.message);
    }
  }

  const total = await query(
    `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1`,
    [FUENTE]
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  console.log('[ingest-agenda-manual] Procesados:', processed, '| Total en BD con fuente', FUENTE + ':', total);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-agenda-manual]', err.message);
  process.exit(1);
});
