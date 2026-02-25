/**
 * Ejecuta consultas de verificación de BD y escribe resultado en docs/verificacion-2026-02-19/VERIFICACION_BD.txt
 * Uso: node server/scripts/verificacion_bd_report.js
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'verificacion-2026-02-19');
const OUT_FILE = path.join(OUT_DIR, 'VERIFICACION_BD.txt');

async function run() {
  const lines = [];
  lines.push('=== VERIFICACIÓN INTEGRIDAD BASE DE DATOS ===');
  lines.push('Fecha: ' + new Date().toISOString());
  lines.push('');

  try {
    // 1. schema_migrations (puede no existir en este proyecto)
    try {
      const mig = await query('SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5');
      lines.push('1. Migraciones (schema_migrations):');
      lines.push(JSON.stringify(mig.rows, null, 2));
    } catch (e) {
      lines.push('1. schema_migrations: tabla no existe (proyecto usa migraciones por archivos .sql)');
    }
    lines.push('');

    // 2. Nuevas tablas existen
    const tables = await query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('vias_estudio', 'puntos_criticos_estudio', 'infraestructura_vial', 'proyecciones_estudio')
      ORDER BY table_name
    `);
    lines.push('2. Nuevas tablas existentes:');
    tables.rows.forEach(r => lines.push('   - ' + r.table_name));
    lines.push('');

    // 3. Conteos nuevas tablas
    const counts = await query(`
      SELECT
        (SELECT COUNT(*) FROM vias_estudio) as vias_total,
        (SELECT COUNT(*) FROM puntos_criticos_estudio) as puntos_criticos_total,
        (SELECT COUNT(*) FROM infraestructura_vial) as infraestructura_total,
        (SELECT COUNT(*) FROM proyecciones_estudio) as proyecciones_total
    `);
    lines.push('3. Registros en nuevas tablas:');
    lines.push('   vias_estudio: ' + counts.rows[0].vias_total);
    lines.push('   puntos_criticos_estudio: ' + counts.rows[0].puntos_criticos_total);
    lines.push('   infraestructura_vial: ' + counts.rows[0].infraestructura_total);
    lines.push('   proyecciones_estudio: ' + counts.rows[0].proyecciones_total);
    lines.push('');

    // 4. estudios_transito.diagnostico_json
    const col = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'estudios_transito' AND column_name = 'diagnostico_json'
    `);
    lines.push('4. Columna estudios_transito.diagnostico_json: ' + (col.rows[0] ? 'SÍ existe' : 'NO existe'));
    lines.push('');

    // 5. Tablas existentes
    const core = await query(`
      SELECT
        (SELECT COUNT(*) FROM nodos) as nodos_total,
        (SELECT COUNT(*) FROM conteos_resumen) as conteos_total,
        (SELECT COUNT(*) FROM estudios_transito) as estudios_total,
        (SELECT COUNT(*) FROM localidades) as localidades_total,
        (SELECT COUNT(*) FROM upz) as upz_total
    `);
    const r = core.rows[0];
    lines.push('5. Integridad tablas existentes:');
    lines.push('   nodos: ' + r.nodos_total);
    lines.push('   conteos_resumen: ' + r.conteos_total);
    lines.push('   estudios_transito: ' + r.estudios_total);
    lines.push('   localidades: ' + r.localidades_total);
    lines.push('   upz: ' + r.upz_total);
  } catch (err) {
    lines.push('ERROR: ' + err.message);
  }

  await closePool();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log('Escrito:', OUT_FILE);
}

run().catch(e => { console.error(e); process.exit(1); });
