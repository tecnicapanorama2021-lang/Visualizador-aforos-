/**
 * GET /api/nodos/:nodeId/estudios, /layers, /aforos, /obras, /eventos, /semaforos
 * GET /api/nodos/search?q=...&limit=10 — búsqueda server-side (pg_trgm), GeoJSON FeatureCollection.
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

/**
 * GET /api/nodos/search?q=...&limit=10
 * Búsqueda por nombre, direccion, node_id_externo (ILIKE). Devuelve GeoJSON FeatureCollection de Points.
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  if (!q) {
    return res.json({ type: 'FeatureCollection', features: [] });
  }
  try {
    const pattern = `%${q}%`;
    const result = await query(
      `SELECT id, node_id_externo, nombre, direccion, fuente,
              ST_AsGeoJSON(geom)::json AS geom_json
       FROM nodos
       WHERE geom IS NOT NULL
         AND (nombre ILIKE $1 OR direccion ILIKE $1 OR node_id_externo ILIKE $1)
       ORDER BY nombre NULLS LAST
       LIMIT $2`,
      [pattern, limit]
    );
    const features = result.rows.map((row) => {
      const geom = row.geom_json;
      const coords = geom?.type === 'Point' && Array.isArray(geom?.coordinates) ? geom.coordinates : null;
      const lng = coords?.[0];
      const lat = coords?.[1];
      if (lng == null || lat == null) return null;
      const props = {
        id: row.node_id_externo,
        node_id_externo: row.node_id_externo,
        nombre: row.nombre || null,
        direccion: row.direccion || null,
        fuente: row.fuente || null,
        centroid: { type: 'Point', coordinates: [lng, lat] },
      };
      return {
        type: 'Feature',
        geometry: geom || { type: 'Point', coordinates: [lng, lat] },
        properties: props,
      };
    }).filter(Boolean);
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Nodos] GET search:', err.message);
    res.json({ type: 'FeatureCollection', features: [] });
  }
});

async function resolveNode(nodeId) {
  const nodoRes = await query(
    `SELECT id, node_id_externo, direccion, nombre, fuente FROM nodos
     WHERE node_id_externo = $1 OR nombre = $1 OR direccion ILIKE $2 OR nombre ILIKE $2
     LIMIT 1`,
    [nodeId, `%${nodeId}%`]
  );
  return nodoRes.rows[0] || null;
}

function mapEstudio(e) {
  const date = e.fecha_inicio ? new Date(e.fecha_inicio).toISOString().slice(0, 10) : null;
  const dateEnd = e.fecha_fin ? new Date(e.fecha_fin).toISOString().slice(0, 10) : date;
  const fileId = e.file_id_dim != null ? String(e.file_id_dim) : null;
  const downloadurl = fileId ? `/api/aforos/descargar/${encodeURIComponent(fileId)}` : (e.download_url || null);
  const dimId = fileId && /^\d+$/.test(fileId) ? fileId : null;
  return {
    id: e.id,
    file_id: fileId != null ? parseInt(fileId, 10) : null,
    fileid: fileId,
    dim_id: dimId,
    date,
    date_end: dateEnd,
    type: e.tipo_estudio || 'Volúmen vehicular',
    contractors: e.contratista ? [e.contratista] : [],
    downloadurl,
  };
}

/**
 * GET /api/nodos/:nodeId/layers
 * Detalle on-demand: node + layers (aforos, obras, eventos, semaforos).
 */
router.get('/:nodeId/layers', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodo = await resolveNode(nodeId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

    const [estudiosRes, obrasRes, eventosRes, semaforosRes] = await Promise.all([
      query('SELECT id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, download_url, contratista FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio DESC', [nodo.id]),
      query('SELECT id, titulo, entidad, estado, fecha_ini, fecha_fin, impacto, descripcion, fuente_url FROM obras WHERE nodo_id = $1 ORDER BY fecha_ini DESC NULLS LAST', [nodo.id]),
      query('SELECT id, tipo_evento, titulo, fecha_ini, fecha_fin, zona_influencia_m, descripcion, fuente_url FROM eventos_urbanos WHERE nodo_id = $1 ORDER BY fecha_ini DESC NULLS LAST', [nodo.id]),
      query('SELECT id, codigo, estado_operativo, plan_semaforico, origen, descripcion FROM semaforos WHERE nodo_id = $1', [nodo.id]),
    ]);

    const estudios = estudiosRes.rows.map(mapEstudio);
    const obras = obrasRes.rows.map((o) => ({
      id: o.id,
      titulo: o.titulo,
      entidad: o.entidad,
      estado: o.estado,
      fecha_ini: o.fecha_ini,
      fecha_fin: o.fecha_fin,
      impacto: o.impacto,
      descripcion: o.descripcion,
      fuente_url: o.fuente_url,
    }));
    const eventos = eventosRes.rows.map((ev) => ({
      id: ev.id,
      tipo_evento: ev.tipo_evento,
      titulo: ev.titulo,
      fecha_ini: ev.fecha_ini,
      fecha_fin: ev.fecha_fin,
      zona_influencia_m: ev.zona_influencia_m,
      descripcion: ev.descripcion,
      fuente_url: ev.fuente_url,
    }));
    const semaforos = semaforosRes.rows.map((s) => ({
      id: s.id,
      codigo: s.codigo,
      estado_operativo: s.estado_operativo,
      plan_semaforico: s.plan_semaforico,
      origen: s.origen,
      descripcion: s.descripcion,
    }));

    res.json({
      node: {
        id: nodo.id,
        node_id_externo: nodo.node_id_externo,
        nombre: nodo.nombre,
        direccion: nodo.direccion,
        fuente: nodo.fuente,
      },
      layers: {
        aforos: { has: estudios.length > 0, estudios },
        obras,
        eventos,
        semaforos,
      },
    });
  } catch (err) {
    console.error('[Nodos] GET layers:', err.message);
    res.status(500).json({ error: 'Error al obtener capas del nodo' });
  }
});

/**
 * GET /api/nodos/:nodeId/aforos
 */
router.get('/:nodeId/aforos', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodo = await resolveNode(nodeId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
    const r = await query('SELECT id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, download_url, contratista FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio DESC', [nodo.id]);
    res.json({ has: r.rows.length > 0, estudios: r.rows.map(mapEstudio) });
  } catch (err) {
    console.error('[Nodos] GET aforos:', err.message);
    res.status(500).json({ error: 'Error al obtener aforos' });
  }
});

/**
 * GET /api/nodos/:nodeId/obras
 */
router.get('/:nodeId/obras', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodo = await resolveNode(nodeId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
    const r = await query('SELECT id, titulo, entidad, estado, fecha_ini, fecha_fin, impacto, descripcion, fuente_url FROM obras WHERE nodo_id = $1 ORDER BY fecha_ini DESC NULLS LAST', [nodo.id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[Nodos] GET obras:', err.message);
    res.status(500).json({ error: 'Error al obtener obras' });
  }
});

/**
 * GET /api/nodos/:nodeId/eventos
 */
router.get('/:nodeId/eventos', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodo = await resolveNode(nodeId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
    const r = await query('SELECT id, tipo_evento, titulo, fecha_ini, fecha_fin, zona_influencia_m, descripcion, fuente_url FROM eventos_urbanos WHERE nodo_id = $1 ORDER BY fecha_ini DESC NULLS LAST', [nodo.id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[Nodos] GET eventos:', err.message);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

/**
 * GET /api/nodos/:nodeId/semaforos
 */
router.get('/:nodeId/semaforos', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodo = await resolveNode(nodeId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
    const r = await query('SELECT id, codigo, estado_operativo, plan_semaforico, origen, descripcion FROM semaforos WHERE nodo_id = $1', [nodo.id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[Nodos] GET semaforos:', err.message);
    res.status(500).json({ error: 'Error al obtener semáforos' });
  }
});

/**
 * GET /api/nodos/:nodeId/impacto
 * Motor de influencia: señales activas que afectan el nodo (ST_DWithin) y factor total.
 */
router.get('/:nodeId/impacto', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodoWithGeom = await query(
      `SELECT id, node_id_externo, geom FROM nodos
       WHERE (node_id_externo = $1 OR nombre = $1 OR direccion ILIKE $2 OR nombre ILIKE $2) AND geom IS NOT NULL
       LIMIT 1`,
      [nodeId, `%${nodeId}%`]
    ).then((r) => r.rows[0]);
    if (!nodoWithGeom) return res.status(404).json({ error: 'Nodo no encontrado' });

    const hasImpactoTable = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'eventos_impacto'`
    ).then((r) => r.rows[0]);
    if (!hasImpactoTable) {
      return res.json({ factor_total: 1, senales_aplicadas: [] });
    }

    const bufferH = 2;
    const now = new Date();
    const nowMinus2h = new Date(now.getTime() - bufferH * 3600000).toISOString();
    const nowPlus2h = new Date(now.getTime() + bufferH * 3600000).toISOString();

    const senales = await query(
      `SELECT
        i.id AS incidente_id,
        i.tipo,
        i.titulo,
        ei.impacto_nivel,
        ei.impacto_radio_m,
        ei.impacto_factor
       FROM incidentes i
       JOIN eventos_impacto ei ON ei.incidente_id = i.id
       WHERE i.geom IS NOT NULL
         AND i.start_at IS NOT NULL
         AND i.end_at IS NOT NULL
         AND i.start_at <= $1::timestamptz
         AND i.end_at >= $2::timestamptz
         AND ST_DWithin(
           i.geom::geography,
           (SELECT geom::geography FROM nodos WHERE id = $3 LIMIT 1),
           ei.impacto_radio_m
         )`,
      [nowPlus2h, nowMinus2h, nodoWithGeom.id]
    );

    const rows = senales.rows;
    let factorTotal = 1;
    const senales_aplicadas = rows.map((row) => {
      const f = parseFloat(row.impacto_factor);
      factorTotal *= f;
      return {
        incidente_id: row.incidente_id,
        tipo: row.tipo,
        titulo: row.titulo || null,
        impacto_nivel: row.impacto_nivel,
        impacto_factor: f,
      };
    });
    factorTotal = Math.round(factorTotal * 100) / 100;

    res.json({ factor_total: factorTotal, senales_aplicadas });
  } catch (err) {
    console.error('[Nodos] GET impacto:', err.message);
    res.status(500).json({ error: 'Error al calcular impacto del nodo' });
  }
});

/**
 * GET /api/nodos/:nodeId/estudios
 * Respuesta: { address, studies: [ { file_id, date, date_end, type, contractors, downloadurl } ] }
 */
router.get('/:nodeId/estudios', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });

  try {
    const nodo = await resolveNode(nodeId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

    const estudiosRes = await query(
      `SELECT id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, download_url, contratista
       FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio DESC`,
      [nodo.id]
    );
    const address = nodo.direccion || nodo.nombre || nodeId;
    const studies = estudiosRes.rows.map(mapEstudio);

    res.json({ address, studies });
  } catch (err) {
    console.error('[Nodos] Error estudios:', err.message);
    res.status(500).json({ error: 'Error al obtener estudios del nodo' });
  }
});

export default router;
