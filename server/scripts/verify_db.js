// server/scripts/verify_db.js

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    console.log('\n════════════════════════════════════════');
    console.log('VERIFICACIÓN COMPLETA DE DATOS EN BD');
    console.log('════════════════════════════════════════\n');

    // 1. Total de nodos
    const nodosRes = await pool.query('SELECT COUNT(*) as total FROM nodos');
    console.log('1️⃣  NODOS TOTALES EN BD:', nodosRes.rows[0].total);

    // 2. Nodos con estudios
    const nodosEstudiosRes = await pool.query(`
      SELECT COUNT(DISTINCT nodo_id) as total 
      FROM estudios
    `);
    console.log('2️⃣  NODOS CON ESTUDIOS:', nodosEstudiosRes.rows[0].total);

    // 3. Total de estudios
    const estudiosRes = await pool.query('SELECT COUNT(*) as total FROM estudios');
    console.log('3️⃣  TOTAL DE ESTUDIOS:', estudiosRes.rows[0].total);

    // 4. Estudios con conteos_resumen (análisis)
    const conteosRes = await pool.query(`
      SELECT COUNT(DISTINCT estudio_id) as total 
      FROM conteos_resumen
    `);
    console.log('4️⃣  ESTUDIOS CON CONTEOS (análisis):', conteosRes.rows[0].total);

    // 5. Estudios con file_id_dim (para descargar)
    const downloadsRes = await pool.query(`
      SELECT COUNT(*) as total 
      FROM estudios 
      WHERE file_id_dim IS NOT NULL
    `);
    console.log('5️⃣  ESTUDIOS CON file_id_dim (descargas):', downloadsRes.rows[0].total);

    // 6. Nodos con zona (upz_id)
    const zonasRes = await pool.query(`
      SELECT COUNT(*) as total 
      FROM nodos 
      WHERE upz_id IS NOT NULL
    `);
    console.log('6️⃣  NODOS CON ZONA (upz_id):', zonasRes.rows[0].total);

    // 7. Nodos con localidad
    const localidadRes = await pool.query(`
      SELECT COUNT(*) as total 
      FROM nodos 
      WHERE localidad_id IS NOT NULL
    `);
    console.log('7️⃣  NODOS CON LOCALIDAD:', localidadRes.rows[0].total);

    // 8. Sample: 1 nodo completo
    console.log('\n8️⃣  SAMPLE - 1 NODO COMPLETO CON SUS DATOS:\n');
    const sampleRes = await pool.query(`
      SELECT 
        n.id, 
        n.node_id_externo,
        n.nombre,
        n.direccion,
        n.upz_id,
        n.localidad_id,
        COUNT(e.id) as cant_estudios,
        COUNT(DISTINCT cr.id) as cant_conteos
      FROM nodos n
      LEFT JOIN estudios e ON e.nodo_id = n.id
      LEFT JOIN conteos_resumen cr ON cr.estudio_id = e.id
      GROUP BY n.id
      HAVING COUNT(e.id) > 0
      LIMIT 1
    `);

    if (sampleRes.rows.length > 0) {
      const row = sampleRes.rows[0];
      console.log('  • id:', row.id);
      console.log('  • node_id_externo:', row.node_id_externo);
      console.log('  • nombre:', row.nombre);
      console.log('  • direccion:', row.direccion);
      console.log('  • upz_id:', row.upz_id);
      console.log('  • localidad_id:', row.localidad_id);
      console.log('  • estudios:', row.cant_estudios);
      console.log('  • conteos (análisis):', row.cant_conteos);
    }

    console.log('\n════════════════════════════════════════\n');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
