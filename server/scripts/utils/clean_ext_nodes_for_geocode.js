/**
 * Elimina nodos externos ext-2 y ext-3 (y sus estudios/conteos) para poder
 * recrearlos con el ETL y que reciban geom por geocoding. Uso: ejecutar una vez
 * antes de volver a correr etl_fuente_externa_csv y etl:cgt para verificar geocode.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

async function main() {
  loadEnv();
  const r1 = await query(
    `DELETE FROM conteos_resumen WHERE estudio_id IN (
      SELECT id FROM estudios WHERE nodo_id IN (
        SELECT id FROM nodos WHERE node_id_externo LIKE 'ext-2-%' OR node_id_externo LIKE 'ext-3-%'
      )
    )`
  );
  const r2 = await query(
    `DELETE FROM estudios WHERE nodo_id IN (
      SELECT id FROM nodos WHERE node_id_externo LIKE 'ext-2-%' OR node_id_externo LIKE 'ext-3-%'
    )`
  );
  const r3 = await query(
    "DELETE FROM nodos WHERE node_id_externo LIKE 'ext-2-%' OR node_id_externo LIKE 'ext-3-%'"
  );
  console.log('[clean] Conteos/estudios/nodos ext-2 y ext-3 eliminados.');
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
