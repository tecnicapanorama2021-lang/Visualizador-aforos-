/**
 * Ingesta idempotente: contexto_eventos (con geom) → incidentes.
 * Clasificación robusta por keywords (capasTaxonomy). Guarda raw_tipo en metadata y confidence_tipo.
 *
 * Uso:
 *   node server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js           # dry-run
 *   node server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js --apply   # aplicar
 */

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';
import { classifyContextoEvento } from '../../utils/capasTaxonomy.js';
import { clasificarImpacto } from '../../utils/impactoClassifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const FUENTE_PRINCIPAL = 'CONTEXTO_EVENTOS';

/** Mapea layer de taxonomía a tipo incidentes (OBRA, EVENTO, MANIFESTACION, CIERRE_VIA). */
function layerToTipo(layer, rawTipo) {
  if (layer === 'OBRAS') return 'OBRA';
  if (layer === 'MANIFESTACIONES') return 'MANIFESTACION';
  if (layer === 'EVENTOS') return 'EVENTO';
  if (rawTipo === 'CIERRE_VIA') return 'CIERRE_VIA';
  return 'EVENTO';
}

/** source_id estable: origen_id o hash. */
function stableSourceId(row) {
  if (row.origen_id) return String(row.origen_id).slice(0, 255);
  const str = `${row.id}-${row.tipo}-${row.descripcion || ''}-${row.fecha_inicio || ''}-${row.fuente || ''}`;
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 64);
}

const ESTADO_BUFFERS_MS = {
  CONCIERTO: { pre: 2 * 3600000, post: 1 * 3600000 },
  FERIA: { pre: 24 * 3600000, post: 2 * 3600000 },
  DEPORTE: { pre: 3 * 3600000, post: 1 * 3600000 },
  TEATRO: { pre: 1 * 3600000, post: 0.5 * 3600000 },
  DEFAULT: { pre: 2 * 3600000, post: 1 * 3600000 },
  MANIFESTACION: { pre: 0, post: 4 * 3600000 },
};

/** Calcula estado temporal: PROGRAMADO | ACTIVO | FINALIZADO | DESCONOCIDO. */
function calcularEstado(start_at, end_at, tipo) {
  const now = Date.now();
  const buf = ESTADO_BUFFERS_MS[tipo] ?? ESTADO_BUFFERS_MS.DEFAULT;
  if (start_at == null) return 'DESCONOCIDO';
  const inicio = new Date(start_at).getTime() - buf.pre;
  const fin = end_at
    ? new Date(end_at).getTime() + buf.post
    : new Date(start_at).getTime() + buf.post + 4 * 3600000;
  if (now < inicio) return 'PROGRAMADO';
  if (now <= fin) return 'ACTIVO';
  return 'FINALIZADO';
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-contexto-incidentes] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  const hasContexto = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasContexto) {
    console.error('[ingest-contexto-incidentes] No existe tabla contexto_eventos.');
    await closePool();
    process.exit(1);
  }

  const hasGeom = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'geom'`
  ).then((r) => r.rows[0]);
  if (!hasGeom) {
    console.error('[ingest-contexto-incidentes] contexto_eventos no tiene geom.');
    await closePool();
    process.exit(1);
  }

  const hasIncidentes = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incidentes'`
  ).then((r) => r.rows[0]);
  if (!hasIncidentes) {
    console.error('[ingest-contexto-incidentes] Ejecuta npm run db:migrate (migración 022).');
    await closePool();
    process.exit(1);
  }

  const rows = await query(`
    SELECT id, tipo, subtipo, descripcion, fecha_inicio, fecha_fin, fuente, url_remota, origen_id
    FROM contexto_eventos
    WHERE geom IS NOT NULL AND (tipo IS NULL OR tipo != 'LUGAR_EVENTO')
    ORDER BY id
  `);

  console.log('[ingest-contexto-incidentes] contexto_eventos con geom (excl. LUGAR_EVENTO):', rows.rows.length);

  // Eliminar incidentes que provenían de contexto_eventos LUGAR_EVENTO (venues Agéndate)
  const deleted = await query(`
    DELETE FROM incidentes i
    WHERE i.fuente_principal = $1
      AND EXISTS (
        SELECT 1 FROM incidentes_sources s
        JOIN contexto_eventos c ON c.fuente = 'AGENDATE_BOGOTA' AND c.tipo = 'LUGAR_EVENTO'
          AND s.payload->>'id' ~ '^[0-9]+$' AND c.id = (s.payload->>'id')::int
        WHERE s.incidente_id = i.id
      )
  `, [FUENTE_PRINCIPAL]).then((r) => r.rowCount ?? 0);
  if (deleted > 0) console.log('[ingest-contexto-incidentes] Eliminados de incidentes (ex-LUGAR_EVENTO):', deleted);

  const byTipo = {};
  const byLayer = {};
  rows.rows.forEach((r) => {
    const cl = classifyContextoEvento(r);
    const tipo = layerToTipo(cl.layer, r.tipo);
    byTipo[tipo] = (byTipo[tipo] || 0) + 1;
    byLayer[cl.layer] = (byLayer[cl.layer] || 0) + 1;
  });
  console.log('[ingest-contexto-incidentes] Clasificación → incidentes tipo:', byTipo);
  console.log('[ingest-contexto-incidentes] Clasificación → layer (OBRAS/EVENTOS/MANIFESTACIONES):', byLayer);

  if (!apply) {
    console.log('[ingest-contexto-incidentes] Para aplicar: node server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js --apply');
    await closePool();
    process.exit(0);
  }

  let inserted = 0;
  let updated = 0;

  for (const row of rows.rows) {
    const classification = classifyContextoEvento(row);
    const tipo = layerToTipo(classification.layer, row.tipo);
    const subtipo = classification.subtype || row.subtipo || null;
    const sourceId = stableSourceId(row);
    const titulo = (row.descripcion || '').slice(0, 1000) || null;
    const startAt = row.fecha_inicio ? new Date(row.fecha_inicio).toISOString() : null;
    const endAt = row.fecha_fin ? new Date(row.fecha_fin).toISOString() : null;
    const estado = calcularEstado(row.fecha_inicio, row.fecha_fin, subtipo || tipo);
    const confidenceTipo = row.tipo === tipo || (row.tipo === 'MANIFESTACION' && tipo === 'MANIFESTACION') ? 90 : 65;
    const metadata = JSON.stringify({
      raw_tipo: row.tipo,
      raw_subtipo: row.subtipo,
      raw_fuente: row.fuente,
    });
    const payload = JSON.stringify({
      id: row.id,
      tipo: row.tipo,
      subtipo: row.subtipo,
      descripcion: row.descripcion,
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin,
      fuente: row.fuente,
      url_remota: row.url_remota,
      origen_id: row.origen_id,
    });

    const exists = await query(
      `SELECT id FROM incidentes WHERE fuente_principal = $1 AND source_id = $2`,
      [FUENTE_PRINCIPAL, sourceId]
    ).then((x) => x.rows[0]);

    await query(
      `INSERT INTO incidentes (
        tipo, subtipo, titulo, descripcion, fuente_principal, source_id, url, estado,
        start_at, end_at, geom, geom_kind, confidence_geo, confidence_tipo, metadata, updated_at
      )
      SELECT
        $1, $2, $3, $4, $5, $6, $7, $13,
        $8::timestamptz, $9::timestamptz,
        ST_Centroid(geom), 'POINT', 80, $10, $11::jsonb, now()
      FROM contexto_eventos WHERE id = $12
      ON CONFLICT (fuente_principal, source_id) WHERE source_id IS NOT NULL
      DO UPDATE SET
        tipo = EXCLUDED.tipo, subtipo = EXCLUDED.subtipo, titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion,
        url = EXCLUDED.url, estado = EXCLUDED.estado, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
        geom = EXCLUDED.geom, confidence_tipo = EXCLUDED.confidence_tipo, metadata = EXCLUDED.metadata,
        updated_at = now()`,
      [tipo, subtipo, titulo, titulo, FUENTE_PRINCIPAL, sourceId, row.url_remota || null, startAt, endAt, confidenceTipo, metadata, row.id, estado]
    );

    const r = await query(`SELECT id FROM incidentes WHERE fuente_principal = $1 AND source_id = $2`, [FUENTE_PRINCIPAL, sourceId]);
    const incidenteId = r.rows[0]?.id;
    if (incidenteId) {
      if (!exists) inserted++;
      else updated++;
      await query(
        `INSERT INTO incidentes_sources (incidente_id, fuente, source_id, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (incidente_id, fuente, source_id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
        [incidenteId, FUENTE_PRINCIPAL, sourceId, payload]
      );

      const impacto = clasificarImpacto({ tipo, titulo, subtipo });
      try {
        await query(
          `INSERT INTO eventos_impacto (incidente_id, impacto_nivel, impacto_radio_m, impacto_factor, impacto_confianza, fuente_senal)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (incidente_id) DO UPDATE SET
             impacto_nivel = EXCLUDED.impacto_nivel,
             impacto_radio_m = EXCLUDED.impacto_radio_m,
             impacto_factor = EXCLUDED.impacto_factor,
             impacto_confianza = EXCLUDED.impacto_confianza,
             fuente_senal = EXCLUDED.fuente_senal`,
          [incidenteId, impacto.nivel, impacto.radio_m, impacto.factor, impacto.confianza, FUENTE_PRINCIPAL]
        );
      } catch (err) {
        if (err?.message?.includes('eventos_impacto') || err?.code === '42P01') {
          console.warn('[ingest-contexto-incidentes] eventos_impacto no existe; ejecuta npm run db:migrate.');
        } else throw err;
      }
    }
  }

  console.log('[ingest-contexto-incidentes] Insertados:', inserted, 'Actualizados:', updated);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-contexto-incidentes]', err.message);
  process.exit(1);
});
