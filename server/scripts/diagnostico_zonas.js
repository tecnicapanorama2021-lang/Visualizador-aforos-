/**
 * Diagnóstico SRID y bbox para localidades/UPZ y nodos.
 * Uso: node server/scripts/diagnostico_zonas.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../..', '.env') });

async function main() {
  console.log('=== 1) SRID nodos ===');
  const r1 = await query('SELECT DISTINCT ST_SRID(geom) AS srid FROM nodos WHERE geom IS NOT NULL');
  console.log(r1.rows);

  console.log('\n=== 2) SRID localidades ===');
  const r2 = await query('SELECT DISTINCT ST_SRID(geom) AS srid FROM localidades WHERE geom IS NOT NULL');
  console.log(r2.rows);

  console.log('\n=== 3) Bbox localidades (primeras 5) ===');
  const r3 = await query(`
    SELECT nombre,
      ST_XMin(geom::geometry) AS xmin,
      ST_YMin(geom::geometry) AS ymin,
      ST_XMax(geom::geometry) AS xmax,
      ST_YMax(geom::geometry) AS ymax
    FROM localidades WHERE geom IS NOT NULL
    LIMIT 5
  `);
  console.log(r3.rows);

  console.log('\n=== 4) Bbox nodos ===');
  const r4 = await query(`
    SELECT
      MIN(ST_X(geom)) AS xmin,
      MIN(ST_Y(geom)) AS ymin,
      MAX(ST_X(geom)) AS xmax,
      MAX(ST_Y(geom)) AS ymax
    FROM nodos WHERE geom IS NOT NULL
  `);
  console.log(r4.rows);

  console.log('\n=== 5) COUNT upz ===');
  const r5 = await query('SELECT COUNT(*) FROM upz');
  console.log(r5.rows);

  console.log('\n=== 5b) SRID y bbox UPZ (geom no null) ===');
  const r5b = await query(`
    SELECT COUNT(*) AS total,
      MIN(ST_XMin(geom::geometry)) AS xmin,
      MIN(ST_YMin(geom::geometry)) AS ymin,
      MAX(ST_XMax(geom::geometry)) AS xmax,
      MAX(ST_YMax(geom::geometry)) AS ymax
    FROM upz WHERE geom IS NOT NULL
  `);
  console.log(r5b.rows);

  console.log('\n=== 6a) ST_Within nodo x localidad (primeros 5) ===');
  const r6a = await query(`
    SELECT n.node_id_externo, n.direccion,
      ST_AsText(n.geom) AS punto,
      l.nombre AS localidad
    FROM nodos n
    CROSS JOIN localidades l
    WHERE ST_Within(n.geom, l.geom)
    LIMIT 5
  `);
  console.log(r6a.rows.length, 'filas:', r6a.rows);

  console.log('\n=== 6b) ST_Intersects nodo x localidad (primeros 5) ===');
  const r6b = await query(`
    SELECT n.node_id_externo, l.nombre AS localidad
    FROM nodos n
    CROSS JOIN localidades l
    WHERE ST_Intersects(n.geom, l.geom)
    LIMIT 5
  `);
  console.log(r6b.rows.length, 'filas:', r6b.rows);

  await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });
