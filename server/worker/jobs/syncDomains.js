/**
 * Job arcgis:domains:sync — Sincroniza dominios ArcGIS a arcgis_domains_cache.
 * Spawn del script existente.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { startRun, endRun } from '../../lib/ingestRuns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

export async function processArcgisDomainsSync() {
  const runId = await startRun('arcgis:domains:sync');
  try {
    const result = spawnSync('node', ['server/scripts/arcgis/sync_domains.js'], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
      env: { ...process.env },
    });
    const ok = result.status === 0;
    await endRun(runId, {
      status: ok ? 'ok' : 'failed',
      error_sample: ok ? null : (result.stderr || result.stdout || 'exit ' + result.status).slice(0, 500),
      meta: { exitCode: result.status },
    });
    if (!ok) throw new Error(result.stderr || 'Script exited with ' + result.status);
    return { ok: true };
  } catch (err) {
    await endRun(runId, { status: 'failed', error_sample: err.message });
    throw err;
  }
}
