/**
 * LEGACY – Ingesta a obras_canonica y eventos_canonica (no a incidentes).
 * Canon: server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js (npm run ingest:eventos:incidentes).
 *
 * Ingesta idempotente: contexto_eventos → obras_canonica (tipo OBRA) y eventos_canonica (EVENTO_CULTURAL, MANIFESTACION, CIERRE_VIA).
 * Taxonomía: OBRA no va a eventos; solo eventos urbanos/culturales van a eventos_canonica.
 *
 * Uso:
 *   node server/scripts/ingest_eventos_from_contexto.js           # dry-run
 *   node server/scripts/ingest_eventos_from_contexto.js --apply   # aplicar
 *   npm run ingest:eventos
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const SOURCE_SYSTEM = 'CONTEXTO_EVENTOS';

/** Tipos que van a obras_canonica (no a eventos). */
const TIPOS_OBRA = ['OBRA'];

/** Tipos que van a eventos_canonica y su tipo_evento canónico. */
const TIPOS_EVENTO = {
  EVENTO_CULTURAL: 'EVENTO_CULTURAL',
  MANIFESTACION: 'MANIFESTACION',
  CIERRE_VIA: 'CIERRE_VIA',
};

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-eventos] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  const hasContexto = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasContexto) {
    console.error('[ingest-eventos] No existe tabla contexto_eventos. Ejecuta migraciones.');
    await closePool();
    process.exit(1);
  }

  const hasGeom = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'geom'`
  ).then((r) => r.rows[0]);
  if (!hasGeom) {
    console.error('[ingest-eventos] contexto_eventos no tiene columna geom.');
    await closePool();
    process.exit(1);
  }

  const rows = await query(`
    SELECT id, tipo, subtipo, descripcion, fecha_inicio, fecha_fin, fuente, url_remota, origen_id
    FROM contexto_eventos
    WHERE geom IS NOT NULL
    ORDER BY id
  `);

  const toObras = rows.rows.filter((r) => TIPOS_OBRA.includes(r.tipo));
  const toEventos = rows.rows.filter((r) => r.tipo && TIPOS_EVENTO[r.tipo]);

  console.log('[ingest-eventos] contexto_eventos con geom:', rows.rows.length);
  console.log('[ingest-eventos] → obras_canonica (OBRA):', toObras.length);
  console.log('[ingest-eventos] → eventos_canonica (EVENTO_CULTURAL/MANIFESTACION/CIERRE_VIA):', toEventos.length);

  const hasObrasCan = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'obras_canonica'`
  ).then((r) => r.rows[0]);
  const hasEventosCan = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'eventos_canonica'`
  ).then((r) => r.rows[0]);
  if (!hasObrasCan || !hasEventosCan) {
    console.error('[ingest-eventos] Ejecuta npm run db:migrate (migración 021).');
    await closePool();
    process.exit(1);
  }

  if (!apply) {
    console.log('[ingest-eventos] Modo dry-run. Para aplicar: node server/scripts/ingest_eventos_from_contexto.js --apply');
    await closePool();
    process.exit(0);
  }

  let obrasInserted = 0;
  let obrasUpdated = 0;
  for (const r of toObras) {
    const sourceId = (r.origen_id != null ? String(r.origen_id) : `ctx-${r.id}`).slice(0, 255);
    const titulo = (r.descripcion || '').slice(0, 1000) || null;
    const fechaIni = r.fecha_inicio ? new Date(r.fecha_inicio).toISOString().slice(0, 10) : null;
    const fechaFin = r.fecha_fin ? new Date(r.fecha_fin).toISOString().slice(0, 10) : null;
    const fuente = (r.fuente || '').slice(0, 100) || null;

    const exists = await query(
      'SELECT 1 FROM obras_canonica WHERE source_system = $1 AND source_id = $2',
      [SOURCE_SYSTEM, sourceId]
    ).then((x) => x.rows[0]);
    await query(
      `INSERT INTO obras_canonica (source_system, source_id, titulo, descripcion, estado, fecha_ini, fecha_fin, fuente, geom, updated_at)
       SELECT $1, $2, $3, $4, NULL, $5::date, $6::date, $7, ST_Centroid(geom), now()
       FROM contexto_eventos WHERE id = $8
       ON CONFLICT (source_system, source_id)
       DO UPDATE SET titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, fecha_ini = EXCLUDED.fecha_ini,
                     fecha_fin = EXCLUDED.fecha_fin, fuente = EXCLUDED.fuente, geom = EXCLUDED.geom, updated_at = now()`,
      [SOURCE_SYSTEM, sourceId, titulo, titulo, fechaIni, fechaFin, fuente, r.id]
    );
    if (exists) obrasUpdated++;
    else obrasInserted++;
  }

  let eventosInserted = 0;
  let eventosUpdated = 0;
  for (const r of toEventos) {
    const tipoEvento = TIPOS_EVENTO[r.tipo];
    const sourceId = (r.origen_id != null ? String(r.origen_id) : `ctx-${r.id}`).slice(0, 255);
    const titulo = (r.descripcion || '').slice(0, 1000) || null;
    const url = (r.url_remota || '').slice(0, 2048) || null;
    const fuente = (r.fuente || '').slice(0, 100) || null;
    const fechaIni = r.fecha_inicio ? new Date(r.fecha_inicio).toISOString() : null;
    const fechaFin = r.fecha_fin ? new Date(r.fecha_fin).toISOString() : null;

    const exists = await query(
      'SELECT 1 FROM eventos_canonica WHERE source_system = $1 AND source_id = $2',
      [SOURCE_SYSTEM, sourceId]
    ).then((x) => x.rows[0]);
    await query(
      `INSERT INTO eventos_canonica (source_system, source_id, tipo_evento, titulo, descripcion, fecha_ini, fecha_fin, url, fuente, geom, updated_at)
       SELECT $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, ST_Centroid(geom), now()
       FROM contexto_eventos WHERE id = $10
       ON CONFLICT (source_system, source_id)
       DO UPDATE SET tipo_evento = EXCLUDED.tipo_evento, titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion,
                     fecha_ini = EXCLUDED.fecha_ini, fecha_fin = EXCLUDED.fecha_fin, url = EXCLUDED.url, fuente = EXCLUDED.fuente,
                     geom = EXCLUDED.geom, updated_at = now()`,
      [SOURCE_SYSTEM, sourceId, tipoEvento, titulo, titulo, fechaIni, fechaFin, url, fuente, r.id]
    );
    if (exists) eventosUpdated++;
    else eventosInserted++;
  }

  console.log('[ingest-eventos] obras_canonica: insertados', obrasInserted, 'actualizados', obrasUpdated);
  console.log('[ingest-eventos] eventos_canonica: insertados', eventosInserted, 'actualizados', eventosUpdated);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-eventos]', err.message);
  process.exit(1);
});
