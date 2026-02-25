/**
 * Prueba de oro: verifica que el snapshot (o ArcGIS) está alimentando eventos mapeables.
 * Ejecutar después de:
 *   npm run ingest:agendate:arcgis:apply
 *   npm run ingest:eventos:incidentes -- --apply
 *
 * Tres chequeos con evidencia (SQL):
 * A) contexto_eventos AGENDATE_SNAPSHOT: total, con_geom, con_fecha, listos (geom+fechas)
 * B) incidentes.EVENTO canónicos
 * C) Eventos activos ahora y próximos 7 días
 *
 * Uso: node server/scripts/verify/verify_agendate_eventos_flow.js
 *      npm run verify:agendate:eventos
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  console.log('\n=== Prueba de oro: snapshot → eventos mapeables ===\n');

  let snapshotRows = [];
  let arcgisRows = [];
  let incidentesEventoCount = 0;
  let activosNow = 0;
  let proximos7d = 0;

  let tabla7Rows = [];
  try {
    const a = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE geom IS NOT NULL) AS con_geom,
        COUNT(*) FILTER (WHERE fecha_inicio IS NOT NULL) AS con_fecha,
        COUNT(*) FILTER (WHERE geom IS NOT NULL AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL) AS listos
      FROM contexto_eventos
      WHERE fuente = 'AGENDATE_SNAPSHOT'
        AND tipo = 'EVENTO_CULTURAL'
    `);
    snapshotRows = a.rows || [];
  } catch (err) {
    console.error('A) Error leyendo contexto_eventos (AGENDATE_SNAPSHOT):', err.message);
  }

  try {
    const a2 = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE geom IS NOT NULL AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL) AS listos
      FROM contexto_eventos
      WHERE fuente = 'AGENDATE_ARCGIS'
        AND tipo = 'EVENTO_CULTURAL'
    `);
    arcgisRows = a2.rows || [];
  } catch (err) {
    console.error('A) Error leyendo contexto_eventos (AGENDATE_ARCGIS):', err.message);
  }

  try {
    const a3 = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE geom IS NOT NULL AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL) AS listos
      FROM contexto_eventos
      WHERE fuente = 'AGENDATE_SNAPSHOT_TABLA7'
        AND tipo = 'EVENTO_CULTURAL'
    `);
    tabla7Rows = a3.rows || [];
  } catch (err) {
    console.error('A) Error leyendo contexto_eventos (AGENDATE_SNAPSHOT_TABLA7):', err.message);
  }

  let relatedRows = [];
  try {
    const a4 = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE geom IS NOT NULL AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL) AS listos
      FROM contexto_eventos
      WHERE fuente = 'AGENDATE_ARCGIS_MANUAL_RELATED'
        AND tipo = 'EVENTO_CULTURAL'
    `);
    relatedRows = a4.rows || [];
  } catch (err) {
    console.error('A) Error leyendo contexto_eventos (AGENDATE_ARCGIS_MANUAL_RELATED):', err.message);
  }

  let tabla7UnreliableGeom = 0;
  try {
    const unreliable = await query(`
      SELECT COUNT(*) AS c
      FROM contexto_eventos
      WHERE fuente = 'AGENDATE_SNAPSHOT_TABLA7'
        AND tipo = 'EVENTO_CULTURAL'
        AND geom IS NOT NULL
        AND (
          datos_extra->>'match_method' = 'contains'
          OR datos_extra->>'reason' = 'LOCALIDAD'
          OR datos_extra->>'reason' ILIKE '%LOCALIDAD%'
        )
    `);
    tabla7UnreliableGeom = parseInt(unreliable.rows[0]?.c ?? 0, 10);
  } catch (err) {
    console.error('A) Error chequeo geom no confiable (tabla7):', err.message);
  }

  try {
    const b = await query(`
      SELECT COUNT(*) AS eventos_canonicos
      FROM incidentes
      WHERE tipo = 'EVENTO'
    `);
    incidentesEventoCount = parseInt(b.rows[0]?.eventos_canonicos ?? 0, 10);
  } catch (err) {
    console.error('B) Error leyendo incidentes:', err.message);
  }

  try {
    const c1 = await query(`
      SELECT COUNT(*) AS activos
      FROM incidentes
      WHERE tipo = 'EVENTO'
        AND start_at <= now()
        AND end_at >= now()
    `);
    activosNow = parseInt(c1.rows[0]?.activos ?? 0, 10);

    const c2 = await query(`
      SELECT COUNT(*) AS proximos_7d
      FROM incidentes
      WHERE tipo = 'EVENTO'
        AND start_at > now()
        AND start_at <= now() + interval '7 days'
    `);
    proximos7d = parseInt(c2.rows[0]?.proximos_7d ?? 0, 10);
  } catch (err) {
    console.error('C) Error leyendo activos/próximos:', err.message);
  }

  await closePool();

  const row = snapshotRows[0];
  const total = parseInt(row?.total ?? 0, 10);
  const con_geom = parseInt(row?.con_geom ?? 0, 10);
  const con_fecha = parseInt(row?.con_fecha ?? 0, 10);
  const listos = parseInt(row?.listos ?? 0, 10);

  const rowArc = arcgisRows[0];
  const totalArc = parseInt(rowArc?.total ?? 0, 10);
  const listosArc = parseInt(rowArc?.listos ?? 0, 10);

  const rowT7 = tabla7Rows[0];
  const totalT7 = parseInt(rowT7?.total ?? 0, 10);
  const listosT7 = parseInt(rowT7?.listos ?? 0, 10);

  const rowRel = relatedRows[0];
  const totalRel = parseInt(rowRel?.total ?? 0, 10);
  const listosRel = parseInt(rowRel?.listos ?? 0, 10);

  console.log('A) contexto_eventos EVENTO_CULTURAL por fuente:');
  console.log('   AGENDATE_SNAPSHOT:           total', total, '| con_geom', con_geom, '| con_fecha', con_fecha, '| listos (geom+fechas)', listos);
  console.log('   AGENDATE_ARCGIS:             total', totalArc, '| listos', listosArc);
  console.log('   AGENDATE_SNAPSHOT_TABLA7:   total', totalT7, '| listos', listosT7);
  console.log('   AGENDATE_ARCGIS_MANUAL_RELATED: total', totalRel, '| listos', listosRel);
  console.log('');
  console.log('B) incidentes.EVENTO canónicos:', incidentesEventoCount);
  console.log('');
  console.log('C) Eventos por ventana:');
  console.log('   activos ahora (start <= now <= end):', activosNow);
  console.log('   próximos 7 días (start en [now, now+7d]):', proximos7d);
  console.log('');

  const listosTotal = listos + listosArc + listosT7 + listosRel;
  console.log('--- Interpretación ---');
  if (tabla7UnreliableGeom > 0) {
    console.error('❌ Geometría no confiable (localidad). Bloqueado por regla Waze.');
    console.error('   AGENDATE_SNAPSHOT_TABLA7 tiene', tabla7UnreliableGeom, 'eventos con geom y match_method=contains o reason=LOCALIDAD.');
    console.error('   Solo se permite geom por KEY o NAME (venue). Ejecute de nuevo el ingest tras corregir el join.');
    process.exit(1);
  }
  if (listosTotal > 0 && incidentesEventoCount === 0) {
    console.log('⚠️  listos es alto pero eventos_canonicos es 0.');
    console.log('   → Revisar ingest:eventos:incidentes (filtro o mapping de campos).');
    process.exit(1);
  }
  if (incidentesEventoCount > 0 && activosNow === 0 && proximos7d === 0) {
    console.log('ℹ️  Hay eventos canónicos pero ninguno en ventana activos/próximos 7d.');
    console.log('   → No es bug: no hay eventos en esa ventana (p. ej. todos históricos).');
  }
  if (total === 0 && totalArc === 0 && totalT7 === 0 && totalRel === 0) {
    console.log('ℹ️  No hay registros Agéndate en contexto_eventos.');
    console.log('   → Ejecutar ingest:agendate:arcgis:apply o flujo related (copy + build + ingest) o tabla 7 manual (ver docs).');
  }
  if (listosTotal > 0 && incidentesEventoCount > 0) {
    console.log('✅ Fuente(s) Agéndate están alimentando eventos mapeables (listos → incidentes.EVENTO).');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
