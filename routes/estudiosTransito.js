/**
 * API de estudios de tránsito enriquecidos: vías, puntos críticos, infraestructura, proyecciones.
 * Rutas: GET /api/estudios-transito/vias, /puntos-criticos, /infraestructura, /proyecciones
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

/** GET /api/estudios-transito/vias?estudio_id=X&localidad_id=Y
 *  Devuelve vías analizadas; geom como GeoJSON LINESTRING. Simbología: capacidad/velocidad.
 */
router.get('/vias', async (req, res) => {
  const estudioId = req.query.estudio_id ? parseInt(req.query.estudio_id, 10) : null;
  if (!estudioId || !Number.isFinite(estudioId)) {
    return res.status(400).json({ error: 'estudio_id (estudios_transito.id) requerido' });
  }
  try {
    const sql = `
      SELECT v.id, v.estudio_transito_id, v.nombre_via, v.tipo_via, v.sentidos,
             v.capacidad_vehicular, v.velocidad_permitida, v.cicloinfra,
             v.pasos_peatonales, v.semaforos,
             ST_AsGeoJSON(v.geom)::json AS geometry
      FROM vias_estudio v
      WHERE v.estudio_transito_id = $1
      ORDER BY v.id`;
    const r = await query(sql, [estudioId]);
    const features = r.rows
      .filter((row) => row.geometry)
      .map((row) => ({
        type: 'Feature',
        properties: {
          id: row.id,
          estudio_transito_id: row.estudio_transito_id,
          nombre_via: row.nombre_via,
          tipo_via: row.tipo_via,
          sentidos: row.sentidos,
          capacidad_vehicular: row.capacidad_vehicular,
          velocidad_permitida: row.velocidad_permitida,
          cicloinfra: row.cicloinfra,
          pasos_peatonales: row.pasos_peatonales,
          semaforos: row.semaforos,
        },
        geometry: row.geometry,
      }));
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/estudios-transito/puntos-criticos?estudio_id=X&tipo=congestión|accidente|peatonal
 *  Devuelve puntos críticos con geom POINT. Simbología: icono por tipo.
 */
router.get('/puntos-criticos', async (req, res) => {
  const estudioId = req.query.estudio_id ? parseInt(req.query.estudio_id, 10) : null;
  const tipo = req.query.tipo ? String(req.query.tipo).trim() : null;
  if (!estudioId || !Number.isFinite(estudioId)) {
    return res.status(400).json({ error: 'estudio_id requerido' });
  }
  try {
    let sql = `
      SELECT p.id, p.estudio_transito_id, p.nombre, p.tipo, p.descripcion, p.frecuencia_anual,
             l.nombre AS localidad_nombre, u.nombre AS upz_nombre,
             ST_AsGeoJSON(p.geom)::json AS geometry
      FROM puntos_criticos_estudio p
      LEFT JOIN localidades l ON p.localidad_id = l.id
      LEFT JOIN upz u ON p.upz_id = u.id
      WHERE p.estudio_transito_id = $1`;
    const params = [estudioId];
    if (tipo) {
      sql += ` AND (p.tipo = $2 OR p.tipo ILIKE $3)`;
      params.push(tipo, `%${tipo}%`);
    }
    sql += ` ORDER BY p.id`;
    const r = await query(sql, params);
    const features = r.rows.map((row) => ({
      type: 'Feature',
      properties: {
        id: row.id,
        estudio_transito_id: row.estudio_transito_id,
        nombre: row.nombre,
        tipo: row.tipo,
        descripcion: row.descripcion,
        frecuencia_anual: row.frecuencia_anual,
        localidad_nombre: row.localidad_nombre,
        upz_nombre: row.upz_nombre,
      },
      geometry: row.geometry || null,
    }));
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/estudios-transito/infraestructura?estudio_id=X&tipo=semaforo|paso-peatonal|cicloinfra
 *  Devuelve infraestructura vial. Simbología: icono por tipo.
 */
router.get('/infraestructura', async (req, res) => {
  const estudioId = req.query.estudio_id ? parseInt(req.query.estudio_id, 10) : null;
  const tipo = req.query.tipo ? String(req.query.tipo).trim() : null;
  if (!estudioId || !Number.isFinite(estudioId)) {
    return res.status(400).json({ error: 'estudio_id requerido' });
  }
  try {
    let sql = `
      SELECT i.id, i.estudio_transito_id, i.tipo, i.ubicacion, i.estado, i.observaciones,
             ST_AsGeoJSON(i.geom)::json AS geometry
      FROM infraestructura_vial i
      WHERE i.estudio_transito_id = $1`;
    const params = [estudioId];
    if (tipo) {
      sql += ` AND (i.tipo = $2 OR i.tipo ILIKE $3)`;
      params.push(tipo, `%${tipo}%`);
    }
    sql += ` ORDER BY i.id`;
    const r = await query(sql, params);
    const features = r.rows.map((row) => ({
      type: 'Feature',
      properties: {
        id: row.id,
        estudio_transito_id: row.estudio_transito_id,
        tipo: row.tipo,
        ubicacion: row.ubicacion,
        estado: row.estado,
        observaciones: row.observaciones,
      },
      geometry: row.geometry || null,
    }));
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/estudios-transito/proyecciones?estudio_id=X&escenario=5-años|10-años
 *  Devuelve proyecciones por nodo/vía para visualizar escenarios.
 */
router.get('/proyecciones', async (req, res) => {
  const estudioId = req.query.estudio_id ? parseInt(req.query.estudio_id, 10) : null;
  const escenario = req.query.escenario ? String(req.query.escenario).trim() : null;
  if (!estudioId || !Number.isFinite(estudioId)) {
    return res.status(400).json({ error: 'estudio_id requerido' });
  }
  try {
    let sql = `
      SELECT pr.id, pr.estudio_transito_id, pr.escenario, pr.descripcion,
             pr.volumen_proyectado, pr.velocidad_promedio, pr.nivel_congestion,
             pr.nodo_id, pr.via_id,
             n.node_id_externo, n.direccion AS nodo_direccion,
             v.nombre_via
      FROM proyecciones_estudio pr
      LEFT JOIN nodos n ON pr.nodo_id = n.id
      LEFT JOIN vias_estudio v ON pr.via_id = v.id
      WHERE pr.estudio_transito_id = $1`;
    const params = [estudioId];
    if (escenario) {
      sql += ` AND (pr.escenario = $2 OR pr.escenario ILIKE $3)`;
      params.push(escenario, `%${escenario}%`);
    }
    sql += ` ORDER BY pr.escenario, pr.id`;
    const r = await query(sql, params);
    res.json({ proyecciones: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
