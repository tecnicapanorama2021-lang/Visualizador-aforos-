/**
 * Importa eventos desde public/data/eventos_bogota_2026_completo.json a contexto_eventos.
 * Georreferencia por match a LUGAR_EVENTO existentes en BD. Fuente: BOGOTA_GOV_MANUAL_2026.
 *
 * Uso:
 *   node server/scripts/import/import_eventos_bogota_json_to_contexto_eventos.js [--dry]
 *   node server/scripts/import/import_eventos_bogota_json_to_contexto_eventos.js --apply
 *
 * ENV: EVENTOS_BOGOTA_DEFAULT_DURACION_H, EVENTOS_BOGOTA_FUENTE, EVENTOS_BOGOTA_SRID
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const JSON_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'eventos_bogota_2026_completo.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DEFAULT_DURACION_H = parseInt(process.env.EVENTOS_BOGOTA_DEFAULT_DURACION_H || '3', 10) || 3;
const FUENTE = process.env.EVENTOS_BOGOTA_FUENTE || 'BOGOTA_GOV_MANUAL_2026';
const SRID = parseInt(process.env.EVENTOS_BOGOTA_SRID || '4326', 10) || 4326;

/** Quitar tildes (NFC normalización + reemplazo). */
const TILDES = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ú: 'u', Ñ: 'n' };
function removeTildes(s) {
  return s.replace(/[áéíóúñÁÉÍÓÚÑ]/g, (c) => TILDES[c] ?? c);
}

/** Normalizar: lower, trim, sin tildes, colapsar espacios, quitar signos (no alfanum). */
function normalize(s) {
  if (s == null || typeof s !== 'string') return '';
  let t = s.toLowerCase().trim();
  t = removeTildes(t);
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/[^\w\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Tokens significativos: longitud >= 4 (para contains match). */
function tokensSignificativos(s) {
  return normalize(s).split(/\s+/).filter((t) => t.length >= 4);
}

/** start_at en ISO local (YYYY-MM-DDTHH:mm:00). */
function buildStartAt(fechaInicio, horaInicio) {
  const date = (fechaInicio || '').slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = horaInicio ? String(horaInicio).trim().slice(0, 5) : null;
  const timePart = time && /^\d{1,2}:\d{2}$/.test(time) ? `${time}:00` : '12:00:00';
  return `${date}T${timePart}`;
}

/** end_at: si misma fecha => start + N h; si otra fecha => fecha_fin T23:00:00; si no fecha_fin => start + N h. */
function buildEndAt(startAtIso, fechaFin, fechaInicio) {
  if (!startAtIso) return null;
  const start = new Date(startAtIso);
  if (!Number.isFinite(start.getTime())) return null;
  const finDate = (fechaFin || '').slice(0, 10);
  if (!finDate || finDate !== fechaInicio?.slice(0, 10)) {
    if (finDate && /^\d{4}-\d{2}-\d{2}$/.test(finDate)) return `${finDate}T23:00:00`;
    const end = new Date(start.getTime() + DEFAULT_DURACION_H * 60 * 60 * 1000);
    return end.toISOString().slice(0, 19).replace('T', 'T');
  }
  const end = new Date(start.getTime() + DEFAULT_DURACION_H * 60 * 60 * 1000);
  return end.toISOString().slice(0, 19).replace('T', 'T');
}

/** origen_id estable: sha256(lower(titulo)|start_at_iso|lower(lugar_nombre)).slice(0,32) */
function stableOrigenId(titulo, startAtIso, lugarNombre) {
  const str = `${(titulo || '').toLowerCase()}|${startAtIso || ''}|${(lugarNombre || '').toLowerCase()}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

async function loadLugaresIndex() {
  const r = await query(`
    SELECT id, descripcion AS titulo, ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM contexto_eventos
    WHERE tipo = 'LUGAR_EVENTO' AND geom IS NOT NULL
  `);
  const byKey = new Map();
  const byTokens = [];
  for (const row of r.rows || []) {
    const key = normalize(row.titulo);
    if (key) {
      byKey.set(key, { id: row.id, lon: parseFloat(row.lon), lat: parseFloat(row.lat) });
      byTokens.push({
        key,
        tokens: tokensSignificativos(row.titulo),
        id: row.id,
        lon: parseFloat(row.lon),
        lat: parseFloat(row.lat),
      });
    }
  }
  return { byKey, byTokens };
}

/** Match: exacto por clave normalizada; si no, contains (≥2 tokens significativos en común). */
function matchPlace(lugarNombre, { byKey, byTokens }) {
  const key = normalize(lugarNombre);
  if (!key) return { method: 'none', id: null, lon: null, lat: null };
  const exact = byKey.get(key);
  if (exact) return { method: 'exact', id: exact.id, lon: exact.lon, lat: exact.lat };
  const evTokens = tokensSignificativos(lugarNombre);
  if (evTokens.length < 2) return { method: 'none', id: null, lon: null, lat: null };
  const evSet = new Set(evTokens);
  for (const place of byTokens) {
    if (place.tokens.length < 2) continue;
    const placeSet = new Set(place.tokens);
    const matchCount = place.tokens.filter((t) => evSet.has(t)).length;
    const evInPlace = evTokens.filter((t) => placeSet.has(t)).length;
    if (matchCount >= 2 || evInPlace >= 2) return { method: 'contains', id: place.id, lon: place.lon, lat: place.lat };
  }
  return { method: 'none', id: null, lon: null, lat: null };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dry = !apply;

  let raw;
  try {
    raw = await fs.readFile(JSON_PATH, 'utf8');
  } catch (err) {
    console.error('[import-eventos-bogota] No se pudo leer', JSON_PATH, err.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('[import-eventos-bogota] JSON inválido:', err.message);
    process.exit(1);
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  const totalEvents = events.length;
  console.log('[import-eventos-bogota] total_events:', totalEvents);

  if (totalEvents === 0) {
    await closePool();
    process.exit(0);
  }

  let lugaresIndex = { byKey: new Map(), byTokens: [] };
  try {
    const hasTable = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
    ).then((r) => r.rows[0]);
    if (hasTable) {
      lugaresIndex = await loadLugaresIndex();
      console.log('[import-eventos-bogota] LUGAR_EVENTO en BD:', lugaresIndex.byKey.size);
    }
  } catch (err) {
    if (!dry) {
      console.error('[import-eventos-bogota] BD requerida para --apply:', err.message);
      await closePool();
      process.exit(1);
    }
    console.warn('[import-eventos-bogota] Sin BD en dry; match stats serán none.');
  }


  const stats = {
    con_fecha_ok: 0,
    con_geom: 0,
    sin_geom: 0,
    matched_exact: 0,
    matched_contains: 0,
    matched_none: 0,
    inserted: 0,
    updated: 0,
  };

  for (const ev of events) {
    const fechaInicio = ev.fecha_inicio != null ? String(ev.fecha_inicio).trim() : null;
    const startAtIso = buildStartAt(fechaInicio, ev.hora_inicio);
    if (!startAtIso) continue;
    const endAtIso = buildEndAt(startAtIso, ev.fecha_fin, fechaInicio);
    if (!endAtIso) continue;
    stats.con_fecha_ok++;

    const lugarNombre = ev.lugar_nombre != null ? String(ev.lugar_nombre).trim() : '';
    const match = matchPlace(lugarNombre, lugaresIndex);
    if (match.method === 'exact') stats.matched_exact++;
    else if (match.method === 'contains') stats.matched_contains++;
    else stats.matched_none++;

    const hasGeom = match.lon != null && match.lat != null && Number.isFinite(match.lon) && Number.isFinite(match.lat);
    if (hasGeom) stats.con_geom++;
    else stats.sin_geom++;

    if (dry) continue;

    const origenId = stableOrigenId(ev.titulo, startAtIso, lugarNombre);
    const descripcion = (ev.titulo != null ? String(ev.titulo) : '').slice(0, 500) || null;
    const datosExtra = {
      match_method: match.method,
      matched_place_id: match.id,
      raw_source: ev,
      ...(ev.descripcion != null ? { descripcion: ev.descripcion } : {}),
    };
    const startAtTs = new Date(startAtIso).toISOString();
    const endAtTs = new Date(endAtIso).toISOString();
    const urlRemota = ev.enlace_fuente != null ? String(ev.enlace_fuente).slice(0, 2048) : null;
    const subtipo = ev.tipo_evento != null ? String(ev.tipo_evento).slice(0, 100) : null;

    const existing = await query(
      `SELECT id FROM contexto_eventos WHERE origen_id = $1 AND fuente = $2`,
      [origenId, FUENTE]
    ).then((r) => r.rows[0]);

    if (hasGeom) {
      const wkt = `POINT(${match.lon} ${match.lat})`;
      await query(
        `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota, datos_extra, subtipo)
         VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_GeomFromText($5), $6), $7, $8, $9::jsonb, $10)
         ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
         DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin,
           geom = EXCLUDED.geom, url_remota = EXCLUDED.url_remota, datos_extra = EXCLUDED.datos_extra, subtipo = EXCLUDED.subtipo`,
        [FUENTE, descripcion, startAtTs, endAtTs, wkt, SRID, origenId, urlRemota, JSON.stringify(datosExtra), subtipo]
      );
    } else {
      await query(
        `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota, datos_extra, subtipo)
         VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, NULL, $5, $6, $7::jsonb, $8)
         ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
         DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin,
           geom = EXCLUDED.geom, url_remota = EXCLUDED.url_remota, datos_extra = EXCLUDED.datos_extra, subtipo = EXCLUDED.subtipo`,
        [FUENTE, descripcion, startAtTs, endAtTs, origenId, urlRemota, JSON.stringify(datosExtra), subtipo]
      );
    }
    if (existing) stats.updated++;
    else stats.inserted++;
  }

  console.log('[import-eventos-bogota] con_fecha_ok:', stats.con_fecha_ok);
  console.log('[import-eventos-bogota] con_geom:', stats.con_geom, '| sin_geom:', stats.sin_geom);
  console.log('[import-eventos-bogota] matched_exact:', stats.matched_exact, '| matched_contains:', stats.matched_contains, '| matched_none:', stats.matched_none);
  console.log('[import-eventos-bogota] inserted:', stats.inserted, '| updated:', stats.updated);
  if (dry) console.log('[import-eventos-bogota] Modo --dry. Para escribir BD: node ... --apply');
  await closePool();
}

main().catch((err) => {
  console.error('[import-eventos-bogota]', err.message);
  process.exit(1);
});
