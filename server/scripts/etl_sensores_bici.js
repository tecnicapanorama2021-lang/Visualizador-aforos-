/**
 * ETL sensores de conteo de bicicletas (SDM). Consume GeoJSON/FeatureServer y UPSERT en sensores_bici.
 * Primera fase: solo ubicación (sin series temporales de conteos).
 *
 * Configuración: SENSORES_BICI_GEOJSON_URL (recomendado) o SENSORES_BICI_FEATURESERVER_URL.
 * Ejemplo: SENSORES_BICI_GEOJSON_URL=http://datos-abiertos-sdm-movilidadbogota.hub.arcgis.com/datasets/a3c4aa2325734484ab0895aed8c2f4ac_0.geojson
 *
 * Uso: npm run etl:sensores-bici
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

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

function getProp(props, ...keys) {
  for (const k of keys) {
    const v = props[k];
    if (v != null && v !== '') return String(v).trim();
  }
  return null;
}

async function ensureTable() {
  const r = await query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sensores_bici'
  `);
  if (!r.rows[0]) {
    console.error('[etl-sensores-bici] Ejecuta primero: npm run db:migrate');
    process.exit(1);
  }
}

async function upsertSensor(feature) {
  const props = feature.properties || feature.attributes || {};
  const idExterno = getProp(props, 'site_id', 'FID', 'id', 'OBJECTID');
  if (!idExterno) return 0;
  const nombre = getProp(props, 'name', 'nombre', 'NOMBRE') || idExterno;
  const direccion = getProp(props, 'direccion', 'address', 'localidad', 'LOCALIDAD') || nombre;
  let lng = null;
  let lat = null;
  if (feature.geometry && feature.geometry.type === 'Point' && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2) {
    lng = feature.geometry.coordinates[0];
    lat = feature.geometry.coordinates[1];
  }
  if (lat == null || lng == null) {
    await query(
      `INSERT INTO sensores_bici (id_externo, nombre, direccion, fuente, updated_at)
       VALUES ($1, $2, $3, 'SDM_BICI', NOW())
       ON CONFLICT (id_externo) DO UPDATE SET nombre = EXCLUDED.nombre, direccion = EXCLUDED.direccion, updated_at = NOW()`,
      [idExterno, nombre, direccion]
    );
  } else {
    await query(
      `INSERT INTO sensores_bici (id_externo, nombre, direccion, geom, fuente, updated_at)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'SDM_BICI', NOW())
       ON CONFLICT (id_externo) DO UPDATE SET nombre = EXCLUDED.nombre, direccion = EXCLUDED.direccion, geom = EXCLUDED.geom, updated_at = NOW()`,
      [idExterno, nombre, direccion, lng, lat]
    );
  }
  return 1;
}

async function main() {
  loadEnv();
  const geojsonUrl = process.env.SENSORES_BICI_GEOJSON_URL;
  const fsUrl = process.env.SENSORES_BICI_FEATURESERVER_URL;

  if (!geojsonUrl && !fsUrl) {
    console.error('[etl-sensores-bici] Configura SENSORES_BICI_GEOJSON_URL o SENSORES_BICI_FEATURESERVER_URL en .env');
    process.exit(1);
  }

  await ensureTable();

  let features = [];
  if (geojsonUrl) {
    console.log('[etl-sensores-bici] Descargando GeoJSON...');
    const res = await fetch(geojsonUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    features = data.features || [];
  } else {
    const url = new URL(fsUrl.replace(/\/?$/, '/query'));
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('f', 'json');
    url.searchParams.set('resultRecordCount', '5000');
    console.log('[etl-sensores-bici] Consultando FeatureServer...');
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const rawFeatures = data.features || [];
    features = rawFeatures.map((f) => ({
      type: 'Feature',
      properties: f.attributes || {},
      geometry: f.geometry ? { type: 'Point', coordinates: [f.geometry.x, f.geometry.y] } : null,
    }));
  }

  console.log('[etl-sensores-bici] Features:', features.length);
  let n = 0;
  for (const f of features) {
    n += await upsertSensor(f);
  }
  await closePool();
  console.log('[etl-sensores-bici] Listo. Insertados/actualizados:', n);
}

main().catch((err) => {
  console.error('[etl-sensores-bici] Error:', err.message);
  process.exit(1);
});
