/**
 * Ejecuta las 3 consultas SQL de verificación de obras (geom types, no-point, metadata arcgis).
 * Uso: node server/scripts/verify/run_obras_geom_queries.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

async function run() {
  console.log('--- A) Tipos geométricos en OBRA ---');
  const a = await query(`
    SELECT ST_GeometryType(geom) AS tipo, COUNT(*)::int AS n
    FROM incidentes
    WHERE tipo='OBRA' AND geom IS NOT NULL
    GROUP BY 1
    ORDER BY n DESC
  `);
  console.log(JSON.stringify(a.rows, null, 2));

  console.log('\n--- B) 5 obras no-point ---');
  const b = await query(`
    SELECT id, titulo, ST_GeometryType(geom) AS tipo
    FROM incidentes
    WHERE tipo='OBRA' AND geom IS NOT NULL
      AND ST_GeometryType(geom) <> 'ST_Point'
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(b.rows, null, 2));

  console.log('\n--- C) Conteo con metadata arcgis ---');
  const c = await query(`
    SELECT COUNT(*)::int AS con_arcgis
    FROM incidentes
    WHERE tipo='OBRA'
      AND metadata ? 'arcgis'
  `);
  console.log(JSON.stringify(c.rows, null, 2));

  await closePool();
}

run().catch((e) => {
  console.error(e.message);
  closePool().then(() => process.exit(1));
});
