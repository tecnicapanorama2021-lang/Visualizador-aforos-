/**
 * POST /api/simular/cierre-giro
 * Body: { node_id, from_leg, to_leg, bucket, closure: true }
 * Calcula redistribución al cerrar el giro from_leg -> to_leg (determinístico, sin ML).
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();

/**
 * Resuelve node_id (puede ser id numérico o node_id_externo).
 */
async function resolveNodeId(nodeIdParam) {
  const id = parseInt(nodeIdParam, 10);
  if (Number.isFinite(id)) {
    const r = await query('SELECT id FROM nodos WHERE id = $1', [id]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const r = await query(
    'SELECT id FROM nodos WHERE node_id_externo = $1 OR nombre = $1 OR direccion ILIKE $2 LIMIT 1',
    [nodeIdParam, `%${nodeIdParam}%`]
  );
  return r.rows[0]?.id ?? null;
}

/**
 * POST /api/simular/cierre-giro
 * Body: { node_id, from_leg, to_leg, bucket, closure: true }
 * Respuesta: { before: turns[], after: turns[], delta: { closed_flow, redistributed } }
 */
router.post('/cierre-giro', async (req, res) => {
  const { node_id: nodeIdParam, from_leg, to_leg, bucket, closure } = req.body || {};
  if (!nodeIdParam || !from_leg || !to_leg) {
    return res.status(400).json({ error: 'Faltan node_id, from_leg o to_leg' });
  }
  const timebucket = bucket?.trim() || 'weekday_07:00';
  const close = closure !== false;

  try {
    const nodeId = await resolveNodeId(String(nodeIdParam));
    if (nodeId == null) return res.status(404).json({ error: 'Nodo no encontrado' });

    const turnsRes = await query(
      `SELECT from_leg_code, to_leg_code, flow_total, p_turn FROM node_turns
       WHERE node_id = $1 AND timebucket = $2 ORDER BY from_leg_code, to_leg_code`,
      [nodeId, timebucket]
    );
    const before = turnsRes.rows;

    if (before.length === 0) {
      return res.status(409).json({
        code: 'NO_TURNS_BASELINE',
        message: 'No hay turns de baseline para este nodo y bucket (solo hay node_legs o el nodo no tiene datos con movimiento).',
        node_id: nodeId,
        timebucket
      });
    }

    const closedTurn = before.find(
      (t) => t.from_leg_code === from_leg && t.to_leg_code === to_leg
    );
    const closedFlow = closedTurn ? Number(closedTurn.flow_total) || 0 : 0;

    const fromLegTurns = before.filter((t) => t.from_leg_code === from_leg);
    const totalFromFlow = fromLegTurns.reduce((s, t) => s + (Number(t.flow_total) || 0), 0);
    const sumP = fromLegTurns.reduce((s, t) => s + (Number(t.p_turn) || 0), 0);

    const after = before.map((t) => {
      const flow = Number(t.flow_total) || 0;
      if (!close || t.from_leg_code !== from_leg || t.to_leg_code !== to_leg) {
        return { ...t, flow_total: flow, flow_total_after: flow };
      }
      const flowAfter = 0;
      return { ...t, flow_total: flow, flow_total_after: flowAfter };
    });

    let redistributed = 0;
    if (close && closedFlow > 0 && fromLegTurns.length > 1) {
      const others = fromLegTurns.filter(
        (t) => !(t.from_leg_code === from_leg && t.to_leg_code === to_leg)
      );
      const totalPOthers = others.reduce((s, t) => s + (Number(t.p_turn) || 0), 0);
      for (const t of after) {
        if (
          t.from_leg_code === from_leg &&
          t.to_leg_code !== to_leg &&
          totalPOthers > 0
        ) {
          const p = Number(t.p_turn) || 0;
          const extra = (closedFlow * p) / totalPOthers;
          t.flow_total_after = (Number(t.flow_total) || 0) + extra;
          redistributed += extra;
        }
      }
    }

    return res.json({
      node_id: nodeId,
      timebucket,
      closure: close,
      before: before.map((t) => ({ ...t, flow_total: Number(t.flow_total) || 0 })),
      after: after.map((t) => ({
        from_leg_code: t.from_leg_code,
        to_leg_code: t.to_leg_code,
        flow_total_before: Number(t.flow_total) || 0,
        flow_total_after: t.flow_total_after ?? (Number(t.flow_total) || 0)
      })),
      delta: { closed_flow: closedFlow, redistributed }
    });
  } catch (e) {
    console.error('[simular] cierre-giro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
