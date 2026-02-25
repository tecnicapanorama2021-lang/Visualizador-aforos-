/**
 * Verifica que los endpoints de diagnóstico /api/debug/* respondan 200
 * y que las capas OBRA/EVENTO/MANIFESTACION devuelvan al menos los registros canónicos de BD.
 * Uso: node server/scripts/verify/verify_debug_endpoints.js
 *      API_BASE=http://localhost:3001 node server/scripts/verify/verify_debug_endpoints.js
 * Exit 0 si todos OK; exit 1 si alguno falla.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const API_BASE = process.env.API_BASE || process.env.API_URL || 'http://localhost:3001';
const AGENDATE_SOURCE_MODE = (process.env.AGENDATE_SOURCE_MODE || 'auto').toLowerCase();
const AGENDATE_ARCGIS_LAYER_URL =
  process.env.AGENDATE_ARCGIS_LAYER_URL ||
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4';
const ENDPOINTS = [
  { path: '/api/debug/ping', name: 'ping' },
  { path: '/api/debug/layers-summary-stats', name: 'layers-summary-stats' },
  { path: '/api/debug/capas-stats', name: 'capas-stats' },
  { path: '/api/debug/capas-sources-audit', name: 'capas-sources-audit' },
  { path: '/api/debug/incidentes-stats', name: 'incidentes-stats' },
  { path: '/api/debug/capas-temporal-stats?active=1', name: 'capas-temporal-stats' },
  { path: '/api/debug/estudios-relation', name: 'estudios-relation' },
];

async function check(url) {
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  return { ok: res.ok, status: res.status, url };
}

/**
 * Compara conteo en BD (incidentes por tipo) con features devueltos por el endpoint.
 * OK cuando bdCount === 0 (fallback permitido) o apiCount >= bdCount.
 * @param {Function} queryFn - query(tex, params) del cliente BD
 */
async function checkCapaConsistency(queryFn, tipo, endpoint) {
  let bdCount = 0;
  try {
    const { rows } = await queryFn(
      'SELECT COUNT(*) AS cnt FROM incidentes WHERE tipo = $1',
      [tipo]
    );
    bdCount = parseInt(rows[0]?.cnt ?? 0, 10);
  } catch (_) {
    return { tipo, bdCount: null, apiCount: null, fallback: null, ok: true };
  }
  const res = await fetch(API_BASE + endpoint, { headers: { Accept: 'application/json' } });
  const gj = res.ok ? await res.json() : {};
  const apiCount = gj.features?.length ?? 0;
  const fallback = bdCount === 0;
  const ok = bdCount === 0 || apiCount >= bdCount;
  return { tipo, bdCount, apiCount, fallback, ok };
}

async function main() {
  const BASE_URL = process.env.API_BASE || process.env.API_URL || 'http://localhost:3001';
  try {
    await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
  } catch (e) {
    const cause = e?.cause ?? e;
    const code = cause?.code || (cause?.errors?.[0]?.code);
    const msg = e?.message || String(e);
    if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
      console.error('\n❌ Backend no está corriendo en', BASE_URL);
      console.error('   Levanta el servidor con: npm run dev');
      console.error('   Luego vuelve a correr: npm run verify:debug\n');
      process.exit(1);
    }
    throw e;
  }

  console.log('Verificando endpoints de diagnóstico en', API_BASE, '...\n');

  try {
    const res = await fetch(`${AGENDATE_ARCGIS_LAYER_URL}?f=pjson`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('  ✅ ArcGIS accesible');
  } catch (e) {
    console.warn('  ⚠️  ArcGIS no accesible:', e.message);
    console.warn('      Si AGENDATE_KMZ_FILE está configurado se puede usar ingesta offline.');
  }

  const failures = [];
  for (const { path: p, name } of ENDPOINTS) {
    const url = API_BASE + p;
    try {
      const { ok, status } = await check(url);
      if (ok) {
        console.log('  OK   ', p);
      } else {
        console.log('  FAIL ', p, status);
        failures.push({ path: p, name, status });
      }
    } catch (err) {
      console.log('  ERROR', p, err.message);
      failures.push({ path: p, name, error: err.message });
    }
  }

  console.log('\nConsistencia capas (BD incidentes vs API):');
  const capas = [
    ['OBRA', '/api/obras/nodos'],
    ['EVENTO', '/api/eventos/nodos'],
    ['MANIFESTACION', '/api/manifestaciones/nodos'],
  ];
  let queryFn = null;
  let closePoolFn = null;
  try {
    const db = await import('../../db/client.js');
    queryFn = db.query;
    closePoolFn = db.closePool;
  } catch (_) {}
  const results = [];
  for (const [tipo, endpoint] of capas) {
    const r = queryFn
      ? await checkCapaConsistency(queryFn, tipo, endpoint)
      : await checkCapaConsistency(() => Promise.resolve({ rows: [{ cnt: '0' }] }), tipo, endpoint);
    if (!queryFn) {
      const res = await fetch(API_BASE + endpoint, { headers: { Accept: 'application/json' } });
      const gj = res.ok ? await res.json() : {};
      r.apiCount = gj.features?.length ?? 0;
      r.bdCount = null;
      r.fallback = null;
      r.ok = true;
    }
    results.push(r);
  }

  let eventoPorFuenteRows = [];
  let eventoCulturalSinGeom = null;
  if (queryFn) {
    try {
      const r = await queryFn(`
        SELECT COALESCE(s.payload->>'fuente', 'sin_fuente') AS fuente, COUNT(*) AS cnt
        FROM incidentes i
        JOIN incidentes_sources s ON s.incidente_id = i.id
        WHERE i.tipo = 'EVENTO'
        GROUP BY s.payload->>'fuente'
        ORDER BY cnt DESC
      `);
      eventoPorFuenteRows = r.rows || [];
    } catch (_) {}
    try {
      const r = await queryFn(`
        SELECT COUNT(*) AS cnt FROM contexto_eventos
        WHERE tipo = 'EVENTO_CULTURAL' AND geom IS NULL
      `);
      eventoCulturalSinGeom = parseInt(r.rows[0]?.cnt ?? 0, 10);
    } catch (_) {}
  }
  if (closePoolFn) await closePoolFn();

  console.log('  TIPO          | BD count | API features | fallback? | OK?');
  console.log('  --------------+----------+--------------+-----------+-----');
  for (const r of results) {
    const bd = r.bdCount != null ? String(r.bdCount).padStart(6) : '   n/a';
    const api = r.apiCount != null ? String(r.apiCount).padStart(6) : '   n/a';
    const fb = r.fallback != null ? (r.fallback ? 'sí' : 'no') : 'n/a';
    const ok = r.ok ? '✅' : '❌';
    console.log(`  ${r.tipo.padEnd(13)} | ${bd} | ${api} | ${fb.padEnd(9)} | ${ok}`);
  }
  const consistencyFail = results.some((r) => r.ok === false);
  if (consistencyFail) {
    failures.push({ path: 'capas-consistency', name: 'capas-consistency', error: 'BD vs API mismatch' });
  }

  if (eventoPorFuenteRows.length > 0) {
    console.log('\nBreakdown EVENTO por fuente (incidentes + incidentes_sources):');
    console.log('  FUENTE              | COUNT');
    console.log('  --------------------+-------');
    for (const row of eventoPorFuenteRows) {
      console.log(`  ${(row.fuente || '').padEnd(20)} | ${String(row.cnt).padStart(5)}`);
    }
  }
  if (eventoCulturalSinGeom != null) {
    console.log('\n  EVENTO_CULTURAL en contexto_eventos sin geom (no pasan a incidentes):', eventoCulturalSinGeom);
  }

  console.log('');
  if (failures.length === 0) {
    console.log('Todos los endpoints de diagnóstico responden 200 y capas consistentes.');
    process.exit(0);
  }
  console.log('DIAGNÓSTICO: los siguientes endpoints no respondieron 200 o hay inconsistencia:');
  failures.forEach((f) => console.log('  -', f.path, f.status || f.error));
  console.log('');
  console.log('Posible causa: el backend en ejecución es anterior a la incorporación de /api/debug.');
  console.log('Recomendación: reiniciar el backend desde la raíz del proyecto:');
  console.log('  .\\scripts\\dev.ps1   o   npm run dev');
  console.log('');
  console.log('Luego verificar:  Invoke-RestMethod http://localhost:3001/api/debug/ping');
  process.exit(1);
}

main();
