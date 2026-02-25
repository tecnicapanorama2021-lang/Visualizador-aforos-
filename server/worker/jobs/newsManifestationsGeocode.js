/**
 * Job news:manifestations:geocode — Geocodifica manifestaciones NEWS_RSS con geom NULL (heurística v1).
 * Repeatable cada 15 min. Actualiza incidentes.geom, quality_status y metadata.geocode.
 */

import { query } from '../../db/client.js';
import { startRun, endRun } from '../../lib/ingestRuns.js';
import { geocodeFromText } from '../../lib/geocodeManifestationsV1.js';

export async function processNewsManifestationsGeocode() {
  const runId = await startRun('news:manifestations:geocode');
  let itemsIn = 0;
  let itemsUpserted = 0;
  const errors = [];

  try {
    const res = await query(
      `SELECT id, titulo, descripcion, start_at, end_at, metadata
       FROM incidentes
       WHERE tipo = 'MANIFESTACION' AND fuente_principal = 'NEWS_RSS' AND geom IS NULL
         AND created_at > now() - interval '7 days'
       ORDER BY id DESC
       LIMIT 200`
    );
    const rows = res.rows;
    itemsIn = rows.length;

    for (const row of rows) {
      try {
        const title = row.titulo || '';
        const desc = row.descripcion || '';
        const meta = typeof row.metadata === 'object' ? row.metadata : {};
        const evidence = Array.isArray(meta.evidence) ? meta.evidence.join(' ') : '';
        const text = [title, desc, evidence].filter(Boolean).join(' ');

        const result = geocodeFromText(text);
        if (!result || !result.geom) continue;

        const geomJson = JSON.stringify(result.geom);
        const hasTime = !!(row.start_at && row.end_at);
        const quality_status = hasTime ? 'HIGH' : 'MED';
        const geocodeMeta = {
          method: result.method,
          confidence: result.confidence,
          matched: result.matched,
          buffer_m: result.buffer_m,
          debug: result.debug,
        };

        await query(
          `UPDATE incidentes SET
             geom = ST_SetSRID(ST_GeomFromGeoJSON($1::jsonb), 4326),
             quality_status = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
             updated_at = now()
           WHERE id = $4`,
          [geomJson, quality_status, JSON.stringify({ geocode: geocodeMeta }), row.id]
        );
        itemsUpserted++;
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
