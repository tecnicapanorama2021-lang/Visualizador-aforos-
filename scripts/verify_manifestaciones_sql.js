/**
 * Ejecuta las consultas SQL de verificación de manifestaciones e imprime resultado.
 * Uso: node scripts/verify_manifestaciones_sql.js
 */
import 'dotenv/config';
import { query } from '../server/db/client.js';
import { closePool } from '../server/db/client.js';

async function main() {
  console.log('--- Manifestaciones por quality_status ---');
  const r1 = await query(
    `SELECT quality_status, COUNT(*) AS cnt FROM incidentes WHERE tipo = 'MANIFESTACION' GROUP BY 1 ORDER BY 1`
  );
  for (const row of r1.rows) {
    console.log('  ', row.quality_status ?? 'NULL', ':', row.cnt);
  }
  console.log('--- Manifestaciones con geom (visibles en mapa) ---');
  const r2 = await query(
    `SELECT COUNT(*) AS cnt FROM incidentes WHERE tipo = 'MANIFESTACION' AND geom IS NOT NULL`
  );
  console.log('  Total con geom:', r2.rows[0].cnt);
  await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });
