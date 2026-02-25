/**
 * Diagnóstico: nodo 20229 y sus estudios en BD + respuesta del API.
 * Uso: node server/scripts/check_node_20229.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const NODE_ID = '20229';

async function main() {
  console.log('\n--- 1) Nodo 20229 en BD ---\n');
  const nodoRes = await query(
    `SELECT id, node_id_externo, nombre, direccion FROM nodos
     WHERE node_id_externo = $1 OR nombre = $1 OR direccion ILIKE $2 OR nombre ILIKE $2
     LIMIT 1`,
    [NODE_ID, `%${NODE_ID}%`]
  );
  const nodo = nodoRes.rows[0];
  if (!nodo) {
    console.log('No existe ningún nodo con node_id_externo o nombre =', NODE_ID);
    process.exit(0);
    return;
  }
  console.log('Nodo encontrado:', nodo);

  console.log('\n--- 2) Estudios para ese nodo (nodo_id = ' + nodo.id + ') ---\n');
  const estudiosRes = await query(
    `SELECT id, file_id_dim, tipo_estudio, fecha_inicio FROM estudios WHERE nodo_id = $1 ORDER BY fecha_inicio DESC LIMIT 5`,
    [nodo.id]
  );
  console.log('Cantidad de estudios:', estudiosRes.rows.length);
  if (estudiosRes.rows.length > 0) {
    console.log('Primeros estudios:', estudiosRes.rows);
  }

  console.log('\n--- 3) Respuesta del API (servidor en 3001) ---\n');
  try {
    const base = process.env.VITE_API_URL || 'http://localhost:3001';
    const url = `${base}/api/nodos/${encodeURIComponent(NODE_ID)}/estudios`;
    console.log('URL:', url);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    console.log('Status:', res.status);
    if (res.ok) {
      try {
        const data = JSON.parse(text);
        console.log('Respuesta:', JSON.stringify(data, null, 2));
        console.log('studies.length:', data?.studies?.length ?? 0);
      } catch (_) {
        console.log('Cuerpo (no JSON):', text.slice(0, 300));
      }
    } else {
      console.log('Cuerpo:', text.slice(0, 400));
    }
  } catch (e) {
    console.log('Error llamando al API:', e.message);
  }

  console.log('\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
