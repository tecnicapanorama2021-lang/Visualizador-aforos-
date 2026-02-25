/**
 * Diagnóstico: incidentes por tipo, contexto_eventos por tipo, geometría.
 * Uso: node server/scripts/diagnose_incidentes_capas.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../..', '.env') });

async function main() {
  console.log('=== incidentes: conteo por tipo ===');
  const r1 = await query(`
    SELECT tipo, COUNT(*) AS c FROM incidentes GROUP BY tipo ORDER BY c DESC
  `);
  r1.rows.forEach((row) => console.log(' ', row.tipo, row.c));

  console.log('\n=== incidentes: tipo + subtipo ===');
  const r2 = await query(`
    SELECT tipo, COALESCE(subtipo,'(null)') AS subtipo, COUNT(*) AS c
    FROM incidentes GROUP BY tipo, subtipo ORDER BY c DESC
  `);
  r2.rows.forEach((row) => console.log(' ', row.tipo, row.subtipo, row.c));

  console.log('\n=== incidentes: MANIFESTACION / EVENTO ===');
  const [man, ev] = await Promise.all([
    query(`SELECT COUNT(*) AS c FROM incidentes WHERE tipo = 'MANIFESTACION'`),
    query(`SELECT COUNT(*) AS c FROM incidentes WHERE tipo = 'EVENTO'`),
  ]);
  console.log(' MANIFESTACION:', man.rows[0].c);
  console.log(' EVENTO:', ev.rows[0].c);

  console.log('\n=== incidentes: geometría por tipo ===');
  const r3 = await query(`
    SELECT tipo,
           COUNT(*) FILTER (WHERE geom IS NULL) AS sin_geom,
           COUNT(*) AS total
    FROM incidentes GROUP BY tipo ORDER BY total DESC
  `);
  r3.rows.forEach((row) => console.log(' ', row.tipo, 'sin_geom:', row.sin_geom, 'total:', row.total));

  console.log('\n=== incidentes_sources: por source ===');
  const r4 = await query(`
    SELECT source, COUNT(*) AS c FROM incidentes_sources GROUP BY source ORDER BY c DESC
  `);
  r4.rows.forEach((row) => console.log(' ', row.source, row.c));

  console.log('\n=== contexto_eventos: por tipo (todos) ===');
  const r5 = await query(`
    SELECT tipo, COUNT(*) AS c FROM contexto_eventos GROUP BY tipo ORDER BY c DESC
  `);
  r5.rows.forEach((row) => console.log(' ', row.tipo, row.c));

  console.log('\n=== contexto_eventos: con geom por tipo ===');
  const r6 = await query(`
    SELECT tipo, COUNT(*) AS c FROM contexto_eventos WHERE geom IS NOT NULL GROUP BY tipo ORDER BY c DESC
  `);
  r6.rows.forEach((row) => console.log(' ', row.tipo, row.c));

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
