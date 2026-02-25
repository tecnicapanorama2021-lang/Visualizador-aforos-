/**
 * Predictor baseline MVP: predicción de aforo por nodo según histórico y incidentes cercanos.
 * GET /api/prediccion/nodo/:nodo_id?fecha=YYYY-MM-DD&hora=HH
 * [nuevo archivo]
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

const RADIO_M = parseInt(process.env.PREDICCION_RADIO_M || '500', 10);
const FACTOR_TIPO = {
  OBRA: -0.15,
  EVENTO: 0.25,
  MANIFESTACION: -0.2,
};

/** Resuelve nodo por node_id_externo o id. */
async function resolveNodo(nodoIdParam) {
  const byExterno = await query(
    `SELECT id, node_id_externo, geom FROM nodos WHERE node_id_externo = $1 OR id::text = $1 LIMIT 1`,
    [nodoIdParam]
  );
  const row = byExterno.rows[0];
  if (!row) return null;
  return row;
}

/**
 * GET /api/prediccion/nodo/:nodo_id?fecha=YYYY-MM-DD&hora=HH
 * fecha: YYYY-MM-DD (default hoy), hora: 0-23 (default hora actual).
 */
router.get('/nodo/:nodo_id', async (req, res) => {
  const nodoId = req.params.nodo_id?.trim();
  if (!nodoId) return res.status(400).json({ error: 'nodo_id requerido' });

  const fechaParam = req.query.fecha;
  const horaParam = req.query.hora;
  const fecha = fechaParam ? new Date(fechaParam + 'T12:00:00Z') : new Date();
  const hora = horaParam != null ? parseInt(String(horaParam), 10) : fecha.getUTCHours();
  if (isNaN(fecha.getTime()) || hora < 0 || hora > 23) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) y hora (0-23) inválidos' });
  }

  try {
    const nodo = await resolveNodo(nodoId);
    if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

    const fechaStr = fecha.toISOString().slice(0, 10);
    let dow = fecha.getUTCDay();
    let esFestivo = false;
    let nombreFestivo = null;

    try {
      const festivo = await query(
        `SELECT nombre FROM festivos_colombia WHERE fecha = $1::date LIMIT 1`,
        [fechaStr]
      );
      if (festivo.rows[0]) {
        esFestivo = true;
        nombreFestivo = festivo.rows[0].nombre;
        dow = 0; // Usar patrón domingo/festivo para el histórico
      }
    } catch (_) {}

    const nodoIdInternal = nodo.id;

    // 1) Histórico: promedio por DOW y hora (festivo → DOW 0)
    const hist = await query(
      `SELECT AVG(c.vol_total)::float AS promedio_historico, STDDEV(c.vol_total)::float AS desviacion, COUNT(*)::int AS n
       FROM conteos_resumen c
       JOIN estudios e ON e.id = c.estudio_id
       WHERE e.nodo_id = $1
         AND EXTRACT(DOW FROM c.intervalo_ini) = $2
         AND EXTRACT(HOUR FROM c.intervalo_ini) = $3`,
      [nodoIdInternal, dow, hora]
    );
    let promedioHistorico = hist.rows[0]?.promedio_historico != null ? parseFloat(hist.rows[0].promedio_historico) : null;
    let nHist = parseInt(hist.rows[0]?.n ?? 0, 10);
    if (esFestivo && (promedioHistorico == null || nHist < 3)) {
      const histNormal = await query(
        `SELECT AVG(c.vol_total)::float AS prom FROM conteos_resumen c JOIN estudios e ON e.id = c.estudio_id
         WHERE e.nodo_id = $1 AND EXTRACT(HOUR FROM c.intervalo_ini) = $2`,
        [nodoIdInternal, hora]
      );
      const prom = histNormal.rows[0]?.prom != null ? parseFloat(histNormal.rows[0].prom) : null;
      if (prom != null) {
        promedioHistorico = prom * 0.7;
        nHist = nHist || 1;
      }
    }

    // 2) Incidentes activos/programados en radio
    let incidentesConsiderados = [];
    let nodoGeomWkt = null;
    if (nodo.geom) {
      const wktRes = await query(
        `SELECT ST_AsText(ST_Centroid(geom)) AS wkt FROM nodos WHERE id = $1`,
        [nodoIdInternal]
      );
      nodoGeomWkt = wktRes.rows[0]?.wkt;
    }
    if (nodoGeomWkt) {
      const inc = await query(
        `SELECT i.tipo, i.subtipo, i.estado,
                ST_Distance(i.geom::geography, (SELECT geom::geography FROM nodos WHERE id = $1)) AS distancia_m
         FROM incidentes i
         WHERE i.estado IN ('ACTIVO', 'PROGRAMADO')
           AND i.geom IS NOT NULL
           AND ST_DWithin(i.geom::geography, (SELECT geom::geography FROM nodos WHERE id = $1), $2)
         ORDER BY distancia_m`,
        [nodoIdInternal, RADIO_M]
      );
      incidentesConsiderados = inc.rows.map((r) => ({
        tipo: r.tipo,
        subtipo: r.subtipo,
        estado: r.estado,
        distancia_m: r.distancia_m != null ? Math.round(parseFloat(r.distancia_m)) : null,
      }));
    }

    // 3) Ajuste por incidentes
    let impactoTotal = 0;
    for (const inc of incidentesConsiderados) {
      const factorTipo = FACTOR_TIPO[inc.tipo] ?? 0;
      const dist = inc.distancia_m != null ? inc.distancia_m : 0;
      const factorDistancia = RADIO_M > 0 ? Math.max(0, 1 - dist / RADIO_M) : 1;
      impactoTotal += factorTipo * factorDistancia;
    }

    // 4) Predicción y confianza
    const base = promedioHistorico != null ? promedioHistorico : 0;
    const prediccion = base * (1 + impactoTotal);
    const confianza = nHist > 10 ? 'alta' : nHist > 3 ? 'media' : 'baja';

    const payload = {
      nodo_id: nodoId,
      fecha: fechaStr,
      hora,
      promedio_historico: promedioHistorico,
      prediccion: Math.round(prediccion * 100) / 100,
      confianza,
      incidentes_considerados: incidentesConsiderados,
      metodologia: 'baseline_v1',
    };
    if (esFestivo) {
      payload.es_festivo = true;
      payload.nombre_festivo = nombreFestivo;
    }
    res.json(payload);
  } catch (err) {
    console.error('[prediccion]', err.message);
    res.status(500).json({ error: 'Error interno', detail: err.message });
  }
});

/** GET /api/prediccion/validacion?dias=90&zona=KENNEDY&tipo_via=ARTERIAL */
router.get('/validacion', async (req, res) => {
  const dias = Math.min(365, Math.max(1, parseInt(req.query.dias || '90', 10) || 90));
  const zona = (req.query.zona || '').trim() || null;
  const tipoVia = (req.query.tipo_via || '').trim() || null;

  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 86400000);
  const desdeStr = desde.toISOString().slice(0, 10);
  const hastaStr = hasta.toISOString().slice(0, 10);

  try {
    let sql = `
      SELECT e.nodo_id, n.node_id_externo, n.nombre AS nodo_nombre,
             c.intervalo_ini, c.vol_total AS aforo_real,
             l.nombre AS localidad
      FROM conteos_resumen c
      JOIN estudios e ON e.id = c.estudio_id
      JOIN nodos n ON n.id = e.nodo_id
      LEFT JOIN localidades l ON l.id = n.localidad_id
      WHERE c.intervalo_ini::date BETWEEN $1::date AND $2::date
        AND ($3::text IS NULL OR l.nombre = $3)
    `;
    const params = [desdeStr, hastaStr, zona];
    const countResult = await query(
      `SELECT COUNT(*) AS cnt FROM conteos_resumen c JOIN estudios e ON e.id = c.estudio_id JOIN nodos n ON n.id = e.nodo_id LEFT JOIN localidades l ON l.id = n.localidad_id WHERE c.intervalo_ini::date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR l.nombre = $3)`,
      params
    );
    const totalRows = parseInt(countResult.rows[0]?.cnt ?? 0, 10);
    let muestreo = false;
    let porcentaje = null;
    if (totalRows > 5000) {
      sql += ` AND random() < 0.10`;
      muestreo = true;
      porcentaje = 10;
    }
    sql += ` ORDER BY random() LIMIT 500`;

    const rows = await query(sql, params);
    const muestras = rows.rows || [];

    const resultados = [];
    for (const r of muestras) {
      const ts = new Date(r.intervalo_ini);
      const fecha = ts.toISOString().slice(0, 10);
      const hora = ts.getUTCHours();
      const dow = ts.getUTCDay();
      const nodoId = r.nodo_id;
      const real = parseInt(r.aforo_real, 10) || 0;

      const avgRes = await query(
        `SELECT AVG(c2.vol_total)::float AS prom
         FROM conteos_resumen c2
         JOIN estudios e2 ON e2.id = c2.estudio_id
         WHERE e2.nodo_id = $1 AND EXTRACT(HOUR FROM c2.intervalo_ini) = $2
           AND EXTRACT(DOW FROM c2.intervalo_ini) = $3
           AND c2.intervalo_ini::date NOT BETWEEN $4::date - 7 AND $4::date + 7`,
        [nodoId, hora, dow, fecha]
      );
      let base = avgRes.rows[0]?.prom != null ? parseFloat(avgRes.rows[0].prom) : null;
      if (base == null) base = real;

      const incRes = await query(
        `SELECT i.tipo, ST_Distance(i.geom::geography, (SELECT geom::geography FROM nodos WHERE id = $1)) AS dist
         FROM incidentes i WHERE i.geom IS NOT NULL AND i.start_at <= $2::timestamptz AND (i.end_at IS NULL OR i.end_at >= $2::timestamptz)
         AND ST_DWithin(i.geom::geography, (SELECT geom::geography FROM nodos WHERE id = $1), $3)`,
        [nodoId, ts.toISOString(), RADIO_M]
      );
      let impacto = 0;
      for (const inc of incRes.rows || []) {
        const fact = FACTOR_TIPO[inc.tipo] ?? 0;
        const d = inc.dist != null ? parseFloat(inc.dist) : 0;
        impacto += fact * Math.max(0, 1 - d / RADIO_M);
      }
      const prediccion = base * (1 + impacto);
      resultados.push({
        nodo_id: r.node_id_externo,
        nodo_nombre: r.nodo_nombre,
        localidad: r.localidad,
        fecha,
        hora,
        aforo_real: real,
        prediccion_simulada: Math.round(prediccion * 100) / 100,
        error: Math.round((prediccion - real) * 100) / 100,
      });
    }

    const errs = resultados.filter((x) => x.aforo_real > 0);
    const mae = errs.length ? errs.reduce((s, x) => s + Math.abs(x.error), 0) / errs.length : 0;
    const mape = errs.length ? (errs.reduce((s, x) => s + Math.abs(x.error) / x.aforo_real, 0) / errs.length) * 100 : 0;
    const rmse = errs.length ? Math.sqrt(errs.reduce((s, x) => s + x.error * x.error, 0) / errs.length) : 0;
    const bias = errs.length ? errs.reduce((s, x) => s + x.error, 0) / errs.length : 0;

    const porZona = {};
    const porHora = {};
    const porNodo = {};
    for (const x of resultados) {
      const z = x.localidad || 'Sin zona';
      if (!porZona[z]) porZona[z] = { errores: [], reales: [] };
      porZona[z].errores.push(x.error);
      if (x.aforo_real > 0) porZona[z].reales.push(x.aforo_real);

      const h = x.hora;
      if (!porHora[h]) porHora[h] = { errores: [], reales: [] };
      porHora[h].errores.push(x.error);
      if (x.aforo_real > 0) porHora[h].reales.push(x.aforo_real);

      const n = x.nodo_id;
      if (!porNodo[n]) porNodo[n] = { nombre: x.nodo_nombre, errores: [], reales: [] };
      porNodo[n].errores.push(Math.abs(x.error));
      porNodo[n].reales.push(x.aforo_real);
    }

    const porZonaArr = Object.entries(porZona).map(([zonaNombre, v]) => {
      const n = v.reales.length;
      const maeZ = n ? v.errores.reduce((s, e) => s + Math.abs(e), 0) / n : 0;
      const mapeZ = n && v.reales.some((r) => r > 0) ? (v.errores.reduce((s, e, i) => s + (v.reales[i] > 0 ? Math.abs(e) / v.reales[i] : 0), 0) / n) * 100 : 0;
      return { zona: zonaNombre, MAE: Math.round(maeZ * 100) / 100, MAPE: Math.round(mapeZ * 100) / 100, n_muestras: n };
    });

    const porHoraArr = Object.entries(porHora).map(([h, v]) => {
      const n = v.reales.length;
      const maeH = n ? v.errores.reduce((s, e) => s + Math.abs(e), 0) / n : 0;
      const mapeH = n && v.reales.some((r) => r > 0) ? (v.errores.reduce((s, e, i) => s + (v.reales[i] > 0 ? Math.abs(e) / v.reales[i] : 0), 0) / n) * 100 : 0;
      return { hora: parseInt(h, 10), MAE: Math.round(maeH * 100) / 100, MAPE: Math.round(mapeH * 100) / 100 };
    }).sort((a, b) => a.hora - b.hora);

    const nodosMae = Object.entries(porNodo).map(([nodoIdK, v]) => ({
      nodo_id: nodoIdK,
      nombre: v.nombre,
      MAE: v.errores.length ? v.errores.reduce((a, b) => a + b, 0) / v.errores.length : 0,
      n_muestras: v.errores.length,
    }));
    nodosMae.sort((a, b) => b.MAE - a.MAE);
    const peoresNodos = nodosMae.slice(0, 5);
    const mejoresNodos = nodosMae.sort((a, b) => a.MAE - b.MAE).slice(0, 5);

    const payload = {
      periodo: { desde: desdeStr, hasta: hastaStr, dias },
      global: {
        MAE: Math.round(mae * 100) / 100,
        MAPE: Math.round(mape * 100) / 100,
        RMSE: Math.round(rmse * 100) / 100,
        bias: Math.round(bias * 100) / 100,
        n_muestras: resultados.length,
      },
      por_zona: porZonaArr,
      por_hora: porHoraArr,
      por_tipo_via: [],
      peores_nodos: peoresNodos.map((n) => ({ nodo_id: n.nodo_id, nombre: n.nombre, MAE: Math.round(n.MAE * 100) / 100, n_muestras: n.n_muestras })),
      mejores_nodos: mejoresNodos.map((n) => ({ nodo_id: n.nodo_id, nombre: n.nombre, MAE: Math.round(n.MAE * 100) / 100, n_muestras: n.n_muestras })),
      metodologia: 'baseline_v1_historical_validation',
    };
    if (muestreo) payload.muestreo = true;
    if (porcentaje != null) payload.porcentaje = porcentaje;
    res.json(payload);
  } catch (err) {
    console.error('[prediccion/validacion]', err.message);
    res.status(500).json({ error: 'Error validación', detail: err.message });
  }
});

/** GET /api/prediccion/zona?localidad=KENNEDY&fecha=YYYY-MM-DD&hora=HH */
router.get('/zona', async (req, res) => {
  const localidad = (req.query.localidad || '').trim();
  const fechaParam = req.query.fecha;
  const horaParam = req.query.hora;
  if (!localidad) return res.status(400).json({ error: 'localidad requerida' });
  const fecha = fechaParam ? new Date(fechaParam + 'T12:00:00Z') : new Date();
  const hora = horaParam != null ? parseInt(String(horaParam), 10) : fecha.getUTCHours();
  if (isNaN(fecha.getTime()) || hora < 0 || hora > 23) return res.status(400).json({ error: 'fecha/hora inválidos' });

  try {
    const nodosRes = await query(
      `SELECT n.id, n.node_id_externo, n.nombre, ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat
       FROM nodos n
       JOIN localidades l ON l.id = n.localidad_id AND l.nombre = $1
       WHERE n.geom IS NOT NULL
         AND EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)`,
      [localidad]
    );
    const nodos = nodosRes.rows || [];
    if (nodos.length === 0) return res.status(404).json({ error: 'No hay nodos con estudios en esa localidad' });

    const fechaStr = fecha.toISOString().slice(0, 10);
    const dow = fecha.getUTCDay();
    const predicciones = [];
    for (const nodo of nodos) {
      const hist = await query(
        `SELECT AVG(c.vol_total)::float AS prom, COUNT(*)::int AS n FROM conteos_resumen c JOIN estudios e ON e.id = c.estudio_id
         WHERE e.nodo_id = $1 AND EXTRACT(DOW FROM c.intervalo_ini) = $2 AND EXTRACT(HOUR FROM c.intervalo_ini) = $3`,
        [nodo.id, dow, hora]
      );
      let base = hist.rows[0]?.prom != null ? parseFloat(hist.rows[0].prom) : 0;
      const inc = await query(
        `SELECT i.tipo, ST_Distance(i.geom::geography, (SELECT geom::geography FROM nodos WHERE id = $1)) AS dist
         FROM incidentes i WHERE i.estado IN ('ACTIVO','PROGRAMADO') AND i.geom IS NOT NULL
         AND ST_DWithin(i.geom::geography, (SELECT geom::geography FROM nodos WHERE id = $1), $2)`,
        [nodo.id, RADIO_M]
      );
      let impacto = 0;
      for (const row of inc.rows || []) {
        impacto += (FACTOR_TIPO[row.tipo] ?? 0) * Math.max(0, 1 - (parseFloat(row.dist) || 0) / RADIO_M);
      }
      const pred = base * (1 + impacto);
      const lat = nodo.lat != null ? parseFloat(nodo.lat) : null;
      const lon = nodo.lon != null ? parseFloat(nodo.lon) : null;
      predicciones.push({ nodo_id: nodo.node_id_externo, nombre: nodo.nombre, prediccion: pred, lat, lon });
    }

    const incZona = await query(
      `SELECT i.tipo, i.subtipo, i.titulo, i.estado FROM incidentes i
       WHERE i.estado IN ('ACTIVO','PROGRAMADO') AND i.geom IS NOT NULL
         AND ST_Intersects(i.geom, (SELECT l.geom FROM localidades l WHERE l.nombre = $1 LIMIT 1))`,
      [localidad]
    ).catch(() => ({ rows: [] }));

    const sorted = predicciones.filter((p) => p.prediccion != null && !Number.isNaN(p.prediccion)).sort((a, b) => b.prediccion - a.prediccion);
    const promZona = sorted.length ? sorted.reduce((s, p) => s + p.prediccion, 0) / sorted.length : 0;
    const hotspot = sorted[0] || null;
    const coldspot = sorted[sorted.length - 1] || null;

    res.json({
      localidad,
      fecha: fechaStr,
      hora,
      prediccion_promedio_zona: Math.round(promZona * 100) / 100,
      hotspot_nodo: hotspot ? { nodo_id: hotspot.nodo_id, nombre: hotspot.nombre, prediccion: Math.round(hotspot.prediccion * 100) / 100, lat: hotspot.lat, lon: hotspot.lon } : null,
      coldspot_nodo: coldspot ? { nodo_id: coldspot.nodo_id, nombre: coldspot.nombre, prediccion: Math.round(coldspot.prediccion * 100) / 100, lat: coldspot.lat, lon: coldspot.lon } : null,
      incidentes_zona: (incZona.rows || []).map((r) => ({ tipo: r.tipo, subtipo: r.subtipo, titulo: r.titulo, estado: r.estado })),
      n_nodos: nodos.length,
      metodologia: 'baseline_v1',
    });
  } catch (err) {
    console.error('[prediccion/zona]', err.message);
    res.status(500).json({ error: 'Error zona', detail: err.message });
  }
});

export default router;
