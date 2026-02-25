/**
 * Lógica compartida para aplicar reglas de clasificación de nodos.
 * Usado por apply_nodos_rules.js (CLI) y por POST /api/nodos/rules/apply (API).
 * No cierra el pool (el llamador decide).
 */

import { query } from '../db/client.js';

const VIRTUAL_HAS_ESTUDIOS = '__HAS_ESTUDIOS__';
const VIRTUAL_NO_ESTUDIOS = '__NO_ESTUDIOS__';

export const ALLOWED_FIELDS = ['nombre', 'direccion', 'fuente', 'node_id_externo', VIRTUAL_HAS_ESTUDIOS, VIRTUAL_NO_ESTUDIOS];
export const ALLOWED_TYPES = ['ILIKE', 'EQ', 'PREFIX', 'REGEX', 'VIRTUAL'];
export const TAXONOMY = ['AFORO_MANUAL', 'EVENTO', 'CONCIERTO', 'MANIFESTACION', 'OBRA', 'SEMAFORO', 'INFRAESTRUCTURA', 'OTROS'];

export function buildMatchCondition(rule, paramStart = 1) {
  const field = rule.match_field;
  const type = rule.match_type;
  const pattern = rule.pattern;
  if (type === 'VIRTUAL') {
    return { whereClause: null, params: [], virtual: true, virtualField: field };
  }
  if (!ALLOWED_FIELDS.includes(field)) throw new Error(`match_field no permitido: ${field}`);
  if (!ALLOWED_TYPES.includes(type)) throw new Error(`match_type no permitido: ${type}`);
  const col = field === 'node_id_externo' ? 'node_id_externo' : field;

  if (type === 'ILIKE') {
    return { whereClause: `${col} ILIKE '%' || $${paramStart} || '%'`, params: [pattern] };
  }
  if (type === 'EQ') {
    return { whereClause: `${col} = $${paramStart}`, params: [pattern] };
  }
  if (type === 'PREFIX') {
    return { whereClause: `${col} LIKE $${paramStart} || '%'`, params: [pattern] };
  }
  if (type === 'REGEX') {
    return { whereClause: `${col} ~ $${paramStart}`, params: [pattern] };
  }
  throw new Error(`match_type no implementado: ${type}`);
}

function confidenceForRule(rule) {
  if (rule.match_type === 'VIRTUAL') {
    if (rule.match_field === VIRTUAL_HAS_ESTUDIOS) return 95;
    if (rule.match_field === VIRTUAL_NO_ESTUDIOS) return 85;
    return 80;
  }
  if (rule.match_field === 'fuente') return 90;
  if (rule.match_field === 'nombre' || rule.match_field === 'direccion') return 70;
  return 80;
}

/**
 * Resuelve IDs de nodos para una regla VIRTUAL (__HAS_ESTUDIOS__ / __NO_ESTUDIOS__).
 * estudios.nodo_id -> nodos.id
 */
function resolveVirtualRuleNodeIds(rule, excludeIds) {
  const hasEstudios = rule.match_field === VIRTUAL_HAS_ESTUDIOS;
  const notExists = rule.match_field === VIRTUAL_NO_ESTUDIOS;
  if (!hasEstudios && !notExists) return null;

  let sql = `
    SELECT n.id FROM nodos n
    WHERE n.tipo_nodo_source != 'MANUAL'
    AND ${hasEstudios ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)
  `;
  const params = [];
  if (excludeIds && excludeIds.length > 0) {
    sql += ` AND n.id != ALL($1::int[])`;
    params.push(excludeIds);
  }
  return { sql, params };
}

/**
 * Aplica reglas a nodos. No toca tipo_nodo_source = 'MANUAL'.
 * @param {{ dryRun: boolean, apply: boolean, resetDefaults?: boolean }} opts
 * @returns {Promise<{ totalNodos: number, manualLocked: number, updatedTotal: number, unchanged: number, byTipo: Array<{tipo_nodo:string,c:string}>, updatedByRule: object, resetCount?: number }>}
 */
export async function runApply(opts) {
  const { dryRun = true, apply = false, resetDefaults = false } = opts;

  const rulesRes = await query(
    `SELECT id, enabled, priority, match_field, match_type, pattern, tipo_nodo, notes
     FROM nodos_categoria_rules WHERE enabled = TRUE ORDER BY priority DESC`
  );
  const rules = rulesRes.rows;

  const totalNodosRes = await query('SELECT COUNT(*) AS c FROM nodos');
  const manualRes0 = await query("SELECT COUNT(*) AS c FROM nodos WHERE tipo_nodo_source = 'MANUAL'");
  const byTipoRes0 = await query('SELECT tipo_nodo, COUNT(*) AS c FROM nodos GROUP BY 1 ORDER BY 2 DESC');
  if (rules.length === 0) {
    return {
      totalNodos: parseInt(totalNodosRes.rows[0].c, 10),
      manualLocked: parseInt(manualRes0.rows[0].c, 10),
      updatedTotal: 0,
      unchanged: parseInt(totalNodosRes.rows[0].c, 10) - parseInt(manualRes0.rows[0].c, 10),
      byTipo: byTipoRes0.rows.map((r) => ({ tipo_nodo: r.tipo_nodo, c: String(r.c) })),
      updatedByRule: {},
      rulesCount: 0,
    };
  }
  const totalNodos = parseInt(totalNodosRes.rows[0].c, 10);
  const manualLocked = parseInt(manualRes0.rows[0].c, 10);

  let resetCount = 0;
  if (resetDefaults && apply) {
    const resetRes = await query(
      `UPDATE nodos SET tipo_nodo = 'OTROS', tipo_nodo_source = 'DEFAULT', tipo_nodo_rule_id = NULL, tipo_nodo_confidence = NULL
       WHERE tipo_nodo_source != 'MANUAL'`
    );
    resetCount = resetRes.rowCount ?? 0;
  }

  const updatedByRule = {};
  const assignedIds = new Set();

  for (const rule of rules) {
    if (!TAXONOMY.includes(rule.tipo_nodo)) continue;
    const excludeIds = assignedIds.size > 0 ? Array.from(assignedIds) : null;

    let ids = [];
    if (rule.match_type === 'VIRTUAL') {
      const resolved = resolveVirtualRuleNodeIds(rule, excludeIds);
      if (!resolved) continue;
      const idsRes = await query(resolved.sql, resolved.params);
      ids = idsRes.rows.map((r) => r.id);
    } else {
      const { whereClause, params } = buildMatchCondition(rule);
      if (!whereClause) continue;
      let selectSql = `
        SELECT id FROM nodos
        WHERE tipo_nodo_source != 'MANUAL' AND (${whereClause})
      `;
      const selectParams = [...params];
      if (excludeIds && excludeIds.length > 0) {
        selectSql += ` AND id != ALL($${selectParams.length + 1}::int[])`;
        selectParams.push(excludeIds);
      }
      const idsRes = await query(selectSql, selectParams);
      ids = idsRes.rows.map((r) => r.id);
    }

    if (ids.length === 0) continue;

    const confidence = confidenceForRule(rule);
    updatedByRule[rule.id] = { count: ids.length, tipo_nodo: rule.tipo_nodo, priority: rule.priority };

    if (apply) {
      await query(
        `UPDATE nodos SET tipo_nodo = $1, tipo_nodo_source = 'RULE', tipo_nodo_rule_id = $2, tipo_nodo_confidence = $3, updated_at = now()
         WHERE id = ANY($4::int[])`,
        [rule.tipo_nodo, rule.id, confidence, ids]
      );
      ids.forEach((id) => assignedIds.add(id));
    }
  }

  const updatedTotal = Object.values(updatedByRule).reduce((s, o) => s + o.count, 0);
  const unchanged = Math.max(0, totalNodos - manualLocked - updatedTotal);

  const byTipoRes = await query(
    'SELECT tipo_nodo, COUNT(*) AS c FROM nodos GROUP BY 1 ORDER BY 2 DESC'
  );
  const byTipo = byTipoRes.rows.map((r) => ({ tipo_nodo: r.tipo_nodo, c: String(r.c) }));

  return {
    totalNodos,
    manualLocked,
    updatedTotal,
    unchanged,
    byTipo,
    updatedByRule,
    rulesCount: rules.length,
    ...(resetDefaults && apply ? { resetCount } : {}),
  };
}
