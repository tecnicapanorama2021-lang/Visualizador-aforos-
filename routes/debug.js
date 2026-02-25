/**
 * Endpoints temporales de diagnóstico multicapa.
 * GET /api/debug/layers-summary-stats
 * GET /api/debug/estudios-relation
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

/**
 * GET /api/debug/ping
 * Verificación de que las rutas debug están montadas.
 */
router.get('/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const NODOS_SQL = `SELECT n.id,
  (SELECT EXISTS(SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)) AS aforos_has,
  (SELECT COUNT(*)::int FROM obras o WHERE o.nodo_id = n.id) AS obras_count,
  (SELECT COUNT(*)::int FROM eventos_urbanos ev WHERE ev.nodo_id = n.id) AS eventos_count,
  (SELECT COUNT(*)::int FROM semaforos s WHERE s.nodo_id = n.id) AS semaforos_count
 FROM nodos n WHERE n.geom IS NOT NULL`;

/**
 * GET /api/debug/layers-summary-stats
 * Misma lógica que /api/aforos/nodos para layers_summary; devuelve agregados.
 */
router.get('/layers-summary-stats', async (req, res) => {
  try {
    const result = await query(NODOS_SQL);
    const rows = result.rows;
    const total_nodes = rows.length;
    const aforos_true = rows.filter((r) => r.aforos_has).length;
    const obras_total = rows.reduce((s, r) => s + (Number(r.obras_count) || 0), 0);
    const eventos_total = rows.reduce((s, r) => s + (Number(r.eventos_count) || 0), 0);
    const semaforos_total = rows.reduce((s, r) => s + (Number(r.semaforos_count) || 0), 0);
    const nodes_with_any_layer = rows.filter(
      (r) =>
        r.aforos_has ||
        (Number(r.obras_count) || 0) > 0 ||
        (Number(r.eventos_count) || 0) > 0 ||
        (Number(r.semaforos_count) || 0) > 0
    ).length;
    res.json({
      total_nodes,
      aforos_true,
      obras_total,
      eventos_total,
      semaforos_total,
      nodes_with_any_layer,
    });
  } catch (err) {
    console.error('[debug] layers-summary-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Cuenta eventos desde incidentes (misma fuente que GET /api/eventos/nodos). Incluye todos los tipo=EVENTO. */
async function countEventosFromIncidentes(temporalOpts = null) {
  try {
    const where = buildIncidentesTemporalWhere('EVENTO', null, temporalOpts);
    const r = await query(`
      SELECT COUNT(*)::int AS c FROM incidentes
      WHERE geom IS NOT NULL AND tipo = 'EVENTO' ${where}
    `);
    return parseInt(r.rows[0]?.c ?? 0, 10);
  } catch (_) {
    return 0;
  }
}

async function countConciertosFromIncidentes(temporalOpts = null) {
  try {
    const where = buildIncidentesTemporalWhere('EVENTO', 'CONCIERTO', temporalOpts);
    const r = await query(`
      SELECT COUNT(*)::int AS c FROM incidentes
      WHERE geom IS NOT NULL AND tipo = 'EVENTO' AND subtipo = 'CONCIERTO' ${where}
    `);
    return parseInt(r.rows[0]?.c ?? 0, 10);
  } catch (_) {
    return 0;
  }
}

/** Filtro temporal en SQL equivalente a isActiveTemporal (hoy + 7d, o 30d atrás si sin end_at). */
function sqlActiveTemporal() {
  return `AND (
    start_at IS NULL
    OR (start_at <= CURRENT_TIMESTAMP AND (end_at IS NULL OR end_at >= CURRENT_TIMESTAMP))
    OR (end_at IS NULL AND start_at >= CURRENT_TIMESTAMP - interval '30 days' AND start_at <= CURRENT_TIMESTAMP + interval '7 days')
  )`;
}

/** WHERE adicional para incidentes según opts. active=1 → isActiveTemporal en SQL. */
function buildIncidentesTemporalWhere(tipo, subtipo, opts) {
  if (!opts || opts.active) return opts?.active ? sqlActiveTemporal() : '';
  return '';
}

/**
 * GET /api/debug/capas-stats
 * Conteos por capa. Eventos/conciertos desde incidentes (misma fuente que el mapa).
 */
router.get('/capas-stats', async (req, res) => {
  try {
    const {
      getEventosFromContexto,
      filterByLayerType,
      getObrasFromCalendario,
    } = await import('../server/utils/capasAdapter.js');

    const [aforosRes, eventosIncidentes, conciertosIncidentes, stagingCounts, lugaresRes, semaforosRes, baseRes] = await Promise.all([
      query(
        `SELECT COUNT(*) AS c FROM nodos n WHERE n.geom IS NOT NULL AND EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)`
      ),
      countEventosFromIncidentes(),
      countConciertosFromIncidentes(),
      getEventosFromContexto({}).then((raw) => ({
        eventos: filterByLayerType(raw, 'EVENTOS').length,
        manifestaciones: filterByLayerType(raw, 'MANIFESTACIONES').length,
      })),
      query(`SELECT COUNT(*) AS c FROM contexto_eventos WHERE tipo = 'LUGAR_EVENTO' AND fuente = 'AGENDATE_BOGOTA' AND geom IS NOT NULL`),
      query(`SELECT COUNT(*) AS c FROM semaforos s JOIN nodos n ON n.id = s.nodo_id WHERE n.geom IS NOT NULL`),
      query(`
        SELECT COUNT(*) AS c FROM nodos n
        WHERE n.geom IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM obras o WHERE o.nodo_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM eventos_urbanos eu WHERE eu.nodo_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM semaforos s WHERE s.nodo_id = n.id)
      `),
    ]);

    let obrasCount = 0;
    try {
      const r = await query(`SELECT COUNT(*) AS c FROM obras_canonica WHERE geom IS NOT NULL`);
      obrasCount = parseInt(r.rows[0]?.c ?? 0, 10);
    } catch (_) {}
    if (obrasCount === 0) obrasCount = getObrasFromCalendario().length;
    const toInt = (r) => Math.max(0, parseInt(r.rows[0]?.c ?? '0', 10));

    res.json({
      aforos: toInt(aforosRes),
      obras: obrasCount,
      eventos: eventosIncidentes,
      manifestaciones: stagingCounts.manifestaciones,
      conciertos: conciertosIncidentes,
      lugares: toInt(lugaresRes),
      semaforos: toInt(semaforosRes),
      base: toInt(baseRes),
      eventos_staging: {
        count: stagingCounts.eventos,
        fuente: 'contexto_eventos',
        nota: 'No todos han pasado a incidentes (requieren geom + start_at)',
      },
    });
  } catch (err) {
    console.error('[debug] capas-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/capas-temporal-stats
 * Conteos por capa con filtro temporal. Eventos/conciertos desde incidentes (misma fuente que el mapa).
 */
router.get('/capas-temporal-stats', async (req, res) => {
  try {
    const active = req.query.active === '1' || req.query.active === true;
    const from = req.query.from || null;
    const to = req.query.to || null;
    const {
      getEventosFromContexto,
      filterByLayerType,
      getObrasFromCalendario,
      isActiveTemporal,
      inTemporalRange,
    } = await import('../server/utils/capasAdapter.js');

    const opts = active ? { active: 1 } : { from, to };
    const [aforosRes, eventosIncidentes, conciertosIncidentes, stagingCounts, lugaresRes, semaforosRes, baseRes] = await Promise.all([
      query(
        `SELECT COUNT(*) AS c FROM nodos n WHERE n.geom IS NOT NULL AND EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)`
      ),
      countEventosFromIncidentes(opts),
      countConciertosFromIncidentes(opts),
      getEventosFromContexto(opts).then((raw) => ({
        eventos: filterByLayerType(raw, 'EVENTOS').length,
        manifestaciones: filterByLayerType(raw, 'MANIFESTACIONES').length,
      })),
      query(`SELECT COUNT(*) AS c FROM contexto_eventos WHERE tipo = 'LUGAR_EVENTO' AND fuente = 'AGENDATE_BOGOTA' AND geom IS NOT NULL`),
      query(`SELECT COUNT(*) AS c FROM semaforos s JOIN nodos n ON n.id = s.nodo_id WHERE n.geom IS NOT NULL`),
      query(`
        SELECT COUNT(*) AS c FROM nodos n
        WHERE n.geom IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM obras o WHERE o.nodo_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM eventos_urbanos eu WHERE eu.nodo_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM semaforos s WHERE s.nodo_id = n.id)
      `),
    ]);

    let obrasCount = 0;
    try {
      const r = await query(`
        SELECT fecha_ini, fecha_fin FROM obras_canonica WHERE geom IS NOT NULL
      `);
      const now = new Date();
      const filtered = r.rows.filter((row) => {
        if (active) return isActiveTemporal(row.fecha_ini, row.fecha_fin, now);
        if (from || to) return inTemporalRange(row.fecha_ini, row.fecha_fin, from, to);
        return true;
      });
      obrasCount = filtered.length;
    } catch (_) {
      const fromCal = getObrasFromCalendario();
      const now = new Date();
      let list = fromCal;
      if (active) list = list.filter((f) => isActiveTemporal(f.properties?.start_at, f.properties?.end_at, now));
      else if (from || to) list = list.filter((f) => inTemporalRange(f.properties?.start_at, f.properties?.end_at, from, to));
      obrasCount = list.length;
    }

    const toInt = (r) => Math.max(0, parseInt(r.rows[0]?.c ?? '0', 10));

    res.json({
      aforos: toInt(aforosRes),
      obras: obrasCount,
      eventos: eventosIncidentes,
      manifestaciones: stagingCounts.manifestaciones,
      conciertos: conciertosIncidentes,
      lugares: toInt(lugaresRes),
      semaforos: toInt(semaforosRes),
      base: toInt(baseRes),
      filter: active ? 'active=1' : from || to ? `from=${from}&to=${to}` : 'none',
      eventos_staging: {
        count: stagingCounts.eventos,
        fuente: 'contexto_eventos',
        nota: 'No todos han pasado a incidentes (requieren geom + start_at)',
      },
    });
  } catch (err) {
    console.error('[debug] capas-temporal-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/capas-sources-audit
 * Conteos por fuente: tablas canónicas (fuente única) + calendario/contexto/t020 para auditoría.
 */
router.get('/capas-sources-audit', async (req, res) => {
  try {
    const [canonical, t020] = await Promise.all([
      Promise.all([
        query('SELECT COUNT(*) AS c FROM obras_canonica WHERE geom IS NOT NULL').then((r) =>
          parseInt(r.rows[0]?.c ?? 0, 10)
        ),
        query(
          `SELECT tipo_evento, COUNT(*) AS c FROM eventos_canonica WHERE geom IS NOT NULL GROUP BY tipo_evento ORDER BY tipo_evento`
        ).then((r) => Object.fromEntries(r.rows.map((row) => [row.tipo_evento, parseInt(row.c, 10)]))),
      ]).then(([obras_canonica_count, eventos_canonica_by_tipo]) => ({
        obras_canonica: obras_canonica_count,
        eventos_canonica: eventos_canonica_by_tipo,
      })),
      Promise.all([
        query('SELECT COUNT(*) AS c FROM obras').then((r) => parseInt(r.rows[0]?.c ?? 0, 10)),
        query('SELECT COUNT(*) AS c FROM eventos_urbanos').then((r) => parseInt(r.rows[0]?.c ?? 0, 10)),
        query('SELECT COUNT(*) AS c FROM semaforos').then((r) => parseInt(r.rows[0]?.c ?? 0, 10)),
      ]).then(([obras, eventos_urbanos, semaforos]) => ({ obras, eventos_urbanos, semaforos })),
    ]);

    res.json({
      canonical,
      tablas_020: t020,
    });
  } catch (err) {
    console.error('[debug] capas-sources-audit:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/incidentes-stats
 * Fuente única canónica: conteos por tipo, por fuente_principal, con/sin geom.
 */
router.get('/incidentes-stats', async (req, res) => {
  try {
    const tableExists = await query(`
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incidentes'
    `).then((r) => r.rows.length > 0);
    if (!tableExists) {
      return res.json({ error: 'Tabla incidentes no existe. Ejecutar migración 022.', by_tipo: {}, by_fuente: {}, con_geom: 0, sin_geom: 0 });
    }
    const [byTipo, byFuente, geomCounts] = await Promise.all([
      query(`SELECT tipo, COUNT(*)::int AS c FROM incidentes GROUP BY tipo ORDER BY tipo`),
      query(`SELECT fuente_principal, COUNT(*)::int AS c FROM incidentes GROUP BY fuente_principal ORDER BY fuente_principal`),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE geom IS NOT NULL)::int AS con_geom,
          COUNT(*) FILTER (WHERE geom IS NULL)::int AS sin_geom
        FROM incidentes
      `),
    ]);
    res.json({
      by_tipo: Object.fromEntries(byTipo.rows.map((r) => [r.tipo, r.c])),
      by_fuente: Object.fromEntries(byFuente.rows.map((r) => [r.fuente_principal, r.c])),
      con_geom: geomCounts.rows[0]?.con_geom ?? 0,
      sin_geom: geomCounts.rows[0]?.sin_geom ?? 0,
    });
  } catch (err) {
    console.error('[debug] incidentes-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/estudios-relation
 * Verificación relación estudios ↔ nodos (EXISTS e.nodo_id = n.id).
 */
router.get('/estudios-relation', async (req, res) => {
  try {
    const [a, b, c, d] = await Promise.all([
      query('SELECT COUNT(*) AS total_estudios FROM estudios'),
      query('SELECT COUNT(nodo_id) AS estudios_con_nodo_id FROM estudios'),
      query(
        `SELECT COUNT(*) AS nodos_con_estudios FROM nodos n
         WHERE EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)`
      ),
      query(
        `SELECT COUNT(DISTINCT e.nodo_id) AS nodos_distintos_con_estudios
         FROM estudios e WHERE e.nodo_id IS NOT NULL`
      ),
    ]);
    res.json({
      total_estudios: Number(a.rows[0]?.total_estudios ?? 0),
      estudios_con_nodo_id: Number(b.rows[0]?.estudios_con_nodo_id ?? 0),
      nodos_con_estudios: Number(c.rows[0]?.nodos_con_estudios ?? 0),
      nodos_distintos_con_estudios: Number(d.rows[0]?.nodos_distintos_con_estudios ?? 0),
    });
  } catch (err) {
    console.error('[debug] estudios-relation:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
