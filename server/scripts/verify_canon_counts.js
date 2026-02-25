/**
 * LEGACY – Verifica obras_canonica/eventos_canonica. La fuente canónica actual es incidentes (ver /api/debug/incidentes-stats).
 *
 * Verificación: conteos de endpoints por capa (api/obras/nodos, etc.) deben coincidir con tablas canónicas.
 * Sanity: ningún ítem OBRA debe aparecer en /api/eventos/nodos.
 *
 * Uso: node server/scripts/verify_canon_counts.js
 *      API_BASE=http://localhost:3001 node server/scripts/verify_canon_counts.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const API_BASE = process.env.API_BASE || process.env.API_URL || 'http://localhost:3001';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

async function fetchCount(url) {
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.features) ? data.features.length : 0;
}

async function main() {
  const failures = [];
  console.log('Verificación de conteos canónicos (API_BASE=', API_BASE, ')\n');

  // 1) Conteos desde BD canónica
  let obrasCanCount = 0;
  let eventosCanCount = 0;
  let manifestacionesCanCount = 0;
  try {
    obrasCanCount = await query('SELECT COUNT(*) AS c FROM obras_canonica WHERE geom IS NOT NULL').then((r) =>
      parseInt(r.rows[0]?.c ?? 0, 10)
    );
    eventosCanCount = await query(
      `SELECT COUNT(*) AS c FROM eventos_canonica WHERE geom IS NOT NULL AND tipo_evento IN ('EVENTO_CULTURAL', 'EVENTO')`
    ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    manifestacionesCanCount = await query(
      `SELECT COUNT(*) AS c FROM eventos_canonica WHERE geom IS NOT NULL AND tipo_evento = 'MANIFESTACION'`
    ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
  } catch (e) {
    console.error('BD:', e.message);
    await closePool();
    process.exit(1);
  }

  // 2) Conteos desde API (requiere servidor levantado)
  let apiObras = 0;
  let apiEventos = 0;
  let apiManif = 0;
  try {
    apiObras = await fetchCount(`${API_BASE}/api/obras/nodos`);
    apiEventos = await fetchCount(`${API_BASE}/api/eventos/nodos`);
    apiManif = await fetchCount(`${API_BASE}/api/manifestaciones/nodos`);
  } catch (e) {
    console.error('API:', e.message);
    console.log('Asegúrate de que el backend esté levantado (npm run dev:api).');
    await closePool();
    process.exit(1);
  }

  console.log('  Obras:        BD obras_canonica =', obrasCanCount, ' | API /api/obras/nodos =', apiObras);
  console.log('  Eventos:      BD eventos_canonica (EVENTO_CULTURAL/EVENTO) =', eventosCanCount, ' | API =', apiEventos);
  console.log('  Manifestaciones: BD eventos_canonica (MANIFESTACION) =', manifestacionesCanCount, ' | API =', apiManif);

  if (obrasCanCount !== apiObras) failures.push('obras: BD ' + obrasCanCount + ' != API ' + apiObras);
  if (eventosCanCount !== apiEventos) failures.push('eventos: BD ' + eventosCanCount + ' != API ' + apiEventos);
  if (manifestacionesCanCount !== apiManif)
    failures.push('manifestaciones: BD ' + manifestacionesCanCount + ' != API ' + apiManif);

  // 3) Sanity: ningún OBRA en eventos (clasificación correcta: OBRA solo en obras_canonica)
  const eventosConTipoObra = await query(
    `SELECT COUNT(*) AS c FROM eventos_canonica WHERE tipo_evento = 'OBRA'`
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
  if (eventosConTipoObra > 0) {
    failures.push('sanity: eventos_canonica no debe tener tipo_evento=OBRA (encontrados: ' + eventosConTipoObra + ')');
  }
  console.log('  Sanity (tipo_evento != OBRA en eventos_canonica):', eventosConTipoObra === 0 ? 'OK' : 'FAIL');

  await closePool();

  if (failures.length > 0) {
    console.log('\nFALLOS:', failures.join('; '));
    process.exit(1);
  }
  console.log('\nTodos los conteos coinciden y sanity OK.');
  process.exit(0);
}

main();
