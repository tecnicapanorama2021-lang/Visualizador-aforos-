/**
 * Job news:manifestations:extract — Lee landing_items NEWS no procesados, clasifica manifestaciones, upsert incidentes.
 * Marca landing_items.processed_at. quality_status: HIGH (geom+tiempo), MED (tiempo), LOW (solo texto).
 */

import { query } from '../../db/client.js';
import { startRun, endRun } from '../../lib/ingestRuns.js';
import { normalizeString } from '../../utils/capasTaxonomy.js';

const FUENTE_PRINCIPAL = 'NEWS_RSS';
const KEYWORDS_MANIFESTACION = [
  'manifestacion', 'manifestación', 'marcha', 'protesta', 'bloqueo', 'planton', 'plantón',
  'disturbios', 'paro', 'cierres por', 'cierre vial', 'toma ', 'movilizacion', 'movilización',
];

function isManifestation(title, description) {
  const text = normalizeString(`${title || ''} ${description || ''}`);
  return KEYWORDS_MANIFESTACION.some((k) => text.includes(normalizeString(k)));
}

/** Extrae fecha de published_at o del payload; estimación para start/end si no hay. */
function parseDates(pubDate, payload) {
  const d = pubDate ? new Date(pubDate) : (payload?.pubDate ? new Date(payload.pubDate) : null);
  if (!d || isNaN(d.getTime())) return { start_at: null, end_at: null };
  const start = new Date(d);
  const end = new Date(d);
  end.setHours(end.getHours() + 2);
  return { start_at: start.toISOString(), end_at: end.toISOString() };
}

export async function processNewsManifestationsExtract() {
  const runId = await startRun('news:manifestations:extract');
  let itemsIn = 0;
  let itemsUpserted = 0;
  const errors = [];

  try {
    const res = await query(
      `SELECT id, source_system, source_id, url, payload, fetched_at FROM landing_items WHERE entity_type = 'NEWS' AND processed_at IS NULL ORDER BY fetched_at DESC LIMIT 500`
    );
    const rows = res.rows;
    itemsIn = rows.length;

    for (const row of rows) {
      try {
        const payload = typeof row.payload === 'object' ? row.payload : (row.payload ? JSON.parse(row.payload) : {});
        const title = payload.title || '';
        const description = payload.description || '';

        if (!isManifestation(title, description)) {
          await query(`UPDATE landing_items SET processed_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
          continue;
        }

        const sourceId = `news-${row.source_system}-${row.source_id}`;
        const { start_at, end_at } = parseDates(null, payload);
        const hasTime = !!(start_at && end_at);
        const quality_status = null; // geom null por ahora → MED o LOW; HIGH cuando haya geocode
        const quality = hasTime ? 'MED' : 'LOW';

        const metadata = { evidence: row.url ? [row.url] : [], source: row.source_system };

        await query(
          `INSERT INTO incidentes (tipo, titulo, descripcion, fuente_principal, source_id, url, estado, start_at, end_at, geom_kind, confidence_geo, confidence_tipo, metadata, quality_status)
           VALUES ('MANIFESTACION', $1, $2, $3, $4, $5, 'ACTIVO', $6::timestamptz, $7::timestamptz, 'POINT', 50, 70, $8::jsonb, $9)
           ON CONFLICT (fuente_principal, source_id) WHERE source_id IS NOT NULL
           DO UPDATE SET titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, url = EXCLUDED.url, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, metadata = EXCLUDED.metadata, quality_status = EXCLUDED.quality_status, updated_at = now()`,
          [title || 'Manifestación (RSS)', (description || '').substring(0, 1000), FUENTE_PRINCIPAL, sourceId, row.url, start_at, end_at, JSON.stringify(metadata), quality]
        );
        itemsUpserted++;

        await query(`UPDATE landing_items SET processed_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
      } catch (err) {
        errors.push(`id=${row.id}: ${err.message}`);
      }
    }

    await endRun(runId, {
      status: errors.length > 0 && itemsUpserted === 0 ? 'failed' : 'ok',
      items_in: itemsIn,
      items_upserted: itemsUpserted,
      errors_count: errors.length,
      error_sample: errors[0] || null,
      meta: { errors: errors.slice(0, 5) },
    });
    return { itemsIn, itemsUpserted, errors };
  } catch (err) {
    await endRun(runId, { status: 'failed', error_sample: err.message });
    throw err;
  }
}
