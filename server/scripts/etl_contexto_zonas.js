/**
 * Asigna localidad_id y upz_id a los registros de contexto_eventos que tienen geom,
 * usando ST_Intersects con las tablas localidades y upz (mismo criterio que nodos en etl_zonas).
 *
 * Ejecutar después de etl:contexto y con tablas localidades/upz ya cargadas (etl:zonas).
 * Uso: node server/scripts/etl_contexto_zonas.js
 *      npm run etl:contexto-zonas
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

async function main() {
  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[etl-contexto-zonas] Tabla contexto_eventos no existe. Ejecuta npm run db:migrate.');
    process.exit(1);
  }

  const hasUpzCol = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'upz_id'`
  ).then((r) => r.rows[0]);
  if (!hasUpzCol) {
    console.error('[etl-contexto-zonas] Columna upz_id no existe en contexto_eventos. Ejecuta npm run db:migrate (011_contexto_eventos_zonas.sql).');
    process.exit(1);
  }

  // Asignar upz_id por intersección con geometría (igual que nodos)
  await query(`
    UPDATE contexto_eventos c
    SET upz_id = u.id
    FROM upz u
    WHERE ST_Intersects(c.geom, u.geom)
      AND c.geom IS NOT NULL
      AND u.geom IS NOT NULL
  `);
  const upzCount = await query(
    'SELECT COUNT(*) AS c FROM contexto_eventos WHERE upz_id IS NOT NULL'
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  await query(`
    UPDATE contexto_eventos c
    SET localidad_id = l.id
    FROM localidades l
    WHERE ST_Intersects(c.geom, l.geom)
      AND c.geom IS NOT NULL
      AND l.geom IS NOT NULL
  `);
  const locCount = await query(
    'SELECT COUNT(*) AS c FROM contexto_eventos WHERE localidad_id IS NOT NULL'
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  const conGeom = await query(
    'SELECT COUNT(*) AS c FROM contexto_eventos WHERE geom IS NOT NULL'
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
  const total = await query('SELECT COUNT(*) AS c FROM contexto_eventos').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  await closePool();
  console.log('[etl-contexto-zonas] Resumen:');
  console.log('  Con upz_id asignado:      ', upzCount, '/', conGeom, '(con geom)');
  console.log('  Con localidad_id asignado:', locCount, '/', conGeom);
  console.log('  Total contexto_eventos:   ', total);
}

main().catch((err) => {
  console.error('[etl-contexto-zonas]', err.message);
  process.exit(1);
});
