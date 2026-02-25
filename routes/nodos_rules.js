/**
 * API de reglas de clasificación de nodos: GET/POST/PATCH /api/nodos/rules, POST /api/nodos/rules/apply
 */

import express from 'express';
import { query } from '../server/db/client.js';
import { runApply, TAXONOMY, ALLOWED_FIELDS, ALLOWED_TYPES } from '../server/scripts/apply_nodos_rules_lib.js';

const router = express.Router();

function validateTipoNodo(tipo_nodo) {
  if (!tipo_nodo || !TAXONOMY.includes(String(tipo_nodo))) {
    return { error: `tipo_nodo debe ser uno de: ${TAXONOMY.join(', ')}` };
  }
  return null;
}
function validateMatchField(match_field) {
  if (!match_field || !ALLOWED_FIELDS.includes(String(match_field))) {
    return { error: `match_field debe ser uno de: ${ALLOWED_FIELDS.join(', ')}` };
  }
  return null;
}
function validateMatchType(match_type) {
  if (!match_type || !ALLOWED_TYPES.includes(String(match_type))) {
    return { error: `match_type debe ser uno de: ${ALLOWED_TYPES.join(', ')}` };
  }
  return null;
}

/**
 * GET /api/nodos/rules
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, enabled, priority, match_field, match_type, pattern, tipo_nodo, notes, created_at, updated_at
       FROM nodos_categoria_rules ORDER BY priority DESC, id ASC`
    );
    res.json({ rules: result.rows });
  } catch (err) {
    console.error('[nodos_rules] GET list:', err.message);
    res.status(500).json({ error: 'Error al listar reglas' });
  }
});

/**
 * POST /api/nodos/rules
 */
router.post('/', async (req, res) => {
  try {
    const { enabled, priority, match_field, match_type, pattern, tipo_nodo, notes } = req.body ?? {};
    const errTipo = validateTipoNodo(tipo_nodo);
    if (errTipo) return res.status(400).json(errTipo);
    const errField = validateMatchField(match_field);
    if (errField) return res.status(400).json(errField);
    const errType = validateMatchType(match_type);
    if (errType) return res.status(400).json(errType);
    if (pattern == null || String(pattern).trim() === '') {
      return res.status(400).json({ error: 'pattern es requerido' });
    }

    const result = await query(
      `INSERT INTO nodos_categoria_rules (enabled, priority, match_field, match_type, pattern, tipo_nodo, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING id, enabled, priority, match_field, match_type, pattern, tipo_nodo, notes, created_at, updated_at`,
      [
        enabled !== false,
        priority != null ? parseInt(priority, 10) : 0,
        String(match_field).trim(),
        String(match_type).trim(),
        String(pattern).trim(),
        String(tipo_nodo).trim(),
        notes != null ? String(notes).trim() : null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Regla duplicada (mismo match_field, match_type, pattern)' });
    console.error('[nodos_rules] POST create:', err.message);
    res.status(500).json({ error: 'Error al crear regla' });
  }
});

/**
 * POST /api/nodos/rules/apply
 * Body: { dryRun?: boolean, resetDefaults?: boolean }
 */
router.post('/apply', async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const apply = !dryRun;
    const resetDefaults = req.body?.resetDefaults === true;
    const result = await runApply({ dryRun, apply, resetDefaults });
    res.json(result);
  } catch (err) {
    console.error('[nodos_rules] POST apply:', err.message);
    res.status(500).json({ error: err.message || 'Error al aplicar reglas' });
  }
});

/**
 * PATCH /api/nodos/rules/:id
 */
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'id inválido' });

    const body = req.body ?? {};
    const updates = [];
    const values = [];
    let idx = 1;
    if (body.enabled !== undefined) {
      updates.push(`enabled = $${idx++}`);
      values.push(!!body.enabled);
    }
    if (body.priority !== undefined) {
      updates.push(`priority = $${idx++}`);
      values.push(parseInt(body.priority, 10));
    }
    if (body.match_field !== undefined) {
      const e = validateMatchField(body.match_field);
      if (e) return res.status(400).json(e);
      updates.push(`match_field = $${idx++}`);
      values.push(String(body.match_field).trim());
    }
    if (body.match_type !== undefined) {
      const e = validateMatchType(body.match_type);
      if (e) return res.status(400).json(e);
      updates.push(`match_type = $${idx++}`);
      values.push(String(body.match_type).trim());
    }
    if (body.pattern !== undefined) {
      updates.push(`pattern = $${idx++}`);
      values.push(String(body.pattern).trim());
    }
    if (body.tipo_nodo !== undefined) {
      const e = validateTipoNodo(body.tipo_nodo);
      if (e) return res.status(400).json(e);
      updates.push(`tipo_nodo = $${idx++}`);
      values.push(String(body.tipo_nodo).trim());
    }
    if (body.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(body.notes == null ? null : String(body.notes).trim());
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    updates.push(`updated_at = now()`);
    values.push(id);
    const result = await query(
      `UPDATE nodos_categoria_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, enabled, priority, match_field, match_type, pattern, tipo_nodo, notes, created_at, updated_at`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Regla no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Regla duplicada' });
    console.error('[nodos_rules] PATCH:', err.message);
    res.status(500).json({ error: 'Error al actualizar regla' });
  }
});

export default router;
