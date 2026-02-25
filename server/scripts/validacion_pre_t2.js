/**
 * Mini validación pre-T2: comprobar que 2–3 nodos tienen estudios y conteos en BD
 * y que la API devuelve bien las curvas (historico, vol_data_completo).
 *
 * Uso: node server/scripts/validacion_pre_t2.js
 * Requiere: BD cargada (db:full-load), opcional: API en marcha (npm run dev:api) en puerto 3001
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

const NODE_IDS = ['171', '136', '466'];
const API_BASE = process.env.API_BASE || 'http://localhost:3001';

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

async function checkDb(nodeId) {
  const res = await query(
    `SELECT
       n.id AS nodo_id,
       n.node_id_externo,
       n.direccion,
       (SELECT COUNT(*) FROM estudios e WHERE e.nodo_id = n.id) AS num_estudios,
       (SELECT COUNT(*) FROM conteos_resumen c
        JOIN estudios e ON e.id = c.estudio_id
        WHERE e.nodo_id = n.id) AS num_conteos
     FROM nodos n
     WHERE n.node_id_externo = $1`,
    [nodeId]
  );
  return res.rows[0] || null;
}

async function checkApi(nodeId) {
  const url = `${API_BASE}/api/aforos/historial/${nodeId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return { ok: false, status: r.status, error: await r.text().catch(() => '') };
    const data = await r.json();
    const historico = data.historico || [];
    const first = historico[0];
    const volData = first?.analisis?.vol_data_completo || [];
    const distribucion = first?.analisis?.distribucion_hora_pico || [];
    const curvesOk =
      Array.isArray(volData) && volData.length > 0 &&
      volData.every(
        (row) =>
          row && typeof row.sentido !== 'undefined' && (row.horaRango != null || row.total != null)
      );
    return {
      ok: true,
      node_id: data.node_id,
      address: data.address,
      num_estudios: historico.length,
      vol_data_len: volData.length,
      distribucion_len: distribucion.length,
      curvesOk,
      sample:
        volData.length > 0
          ? {
              sentido: volData[0].sentido,
              horaRango: volData[0].horaRango,
              total: volData[0].total,
              hasClasses: !!volData[0].classes,
            }
          : null,
    };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, error: e.message || String(e) };
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[validación] Configura DATABASE_URL o PGHOST/PGDATABASE/...');
    process.exit(1);
  }

  console.log('=== Validación pre-T2 ===\n');
  console.log('NodeIds a comprobar:', NODE_IDS.join(', '));
  console.log('');

  let dbOk = 0;
  let apiOk = 0;
  let apiSkipped = false;

  for (const nodeId of NODE_IDS) {
    console.log(`--- nodeId ${nodeId} ---`);

    const row = await checkDb(nodeId);
    if (!row) {
      console.log('  BD: nodo no encontrado.');
      continue;
    }

    const estudiosOk = (row.num_estudios || 0) >= 2;
    const conteosOk = (row.num_conteos || 0) >= 1;
    if (estudiosOk && conteosOk) dbOk++;

    console.log('  BD:');
    console.log(`    estudios: ${row.num_estudios} ${estudiosOk ? '✓ (varios)' : '(se esperan varios)'}`);
    console.log(`    conteos_resumen: ${row.num_conteos} ${conteosOk ? '✓' : ''}`);
    console.log(`    direccion: ${(row.direccion || '').slice(0, 50)}${(row.direccion || '').length > 50 ? '...' : ''}`);

    const api = await checkApi(nodeId);
    if (!api.ok) {
      if (!apiSkipped) {
        console.log('  API: no disponible (¿servidor en marcha? npm run dev:api)');
        apiSkipped = true;
      }
      console.log(`    ${api.error || api.error || 'status ' + (api.status || '')}`);
      continue;
    }

    apiSkipped = false;
    if (api.curvesOk && api.num_estudios > 0) apiOk++;
    console.log('  API:');
    console.log(`    historico.length: ${api.num_estudios} ✓`);
    console.log(`    vol_data_completo (primer estudio): ${api.vol_data_len} filas ${api.curvesOk ? '✓' : ''}`);
    if (api.sample) {
      console.log(`    muestra: sentido=${api.sample.sentido}, horaRango=${api.sample.horaRango}, total=${api.sample.total}, classes=${api.sample.hasClasses ? 'sí' : 'no'}`);
    }
    console.log('');
  }

  await closePool();

  console.log('=== Resumen ===');
  const expected = NODE_IDS.length;
  console.log(`Nodos con varios estudios y conteos en BD: ${dbOk}/${expected}`);
  if (!apiSkipped) {
    console.log(`Nodos con API correcta (curvas): ${apiOk}/${expected}`);
  } else {
    console.log('API no probada (levanta el servidor y vuelve a ejecutar para comprobar curvas).');
  }

  if (dbOk >= 2) {
    console.log('\n✓ Validación BD OK. Listo para avanzar a Tarea 2.');
  } else {
    console.log('\n⚠ Revisa la carga ETL (npm run db:full-load) o que los nodeId existan en la BD.');
  }
}

main().catch((err) => {
  console.error('[validación] Error:', err.message);
  process.exit(1);
});
