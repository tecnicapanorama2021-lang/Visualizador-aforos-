/**
 * Carga nodos EXTERNO desde GeoJSON de CKAN (IDs 15 y 17).
 * Lee data/datos_abiertos/15 y 17, extrae features como puntos y hace UPSERT en nodos.
 *
 * Uso: node server/scripts/etl_geojson_nodos_ckan.js
 *      npm run etl:nodos:ckan-geojson
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const DATA_BASE = path.join(PROJECT_ROOT, 'data', 'datos_abiertos');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const IDS = [15, 17];

function getProp(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  return null;
}

function extraerDeFeature(f) {
  const props = f.properties || {};
  const coords = f.geometry?.coordinates;
  const idExterno = String(getProp(props, 'site_id', 'siteid', 'FID') ?? '');
  const nombre = String(getProp(props, 'name', 'siteid', 'site_id') ?? '').trim() || null;
  const direccion = String(getProp(props, 'address', 'location', 'name') ?? '').trim() || null;
  const localidad = String(getProp(props, 'localidad', 'LOCALIDAD') ?? '').trim() || null;
  const lng = coords && coords.length >= 2 ? Number(coords[0]) : null;
  const lat = coords && coords.length >= 2 ? Number(coords[1]) : null;
  return { id_externo: idExterno, nombre, direccion, localidad, lat, lng };
}

async function main() {
  let insertados = 0;
  let actualizados = 0;

  for (const id of IDS) {
    const dir = path.join(DATA_BASE, String(id));
    if (!fs.existsSync(dir)) {
      console.warn('[etl-geojson-nodos] Carpeta no encontrada:', dir);
      continue;
    }
    const files = fs.readdirSync(dir);
    const geoFile = files.find((f) => f.toLowerCase().includes('geojson') || !path.extname(f));
    if (!geoFile) {
      console.warn('[etl-geojson-nodos] No se encontró archivo GeoJSON en', dir);
      continue;
    }
    const filePath = path.join(dir, geoFile);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn('[etl-geojson-nodos] Error leyendo', filePath, e.message);
      continue;
    }
    const features = raw.features || [];
    console.log('[etl-geojson-nodos] ID', id, ':', features.length, 'features');

    for (const f of features) {
      const { id_externo, nombre, direccion, lat, lng } = extraerDeFeature(f);
      if (!id_externo) continue;
      const nodeIdExterno = 'ckan-' + id_externo;
      const geomVal = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`
        : null;

      const existing = await query(
        'SELECT id FROM nodos WHERE node_id_externo = $1',
        [nodeIdExterno]
      );
      if (existing.rows[0]) {
        if (geomVal) {
          await query(
            `UPDATE nodos SET nombre = $1, direccion = $2, geom = ${geomVal}, updated_at = NOW() WHERE node_id_externo = $3`,
            [nombre, direccion, nodeIdExterno]
          );
        } else {
          await query(
            'UPDATE nodos SET nombre = $1, direccion = $2, updated_at = NOW() WHERE node_id_externo = $3',
            [nombre, direccion, nodeIdExterno]
          );
        }
        actualizados++;
      } else {
        await query(
          `INSERT INTO nodos (node_id_externo, nombre, direccion, geom, fuente)
           VALUES ($1, $2, $3, ${geomVal || 'NULL'}, 'EXTERNO')`,
          [nodeIdExterno, nombre, direccion]
        );
        insertados++;
      }

      if (geomVal) {
        await query(
          `UPDATE nodos SET
             upz_id = (SELECT id FROM upz WHERE ST_Intersects(nodos.geom, upz.geom) LIMIT 1),
             localidad_id = (SELECT id FROM localidades WHERE ST_Intersects(nodos.geom, localidades.geom) LIMIT 1)
           WHERE node_id_externo = $1 AND geom IS NOT NULL`,
          [nodeIdExterno]
        );
      }
    }
  }

  await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id IN (15, 17)');
  await closePool();

  console.log('[etl-geojson-nodos] Nodos insertados:', insertados);
  console.log('[etl-geojson-nodos] Nodos actualizados:', actualizados);
  console.log('[etl-geojson-nodos] archivos_fuente 15 y 17 marcados procesado=TRUE');
}

main().catch((err) => {
  console.error('[etl-geojson-nodos]', err.message);
  process.exit(1);
});
