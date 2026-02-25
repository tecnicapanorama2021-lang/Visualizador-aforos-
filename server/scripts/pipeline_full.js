/**
 * Orquestador del pipeline completo: SDP, SECOP (headless), descarga, procesar, ETL PDF,
 * CKAN, datos abiertos, scraper portales, stats. Si un paso falla, se loguea y se continúa.
 *
 * Uso: node server/scripts/pipeline_full.js
 *      npm run pipeline:full
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

const useTor = !!process.env.PROXY_URL;
const sdpStep = useTor ? 'sdp:descargar:tor' : 'sdp:descargar';

const steps = [
  { name: 'secop:catalogo:headless', cmd: 'npm', args: ['run', 'secop:catalogo:headless'] },
  { name: 'secop:registrar-relevantes', cmd: 'npm', args: ['run', 'secop:registrar-relevantes'] },
  { name: sdpStep, cmd: 'npm', args: ['run', sdpStep] },
  { name: 'secop:descargar', cmd: 'npm', args: ['run', useTor ? 'secop:descargar:tor' : 'secop:descargar'] },
  { name: 'secop:procesar', cmd: 'npm', args: ['run', 'secop:procesar'] },
  { name: 'etl:pdf', cmd: 'npm', args: ['run', 'etl:pdf'] },
  { name: 'ckan:registrar-aforos', cmd: 'npm', args: ['run', 'ckan:registrar-aforos'] },
  { name: 'datos-abiertos:full', cmd: 'npm', args: ['run', 'datos-abiertos:full'] },
  { name: 'scraper:portales', cmd: 'npm', args: ['run', 'scraper:portales'] },
  { name: 'stats:fuentes', cmd: 'npm', args: ['run', 'stats:fuentes'] },
  { name: 'estudios:registrar-pdfs', cmd: 'npm', args: ['run', 'estudios:registrar-pdfs'] },
];

console.log('[pipeline-full] Iniciando pipeline (', steps.length, 'pasos )...\n');

const results = [];
for (const step of steps) {
  process.stdout.write('[pipeline-full] ' + step.name + ' ... ');
  const result = spawnSync(step.cmd, step.args, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    shell: true,
    encoding: 'utf8',
  });
  const ok = result.status === 0;
  results.push({ name: step.name, ok, status: result.status, stderr: result.stderr, stdout: result.stdout });
  if (ok) {
    console.log('OK');
  } else {
    console.log('FALLO (código', result.status + ')');
    if (result.stderr) console.log(result.stderr.slice(-500));
  }
}

console.log('\n--- Resumen pipeline ---');
let okCount = 0;
for (const r of results) {
  console.log('  ', r.ok ? '✓' : '✗', r.name);
  if (r.ok) okCount++;
}
console.log('  Total:', okCount, 'OK,', results.length - okCount, 'fallos');
process.exit(okCount === results.length ? 0 : 1);
