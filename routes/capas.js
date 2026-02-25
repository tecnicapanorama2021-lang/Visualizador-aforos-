/**
 * Rutas por capa real: GeoJSON por capa.
 * Fuente única canónica: incidentes (obras/eventos/manifestaciones/conciertos).
 * Vigencia: ?active=1 | ?from=YYYY-MM-DD&to=YYYY-MM-DD. Propiedades: start_at, end_at (ISO).
 * Fallback: adapter/calendario si incidentes está vacío (deprecado).
 */

import express from 'express';
import { query } from '../server/db/client.js';
import {
  getEventosFromContexto,
  filterByLayerType,
  getObrasFromCalendario,
  isActiveTemporal,
  inTemporalRange,
} from '../server/utils/capasAdapter.js';

const router = express.Router();

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

function toISO(d) {
  if (d == null) return null;
  try {
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x.toISOString();
  } catch (_) {
    return null;
  }
}

/** Params temporales desde query. vigencia=activos|historico o active=1|0. */
function temporalOpts(req) {
  const vigencia = req.query.vigencia || (req.query.active === '1' || req.query.active === true ? 'activos' : 'historico');
  const active = vigencia === 'activos';
  const from = req.query.from || null;
  const to = req.query.to || null;
  const eventosFilter = req.query.eventos_filter || (active ? 'active' : 'historic');
  return { active: active ? 1 : 0, from, to, eventosFilter, vigencia };
}

/**
 * Lee incidentes de BD y devuelve GeoJSON FeatureCollection.
 * Soporta geometrías mixtas: Point, Polygon, LineString, Multi*.
 * properties.centroid se rellena con ST_PointOnSurface para no-Point.
 * @param {object} opts - { tipo, subtipo (opcional), layerType, temporal, geomMode?: 'centroid'|'full' }
 *   geomMode: 'centroid' => geometry = Point (centroide); 'full' => geometry = geom real. Si se pasa, se añaden en properties: centroid, bbox, geom_type, has_full_geometry.
 */
/**
 * Regla Waze: EVENTO solo si geom + start_at + end_at. LUGAR_EVENTO no es EVENTO (ya excluido en ingest).
 */
async function getIncidentesAsGeoJSON(opts) {
  const { tipo, subtipo = null, layerType, temporal, geomMode = null, onlyWithGeometry = false, onlyEnriched = false, qualityFilter = 'high' } = opts;
  const useGeomMode = geomMode === 'centroid' || geomMode === 'full';
  let sql = `
    SELECT id, tipo, subtipo, titulo, descripcion, fuente_principal, source_id, url, estado,
           start_at, end_at,
           ST_AsGeoJSON(geom)::json AS geom_json,
           ST_AsGeoJSON(ST_PointOnSurface(geom))::json AS centroid_geojson,
           confidence_geo, confidence_tipo
  `;
  if (tipo === 'OBRA') {
    sql += `,
           title, objetivo, ubicacion, entidad_name, localidad_name, estado_name, tipo_obra_name, cod_rel, cod_obra, upz, quality_status,
           (ST_GeometryType(geom) IS NOT NULL AND ST_GeometryType(geom) != 'ST_Point') AS has_full_geometry
    `;
  }
  if (tipo === 'MANIFESTACION') {
    sql += `, quality_status`;
  }
  if (useGeomMode) {
    sql += `,
           ST_XMin(ST_Envelope(geom)) AS xmin, ST_YMin(ST_Envelope(geom)) AS ymin,
           ST_XMax(ST_Envelope(geom)) AS xmax, ST_YMax(ST_Envelope(geom)) AS ymax,
           ST_GeometryType(geom) AS geom_type
    `;
  }
  sql += `
    FROM incidentes
    WHERE geom IS NOT NULL AND tipo = $1
  `;
  const params = [tipo];
  if (tipo === 'EVENTO') {
    sql += ` AND start_at IS NOT NULL AND end_at IS NOT NULL`;
  }
  if (subtipo) {
    sql += ` AND subtipo = $2`;
    params.push(subtipo);
  }
  if (tipo === 'OBRA' && qualityFilter === 'high') {
    sql += ` AND (quality_status IS NULL OR quality_status IN ('HIGH', 'MED'))`;
  }
  if (tipo === 'MANIFESTACION' && qualityFilter === 'high') {
    sql += ` AND (quality_status IS NULL OR quality_status IN ('HIGH', 'MED'))`;
  }
  if (tipo === 'OBRA' && onlyWithGeometry) {
    sql += ` AND ST_GeometryType(geom) != 'ST_Point'`;
  }
  if (tipo === 'OBRA' && onlyEnriched) {
    sql += ` AND metadata IS NOT NULL AND metadata->'arcgis'->'attributes_raw' IS NOT NULL AND jsonb_typeof(metadata->'arcgis'->'attributes_raw') = 'object' AND ((metadata->'arcgis'->'attributes_raw') ? 'titulo' OR (metadata->'arcgis'->'attributes_raw') ? 'objeto' OR (metadata->'arcgis'->'attributes_raw') ? 'entidad')`;
  }
  sql += ` ORDER BY id`;
  const result = await query(sql, params);
  const now = new Date();
  const nowMs = now.getTime();
  const in7d = nowMs + 7 * 24 * 60 * 60 * 1000;
  const features = result.rows.map((row) => {
    const geom = row.geom_json;
    if (!geom || !geom.type) return null;
    const coords = geom?.coordinates;
    let lng = null;
    let lat = null;
    if (geom.type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
      lng = coords[0];
      lat = coords[1];
    }
    const centroidGeo = row.centroid_geojson;
    if ((lng == null || lat == null) && centroidGeo?.type === 'Point' && Array.isArray(centroidGeo?.coordinates) && centroidGeo.coordinates.length >= 2) {
      lng = centroidGeo.coordinates[0];
      lat = centroidGeo.coordinates[1];
    }
    const props = {
      incidente_id: row.id,
      id: row.source_id,
      node_id_externo: row.source_id,
      tipo: row.tipo,
      subtipo: row.subtipo,
      estado: row.estado,
      start_at: toISO(row.start_at),
      end_at: toISO(row.end_at),
      confidence_geo: row.confidence_geo,
      fuente_principal: row.fuente_principal,
      url: row.url || null,
      titulo: row.titulo || null,
      descripcion: (row.descripcion || '').slice(0, 500) || null,
      nombre: row.titulo || null,
      layerType,
    };
    if (centroidGeo?.type === 'Point' && Array.isArray(centroidGeo?.coordinates) && centroidGeo.coordinates.length >= 2) {
      props.centroid = { type: 'Point', coordinates: centroidGeo.coordinates };
    }
    if (useGeomMode) {
      const { xmin, ymin, xmax, ymax, geom_type } = row;
      if ([xmin, ymin, xmax, ymax].every(Number.isFinite)) {
        props.bbox = { xmin, ymin, xmax, ymax };
      }
      if (geom_type != null) props.geom_type = geom_type;
      props.has_full_geometry = !!geom;
    }
    if (tipo === 'OBRA') {
      props.title = row.title ?? null;
      props.objetivo = row.objetivo ?? null;
      props.ubicacion = row.ubicacion ?? null;
      props.entidad_name = row.entidad_name ?? null;
      props.localidad_name = row.localidad_name ?? null;
      props.estado_name = row.estado_name ?? null;
      props.tipo_obra_name = row.tipo_obra_name ?? null;
      props.cod_rel = row.cod_rel ?? null;
      props.cod_obra = row.cod_obra ?? null;
      props.upz = row.upz ?? null;
      props.quality_status = row.quality_status ?? null;
      if (row.has_full_geometry != null) props.has_full_geometry = row.has_full_geometry;
    }
    if (tipo === 'MANIFESTACION') {
      props.quality_status = row.quality_status ?? null;
    }
    if (tipo === 'EVENTO' && temporal?.eventosFilter) {
      const start = row.start_at ? new Date(row.start_at).getTime() : null;
      const end = row.end_at ? new Date(row.end_at).getTime() : null;
      if (temporal.eventosFilter === 'active') {
        if (start == null || end == null || start > nowMs || end < nowMs) return null;
      } else if (temporal.eventosFilter === 'upcoming') {
        if (start == null || start <= nowMs || start > in7d) return null;
      } else if (temporal.eventosFilter === 'historic') {
        if (end == null || end >= nowMs) return null;
      }
    } else if (tipo === 'MANIFESTACION' && temporal?.vigencia === 'historico') {
      const end = row.end_at ? new Date(row.end_at).getTime() : null;
      if (end == null || end >= nowMs) return null;
    } else if (temporal?.active) {
      if (!isActiveTemporal(props.start_at, props.end_at, now)) return null;
    } else if (temporal?.from || temporal?.to) {
      if (!inTemporalRange(props.start_at, props.end_at, temporal.from, temporal.to)) return null;
    }
    const geometry = useGeomMode && geomMode === 'centroid' && centroidGeo?.type === 'Point' && Array.isArray(centroidGeo?.coordinates)
      ? centroidGeo
      : geom;
    const f = {
      type: 'Feature',
      geometry,
      properties: props,
    };
    return f;
  }).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

/** Comprueba si la tabla incidentes existe y tiene filas para un tipo. */
async function incidentesHasTipo(tipo) {
  try {
    const r = await query(`SELECT 1 FROM incidentes WHERE tipo = $1 LIMIT 1`, [tipo]);
    return r.rows.length > 0;
  } catch (_) {
    return false;
  }
}

/** Cuenta incidentes por tipo. Para EVENTO solo cuenta con geom + start_at + end_at (regla Waze). */
async function incidentesCountByTipo(tipo) {
  try {
    let sql = `SELECT COUNT(*) AS count FROM incidentes WHERE tipo = $1 AND geom IS NOT NULL`;
    if (tipo === 'EVENTO') sql += ` AND start_at IS NOT NULL AND end_at IS NOT NULL`;
    const r = await query(sql, [tipo]);
    return parseInt(r.rows[0]?.count ?? 0, 10);
  } catch (_) {
    return 0;
  }
}

/**
 * GET /api/obras/nodos
 * Fuente única: incidentes WHERE tipo='OBRA'. Fallback: obras_canonica + calendario (deprecado).
 * Query: geomMode=centroid (default) devuelve geometry Point; geomMode=full devuelve geometría real (Polygon/LineString).
 * Ver docs/OBRAS_GEOM_MODE.md para consumidores que necesiten geometría completa.
 */
/** Cache in-memory desvíos SIMUR por incidenteId. TTL 10 min. */
const desviosCache = new Map();
const DESVIOS_TTL_MS = 10 * 60 * 1000;

function getCachedDesvios(incidenteId) {
  const entry = desviosCache.get(incidenteId);
  if (!entry) return null;
  if (Date.now() - entry.ts > DESVIOS_TTL_MS) {
    desviosCache.delete(incidenteId);
    return null;
  }
  return entry.fc;
}

function setCachedDesvios(incidenteId, fc) {
  desviosCache.set(incidenteId, { fc, ts: Date.now() });
}

/**
 * GET /api/obras/:incidenteId/detail
 * Devuelve campos canónicos (title, objetivo, ubicacion, entidad_name, etc.) y feature.
 * attributes_raw solo en ?debug=1.
 */
router.get('/obras/:incidenteId/detail', async (req, res) => {
  const incidenteId = req.params.incidenteId?.trim();
  const debug = req.query.debug === '1' || req.query.debug === 'true';
  if (!incidenteId) return res.status(400).json({ error: 'incidenteId requerido' });
  try {
    const row = await query(
      `SELECT id, tipo, subtipo, titulo, descripcion, fuente_principal, source_id, url, estado,
              start_at, end_at, metadata,
              title, objetivo, ubicacion, entidad_name, localidad_name, estado_name, tipo_obra_name, cod_rel, cod_obra, upz, quality_status,
              (ST_GeometryType(geom) IS NOT NULL AND ST_GeometryType(geom) != 'ST_Point') AS has_full_geometry,
              ST_AsGeoJSON(geom)::json AS geom_json,
              ST_AsGeoJSON(ST_PointOnSurface(geom))::json AS centroid_json,
              ST_XMin(ST_Envelope(geom)) AS xmin, ST_YMin(ST_Envelope(geom)) AS ymin,
              ST_XMax(ST_Envelope(geom)) AS xmax, ST_YMax(ST_Envelope(geom)) AS ymax
       FROM incidentes WHERE id = $1 AND tipo = 'OBRA' LIMIT 1`,
      [incidenteId]
    ).then((r) => r.rows[0]);
    if (!row) return res.status(404).json({ error: 'Obra no encontrada' });

    const geom = row.geom_json;
    const centroid = row.centroid_json;
    const bbox = [row.xmin, row.ymin, row.xmax, row.ymax].every(Number.isFinite)
      ? { xmin: row.xmin, ymin: row.ymin, xmax: row.xmax, ymax: row.ymax }
      : null;

    const feature = {
      type: 'Feature',
      geometry: geom || null,
      properties: {
        incidente_id: row.id,
        tipo: row.tipo,
        subtipo: row.subtipo,
        titulo: row.titulo,
        descripcion: row.descripcion,
        fuente_principal: row.fuente_principal,
        source_id: row.source_id,
        url: row.url,
        estado: row.estado,
        start_at: toISO(row.start_at),
        end_at: toISO(row.end_at),
        layerType: 'OBRAS',
        centroid: centroid?.type === 'Point' && Array.isArray(centroid?.coordinates) ? { type: 'Point', coordinates: centroid.coordinates } : null,
        title: row.title ?? null,
        objetivo: row.objetivo ?? null,
        ubicacion: row.ubicacion ?? null,
        entidad_name: row.entidad_name ?? null,
        localidad_name: row.localidad_name ?? null,
        estado_name: row.estado_name ?? null,
        tipo_obra_name: row.tipo_obra_name ?? null,
        cod_rel: row.cod_rel ?? null,
        cod_obra: row.cod_obra ?? null,
        quality_status: row.quality_status ?? null,
        has_full_geometry: row.has_full_geometry ?? false,
        upz: row.upz ?? null,
      },
    };

    const payload = {
      feature,
      title: row.title ?? null,
      objetivo: row.objetivo ?? null,
      ubicacion: row.ubicacion ?? null,
      entidad_name: row.entidad_name ?? null,
      localidad_name: row.localidad_name ?? null,
      estado_name: row.estado_name ?? null,
      tipo_obra_name: row.tipo_obra_name ?? null,
      cod_rel: row.cod_rel ?? null,
      cod_obra: row.cod_obra ?? null,
      upz: row.upz ?? null,
      has_full_geometry: row.has_full_geometry ?? false,
      quality_status: row.quality_status ?? null,
      bbox,
      centroid: feature.properties.centroid,
    };
    if (debug && row.metadata?.arcgis?.attributes_raw) {
      payload._debug = { attributes_raw: row.metadata.arcgis.attributes_raw };
    }
    return res.json(payload);
  } catch (err) {
    console.error('[Capas] GET obras/:incidenteId/detail:', err.message);
    res.status(500).json({ error: 'Error al obtener detalle' });
  }
});

/**
 * GET /api/obras/:incidenteId/around
 * Capas ArcGIS "alrededor" de la obra (radius_m, layers por env). Devuelve { layerName: FeatureCollection }.
 * Env: OBRAS_AROUND_LAYERS (JSON array de { url, name }) o endpoint único. Si no hay config, devuelve {}.
 */
router.get('/obras/:incidenteId/around', async (req, res) => {
  const incidenteId = req.params.incidenteId?.trim();
  const radiusM = Math.min(Math.max(parseInt(req.query.radius_m, 10) || 500, 100), 5000);
  if (!incidenteId) return res.status(400).json({ error: 'incidenteId requerido' });
  try {
    let layersConfig = [];
    try {
      const raw = process.env.OBRAS_AROUND_LAYERS;
      if (raw) layersConfig = JSON.parse(raw);
      else if (process.env.OBRAS_AROUND_URL) {
        layersConfig = [{ url: process.env.OBRAS_AROUND_URL, name: 'around' }];
      }
    } catch (_) {
      return res.json({});
    }
    if (!Array.isArray(layersConfig) || layersConfig.length === 0) {
      return res.json({});
    }

    const bboxRow = await query(
      `SELECT ST_XMin(ST_Envelope(ST_Transform(ST_Buffer(geom::geography, $2), 4326))) AS xmin,
              ST_YMin(ST_Envelope(ST_Transform(ST_Buffer(geom::geography, $2), 4326))) AS ymin,
              ST_XMax(ST_Envelope(ST_Transform(ST_Buffer(geom::geography, $2), 4326))) AS xmax,
              ST_YMax(ST_Envelope(ST_Transform(ST_Buffer(geom::geography, $2), 4326))) AS ymax
       FROM incidentes WHERE id = $1 AND geom IS NOT NULL LIMIT 1`,
      [incidenteId, radiusM]
    ).then((r) => r.rows[0]);
    if (!bboxRow) return res.json({});

    const xmin = parseFloat(bboxRow.xmin);
    const ymin = parseFloat(bboxRow.ymin);
    const xmax = parseFloat(bboxRow.xmax);
    const ymax = parseFloat(bboxRow.ymax);
    if (!Number.isFinite(xmin + ymin + xmax + ymax)) return res.json({});

    const result = {};
    for (const layer of layersConfig) {
      const url = typeof layer === 'string' ? layer : layer.url;
      const name = (typeof layer === 'object' && layer.name) ? layer.name : `layer_${result.length}`;
      if (!url) continue;
      const queryUrl = url.includes('/query') ? url : `${url.replace(/\/?$/, '')}/query`;
      const params = new URLSearchParams({
        where: '1=1',
        returnGeometry: 'true',
        outFields: '*',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        geometryType: 'esriGeometryEnvelope',
        geometry: JSON.stringify({ xmin, ymin, xmax, ymax }),
        f: 'geojson',
      });
      try {
        const resp = await fetch(`${queryUrl}?${params.toString()}`, { headers: { Accept: 'application/json' } });
        const data = resp.ok ? await resp.json() : null;
        const fc = data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: Array.isArray(data?.features) ? data.features : [] };
        result[name] = fc;
      } catch (_) {
        result[name] = { type: 'FeatureCollection', features: [] };
      }
    }
    return res.json(result);
  } catch (err) {
    console.error('[Capas] GET obras/:incidenteId/around:', err.message);
    res.json({});
  }
});

/**
 * GET /api/obras/:incidenteId/desvios
 * Desvíos SIMUR PMT por obra: bbox del incidente, query espacial a ArcGIS, cache 10 min.
 */
router.get('/obras/:incidenteId/desvios', async (req, res) => {
  const incidenteId = req.params.incidenteId?.trim();
  if (!incidenteId) return res.status(400).json({ error: 'incidenteId requerido' });
  try {
    const cached = getCachedDesvios(incidenteId);
    if (cached) return res.json(cached);

    // Bbox del incidente. Para puntos, expandir más (0.01 ~1km) para que la query espacial a SIMUR devuelva desvíos cercanos.
    const bboxResult = await query(
      `SELECT ST_GeometryType(geom) AS gtype,
              ST_XMin(ST_Envelope(ST_Transform(ST_Expand(geom, 0.01), 4326))) AS xmin,
              ST_YMin(ST_Envelope(ST_Transform(ST_Expand(geom, 0.01), 4326))) AS ymin,
              ST_XMax(ST_Envelope(ST_Transform(ST_Expand(geom, 0.01), 4326))) AS xmax,
              ST_YMax(ST_Envelope(ST_Transform(ST_Expand(geom, 0.01), 4326))) AS ymax
       FROM incidentes WHERE id = $1 AND geom IS NOT NULL LIMIT 1`,
      [incidenteId]
    );
    const row = bboxResult.rows[0];
    if (!row) {
      const empty = { type: 'FeatureCollection', features: [] };
      return res.json(empty);
    }

    const xmin = parseFloat(row.xmin);
    const ymin = parseFloat(row.ymin);
    const xmax = parseFloat(row.xmax);
    const ymax = parseFloat(row.ymax);
    if (!Number.isFinite(xmin + ymin + xmax + ymax)) {
      const empty = { type: 'FeatureCollection', features: [] };
      return res.json(empty);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Capas DEV] desvios bbox', { incidenteId, xmin, ymin, xmax, ymax });
    }

    const baseUrl = process.env.SIMUR_DESVIOS_URL || 'https://sig.simur.gov.co/arcgis/rest/services/PMT/Desvios_Por_Obra/MapServer/0/query';
    const params = new URLSearchParams({
      where: '1=1',
      returnGeometry: 'true',
      outFields: '*',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      geometryType: 'esriGeometryEnvelope',
      geometry: JSON.stringify({ xmin, ymin, xmax, ymax }),
      f: 'geojson',
    });
    const url = `${baseUrl}?${params.toString()}`;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Capas DEV] desvios URL (sin token)', baseUrl);
      console.log('[Capas DEV] desvios params', Object.fromEntries(params.entries()));
    }
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      console.warn('[Capas] SIMUR desvíos no OK:', resp.status, incidenteId);
      const empty = { type: 'FeatureCollection', features: [] };
      return res.json(empty);
    }
    const data = await resp.json();
    if (process.env.NODE_ENV !== 'production') {
      const slice = {
        type: data?.type,
        featuresLength: Array.isArray(data?.features) ? data.features.length : 'n/a',
        hasError: !!data?.error,
        errorMessage: data?.error?.message ?? null,
      };
      console.log('[Capas DEV] desvios response slice', slice);
      if (data?.type !== 'FeatureCollection' && !Array.isArray(data?.features)) {
        console.warn('[Capas DEV] SIMUR no devolvió FeatureCollection; se devuelve vacío o features array. Keys:', data ? Object.keys(data) : []);
      }
    }
    // Si el servidor no soporta f=geojson, ArcGIS devuelve f=json con features[].geometry en formato esri;
    // aquí asumimos f=geojson; si fallara, se podría convertir esri → GeoJSON (esri-to-geojson) y documentar.
    const fc = data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: Array.isArray(data?.features) ? data.features : [] };
    setCachedDesvios(incidenteId, fc);
    res.json(fc);
  } catch (err) {
    console.error('[Capas] GET obras/:incidenteId/desvios:', err.message);
    res.json({ type: 'FeatureCollection', features: [] });
  }
});

router.get('/obras/nodos', async (req, res) => {
  try {
    const opts = temporalOpts(req);
    const geomMode = (req.query.geomMode === 'full' || req.query.geomMode === 'centroid') ? req.query.geomMode : 'centroid';
    const onlyWithGeometry = req.query.onlyWithGeometry === '1' || req.query.onlyWithGeometry === 'true';
    const onlyEnriched = req.query.onlyEnriched === '1' || req.query.onlyEnriched === 'true';
    const qualityFilter = req.query.quality === 'all' ? 'all' : 'high';
    if (await incidentesHasTipo('OBRA')) {
      const fc = await getIncidentesAsGeoJSON({
        tipo: 'OBRA',
        layerType: 'OBRAS',
        temporal: opts,
        geomMode,
        onlyWithGeometry,
        onlyEnriched,
        qualityFilter,
      });
      return res.json(fc);
    }
    // Fallback deprecado
    let result;
    try {
      result = await query(`
        SELECT id, source_system, source_id, titulo, descripcion, estado, entidad, fecha_ini, fecha_fin, fuente,
               ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat
        FROM obras_canonica
        WHERE geom IS NOT NULL
        ORDER BY id
      `);
    } catch (_) {
      result = { rows: [] };
    }
    const now = new Date();
    let features = result.rows.map((row) => ({
      ...pointFeature(row.lng, row.lat, {
        id: row.source_id,
        obra_id: row.id,
        node_id_externo: row.source_id,
        nombre: row.titulo || null,
        direccion: null,
        entidad: row.entidad || null,
        estado: row.estado || null,
        fecha_ini: row.fecha_ini,
        fecha_fin: row.fecha_fin,
        start_at: toISO(row.fecha_ini),
        end_at: toISO(row.fecha_fin),
        descripcion: row.descripcion || null,
        fuente: row.fuente || null,
        source_id: row.source_id,
        layerType: 'OBRAS',
      }),
    }));
    if (features.length === 0) {
      const fromCal = getObrasFromCalendario();
      features = fromCal.map((f) => ({ ...f }));
    }
    if (opts.active) {
      features = features.filter((f) => {
        const p = f.properties;
        return isActiveTemporal(p.start_at || p.fecha_ini, p.end_at || p.fecha_fin, now);
      });
    } else if (opts.from || opts.to) {
      features = features.filter((f) => {
        const p = f.properties;
        return inTemporalRange(p.start_at || p.fecha_ini, p.end_at || p.fecha_fin, opts.from, opts.to);
      });
    }
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Capas] GET obras/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener obras' });
  }
});

/**
 * GET /api/eventos/nodos
 * Fuente única: incidentes WHERE tipo='EVENTO'. Fallback: contexto_eventos cuando no hay canónicos.
 * POLÍTICA: cuando incidentes.tipo='EVENTO' > 0, NO usar fallback (evitar doble verdad).
 * Para poblar canónicos: npm run ingest:eventos:incidentes -- --apply
 */
router.get('/eventos/nodos', async (req, res) => {
  try {
    const opts = temporalOpts(req);
    opts.eventosFilter = opts.eventosFilter || 'active';
    const countCanonicos = await incidentesCountByTipo('EVENTO');
    const usoFallback = countCanonicos === 0;

    if (!usoFallback) {
      const fc = await getIncidentesAsGeoJSON({ tipo: 'EVENTO', layerType: 'EVENTOS', temporal: opts });
      return res.json(fc);
    }
    const now = new Date();
    const nowMs = now.getTime();
    const in7dMs = nowMs + 7 * 24 * 60 * 60 * 1000;
    let fallbackOpts = { active: 0, from: null, to: null };
    if (opts.eventosFilter === 'active') fallbackOpts = { active: 1, from: null, to: null };
    else if (opts.eventosFilter === 'upcoming') {
      fallbackOpts = { active: 0, from: now.toISOString().slice(0, 10), to: new Date(in7dMs).toISOString().slice(0, 10) };
    } else if (opts.eventosFilter === 'historic') {
      fallbackOpts = { active: 0, from: null, to: now.toISOString().slice(0, 10) };
    }
    let features = filterByLayerType(await getEventosFromContexto(fallbackOpts), 'EVENTOS');
    if (opts.eventosFilter === 'upcoming') {
      features = features.filter((f) => {
        const start = f.properties?.start_at ? new Date(f.properties.start_at).getTime() : null;
        return start != null && start > nowMs && start <= in7dMs;
      });
    } else if (opts.eventosFilter === 'historic') {
      features = features.filter((f) => {
        const end = f.properties?.end_at ? new Date(f.properties.end_at).getTime() : null;
        return end != null && end < nowMs;
      });
    }
    res.json({
      type: 'FeatureCollection',
      features,
      meta: { source: 'fallback_contexto_eventos', fallback: true },
    });
  } catch (err) {
    console.error('[Capas] GET eventos/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

/**
 * GET /api/manifestaciones/nodos
 * Fuente única: incidentes WHERE tipo='MANIFESTACION'. Fallback: contexto_eventos cuando no hay canónicos.
 * POLÍTICA: cuando incidentes.tipo='MANIFESTACION' > 0, NO usar fallback. Misma lógica que eventos.
 */
router.get('/manifestaciones/nodos', async (req, res) => {
  try {
    const opts = temporalOpts(req);
    const qualityFilter = req.query.quality === 'all' ? 'all' : 'high';
    const countCanonicos = await incidentesCountByTipo('MANIFESTACION');
    const usoFallback = countCanonicos === 0;

    if (!usoFallback) {
      const fc = await getIncidentesAsGeoJSON({
        tipo: 'MANIFESTACION',
        layerType: 'MANIFESTACIONES',
        temporal: opts,
        qualityFilter,
        geomMode: 'centroid',
      });
      return res.json(fc);
    }
    const all = await getEventosFromContexto({ active: opts.active ? 1 : 0, from: opts.from, to: opts.to });
    const features = filterByLayerType(all, 'MANIFESTACIONES');
    res.json({
      type: 'FeatureCollection',
      features,
      meta: { source: 'fallback_contexto_eventos', fallback: true },
    });
  } catch (err) {
    console.error('[Capas] GET manifestaciones/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener manifestaciones' });
  }
});

/**
 * GET /api/conciertos/nodos
 * Fuente única: incidentes WHERE tipo='EVENTO' AND subtipo='CONCIERTO'. Fallback: eventos_urbanos (deprecado).
 */
router.get('/conciertos/nodos', async (req, res) => {
  try {
    const opts = temporalOpts(req);
    const hasConciertos = await query(
      `SELECT 1 FROM incidentes WHERE tipo = 'EVENTO' AND subtipo = 'CONCIERTO' AND geom IS NOT NULL LIMIT 1`
    ).then((r) => r.rows.length > 0).catch(() => false);
    if (hasConciertos) {
      const fc = await getIncidentesAsGeoJSON({
        tipo: 'EVENTO',
        subtipo: 'CONCIERTO',
        layerType: 'CONCIERTOS',
        temporal: opts,
      });
      return res.json(fc);
    }
    const result = await query(`
      SELECT eu.id AS evento_id, eu.titulo, eu.fecha_ini, eu.fecha_fin, eu.zona_influencia_m, eu.descripcion, eu.fuente_url,
             n.id AS nodo_id, n.node_id_externo, n.nombre AS nodo_nombre, n.direccion,
             ST_X(n.geom::geometry) AS lng, ST_Y(n.geom::geometry) AS lat
      FROM eventos_urbanos eu
      JOIN nodos n ON n.id = eu.nodo_id
      WHERE n.geom IS NOT NULL AND eu.tipo_evento = 'CONCIERTO'
    `);
    const features = result.rows.map((row) =>
      pointFeature(row.lng, row.lat, {
        id: row.node_id_externo,
        evento_id: row.evento_id,
        nodo_id: row.nodo_id,
        node_id_externo: row.node_id_externo,
        nombre: row.titulo || row.nodo_nombre || null,
        nodo_nombre: row.nodo_nombre || null,
        direccion: row.direccion || null,
        fecha_ini: row.fecha_ini,
        fecha_fin: row.fecha_fin,
        start_at: toISO(row.fecha_ini),
        end_at: toISO(row.fecha_fin),
        zona_influencia_m: row.zona_influencia_m,
        descripcion: row.descripcion || null,
        fuente: row.fuente_url || null,
        layerType: 'CONCIERTOS',
      })
    );
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Capas] GET conciertos/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener conciertos' });
  }
});

/**
 * GET /api/semaforos/nodos
 * Tabla semaforos (020). notes: 'demo' si es único/demo.
 */
router.get('/semaforos/nodos', async (req, res) => {
  try {
    const result = await query(`
      SELECT s.id AS semaforo_id, s.codigo, s.estado_operativo, s.plan_semaforico, s.origen, s.descripcion,
             n.id AS nodo_id, n.node_id_externo, n.nombre AS nodo_nombre, n.direccion,
             ST_X(n.geom::geometry) AS lng, ST_Y(n.geom::geometry) AS lat
      FROM semaforos s
      JOIN nodos n ON n.id = s.nodo_id
      WHERE n.geom IS NOT NULL
    `);
    const isDemo = result.rows.length <= 1;
    const features = result.rows.map((row) =>
      pointFeature(row.lng, row.lat, {
        id: row.node_id_externo,
        semaforo_id: row.semaforo_id,
        nodo_id: row.nodo_id,
        node_id_externo: row.node_id_externo,
        nombre: row.nodo_nombre || row.codigo || null,
        nodo_nombre: row.nodo_nombre || null,
        direccion: row.direccion || null,
        codigo: row.codigo || null,
        estado_operativo: row.estado_operativo || null,
        plan_semaforico: row.plan_semaforico || null,
        origen: row.origen || null,
        descripcion: row.descripcion || null,
        layerType: 'SEMAFOROS',
        notes: isDemo ? 'demo' : null,
      })
    );
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Capas] GET semaforos/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener semáforos' });
  }
});

/**
 * GET /api/lugares/nodos
 * Venues/lugares (Agéndate): contexto_eventos tipo LUGAR_EVENTO, fuente AGENDATE_BOGOTA.
 * No son instancias temporales; no se incluyen en incidentes.
 */
router.get('/lugares/nodos', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, tipo, descripcion, fuente, datos_extra,
             ST_X(ST_Centroid(geom)::geometry) AS lng, ST_Y(ST_Centroid(geom)::geometry) AS lat
      FROM contexto_eventos
      WHERE tipo = 'LUGAR_EVENTO' AND fuente = 'AGENDATE_BOGOTA' AND geom IS NOT NULL
      ORDER BY id
    `);
    const features = result.rows.map((row) => {
      const extra = row.datos_extra && typeof row.datos_extra === 'object' ? row.datos_extra : {};
      return pointFeature(row.lng, row.lat, {
        id: row.id,
        source_id: row.id,
        titulo: (row.descripcion || '').slice(0, 500) || null,
        entidad: extra.entidad ?? extra.Entidad ?? null,
        tipo_lugar: row.tipo || 'LUGAR_EVENTO',
        fuente: row.fuente || 'AGENDATE_BOGOTA',
        nombre: (row.descripcion || '').slice(0, 200) || null,
        layerType: 'LUGARES',
      });
    });
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Capas] GET lugares/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener lugares' });
  }
});

/**
 * GET /api/base/nodos
 * Nodos sin estudios ni capas 020.
 */
router.get('/base/nodos', async (req, res) => {
  try {
    const result = await query(`
      SELECT n.id AS nodo_id, n.node_id_externo, n.nombre, n.direccion, n.fuente,
             ST_X(n.geom::geometry) AS lng, ST_Y(n.geom::geometry) AS lat
      FROM nodos n
      WHERE n.geom IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM obras o WHERE o.nodo_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM eventos_urbanos eu WHERE eu.nodo_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM semaforos s WHERE s.nodo_id = n.id)
    `);
    const features = result.rows.map((row) =>
      pointFeature(row.lng, row.lat, {
        id: row.node_id_externo,
        nodo_id: row.nodo_id,
        node_id_externo: row.node_id_externo,
        nombre: row.nombre || null,
        direccion: row.direccion || null,
        fuente: row.fuente || null,
        layerType: 'BASE',
      })
    );
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Capas] GET base/nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener nodos base' });
  }
});

export default router;
