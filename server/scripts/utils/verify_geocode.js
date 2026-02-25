/**
 * Verificación rápida: SELECT nodos ext-2 y ext-3 con lat/lng.
 * Uso: node server/scripts/utils/verify_geocode.js
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
  const r = await query(
    `SELECT node_id_externo, direccion, ST_Y(geom) AS lat, ST_X(geom) AS lng
     FROM nodos
     WHERE node_id_externo LIKE 'ext-2-%' OR node_id_externo LIKE 'ext-3-%'`
  );
  console.log('Nodos ext-2 y ext-3 (lat/lng desde geom):');
  console.table(r.rows);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
