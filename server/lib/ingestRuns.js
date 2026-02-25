/**
 * Helper para registrar inicio/fin de jobs en ingest_runs (observabilidad).
 */

import { query } from '../db/client.js';

/**
 * Registra el inicio de un job y devuelve el id del run.
 * @param {string} jobName
 * @param {object} [meta] - meta jsonb opcional
 * @returns {Promise<number>} id de ingest_runs
 */
export async function startRun(jobName, meta = {}) {
  const r = await query(
    `INSERT INTO ingest_runs (job_name, status, meta) VALUES ($1, 'running', $2::jsonb) RETURNING id`,
    [jobName, JSON.stringify(meta)]
  );
  return r.rows[0].id;
}

/**
 * Actualiza el run con resultado (finished_at, status, contadores).
 * @param {number} runId
 * @param {object} result - { status: 'ok'|'failed', items_in?, items_upserted?, errors_count?, error_sample?, meta? }
 */
export async function endRun(runId, result) {
  const {
    status = 'ok',
    items_in = null,
    items_upserted = null,
    errors_count = null,
    error_sample = null,
    meta = null,
  } = result;

  await query(
    `UPDATE ingest_runs SET finished_at = now(), status = $1, items_in = $2, items_upserted = $3, errors_count = $4, error_sample = $5, meta = CASE WHEN $6::jsonb IS NOT NULL THEN COALESCE(meta, '{}'::jsonb) || $6::jsonb ELSE meta END WHERE id = $7`,
    [
      status,
      items_in,
      items_upserted,
      errors_count ?? 0,
      error_sample,
      meta ? JSON.stringify(meta) : null,
      runId,
    ]
  );
}

export default { startRun, endRun };
