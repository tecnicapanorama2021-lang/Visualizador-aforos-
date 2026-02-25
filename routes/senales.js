/**
 * API de señales de impacto vial (tipo Waze).
 * GET /api/senales/activas — señales activas (now >= start_at - 2h AND now <= end_at + 2h)
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

function toISO(d) {
  if (d == null) return null;
  try {
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x.toISOString();
  } catch (_) {
    return null;
  }
}

/** GET /api/senales/activas — señales activas con buffer ±2h */
router.get('/activas', async (req, res) => {
  try {
    const hasTable = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'eventos_impacto'`
    ).then((r) => r.rows[0]);
    if (!hasTable) {
      return res.json([]);
    }

    const bufferH = 2;
    const now = new Date();
    const nowMinus2h = new Date(now.getTime() - bufferH * 3600000).toISOString();
    const nowPlus2h = new Date(now.getTime() + bufferH * 3600000).toISOString();

    const result = await query(
      `SELECT
        i.id AS incidente_id,
        i.tipo,
        i.titulo,
        ei.impacto_nivel,
        ei.impacto_radio_m,
        ei.impacto_factor,
        i.start_at,
        i.end_at,
        ST_X(ST_Centroid(i.geom)::geometry) AS lng,
        ST_Y(ST_Centroid(i.geom)::geometry) AS lat
       FROM incidentes i
       JOIN eventos_impacto ei ON ei.incidente_id = i.id
       WHERE i.geom IS NOT NULL
         AND i.start_at IS NOT NULL
         AND i.end_at IS NOT NULL
         AND i.start_at <= $1::timestamptz
         AND i.end_at >= $2::timestamptz`,
      [nowPlus2h, nowMinus2h]
    );

    const rows = result.rows;
    const senales = rows.map((row) => ({
      incidente_id: row.incidente_id,
      tipo: row.tipo,
      titulo: row.titulo || null,
      impacto_nivel: row.impacto_nivel,
      impacto_radio_m: row.impacto_radio_m,
      impacto_factor: parseFloat(row.impacto_factor),
      geom: row.lng != null && row.lat != null ? { type: 'Point', coordinates: [row.lng, row.lat] } : null,
      start_at: toISO(row.start_at),
      end_at: toISO(row.end_at),
    }));

    res.json(senales);
  } catch (err) {
    console.error('[Senales] GET activas:', err.message);
    res.status(500).json({ error: 'Error al obtener señales activas' });
  }
});

export default router;
