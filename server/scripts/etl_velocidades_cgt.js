/**
 * ETL velocidades actual en vía (CGT). Consume FeatureServer y UPSERT en tabla velocidades.
 *
 * Configuración: VELOCIDADES_CGT_FEATURESERVER_URL (base del FeatureServer, ej. .../FeatureServer/0)
 * Ejemplo: VELOCIDADES_CGT_FEATURESERVER_URL=https://srvarcgis1.eastus.cloudapp.azure.com/agserver/rest/services/Hosted/V2_CGT_RegsVelocity_Recent_v2/FeatureServer/0
 *
 * Uso: npm run etl:velocidades:cgt
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

function getAttr(attrs, ...keys) {
  const upper = (k) => String(k).toUpperCase().replace(/\s/g, '_');
  for (const k of keys) {
    const u = upper(k);
    for (const [key, v] of Object.entries(attrs)) {
      if (upper(key) === u && v != null && v !== '') return v;
    }
  }
  return null;
}

function parseFechaHora(val) {
  if (val == null || val === '') return null;
  const v = String(val).trim();
  const asNum = parseInt(v, 10);
  if (Number.isFinite(asNum)) {
    const d = new Date(asNum);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function ensureTable() {
  const r = await query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'velocidades'
  `);
  if (!r.rows[0]) {
    console.error('[etl-velocidades] Ejecuta primero: npm run db:migrate');
    process.exit(1);
  }
}

async function main() {
  loadEnv();
  const baseUrl = process.env.VELOCIDADES_CGT_FEATURESERVER_URL;
  if (!baseUrl) {
    console.error('[etl-velocidades] Configura VELOCIDADES_CGT_FEATURESERVER_URL en .env (URL del FeatureServer/0)');
    process.exit(1);
  }

  await ensureTable();

  const url = new URL(baseUrl.replace(/\/?$/, '') + '/query');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('f', 'json');
  url.searchParams.set('resultRecordCount', '5000');

  console.log('[etl-velocidades] Consultando FeatureServer...');
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    console.error('[etl-velocidades] HTTP', res.status, res.statusText);
    process.exit(1);
  }
  const data = await res.json();
  if (data.error) {
    console.error('[etl-velocidades]', data.error.message || data.error);
    process.exit(1);
  }

  const features = data.features || [];
  console.log('[etl-velocidades] Features:', features.length);

  let inserted = 0;
  for (const f of features) {
    const att = f.attributes || {};
    const tramoId = getAttr(att, 'OBJECTID', 'ID_TRAMO', 'TRAMO_ID', 'FID', 'ID');
    if (!tramoId) continue;
    const tramoIdExterno = String(tramoId);
    const fechaHoraVal = getAttr(att, 'FECHA_HORA', 'FECHA', 'DATE', 'TIMESTAMP', 'FECHA_REGISTRO');
    const fechaHora = parseFechaHora(fechaHoraVal);
    if (!fechaHora) continue;
    const velVal = getAttr(att, 'VEL_KMH', 'VELOCIDAD', 'VEL_MEDIA', 'SPEED', 'VEL');
    const velMediaKmh = velVal != null ? parseFloat(velVal) : null;
    if (velMediaKmh != null && !Number.isFinite(velMediaKmh)) continue;

    let lng = null;
    let lat = null;
    if (f.geometry) {
      if (f.geometry.x != null && f.geometry.y != null) {
        lng = f.geometry.x;
        lat = f.geometry.y;
      } else if (Array.isArray(f.geometry.coordinates)) {
        lng = f.geometry.coordinates[0];
        lat = f.geometry.coordinates[1];
      }
    }

    if (lng != null && lat != null) {
      await query(
        `INSERT INTO velocidades (tramo_id_externo, fecha_hora, vel_media_kmh, fuente, geom, updated_at)
         VALUES ($1, $2, $3, 'CGT_VELOCIDAD', ST_SetSRID(ST_MakePoint($4, $5), 4326), NOW())
         ON CONFLICT (tramo_id_externo, fecha_hora) DO UPDATE SET vel_media_kmh = EXCLUDED.vel_media_kmh, geom = EXCLUDED.geom, updated_at = NOW()`,
        [tramoIdExterno, fechaHora, velMediaKmh, lng, lat]
      );
    } else {
      await query(
        `INSERT INTO velocidades (tramo_id_externo, fecha_hora, vel_media_kmh, fuente, updated_at)
         VALUES ($1, $2, $3, 'CGT_VELOCIDAD', NOW())
         ON CONFLICT (tramo_id_externo, fecha_hora) DO UPDATE SET vel_media_kmh = EXCLUDED.vel_media_kmh, updated_at = NOW()`,
        [tramoIdExterno, fechaHora, velMediaKmh]
      );
    }
    inserted++;
  }

  await closePool();
  console.log('[etl-velocidades] Listo. Registros procesados:', inserted);
}

main().catch((err) => {
  console.error('[etl-velocidades] Error:', err.message);
  process.exit(1);
});
