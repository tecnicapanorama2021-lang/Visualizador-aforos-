/**
 * Verificación "oro" del flujo eventos Bogotá 2026 manual:
 * contexto_eventos (BOGOTA_GOV_MANUAL_2026) → incidentes EVENTO → activos / próximos 7 días.
 *
 * Uso: node server/scripts/verify/verify_eventos_bogota_2026_flow.js
 *      npm run verify:eventos:bogota
 *
 * Interpretación:
 * - Si listos > 0 y incidentes.EVENTO == 0 => EXIT 1 (fallo en ingest:eventos:incidentes).
 * - Si incidentes.EVENTO > 0 pero activos/upcoming == 0 => OK informativo (fechas fuera de ventana).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const FUENTE = 'BOGOTA_GOV_MANUAL_2026';

async function main() {
  console.log('\n=== Verificación eventos Bogotá 2026 (manual) ===\n');

  let ctxRows = [];
  let incidentesEvento = 0;
  let activosNow = 0;
  let upcoming7 = 0;

  try {
    const a = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE geom IS NOT NULL) AS con_geom,
        COUNT(*) FILTER (WHERE fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL) AS con_fecha,
        COUNT(*) FILTER (WHERE geom IS NOT NULL AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL) AS listos
      FROM contexto_eventos
      WHERE fuente = $1 AND tipo = 'EVENTO_CULTURAL'
    `, [FUENTE]);
    ctxRows = a.rows || [];
  } catch (err) {
    console.error('A) Error leyendo contexto_eventos:', err.message);
    await closePool();
    process.exit(1);
  }

  try {
    const b = await query(`
      SELECT COUNT(*) AS total FROM incidentes WHERE tipo = 'EVENTO'
    `);
    incidentesEvento = parseInt(b.rows[0]?.total ?? 0, 10);
  } catch (err) {
    console.error('B) Error leyendo incidentes:', err.message);
  }

  try {
    const c1 = await query(`
      SELECT COUNT(*) AS activos
      FROM incidentes
      WHERE tipo = 'EVENTO'
        AND start_at <= now() AND end_at >= now()
    `);
    activosNow = parseInt(c1.rows[0]?.activos ?? 0, 10);

    const c2 = await query(`
      SELECT COUNT(*) AS upcoming
      FROM incidentes
      WHERE tipo = 'EVENTO'
        AND start_at > now() AND start_at <= now() + interval '7 days'
    `);
    upcoming7 = parseInt(c2.rows[0]?.upcoming ?? 0, 10);
  } catch (err) {
    console.error('C) Error leyendo activos/próximos:', err.message);
  }

  await closePool();

  const r = ctxRows[0];
  const total = parseInt(r?.total ?? 0, 10);
  const con_geom = parseInt(r?.con_geom ?? 0, 10);
  const con_fecha = parseInt(r?.con_fecha ?? 0, 10);
  const listos = parseInt(r?.listos ?? 0, 10);

  console.log('A) contexto_eventos (EVENTO_CULTURAL) fuente', FUENTE + ':');
  console.log('   total:', total, '| con_geom:', con_geom, '| con_fecha:', con_fecha, '| listos (geom+inicio+fin):', listos);
  console.log('');
  console.log('B) incidentes tipo EVENTO:', incidentesEvento);
  console.log('');
  console.log('C) activos ahora (start_at <= now <= end_at):', activosNow);
  console.log('   próximos 7 días (start_at in (now, now+7d]):', upcoming7);
  console.log('');

  console.log('--- Interpretación ---');
  if (listos > 0 && incidentesEvento === 0) {
    console.error('❌ listos > 0 pero incidentes.EVENTO == 0. Revisar ingest:eventos:incidentes.');
    process.exit(1);
  }
  if (incidentesEvento > 0 && activosNow === 0 && upcoming7 === 0) {
    console.log('ℹ️  Hay eventos canónicos pero ninguno en ventana activos/próximos 7d.');
    console.log('   → exit(0) informativo: fechas fuera de ventana, no es bug.');
  }
  if (activosNow > 0 || upcoming7 > 0) {
    console.log('✅ OK: hay eventos en ventana activos o próximos 7 días.');
  }
  if (total === 0) {
    console.log('ℹ️  No hay registros', FUENTE, 'en contexto_eventos.');
    console.log('   → Ejecutar import:eventos:bogota:copy y import:eventos:bogota:contexto:apply.');
  }
  if (listos > 0 && incidentesEvento > 0 && activosNow === 0 && upcoming7 === 0) {
    console.log('✅ Flujo OK: contexto_eventos listos → incidentes.EVENTO (ventana vacía).');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
