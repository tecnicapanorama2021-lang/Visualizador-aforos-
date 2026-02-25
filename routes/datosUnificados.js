/**
 * LEGACY – No usado por capas reales del mapa.
 * Las capas (obras/eventos/manifestaciones) leen de incidentes vía routes/capas.js.
 * Mantenido por compatibilidad con posibles consumidores de /api/datos-unificados/*.
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../server/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();
router.use((_req, res, next) => {
  res.setHeader('X-Deprecated', 'true');
  next();
});

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const CALENDAR_PATH = path.join(DATA_DIR, 'calendario_obras_eventos.json');
const VELOCIDADES_PATH = path.join(DATA_DIR, 'velocidades_por_nodo.json');

function readJsonSafe(filePath, defaultValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return defaultValue ?? null;
  }
}

/**
 * GET /api/datos-unificados/calendario
 * Query opcional: nodo_id, desde, hasta (ISO8601)
 * Devuelve registros del calendario (obras + eventos) filtrados.
 */
router.get('/calendario', (req, res) => {
  try {
    const { nodo_id, desde, hasta } = req.query;
    const data = readJsonSafe(CALENDAR_PATH, { obras: [], eventos: [], metadata: {} });
    if (!data) {
      return res.status(404).json({ error: 'Calendario no encontrado', obras: [], eventos: [] });
    }

    const filterByTime = (item) => {
      const ts = item.timestamp || item.fecha_inicio || item.fecha_fin;
      if (!ts) return true;
      const t = new Date(ts).getTime();
      if (desde && t < new Date(desde).getTime()) return false;
      if (hasta && t > new Date(hasta).getTime()) return false;
      return true;
    };

    const filterByNode = (item) => {
      if (!nodo_id) return true;
      if (String(item.nodo_id || '') === String(nodo_id)) return true;
      const afectados = item.nodos_afectados || [];
      return afectados.some((id) => String(id) === String(nodo_id));
    };

    let obras = Array.isArray(data.obras) ? data.obras : [];
    let eventos = Array.isArray(data.eventos) ? data.eventos : [];
    obras = obras.filter(filterByNode).filter(filterByTime);
    eventos = eventos.filter(filterByNode).filter(filterByTime);

    res.json({
      metadata: data.metadata || {},
      obras,
      eventos
    });
  } catch (err) {
    console.error('[datos-unificados] Error leyendo calendario:', err.message);
    res.status(500).json({ error: 'Error al leer calendario', message: err.message });
  }
});

/**
 * GET /api/datos-unificados/obras
 * Devuelve todas las obras con geometría para dibujar en el mapa.
 */
router.get('/obras', (req, res) => {
  try {
    const data = readJsonSafe(CALENDAR_PATH, { obras: [], metadata: {} });
    const obras = Array.isArray(data?.obras) ? data.obras : [];
    const conGeometria = obras.filter((o) => o.geometry && o.geometry.coordinates && o.geometry.coordinates.length >= 2);
    res.json({
      metadata: data?.metadata || {},
      total: obras.length,
      con_geometria: conGeometria.length,
      obras: conGeometria
    });
  } catch (err) {
    console.error('[datos-unificados] Error leyendo obras:', err.message);
    res.status(500).json({ error: 'Error al leer obras', message: err.message });
  }
});

/**
 * GET /api/datos-unificados/contexto-eventos
 * Devuelve obras y eventos desde la BD (contexto_eventos) con localidad y UPZ asignadas.
 * Incluye localidad_id, localidad_nombre, localidad_codigo, upz_id, upz_nombre, upz_codigo.
 */
router.get('/contexto-eventos', async (req, res) => {
  try {
    const hasCol = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'upz_id'`
    ).then((r) => r.rows[0]);

    let rows;
    const hasUbicacionTexto = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'ubicacion_texto'`
    ).then((r) => r.rows[0]);

    if (hasCol) {
      const result = await query(`
        SELECT c.id, c.tipo, c.subtipo, c.descripcion, c.fecha_inicio, c.fecha_fin,
               c.fuente, c.url_remota, c.origen_id, c.radio_influencia_m, c.procesado, c.created_at,
               ST_AsGeoJSON(c.geom)::json AS geometry,
               c.localidad_id, c.upz_id,
               l.nombre AS localidad_nombre, l.codigo AS localidad_codigo,
               u.nombre AS upz_nombre, u.codigo AS upz_codigo
               ${hasUbicacionTexto ? ', c.ubicacion_texto, c.zona_texto' : ''}
        FROM contexto_eventos c
        LEFT JOIN localidades l ON l.id = c.localidad_id
        LEFT JOIN upz u ON u.id = c.upz_id
        ORDER BY c.fecha_inicio DESC NULLS LAST, c.id
      `);
      rows = result.rows;
    } else {
      const result = await query(`
        SELECT id, tipo, subtipo, descripcion, fecha_inicio, fecha_fin,
               fuente, url_remota, origen_id, radio_influencia_m, procesado, created_at,
               ST_AsGeoJSON(geom)::json AS geometry,
               NULL::int AS localidad_id, NULL::int AS upz_id,
               NULL::text AS localidad_nombre, NULL::text AS localidad_codigo,
               NULL::text AS upz_nombre, NULL::text AS upz_codigo
               ${hasUbicacionTexto ? ', ubicacion_texto, zona_texto' : ''}
        FROM contexto_eventos
        ORDER BY fecha_inicio DESC NULLS LAST, id
      `);
      rows = result.rows;
    }

    const eventos = rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      subtipo: r.subtipo,
      descripcion: r.descripcion,
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin,
      fuente: r.fuente,
      url_remota: r.url_remota,
      origen_id: r.origen_id,
      geometry: r.geometry,
      localidad_id: r.localidad_id,
      localidad_nombre: r.localidad_nombre,
      localidad_codigo: r.localidad_codigo,
      upz_id: r.upz_id,
      upz_nombre: r.upz_nombre,
      upz_codigo: r.upz_codigo,
      ubicacion_texto: r.ubicacion_texto ?? null,
      zona_texto: r.zona_texto ?? null,
    }));

    res.json({ total: eventos.length, eventos });
  } catch (err) {
    console.error('[datos-unificados] Error contexto-eventos:', err.message);
    res.status(500).json({ error: 'Error al obtener contexto-eventos', message: err.message });
  }
});

/**
 * GET /api/datos-unificados/velocidades/:nodoId
 * Query opcional: desde, hasta (ISO8601)
 * Devuelve serie temporal de velocidades para ese nodo.
 */
router.get('/velocidades/:nodoId', (req, res) => {
  try {
    const nodoId = req.params.nodoId?.trim();
    const { desde, hasta } = req.query;
    if (!nodoId) {
      return res.status(400).json({ error: 'nodoId requerido' });
    }

    const data = readJsonSafe(VELOCIDADES_PATH, { metadata: {}, by_node: {} });
    if (!data || !data.by_node) {
      return res.json({ metadata: {}, serie: [] });
    }

    let serie = Array.isArray(data.by_node[nodoId]) ? data.by_node[nodoId] : [];
    if (desde || hasta) {
      const desdeMs = desde ? new Date(desde).getTime() : 0;
      const hastaMs = hasta ? new Date(hasta).getTime() : Number.MAX_SAFE_INTEGER;
      serie = serie.filter((p) => {
        const t = new Date(p.ts).getTime();
        return t >= desdeMs && t <= hastaMs;
      });
    }
    serie = [...serie].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    res.json({
      metadata: data.metadata || {},
      nodo_id: nodoId,
      serie
    });
  } catch (err) {
    console.error('[datos-unificados] Error leyendo velocidades:', err.message);
    res.status(500).json({ error: 'Error al leer velocidades', message: err.message });
  }
});

export default router;
