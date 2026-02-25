/**
 * Rutas admin: estado de jobs (ingest_runs). Solo dev o con ADMIN_TOKEN.
 * GET /api/admin/jobs/status → últimos runs por job_name.
 */

import express from 'express';
import { query } from '../server/db/client.js';

const router = express.Router();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const IS_DEV = process.env.NODE_ENV !== 'production';

function authAdmin(req) {
  if (!ADMIN_TOKEN && IS_DEV) return true;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === ADMIN_TOKEN;
}

router.use((req, res, next) => {
  if (!authAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden: admin token required' });
  }
  next();
});

/**
 * GET /api/admin/jobs/status
 * Últimos runs por job_name (ingest_runs). Limit 50 por job o total.
 */
router.get('/jobs/status', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const byJob = await query(
      `SELECT job_name, started_at, finished_at, status, items_in, items_upserted, errors_count, error_sample, meta
       FROM ingest_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );
    const byName = {};
    for (const row of byJob.rows) {
      const name = row.job_name;
      if (!byName[name]) byName[name] = [];
      if (byName[name].length < 10) {
        byName[name].push({
          started_at: row.started_at,
          finished_at: row.finished_at,
          status: row.status,
          items_in: row.items_in,
          items_upserted: row.items_upserted,
          errors_count: row.errors_count,
          error_sample: row.error_sample ? row.error_sample.slice(0, 200) : null,
        });
      }
    }
    res.json({
      runs: byJob.rows,
      by_job: byName,
    });
  } catch (err) {
    console.error('[admin] jobs/status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
