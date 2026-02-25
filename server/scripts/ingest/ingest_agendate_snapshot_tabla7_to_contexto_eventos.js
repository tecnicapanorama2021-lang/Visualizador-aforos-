/**
 * Ingesta idempotente: agendate_eventos_snapshot.json → contexto_eventos.
 * Fuente: AGENDATE_SNAPSHOT_TABLA7. Tipo: EVENTO_CULTURAL.
 * Venue matching contra LUGAR_EVENTO: solo KEY o NAME (nunca contains/localidad). Regla Waze: no inventar geom.
 *
 * Uso:
 *   node server/scripts/ingest/ingest_agendate_snapshot_tabla7_to_contexto_eventos.js --dry
 *   node server/scripts/ingest/ingest_agendate_snapshot_tabla7_to_contexto_eventos.js --apply
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';
import {
  normalizeForMatch,
  getVal,
  getPlaceKeyValue,
  runJoinDiagnosis,
  CANDIDATE_KEY_KEYS,
  CANDIDATE_NAME_KEYS_FOR_GEOM,
} from '../../utils/agendate_tabla7_join.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_snapshot.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const FUENTE_TABLA7 = 'AGENDATE_SNAPSHOT_TABLA7';
const FUENTE_RELATED = 'AGENDATE_ARCGIS_MANUAL_RELATED';
const JOIN_THRESHOLD = 70;

async function loadPlaces() {
  const hasUbicacion = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'ubicacion_texto'`
  ).then((r) => r.rows[0]);
  const titleExpr = hasUbicacion ? "COALESCE(ubicacion_texto, descripcion)" : "descripcion";
  const res = await query(`
    SELECT id, ${titleExpr} AS titulo, ST_AsText(geom) AS geom_wkt, datos_extra
    FROM contexto_eventos
    WHERE tipo = 'LUGAR_EVENTO' AND geom IS NOT NULL
  `);
  return res.rows;
}

/**
 * Construye índice de lugares según estrategia KEY o NAME (contains no permitido para geom).
 */
function buildIndexAndFinder(places, strategy, keyEventField, keyPlaceField, nameField) {
  const byKey = new Map();
  const byName = new Map();
  for (const p of places) {
    if (strategy === 'key' && keyPlaceField) {
      const v = getPlaceKeyValue(p.datos_extra, keyPlaceField);
      if (v) byKey.set(v, { id: p.id, geom_wkt: p.geom_wkt, titulo: p.titulo });
    }
    const name = (p.titulo || '').toString().trim();
    if (name) {
      const norm = normalizeForMatch(name);
      if (norm && !byName.has(norm)) byName.set(norm, { id: p.id, geom_wkt: p.geom_wkt, titulo: p.titulo });
    }
  }

  function findPlace(ev) {
    const raw = ev.raw || {};
    if (strategy === 'key' && keyEventField) {
      const key = getVal(raw, keyEventField) ?? ev.lugar_key;
      if (key) {
        const place = byKey.get(String(key).trim());
        if (place) return { ...place, match_method: 'key', match_score: 1 };
      }
    }
    if (strategy === 'name' && nameField) {
      const name = (getVal(raw, nameField) ?? ev.lugar_nombre ?? '').toString().trim();
      if (name) {
        const norm = normalizeForMatch(name);
        if (norm) {
          const place = byName.get(norm);
          if (place) return { ...place, match_method: 'name', match_score: 1 };
          for (const [k, v] of byName) {
            if (norm.includes(k) || k.includes(norm)) return { ...v, match_method: 'name', match_score: 1 };
          }
        }
      }
    }
    return null;
  }
  return findPlace;
}

/** Detecta qué candidatos tiene el evento en raw (para datos_extra cuando no hay join). */
function getCandidateDetected(raw) {
  const o = raw || {};
  const candidate_keys_detected = CANDIDATE_KEY_KEYS.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '');
  const candidate_names_detected = CANDIDATE_NAME_KEYS_FOR_GEOM.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '');
  const evloc = o.EVLOC ?? o.evloc ?? null;
  return { candidate_keys_detected, candidate_names_detected, evloc };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-tabla7] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  let snapshot;
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
    snapshot = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('[ingest-tabla7] No encontrado:', SNAPSHOT_PATH);
      console.error('  Ejecute antes: npm run import:agendate:tabla7:snapshot:apply');
    } else {
      console.error('[ingest-tabla7] Error leyendo snapshot:', err.message);
    }
    process.exit(1);
  }

  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const source = (snapshot.source || '').toString();
  const isRelated = source === FUENTE_RELATED;
  const FUENTE = isRelated ? FUENTE_RELATED : FUENTE_TABLA7;

  console.log('[ingest-tabla7] Eventos en snapshot:', events.length, '| source:', source || '(tabla7)');

  if (isRelated) {
    await runIngestRelated(events, apply, FUENTE);
    await closePool();
    return;
  }

  const places = await loadPlaces();
  console.log('[ingest-tabla7] Lugares (LUGAR_EVENTO) en BD:', places.length);

  const eventsAttrs = events.map((e) => e.raw || {});
  const placesForDiag = places.map((p) => ({ id: p.id, titulo: p.titulo, datos_extra: p.datos_extra }));
  const diagnosis = runJoinDiagnosis(eventsAttrs, placesForDiag);

  const invalidLocalidad = diagnosis.join_quality === 'INVALID_LOCALIDAD';
  const useKey = !invalidLocalidad && diagnosis.strategy === 'key' && diagnosis.bestKey >= JOIN_THRESHOLD;
  const useName = !invalidLocalidad && diagnosis.strategy === 'name' && diagnosis.bestName >= JOIN_THRESHOLD;
  const hasJoin = useKey || useName;

  if (invalidLocalidad) {
    console.log('[ingest-tabla7] join_quality = INVALID_LOCALIDAD. No se asigna geom (EVLOC/localidad prohibido por regla Waze).');
  }
  if (hasJoin) {
    console.log('[ingest-tabla7] Estrategia ganadora:', diagnosis.strategy, '(', (useKey ? diagnosis.bestKey : diagnosis.bestName).toFixed(1), '% )');
  } else if (!invalidLocalidad) {
    console.log('[ingest-tabla7] Sin join confiable (key/name <', JOIN_THRESHOLD, '%). Se insertarán eventos sin geom.');
  }
  if (!hasJoin) {
    console.log('[ingest-tabla7] Sugerencia: usar snapshot desde queryRelatedRecords o reingestar lugares con GlobalID/OBJECTID/EVNLUGAR en datos_extra.');
  }

  const findPlace = hasJoin
    ? buildIndexAndFinder(places, diagnosis.strategy, diagnosis.keyEventField, diagnosis.keyPlaceField, diagnosis.nameField)
    : () => null;

  let upserted = 0;
  let con_geom = 0;
  let sin_geom = 0;
  let matched_by_key = 0;
  let matched_by_name = 0;
  let sin_match = 0;
  let skipped_invalid_dates = 0;
  const reason_counts = { NO_JOIN_CONFIABLE: 0 };

  for (const ev of events) {
    const startAt = ev.start_at ? new Date(ev.start_at) : null;
    const endAt = ev.end_at ? new Date(ev.end_at) : null;
    if (!startAt || Number.isNaN(startAt.getTime())) {
      skipped_invalid_dates++;
      continue;
    }
    const place = findPlace(ev);
    if (place?.match_method === 'key') matched_by_key++;
    else if (place?.match_method === 'name') matched_by_name++;
    else sin_match++;
    const geomWkt = place?.geom_wkt || null;
    if (geomWkt) con_geom++;
    else sin_geom++;

    const raw = ev.raw || {};
    const { candidate_keys_detected, candidate_names_detected, evloc } = getCandidateDetected(raw);
    const reason = !place ? 'NO_JOIN_CONFIABLE' : null;
    if (reason) reason_counts.NO_JOIN_CONFIABLE++;

    const datosExtra = {
      ...raw,
      lugar_key: ev.lugar_key ?? null,
      lugar_nombre: ev.lugar_nombre ?? null,
      match_method: place?.match_method ?? 'none',
      match_score: place?.match_score ?? 0,
      matched_place_id: place?.id ?? null,
      ...(reason && {
        reason,
        evloc: evloc ?? null,
        candidate_keys_detected,
        candidate_names_detected,
      }),
    };

    if (!apply) continue;

    const descripcion = (ev.titulo || 'Evento sin nombre').toString().slice(0, 2000);
    const endAtVal = endAt && !Number.isNaN(endAt.getTime()) ? endAt.toISOString() : null;

    try {
      if (geomWkt) {
        const r = await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, datos_extra)
           VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_GeomFromText($5), 4326), $6, $7::jsonb)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, geom = EXCLUDED.geom, datos_extra = EXCLUDED.datos_extra`,
          [FUENTE, descripcion, startAt.toISOString(), endAtVal, geomWkt, ev.origen_id, JSON.stringify(datosExtra)]
        );
        if (r.rowCount > 0) upserted++;
      } else {
        const r = await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, origen_id, datos_extra)
           VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, $5, $6::jsonb)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, datos_extra = EXCLUDED.datos_extra, geom = NULL`,
          [FUENTE, descripcion, startAt.toISOString(), endAtVal, ev.origen_id, JSON.stringify(datosExtra)]
        );
        if (r.rowCount > 0) upserted++;
      }
    } catch (err) {
      console.warn('[ingest-tabla7] Upsert error', ev.origen_id, err.message);
    }
  }

  if (apply) {
    const total = await query(
      `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1`,
      [FUENTE]
    ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    const conGeomCount = await query(
      `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1 AND geom IS NOT NULL`,
      [FUENTE]
    ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    console.log('[ingest-tabla7] Total en BD (' + FUENTE + '):', total, '| con geom:', conGeomCount);
  }
  console.log('[ingest-tabla7] Resumen:');
  console.log('  total_events:', events.length);
  console.log('  skipped_invalid_dates:', skipped_invalid_dates);
  console.log('  con_geom:', con_geom);
  console.log('  sin_geom:', sin_geom);
  console.log('  matched_by_key:', matched_by_key);
  console.log('  matched_by_name:', matched_by_name);
  console.log('  sin_match:', sin_match);
  console.log('  reason_counts:', reason_counts);
  if (apply) console.log('  upserted:', upserted);
  else console.log('[ingest-tabla7] Dry-run. Para aplicar: ... --apply');
  await closePool();
}

/** Ingest para snapshot AGENDATE_ARCGIS_MANUAL_RELATED: geom desde lon/lat del evento. Sin match por nombre/localidad. */
async function runIngestRelated(events, apply, FUENTE) {
  let upserted = 0;
  let con_geom = 0;
  let skipped_no_coords = 0;
  let skipped_invalid_dates = 0;

  for (const ev of events) {
    const startAt = ev.fecha_inicio ? new Date(ev.fecha_inicio) : (ev.start_at ? new Date(ev.start_at) : null);
    const endAt = ev.fecha_fin ? new Date(ev.fecha_fin) : (ev.end_at ? new Date(ev.end_at) : null);
    if (!startAt || Number.isNaN(startAt.getTime())) {
      skipped_invalid_dates++;
      continue;
    }
    const lon = ev.lon != null ? Number(ev.lon) : null;
    const lat = ev.lat != null ? Number(ev.lat) : null;
    if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      skipped_no_coords++;
      continue;
    }
    con_geom++;

    const datosExtra = {
      ...(ev.raw || {}),
      lugar_nombre: ev.lugar_nombre ?? null,
      match_method: 'objectid',
      match_score: 1,
    };
    const descripcion = (ev.titulo || 'Evento sin nombre').toString().slice(0, 2000);
    const endAtVal = endAt && !Number.isNaN(endAt.getTime()) ? endAt.toISOString() : null;

    if (!apply) continue;

    try {
      const r = await query(
        `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, datos_extra)
         VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8::jsonb)
         ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
         DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, geom = EXCLUDED.geom, datos_extra = EXCLUDED.datos_extra`,
        [FUENTE, descripcion, startAt.toISOString(), endAtVal, lon, lat, ev.origen_id, JSON.stringify(datosExtra)]
      );
      if (r.rowCount > 0) upserted++;
    } catch (err) {
      console.warn('[ingest-tabla7] Upsert error', ev.origen_id, err.message);
    }
  }

  if (apply) {
    const total = await query(
      `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1`,
      [FUENTE]
    ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    const conGeomCount = await query(
      `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1 AND geom IS NOT NULL`,
      [FUENTE]
    ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    console.log('[ingest-tabla7] Total en BD (' + FUENTE + '):', total, '| con geom:', conGeomCount);
  }
  console.log('[ingest-tabla7] Resumen (related):');
  console.log('  total_events:', events.length);
  console.log('  skipped_invalid_dates:', skipped_invalid_dates);
  console.log('  skipped_no_coords:', skipped_no_coords);
  console.log('  con_geom:', con_geom);
  if (apply) console.log('  upserted:', upserted);
}

main().catch((err) => {
  console.error('[ingest-tabla7]', err);
  process.exit(1);
});
