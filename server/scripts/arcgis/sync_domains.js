/**
 * Sincroniza dominios ArcGIS (coded values) del MapServer de Obras Distritales a arcgis_domains_cache.
 * Uso: npm run arcgis:domains:sync
 * Requiere: migración 029 aplicada y DATABASE_URL (o PGHOST/PGDATABASE/...).
 * Cache 24h: ejecutar diariamente o tras cambios en el servicio.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { fetchLayerJson, extractDomainsFromLayer, DEFAULT_OBRAS_MAPSERVER_URL } from '../../utils/arcgisDomains.js';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const SERVICE_URL = process.env.ARCGIS_BASE_URL || DEFAULT_OBRAS_MAPSERVER_URL;
const LAYER_ID = parseInt(process.env.LAYER_ID ?? '0', 10);

async function main() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[arcgis:domains:sync] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }
  const baseUrl = SERVICE_URL.replace(/\/$/, '');
  console.log('[arcgis:domains:sync] Fetching layer', baseUrl, 'layerId=', LAYER_ID);
  let layerJson;
  try {
    layerJson = await fetchLayerJson(baseUrl, LAYER_ID);
  } catch (err) {
    console.error('[arcgis:domains:sync] Error fetching layer:', err.message);
    process.exit(1);
  }
  const domains = extractDomainsFromLayer(layerJson);
  const fieldNames = Object.keys(domains);
  console.log('[arcgis:domains:sync] Fields with domains:', fieldNames.length, fieldNames.join(', ') || '(ninguno)');

  await query(
    `DELETE FROM arcgis_domains_cache WHERE service_url = $1 AND layer_id = $2`,
    [baseUrl, LAYER_ID]
  );
  let inserted = 0;
  for (const [fieldName, codeToName] of Object.entries(domains)) {
    for (const [code, name] of Object.entries(codeToName)) {
      await query(
        `INSERT INTO arcgis_domains_cache (service_url, layer_id, field_name, code, name, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (service_url, layer_id, field_name, code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [baseUrl, LAYER_ID, fieldName, code, name || code]
      );
      inserted++;
    }
  }
  console.log('[arcgis:domains:sync] Inserted/updated', inserted, 'rows');
  await closePool();
}

main().catch((err) => {
  console.error('[arcgis:domains:sync]', err);
  process.exit(1);
});
