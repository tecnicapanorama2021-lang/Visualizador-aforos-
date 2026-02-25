/**
 * Estadísticas de crecimiento de la base por fuente de aforos.
 * Muestra: nodos por fuente (DIM / EXTERNO), estudios por origen (DIM, SECOP, PANORAMA, CGT_SDM, etc.),
 * conteos_resumen por origen de archivo_fuente.
 *
 * Uso: node server/scripts/stats_fuentes_aforos.js
 *      npm run stats:fuentes
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

async function main() {
  console.log('--- Estadísticas por fuente de aforos ---\n');

  const nodosPorFuente = await query(
    `SELECT fuente, COUNT(*) AS total FROM nodos GROUP BY fuente ORDER BY total DESC`
  );
  console.log('Nodos por fuente (nodos.fuente):');
  for (const row of nodosPorFuente.rows) {
    const etiqueta = row.fuente === 'EXTERNO' ? 'EXTERNO (todos)' : row.fuente;
    console.log('  ', etiqueta + ':', row.total);
  }

  const estudiosPorOrigen = await query(`
    SELECT COALESCE(af.origen, 'DIM') AS origen, COUNT(*) AS total
    FROM estudios e
    LEFT JOIN archivos_fuente af ON af.id = e.archivo_fuente_id
    GROUP BY af.origen
    ORDER BY total DESC
  `);
  console.log('\nEstudios por origen (archivos_fuente.origen; DIM = sin archivo):');
  for (const row of estudiosPorOrigen.rows) {
    console.log('  ', row.origen + ':', row.total);
  }

  const conteosPorOrigen = await query(`
    SELECT COALESCE(af.origen, 'DIM') AS origen, COUNT(*) AS total
    FROM conteos_resumen c
    JOIN estudios e ON e.id = c.estudio_id
    LEFT JOIN archivos_fuente af ON af.id = e.archivo_fuente_id
    GROUP BY af.origen
    ORDER BY total DESC
  `);
  console.log('\nConteos (conteos_resumen) por origen:');
  for (const row of conteosPorOrigen.rows) {
    console.log('  ', row.origen + ':', row.total);
  }

  const archivosPendientes = await query(
    `SELECT origen, COUNT(*) AS total FROM archivos_fuente WHERE procesado = FALSE GROUP BY origen ORDER BY total DESC`
  );
  if (archivosPendientes.rows.some((r) => parseInt(r.total, 10) > 0)) {
    console.log('\nArchivos pendientes de procesar (archivos_fuente.procesado = FALSE):');
    for (const row of archivosPendientes.rows) {
      console.log('  ', row.origen + ':', row.total);
    }
  }

  const archivosPorTipo = await query(
    `SELECT tipo, COUNT(*) AS total FROM archivos_fuente GROUP BY tipo ORDER BY total DESC`
  );
  console.log('\nArchivos por tipo (archivos_fuente.tipo):');
  for (const row of archivosPorTipo.rows) {
    console.log('  ', row.tipo + ':', row.total);
  }

  const pdfStats = await query(`
    SELECT origen, COUNT(*) AS total,
           COUNT(*) FILTER (WHERE procesado = TRUE) AS procesados,
           COUNT(*) FILTER (WHERE procesado = FALSE) AS pendientes
    FROM archivos_fuente WHERE tipo = 'PDF'
    GROUP BY origen ORDER BY total DESC
  `);
  if (pdfStats.rows.length > 0) {
    console.log('\nPDF por origen (total / procesados / pendientes):');
    for (const row of pdfStats.rows) {
      console.log('  ', row.origen + ':', row.total, '| procesados:', row.procesados, '| pendientes:', row.pendientes);
    }
  }

  const hasZonas = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'localidades'`
  ).then((r) => r.rows[0]);
  if (hasZonas) {
    const totalNodos = await query('SELECT COUNT(*) AS c FROM nodos').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    const conUpz = await query('SELECT COUNT(*) AS c FROM nodos WHERE upz_id IS NOT NULL').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    const conLocalidad = await query('SELECT COUNT(*) AS c FROM nodos WHERE localidad_id IS NOT NULL').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    const sinGeom = await query('SELECT COUNT(*) AS c FROM nodos WHERE geom IS NULL').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    console.log('\n--- Cobertura geográfica de nodos ---');
    console.log('Nodos con upz_id asignado:      ', conUpz, '/', totalNodos);
    console.log('Nodos con localidad_id asignado:', conLocalidad, '/', totalNodos);
    console.log('Nodos sin geom:                 ', sinGeom);
    const topUpz = await query(
      `SELECT u.nombre, COUNT(*) AS total FROM nodos n JOIN upz u ON n.upz_id = u.id GROUP BY u.id, u.nombre ORDER BY total DESC LIMIT 5`
    );
    if (topUpz.rows.length > 0) {
      console.log('Top 5 UPZ con más nodos:', topUpz.rows.map((r) => r.nombre + ' (' + r.total + ')').join(', '));
    }
    const topLoc = await query(
      `SELECT l.nombre, COUNT(*) AS total FROM nodos n JOIN localidades l ON n.localidad_id = l.id GROUP BY l.id, l.nombre ORDER BY total DESC LIMIT 5`
    );
    if (topLoc.rows.length > 0) {
      console.log('Top 5 localidades con más nodos:', topLoc.rows.map((r) => r.nombre + ' (' + r.total + ')').join(', '));
    }
  }

  const hasCtx = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (hasCtx) {
    const ctxPorTipo = await query(
      `SELECT tipo, COUNT(*) AS total FROM contexto_eventos GROUP BY tipo ORDER BY total DESC`
    );
    const ctxPorFuente = await query(
      `SELECT fuente, COUNT(*) AS total FROM contexto_eventos WHERE fuente IS NOT NULL GROUP BY fuente ORDER BY total DESC`
    );
    console.log('\n--- contexto_eventos ---');
    if (ctxPorTipo.rows.length > 0) {
      console.log('Total por tipo:', ctxPorTipo.rows.map((r) => r.tipo + ' ' + r.total).join(' | '));
    } else {
      console.log('Total por tipo: (sin registros)');
    }
    if (ctxPorFuente.rows.length > 0) {
      console.log('Por fuente:', ctxPorFuente.rows.map((r) => r.fuente + ' ' + r.total).join(' | '));
    }
  }

  const hasEt = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'estudios_transito'`
  ).then((r) => r.rows[0]);
  if (hasEt) {
    const totalEt = await query('SELECT COUNT(*) AS c FROM estudios_transito').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    const etPorTipo = await query(
      `SELECT tipo, COUNT(*) AS total FROM estudios_transito WHERE tipo IS NOT NULL GROUP BY tipo ORDER BY total DESC`
    );
    const etPorFuente = await query(
      `SELECT fuente, COUNT(*) AS total FROM estudios_transito WHERE fuente IS NOT NULL GROUP BY fuente ORDER BY total DESC`
    );
    const conArea = await query('SELECT COUNT(*) AS c FROM estudios_transito WHERE area_influencia IS NOT NULL').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
    console.log('\n--- estudios_transito ---');
    console.log('Total estudios:', totalEt);
    if (etPorTipo.rows.length > 0) {
      console.log('Por tipo:', etPorTipo.rows.map((r) => r.tipo + ' ' + r.total).join(' | '));
    }
    if (etPorFuente.rows.length > 0) {
      console.log('Por fuente:', etPorFuente.rows.map((r) => r.fuente + ' ' + r.total).join(' | '));
    }
    console.log('Con area_influencia:', conArea, '| Sin area_influencia:', totalEt - conArea);
  }

  console.log('');
  await closePool();
}

main().catch((err) => {
  console.error('[stats-fuentes]', err.message);
  process.exit(1);
});
