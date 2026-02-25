/**
 * Job eventos:incidentes — Ejecuta Agéndate → contexto_eventos y luego contexto_eventos → incidentes.
 * Spawn de scripts existentes.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { startRun, endRun } from '../../lib/ingestRuns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

export async function processEventosIncidentes() {
  const runId = await startRun('eventos:incidentes');
  const steps = [
    ['server/scripts/ingest/ingest_agendate_arcgis_to_contexto_eventos.js', '--apply'],
    ['server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js', '--apply'],
  ];
  let lastError = null;
  try {
    for (const [script, ...args] of steps) {
      const result = spawnSync('node', [script, ...args], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        shell: false,
        encoding: 'utf8',
        env: { ...process.env },
      });
      if (result.status !== 0) {
        lastError = result.stderr || result.stdout || 'exit ' + result.status;
        break;
      }
    }
    const ok = !lastError;
    await endRun(runId, {
      status: ok ? 'ok' : 'failed',
      error_sample: lastError ? lastError.slice(0, 500) : null,
    });
    if (!ok) throw new Error(lastError);
    return { ok: true };
  } catch (err) {
    await endRun(runId, { status: 'failed', error_sample: err.message });
    throw err;
  }
}
