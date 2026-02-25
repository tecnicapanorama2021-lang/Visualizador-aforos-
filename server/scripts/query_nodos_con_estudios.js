/**
 * Ejecuta las consultas de nodos con estudios (equivalente a los psql que pide el usuario).
 * Uso: node server/scripts/query_nodos_con_estudios.js
 * Requiere: .env con DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

async function main() {
  console.log('--- 1) Total nodos que TIENEN estudios ---\n');
  const r1 = await query(`
    SELECT COUNT(*) as total_nodos_con_estudios
    FROM nodos n
    WHERE EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)
  `);
  console.log(r1.rows[0]);
  const total = parseInt(r1.rows[0]?.total_nodos_con_estudios ?? '0', 10);
  console.log('');

  if (total === 0) {
    console.log('Total = 0 → No hay nodos con estudios en la BD.\n');
    process.exit(0);
    return;
  }

  console.log('--- 2) Primeros 10 nodos que TIENEN estudios ---\n');
  const r2 = await query(`
    SELECT
      n.id,
      n.node_id_externo,
      n.nombre,
      n.direccion,
      COUNT(e.id)::int as cant_estudios
    FROM nodos n
    INNER JOIN estudios e ON e.nodo_id = n.id
    GROUP BY n.id, n.node_id_externo, n.nombre, n.direccion
    ORDER BY cant_estudios DESC
    LIMIT 10
  `);
  console.table(r2.rows);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
