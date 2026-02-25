/**
 * Ejecuta las SQL de verificación post-ingesta y muestra resultados.
 * Uso: node server/scripts/query_incidentes_post_ingest.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../..', '.env') });

async function main() {
  console.log('-- Conteo por tipo --');
  const r1 = await query(`
    SELECT tipo, COUNT(*) AS c
    FROM incidentes
    GROUP BY tipo
    ORDER BY COUNT(*) DESC
  `);
  console.table(r1.rows);

  console.log('\n-- Eventos, manifestaciones, obras --');
  const r2 = await query(`
    SELECT
      SUM(CASE WHEN tipo='EVENTO'        THEN 1 ELSE 0 END) AS eventos,
      SUM(CASE WHEN tipo='MANIFESTACION' THEN 1 ELSE 0 END) AS manifestaciones,
      SUM(CASE WHEN tipo='OBRA'          THEN 1 ELSE 0 END) AS obras
    FROM incidentes
  `);
  console.log(r2.rows[0]);

  console.log('\n-- Geometría por tipo --');
  const r3 = await query(`
    SELECT tipo,
           COUNT(*) FILTER (WHERE geom IS NULL) AS sin_geom,
           COUNT(*) AS total
    FROM incidentes
    GROUP BY tipo
    ORDER BY total DESC
  `);
  console.table(r3.rows);

  await closePool();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
