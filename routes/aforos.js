/**
 * Rutas de aforos que leen desde PostgreSQL.
 * :nodeId se interpreta como node_id_externo (ej. "171", "136") para compatibilidad con el front.
 */

import express from 'express';
import { query } from '../server/db/client.js';
import { normalizeSentido } from '../server/utils/normalizeSentido.js';
import { normalizeClaseVehiculo } from '../server/utils/normalizeClaseVehiculo.js';

const router = express.Router();

/** Etiquetas de clase para respuesta API (convención IDU: Autos, no Livianos). */
const VOL_KEY_TO_LABEL = [
  { key: 'vol_autos', label: 'Autos' },
  { key: 'vol_motos', label: 'Motos' },
  { key: 'vol_buses', label: 'Buses' },
  { key: 'vol_pesados', label: 'Camiones' },
  { key: 'vol_bicis', label: 'Bicicletas' },
  { key: 'vol_otros', label: 'Otros' },
];

/**
 * GET /api/aforos/historial/:nodeId
 * Devuelve el mismo shape que antes (historial.nodes[nodeId]): node_id, address, historico, estadisticas.
 */
router.get('/historial/:nodeId', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });

  try {
    // Buscar nodo por node_id_externo, nombre o dirección (el front puede enviar cualquiera)
    const nodoRes = await query(
      `SELECT
        n.id, n.node_id_externo, n.nombre, n.direccion,
        n.via_principal, n.via_secundaria,
        u.nombre  AS upz_nombre,
        u.codigo  AS upz_codigo,
        l.nombre  AS localidad_nombre,
        l.codigo  AS localidad_codigo
       FROM nodos n
       LEFT JOIN upz u         ON n.upz_id = u.id
       LEFT JOIN localidades l ON n.localidad_id = l.id
       WHERE n.node_id_externo = $1
          OR n.nombre = $1
          OR n.direccion ILIKE $2
          OR n.nombre ILIKE $2
       LIMIT 1`,
      [nodeId, `%${nodeId}%`]
    );
    const nodo = nodoRes.rows[0];
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado en historial' });

    const estudiosRes = await query(
      `SELECT id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, download_url, contratista, total_records, vehicle_types
       FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio`,
      [nodo.id]
    );
    const estudios = estudiosRes.rows;

    const historico = [];
    const classHeaders = VOL_KEY_TO_LABEL.map(({ key }) => ({
      key,
      label: normalizeClaseVehiculo(key) || key,
    }));

    for (const e of estudios) {
      const conteosRes = await query(
        `SELECT sentido, intervalo_ini, intervalo_fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros
         FROM conteos_resumen WHERE estudio_id = $1 ORDER BY intervalo_ini`,
        [e.id]
      );
      const conteos = conteosRes.rows;

      const fechaStr = e.fecha_inicio ? new Date(e.fecha_inicio).toISOString().slice(0, 10) : null;
      const distribucion_hora_pico = [];
      let volumen_total_pico = 0;
      const bySentido = new Map();
      const byInterval = new Map();

      for (const c of conteos) {
        volumen_total_pico += c.vol_total || 0;
        const sent = normalizeSentido(c.sentido || 'N/A');
        const prev = bySentido.get(sent) || { sentido: sent, total: 0, vol_autos: 0, vol_motos: 0, vol_buses: 0, vol_pesados: 0, vol_bicis: 0, vol_otros: 0 };
        prev.total += c.vol_total || 0;
        prev.vol_autos += c.vol_autos || 0;
        prev.vol_motos += c.vol_motos || 0;
        prev.vol_buses += c.vol_buses || 0;
        prev.vol_pesados += c.vol_pesados || 0;
        prev.vol_bicis += c.vol_bicis || 0;
        prev.vol_otros += c.vol_otros || 0;
        bySentido.set(sent, prev);

        const intervalKey = c.intervalo_ini ? new Date(c.intervalo_ini).getTime() : null;
        if (intervalKey != null) {
          const cur = byInterval.get(intervalKey) || { total: 0, intervalo_ini: c.intervalo_ini, intervalo_fin: c.intervalo_fin };
          cur.total += c.vol_total || 0;
          byInterval.set(intervalKey, cur);
        }
      }
      bySentido.forEach((v) => distribucion_hora_pico.push(v));

      let peakInterval = null;
      for (const v of byInterval.values()) {
        if (!peakInterval || v.total > peakInterval.total) peakInterval = v;
      }
      const hora_pico_rango = peakInterval
        ? `${formatTime(peakInterval.intervalo_ini)} - ${formatTime(peakInterval.intervalo_fin)}`
        : null;

      historico.push({
        file_id: e.file_id_dim != null ? parseInt(e.file_id_dim, 10) : null,
        fecha: fechaStr,
        fecha_fin: e.fecha_fin ? new Date(e.fecha_fin).toISOString().slice(0, 10) : fechaStr,
        contratista: e.contratista || 'Desconocido',
        tipo_estudio: e.tipo_estudio || 'Volúmen vehicular',
        resumen_texto: `Aforo ${fechaStr || ''}, volumen pico ${volumen_total_pico}`,
        analisis: {
          hora_pico_rango,
          hora_pico_inicio: peakInterval ? formatTime(peakInterval.intervalo_ini) : null,
          hora_pico_fin: peakInterval ? formatTime(peakInterval.intervalo_fin) : null,
          volumen_total_pico: volumen_total_pico || null,
          distribucion_hora_pico,
          class_headers: classHeaders,
          clases_vehiculos: classHeaders,
          historial_conflictos: [],
          vol_data_completo: conteos.map((c) => ({
            sentido: normalizeSentido(c.sentido),
            horaRango: c.intervalo_ini && c.intervalo_fin
              ? `${formatTime(c.intervalo_ini)} - ${formatTime(c.intervalo_fin)}`
              : null,
            total: c.vol_total,
            classes: {
              ...(c.vol_autos ? { LIVIANOS: c.vol_autos } : {}),
              ...(c.vol_motos ? { MOTOS: c.vol_motos } : {}),
              ...(c.vol_buses ? { BUSES: c.vol_buses } : {}),
              ...(c.vol_pesados ? { PESADOS: c.vol_pesados } : {}),
              ...(c.vol_bicis ? { BICICLETAS: c.vol_bicis } : {}),
              ...(c.vol_otros ? { OTROS: c.vol_otros } : {}),
            },
          })),
          hoja_identificacion: [],
        },
        observaciones: null,
        contexto_temporal: null,
      });
    }

    const estadisticas = historico.length
      ? {
          volumen_promedio: Math.round(
            historico.reduce((acc, h) => acc + (h.analisis?.volumen_total_pico || 0), 0) / historico.length
          ),
          total_estudios: historico.length,
        }
      : null;

    const payload = {
      node_id: nodo.node_id_externo ?? nodeId,
      address: nodo.direccion || nodo.nombre || nodo.node_id_externo || nodeId,
      via_principal: nodo.via_principal || null,
      via_secundaria: nodo.via_secundaria || null,
      upz: nodo.upz_nombre || null,
      upz_codigo: nodo.upz_codigo || null,
      localidad: nodo.localidad_nombre || null,
      localidad_codigo: nodo.localidad_codigo || null,
      historico,
      estadisticas,
    };

    res.json(payload);
  } catch (err) {
    console.error('[Aforos] Error historial:', err.message);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * GET /api/aforos/nodos
 * Devuelve SOLO nodos con aforos (EXISTS estudios). GeoJSON sin layers_summary.
 * properties: id, node_id_externo, nombre, direccion, fuente, layerType:'AFOROS', study_count.
 * dim_id se obtiene en popup vía GET /api/nodos/:id/estudios.
 */
router.get('/nodos', async (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[API CHECK] GET /api/aforos/nodos ejecutado');
  }
  const fuente = req.query.fuente?.trim();
  const validFuente = fuente === 'DIM' || fuente === 'EXTERNO' ? fuente : null;

  try {
    const sql = validFuente
      ? `SELECT n.node_id_externo, n.nombre, n.direccion, n.fuente,
                (SELECT COUNT(*)::int FROM estudios e WHERE e.nodo_id = n.id) AS study_count,
                ST_X(n.geom::geometry) AS lng, ST_Y(n.geom::geometry) AS lat
         FROM nodos n
         WHERE n.geom IS NOT NULL AND n.fuente = $1
           AND EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)`
      : `SELECT n.node_id_externo, n.nombre, n.direccion, n.fuente,
                (SELECT COUNT(*)::int FROM estudios e WHERE e.nodo_id = n.id) AS study_count,
                ST_X(n.geom::geometry) AS lng, ST_Y(n.geom::geometry) AS lat
         FROM nodos n
         WHERE n.geom IS NOT NULL
           AND EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)`;
    const result = validFuente ? await query(sql, [validFuente]) : await query(sql);

    const features = result.rows.map((row) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(row.lng), parseFloat(row.lat)],
      },
      properties: {
        id: row.node_id_externo,
        node_id_externo: row.node_id_externo,
        nombre: row.nombre || null,
        direccion: row.direccion || null,
        fuente: row.fuente || null,
        layerType: 'AFOROS',
        study_count: Math.max(0, Number(row.study_count) || 0),
      },
    }));

    if (process.env.NODE_ENV !== 'production' && features.length > 0) {
      console.log('[Aforos] GET /nodos — example:', JSON.stringify(features[0].properties));
    }
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('[Aforos] Error nodos:', err.message);
    res.status(500).json({ error: 'Error al obtener nodos' });
  }
});

/**
 * GET /api/aforos/nodo/:nodoId/estudios
 * Lista de estudios del nodo con dim_id y metadata para el popup (Ver análisis).
 */
router.get('/nodo/:nodoId/estudios', async (req, res) => {
  const nodoId = req.params.nodoId?.trim();
  if (!nodoId) return res.status(400).json({ error: 'nodoId requerido' });
  try {
    const nodoRes = await query(
      `SELECT id, node_id_externo, nombre, direccion FROM nodos
       WHERE node_id_externo = $1 OR nombre = $1 OR direccion ILIKE $2 OR nombre ILIKE $2 LIMIT 1`,
      [nodoId, `%${nodoId}%`]
    );
    const nodo = nodoRes.rows[0];
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
    const estudiosRes = await query(
      `SELECT id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, download_url, contratista
       FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio DESC`,
      [nodo.id]
    );
    const studies = estudiosRes.rows.map((e) => {
      const fileId = e.file_id_dim != null ? String(e.file_id_dim) : null;
      const dimId = fileId && /^\d+$/.test(fileId) ? fileId : null;
      return {
        id: e.id,
        dim_id: dimId,
        file_id_dim: fileId,
        tipo_estudio: e.tipo_estudio || null,
        fecha_inicio: e.fecha_inicio,
        fecha_fin: e.fecha_fin,
        download_url: e.download_url || null,
        contratista: e.contratista || null,
      };
    });
    res.json({ node_id_externo: nodo.node_id_externo, nombre: nodo.nombre, direccion: nodo.direccion, studies });
  } catch (err) {
    console.error('[Aforos] Error nodo estudios:', err.message);
    res.status(500).json({ error: 'Error al obtener estudios del nodo' });
  }
});

/**
 * GET /api/aforos/geocode/:nodeId
 * Devuelve { lat, lng } desde la tabla nodos (geom). Mismo shape que antes.
 */
router.get('/geocode/:nodeId', async (req, res) => {
  const nodeId = req.params.nodeId?.trim();
  if (!nodeId) return res.status(400).json({ error: 'nodeId requerido' });

  try {
    const result = await query(
      'SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng FROM nodos WHERE node_id_externo = $1 AND geom IS NOT NULL',
      [nodeId]
    );
    const row = result.rows[0];
    if (!row || row.lat == null || row.lng == null) {
      return res.status(404).json({ error: 'Nodo no encontrado en diccionario de estudios' });
    }
    res.json({ lat: parseFloat(row.lat), lng: parseFloat(row.lng) });
  } catch (err) {
    console.error('[Aforos] Error geocode:', err.message);
    res.status(500).json({ error: 'Error al obtener coordenadas' });
  }
});

export default router;
