/**
 * Verifica conteos en tablas de estudios de tránsito enriquecidos.
 * Uso: node server/scripts/verificar_estudios_tablas.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  console.log('=== VÍAS ===');
  const vias = await query('SELECT COUNT(*) as total, COUNT(DISTINCT estudio_transito_id) as estudios FROM vias_estudio');
  console.log(vias.rows[0]);

  console.log('\n=== PUNTOS CRÍTICOS ===');
  const pc = await query('SELECT COUNT(*) as total, COUNT(DISTINCT tipo) as tipos FROM puntos_criticos_estudio');
  console.log(pc.rows[0]);

  console.log('\n=== INFRAESTRUCTURA ===');
  const inf = await query('SELECT COUNT(*) as total, COUNT(DISTINCT tipo) as tipos FROM infraestructura_vial');
  console.log(inf.rows[0]);

  console.log('\n=== PROYECCIONES ===');
  const proy = await query('SELECT COUNT(*) as total, COUNT(DISTINCT escenario) as escenarios FROM proyecciones_estudio');
  console.log(proy.rows[0]);

  console.log('\n=== ESTUDIOS (últimos 10) ===');
  const est = await query('SELECT id, nombre, diagnostico_json IS NOT NULL as tiene_diagnostico FROM estudios_transito ORDER BY id DESC LIMIT 10');
  console.log(est.rows);

  await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });
