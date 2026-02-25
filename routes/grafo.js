/**
 * GET /api/grafo/nodos/:nodeId/legs
 * GET /api/grafo/nodos/:nodeId/turns?bucket=weekday_07:00
 * GET /api/grafo/nodos/:nodeId/baseline
 * Resuelve nodeId (externo o nombre) a nodos.id para consultar node_legs y node_turns.
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

async function resolveNodeId(nodeIdParam) {
  const r = await query(
    `SELECT id FROM nodos WHERE node_id_externo = $1 OR nombre = $1 OR direccion ILIKE $2 OR nombre ILIKE $2 LIMIT 1`,
    [nodeIdParam, `%${nodeIdParam}%`]
  );
  return r.rows[0]?.id ?? null;
}

/**
 * GET /api/grafo/nodos/:nodeId/legs
 * Respuesta: { node_id, legs: [ { leg_code, bearing_deg, meta } ] }
 */
router.get('/nodos/:nodeId/legs', async (req, res) => {
  const nodeIdParam = req.params.nodeId?.trim();
  if (!nodeIdParam) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodeId = await resolveNodeId(nodeIdParam);
    if (nodeId == null) return res.status(404).json({ error: 'Nodo no encontrado' });
    const r = await query(
      'SELECT leg_code, bearing_deg, meta FROM node_legs WHERE node_id = $1 ORDER BY leg_code',
      [nodeId]
    );
    return res.json({ node_id: nodeId, legs: r.rows });
  } catch (e) {
    console.error('[grafo] legs:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/grafo/nodos/:nodeId/turns?bucket=weekday_07:00
 * Respuesta: { node_id, timebucket, turns: [ { from_leg_code, to_leg_code, flow_total, p_turn, quality } ] }
 */
router.get('/nodos/:nodeId/turns', async (req, res) => {
  const nodeIdParam = req.params.nodeId?.trim();
  const bucket = req.query.bucket?.trim();
  if (!nodeIdParam) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodeId = await resolveNodeId(nodeIdParam);
    if (nodeId == null) return res.status(404).json({ error: 'Nodo no encontrado' });
    let sql = 'SELECT from_leg_code, to_leg_code, flow_total, p_turn, quality FROM node_turns WHERE node_id = $1';
    const params = [nodeId];
    if (bucket) {
      sql += ' AND timebucket = $2';
      params.push(bucket);
    }
    sql += ' ORDER BY from_leg_code, to_leg_code';
    const r = await query(sql, params);
    return res.json({
      node_id: nodeId,
      timebucket: bucket || null,
      turns: r.rows
    });
  } catch (e) {
    console.error('[grafo] turns:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/grafo/nodos/:nodeId/baseline
 * Respuesta: resumen de turns (top por flujo) y buckets disponibles.
 */
router.get('/nodos/:nodeId/baseline', async (req, res) => {
  const nodeIdParam = req.params.nodeId?.trim();
  if (!nodeIdParam) return res.status(400).json({ error: 'nodeId requerido' });
  try {
    const nodeId = await resolveNodeId(nodeIdParam);
    if (nodeId == null) return res.status(404).json({ error: 'Nodo no encontrado' });
    const bucketsRes = await query(
      'SELECT DISTINCT timebucket FROM node_turns WHERE node_id = $1 ORDER BY timebucket',
      [nodeId]
    );
    const topTurns = await query(
      `SELECT from_leg_code, to_leg_code, timebucket, flow_total, p_turn
       FROM node_turns WHERE node_id = $1 ORDER BY flow_total DESC LIMIT 20`,
      [nodeId]
    );
    return res.json({
      node_id: nodeId,
      timebuckets: bucketsRes.rows.map((r) => r.timebucket),
      top_turns: topTurns.rows
    });
  } catch (e) {
    console.error('[grafo] baseline:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
