/**
 * Adapter: fuentes para capas (calendario + contexto_eventos con taxonomía robusta).
 * Taxonomía: capasTaxonomy.classifyContextoEvento. Vigencia: ?active=1 | ?from=&to=
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/client.js';
import { classifyContextoEvento } from './capasTaxonomy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CALENDAR_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'calendario_obras_eventos.json');

function pointFeature(lng, lat, properties) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [parseFloat(lng), parseFloat(lat)],
    },
    properties,
  };
}

/** Convierte fecha a ISO o null. */
function toISO(d) {
  if (d == null) return null;
  try {
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x.toISOString();
  } catch (_) {
    return null;
  }
}

/** Filtro vigencia: activo = start <= now && (end null || end >= now) || start en [now, now+7d]. */
export function isActiveTemporal(startAt, endAt, now = new Date()) {
  const start = startAt ? new Date(startAt).getTime() : null;
  const end = endAt ? new Date(endAt).getTime() : null;
  const t = now.getTime();
  const t7 = t + 7 * 24 * 60 * 60 * 1000;
  if (start != null && end != null) return start <= t && end >= t;
  if (start != null && end == null) return start <= t7 && start >= t - 30 * 24 * 60 * 60 * 1000;
  return true;
}

/** Filtro rango: overlap con [from, to]. */
export function inTemporalRange(startAt, endAt, from, to) {
  if (!from && !to) return true;
  const start = startAt ? new Date(startAt).getTime() : 0;
  const end = endAt ? new Date(endAt).getTime() : start || Infinity;
  const f = from ? new Date(from).getTime() : 0;
  const t = to ? new Date(to).getTime() : Infinity;
  return start <= t && (end >= f || !endAt);
}

function readCalendario() {
  try {
    if (!fs.existsSync(CALENDAR_PATH)) return null;
    const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      obras: Array.isArray(data.obras) ? data.obras : [],
      eventos: Array.isArray(data.eventos) ? data.eventos : [],
      metadata: data.metadata || {},
    };
  } catch (err) {
    console.warn('[capasAdapter] readCalendario:', err.message);
    return null;
  }
}

/**
 * Obras desde calendario (con geometry). GeoJSON con start_at, end_at (ISO).
 */
export function getObrasFromCalendario() {
  const data = readCalendario();
  if (!data) return [];
  const conGeom = data.obras.filter((o) => o.geometry?.coordinates && o.geometry.coordinates.length >= 2);
  return conGeom.map((o, idx) => {
    const [lng, lat] = o.geometry.coordinates;
    return pointFeature(lng, lat, {
      id: o.id || `cal-obra-${idx}`,
      obra_id: o.id || null,
      node_id_externo: o.nodo_id || o.id || null,
      nombre: o.nombre || o.descripcion || null,
      direccion: null,
      entidad: o.entidad || null,
      estado: o.estado || null,
      fecha_ini: o.fecha_inicio,
      fecha_fin: o.fecha_fin,
      start_at: toISO(o.fecha_inicio),
      end_at: toISO(o.fecha_fin),
      source_time: toISO(o.timestamp),
      descripcion: o.descripcion || null,
      fuente: o.fuente || 'IDU',
      layerType: 'OBRAS',
    });
  });
}

/**
 * Eventos desde contexto_eventos con taxonomía (classifyContextoEvento).
 * Opciones: { active: 1 } | { from, to }. Propiedades: start_at, end_at (ISO), subtype.
 */
export async function getEventosFromContexto(options = {}) {
  try {
    const hasGeom = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'geom'`
    ).then((r) => r.rows[0]);
    if (!hasGeom) return [];

    const result = await query(`
      SELECT id, tipo, subtipo, descripcion, fecha_inicio, fecha_fin, fuente, url_remota, origen_id,
             ST_X(ST_Centroid(geom)::geometry) AS lng, ST_Y(ST_Centroid(geom)::geometry) AS lat
      FROM contexto_eventos
      WHERE geom IS NOT NULL
      ORDER BY fecha_inicio DESC NULLS LAST, id
    `);

    const now = new Date();
    const from = options.from || null;
    const to = options.to || null;
    const active = options.active === 1 || options.active === '1' || options.active === true;

    const features = [];
    for (const row of result.rows) {
      if (row.tipo === 'LUGAR_EVENTO' || row.fuente === 'AGENDATE_BOGOTA') continue;
      if (row.fecha_inicio == null || row.fecha_fin == null) continue;
      const classification = classifyContextoEvento(row);
      const startAt = toISO(row.fecha_inicio);
      const endAt = toISO(row.fecha_fin);
      if (active && !isActiveTemporal(row.fecha_inicio, row.fecha_fin, now)) continue;
      if (from || to) {
        if (!inTemporalRange(row.fecha_inicio, row.fecha_fin, from, to)) continue;
      }

      const layerType = classification.layer === 'MANIFESTACIONES' ? 'MANIFESTACIONES' : 'EVENTOS';
      features.push(
        pointFeature(row.lng, row.lat, {
          id: row.origen_id || String(row.id),
          evento_id: row.id,
          node_id_externo: row.origen_id || String(row.id),
          nombre: (row.descripcion || '').slice(0, 200) || null,
          direccion: null,
          tipo_evento: row.tipo || null,
          subtype: classification.subtype || null,
          fecha_ini: row.fecha_inicio,
          fecha_fin: row.fecha_fin,
          start_at: startAt,
          end_at: endAt,
          source_time: null,
          descripcion: row.descripcion || null,
          fuente: row.fuente || null,
          url_remota: row.url_remota || null,
          layerType,
        })
      );
    }
    return features;
  } catch (err) {
    console.warn('[capasAdapter] getEventosFromContexto:', err.message);
    return [];
  }
}

/** Filtra features por layerType. */
export function filterByLayerType(features, layerType) {
  return features.filter((f) => f.properties?.layerType === layerType);
}

export function getCalendarioCounts() {
  const data = readCalendario();
  if (!data) return { obras_count: 0, obras_con_coords: 0, eventos_count: 0, eventos_con_coords: 0 };
  const obrasConCoords = data.obras.filter((o) => o.geometry?.coordinates && o.geometry.coordinates.length >= 2).length;
  const eventosConCoords = data.eventos.filter((e) => e.geometry?.coordinates && e.geometry.coordinates.length >= 2).length;
  return {
    obras_count: data.obras.length,
    obras_con_coords: obrasConCoords,
    eventos_count: data.eventos.length,
    eventos_con_coords: eventosConCoords,
  };
}

export async function getContextoEventosCounts() {
  try {
    const r = await query(
      `SELECT tipo, COUNT(*) AS c FROM contexto_eventos GROUP BY tipo ORDER BY c DESC`
    );
    const byTipo = Object.fromEntries(r.rows.map((row) => [row.tipo, parseInt(row.c, 10)]));
    const conGeom = await query(
      `SELECT COUNT(*) AS c FROM contexto_eventos WHERE geom IS NOT NULL`
    ).then((res) => parseInt(res.rows[0]?.c ?? 0, 10));
    const total = await query(`SELECT COUNT(*) AS c FROM contexto_eventos`).then((res) =>
      parseInt(res.rows[0]?.c ?? 0, 10)
    );
    return { total, con_geom: conGeom, by_tipo: byTipo };
  } catch (err) {
    return { total: 0, con_geom: 0, by_tipo: {} };
  }
}
