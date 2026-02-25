/**
 * Inspecciona el historial de un nodo (misma lógica que GET /api/aforos/historial/:nodeId).
 * Uso: node server/scripts/inspect_node_historial.js <node_id_externo>
 * Ejemplo: node server/scripts/inspect_node_historial.js ext-3-1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h}:${String(m).padStart(2, '0')}`;
}

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

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[inspect] Configura DATABASE_URL o PGHOST/PGDATABASE/...');
    process.exit(1);
  }

  const nodeId = process.argv[2]?.trim();
  if (!nodeId) {
    console.error('Uso: node server/scripts/inspect_node_historial.js <node_id_externo>');
    console.error('Ejemplo: node server/scripts/inspect_node_historial.js ext-3-1');
    process.exit(1);
  }

  const nodoRes = await query(
    'SELECT id, node_id_externo, nombre, direccion FROM nodos WHERE node_id_externo = $1',
    [nodeId]
  );
  const nodo = nodoRes.rows[0];
  if (!nodo) {
    console.error('Nodo no encontrado:', nodeId);
    await closePool();
    process.exit(1);
  }

  const estudiosRes = await query(
    `SELECT id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin
     FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio`,
    [nodo.id]
  );
  const estudios = estudiosRes.rows;
  const address = nodo.direccion || nodo.nombre || nodeId;

  const volDataByEstudio = [];
  for (const e of estudios) {
    const conteosRes = await query(
      `SELECT sentido, intervalo_ini, intervalo_fin, vol_total
       FROM conteos_resumen WHERE estudio_id = $1 ORDER BY intervalo_ini`,
      [e.id]
    );
    const conteos = conteosRes.rows;
    const vol_data_completo = conteos.map((c) => ({
      sentido: c.sentido,
      horaRango:
        c.intervalo_ini && c.intervalo_fin
          ? `${formatTime(c.intervalo_ini)} - ${formatTime(c.intervalo_fin)}`
          : null,
      total: c.vol_total,
    }));
    volDataByEstudio.push(vol_data_completo);
  }

  await closePool();

  console.log('node_id:', nodeId);
  console.log('address:', address);
  console.log('número de estudios:', estudios.length);
  const firstVolData = volDataByEstudio[0] || [];
  console.log('filas vol_data_completo (primer estudio):', firstVolData.length);
  console.log('primeros 3 intervalos:');
  firstVolData.slice(0, 3).forEach((row, i) => {
    console.log(`  ${i + 1}. sentido=${row.sentido} horaRango=${row.horaRango} total=${row.total}`);
  });
}

main().catch((err) => {
  console.error('[inspect] Error:', err.message);
  process.exit(1);
});
