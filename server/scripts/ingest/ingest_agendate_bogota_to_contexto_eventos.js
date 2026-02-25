/**
 * Ingesta idempotente: Agéndate con Bogotá → contexto_eventos (LUGAR_EVENTO).
 * Fuente: ArcGIS REST (layer 4) o KMZ (fallback). Control por ENV.
 *
 * IMPORTANTE para join tabla7→lugares: datos_extra debe incluir GlobalID (o GUID_2), OBJECTID y EVNLUGAR
 * para que el ingest de eventos (tabla 7) pueda hacer KEY-match. Sin estos campos en datos_extra,
 * el join KEY no es posible y los eventos quedarán sin geom (regla Waze).
 *
 * Uso:
 *   node server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js           # dry-run
 *   node server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js --apply   # escribir en BD
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';
import { readKmzFromUrl, readKmzFromFile } from '../../utils/kmz_kml_reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const FUENTE = 'AGENDATE_BOGOTA';
const GUARD_DAYS = 30;

const AGENDATE_SOURCE_MODE = (process.env.AGENDATE_SOURCE_MODE || 'auto').toLowerCase();
const AGENDATE_ARCGIS_LAYER_URL =
  process.env.AGENDATE_ARCGIS_LAYER_URL ||
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4';
function getQueryUrl() {
  if (process.env.AGENDATE_ARCGIS_QUERY_URL) return process.env.AGENDATE_ARCGIS_QUERY_URL;
  return AGENDATE_ARCGIS_LAYER_URL.replace(/\/?$/, '') + '/query';
}
const AGENDATE_KMZ_URL =
  process.env.AGENDATE_KMZ_URL ||
  'https://datosabiertos.bogota.gov.co/dataset/71c46905-c085-47cb-9f22-e743e455fb1d/resource/68c7aa64-deb5-4efd-b329-07a88828c1c5/download/lugar_evento_agendate.kmz';
const AGENDATE_KMZ_FILE = process.env.AGENDATE_KMZ_FILE || '';
const AGENDATE_TIMEOUT_MS = parseInt(process.env.AGENDATE_TIMEOUT_MS || '20000', 10);
const AGENDATE_RETRIES = parseInt(process.env.AGENDATE_RETRIES || '2', 10);
const AGENDATE_PAGE_SIZE = parseInt(process.env.AGENDATE_PAGE_SIZE || '1000', 10);

/** Log detallado de error de fetch (URL, host, err.name/code/message/cause, sugerencia). */
function logFetchError(url, err, label) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '(URL inválida)';
    }
  })();
  console.error('[ingest-agendate] ❌ Fetch fallido' + (label ? ' (' + label + ')' : ''));
  console.error('[ingest-agendate]    URL:   ', url);
  console.error('[ingest-agendate]    Host:  ', host);
  console.error('[ingest-agendate]    Error: ', (err && err.name) || '', (err && err.code) || '', '-', (err && err.message) || err);
  console.error('[ingest-agendate]    Causa: ', (err && err.cause && (err.cause.message || err.cause.code)) || 'no disponible');
  console.error('[ingest-agendate]    Sugerencia: comprueba proxy/firewall para este host o usa AGENDATE_KMZ_FILE para ingesta offline.');
}

/** source_id estable desde properties ArcGIS o desde item KMZ. */
function stableOrigenId(properties, geometry) {
  const gid = properties?.GLOBALID ?? properties?.globalid ?? properties?.GlobalID;
  if (gid && String(gid).trim()) return String(gid).slice(0, 255);
  const titulo = (properties?.EVNLUGAR ?? properties?.evnlugar ?? '').toString();
  const coords = geometry?.coordinates;
  const lugar = Array.isArray(coords) ? `${coords[0]},${coords[1]}` : '';
  return crypto.createHash('sha256').update(`${titulo}|${lugar}`).digest('hex').slice(0, 32);
}

/** Es error de conectividad (no HTTP 4xx de negocio). */
function isConnectivityError(err) {
  const msg = (err && err.message) || String(err);
  return (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('Could not connect') ||
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('certificate') ||
    msg.includes('handshake')
  );
}

/** Descarga una página ArcGIS GeoJSON con reintentos. */
async function fetchArcGisPage(queryUrl, resultOffset, timeoutMs, retries) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    f: 'geojson',
    resultRecordCount: String(AGENDATE_PAGE_SIZE),
    resultOffset: String(resultOffset),
  });
  const url = `${queryUrl}?${params.toString()}`;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      const features = data?.features ?? [];
      return { features };
    } catch (err) {
      lastErr = err;
      if (i === retries) logFetchError(url, err, 'ArcGIS');
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Obtiene todos los features desde ArcGIS (paginado). */
async function fetchAllFromArcGis() {
  const queryUrl = getQueryUrl();
  const all = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { features } = await fetchArcGisPage(
      queryUrl,
      offset,
      AGENDATE_TIMEOUT_MS,
      AGENDATE_RETRIES
    );
    all.push(...features);
    if (features.length < AGENDATE_PAGE_SIZE) hasMore = false;
    else offset += AGENDATE_PAGE_SIZE;
  }
  return all;
}

/** Convierte GeoJSON Point a WKT (SRID 4326). */
function geomToWkt(feature) {
  const geom = feature?.geometry;
  if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) return null;
  const [lng, lat] = geom.coordinates;
  if (lng == null || lat == null) return null;
  return `POINT(${lng} ${lat})`;
}

/** Convierte item normalizado KMZ a feature-like { properties, geometry } para upsert. */
function kmzItemToFeature(item) {
  const geom = item.geom;
  const coords = geom?.coordinates;
  const titulo = item.title || item.description || '';
  const origenId = item.origen_id || crypto.createHash('sha256').update(JSON.stringify(item.raw)).digest('hex').slice(0, 32);
  return {
    properties: { EVNLUGAR: titulo, origen_id: origenId, ...item.raw },
    geometry: geom ? { type: 'Point', coordinates: coords } : null,
    _origenId: origenId,
    _descripcion: (item.description || titulo || '').slice(0, 2000),
    _geomWkt: geom && coords && coords.length >= 2 ? `POINT(${coords[0]} ${coords[1]})` : null,
  };
}

/** Guard: no re-ingestar si venues Agéndate se actualizaron hace menos de GUARD_DAYS días. */
async function checkGuard30Days() {
  try {
    const result = await query(`
      SELECT MAX(COALESCE(updated_at, created_at)) AS ultima_actualizacion
      FROM contexto_eventos
      WHERE fuente = $1
    `, [FUENTE]);
    const ultima = result.rows[0]?.ultima_actualizacion;
    const diasDesdeActualizacion = ultima
      ? Math.floor((Date.now() - new Date(ultima).getTime()) / 86400000)
      : 999;
    if (diasDesdeActualizacion < GUARD_DAYS && !process.env.AGENDATE_FORCE_UPDATE) {
      console.log(`[ingest-agendate] ✅ Venues Agéndate actualizados hace ${diasDesdeActualizacion} días.`);
      console.log('[ingest-agendate]    No es necesario re-ingestar. Usar AGENDATE_FORCE_UPDATE=true para forzar.');
      await closePool();
      process.exit(0);
    }
  } catch (err) {
    console.warn('[ingest-agendate] Guard no aplicable (tabla/columna):', err.message);
  }
}

/** Resuelve fuente KMZ: 1) archivo local, 2) URL, 3) error. Retorna { kind: 'kmz_file'|'kmz_url', pathOrUrl, items } o null. */
async function resolveKmzSource() {
  if (AGENDATE_KMZ_FILE) {
    try {
      const stat = await fs.stat(AGENDATE_KMZ_FILE);
      if (stat.isFile()) {
        const items = await readKmzFromFile(AGENDATE_KMZ_FILE);
        return { kind: 'kmz_file', pathOrUrl: AGENDATE_KMZ_FILE, items, sizeBytes: stat.size };
      }
    } catch (err) {
      console.error('[ingest-agendate] AGENDATE_KMZ_FILE no accesible:', AGENDATE_KMZ_FILE, err.message);
    }
  }
  if (AGENDATE_KMZ_URL) {
    try {
      const items = await readKmzFromUrl(AGENDATE_KMZ_URL, { timeoutMs: AGENDATE_TIMEOUT_MS });
      return { kind: 'kmz_url', pathOrUrl: AGENDATE_KMZ_URL, items };
    } catch (err) {
      logFetchError(AGENDATE_KMZ_URL, err, 'KMZ URL');
    }
  }
  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!apply && !process.env.DATABASE_URL && !process.env.PGHOST) {
    console.log('[ingest-agendate] Modo dry-run: no se requiere BD.');
  } else if (apply && !process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-agendate] Con --apply configura DATABASE_URL o PGHOST/PGDATABASE.');
    process.exit(1);
  }

  if (apply) {
    await checkGuard30Days();
  }

  let features = [];
  let sourceUsed = null;
  let fallbackReason = null;

  if (AGENDATE_SOURCE_MODE === 'kmz') {
    console.log('[ingest-agendate] Modo KMZ (AGENDATE_SOURCE_MODE=kmz)');
    const kmz = await resolveKmzSource();
    if (!kmz) {
      console.error('[ingest-agendate] No hay fuente KMZ. Configura AGENDATE_KMZ_FILE (archivo local) o AGENDATE_KMZ_URL.');
      process.exit(1);
    }
    sourceUsed = kmz.kind === 'kmz_file' ? 'kmz_file' : 'kmz_url';
    console.log('[ingest-agendate] Fuente seleccionada:', sourceUsed);
    console.log('[ingest-agendate] Ruta/URL:', kmz.pathOrUrl);
    if (kmz.sizeBytes != null) console.log('[ingest-agendate] Archivo existe, tamaño:', kmz.sizeBytes, 'bytes');
    features = kmz.items.map((item) => kmzItemToFeature(item));
    console.log('[ingest-agendate] features leídos:', features.length);
  } else if (AGENDATE_SOURCE_MODE === 'arcgis') {
    console.log('[ingest-agendate] Modo ArcGIS (AGENDATE_SOURCE_MODE=arcgis)');
    console.log('[ingest-agendate] Fuente seleccionada: arcgis');
    console.log('[ingest-agendate] Ruta/URL:', AGENDATE_ARCGIS_LAYER_URL);
    try {
      features = await fetchAllFromArcGis();
      sourceUsed = 'arcgis';
      console.log('[ingest-agendate] features leídos:', features.length);
    } catch (err) {
      console.error('[ingest-agendate] ArcGIS no accesible:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[ingest-agendate] Modo auto: intentando ArcGIS primero');
    console.log('[ingest-agendate] Fuente seleccionada: arcgis (intento)');
    console.log('[ingest-agendate] Ruta/URL:', AGENDATE_ARCGIS_LAYER_URL);
    try {
      features = await fetchAllFromArcGis();
      sourceUsed = 'arcgis';
      console.log('[ingest-agendate] features leídos:', features.length);
    } catch (err) {
      const errClase = isConnectivityError(err) ? 'conectividad' : err.message || 'error';
      fallbackReason = `${errClase} (${err.message || err})`;
      console.log('[ingest-agendate] ARC GIS no accesible:', fallbackReason, '→ usando KMZ');
      const kmz = await resolveKmzSource();
      if (!kmz) {
        console.error('[ingest-agendate] No hay fuente KMZ disponible. Configura AGENDATE_KMZ_FILE o AGENDATE_KMZ_URL.');
        process.exit(1);
      }
      sourceUsed = kmz.kind === 'kmz_file' ? 'kmz_file' : 'kmz_url';
      console.log('[ingest-agendate] Fuente seleccionada:', sourceUsed);
      console.log('[ingest-agendate] Ruta/URL:', kmz.pathOrUrl);
      if (kmz.sizeBytes != null) console.log('[ingest-agendate] Archivo existe, tamaño:', kmz.sizeBytes, 'bytes');
      features = kmz.items.map((item) => kmzItemToFeature(item));
      console.log('[ingest-agendate] features leídos:', features.length);
    }
  }

  const sinGeom = features.filter((f) => {
    const wkt = f._geomWkt ?? (f.geometry && geomToWkt({ geometry: f.geometry }));
    return !wkt;
  }).length;
  if (sinGeom > 0) {
    console.warn('[ingest-agendate] Advertencia:', sinGeom, 'features sin geometría válida.');
  }

  if (!apply) {
    console.log('[ingest-agendate] Dry-run. Para aplicar: node server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js --apply');
    process.exit(0);
  }

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[ingest-agendate] No existe tabla contexto_eventos. Ejecuta npm run db:migrate.');
    await closePool();
    process.exit(1);
  }

  let procesados = 0;
  const errores = [];

  for (const feature of features) {
    const origenId = feature._origenId ?? stableOrigenId(feature.properties, feature.geometry);
    const descripcion =
      feature._descripcion ??
      (() => {
        const p = feature.properties || {};
        const t = p.EVNLUGAR ?? p.evnlugar ?? '';
        return t ? String(t).slice(0, 500) : null;
      })();
    const wkt = feature._geomWkt ?? geomToWkt(feature);
    const datosExtra = JSON.stringify(feature.properties || {});

    try {
      if (wkt) {
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota, datos_extra)
           VALUES ('LUGAR_EVENTO', $1, $2, NULL, NULL, ST_SetSRID(ST_GeomFromText($3), 4326), $4, NULL, $5::jsonb)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET tipo = EXCLUDED.tipo, descripcion = EXCLUDED.descripcion, datos_extra = EXCLUDED.datos_extra, geom = EXCLUDED.geom, updated_at = now()`,
          [FUENTE, descripcion, wkt, origenId, datosExtra]
        );
      } else {
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, origen_id, url_remota, datos_extra)
           VALUES ('LUGAR_EVENTO', $1, $2, $3, NULL, $4::jsonb)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET tipo = EXCLUDED.tipo, descripcion = EXCLUDED.descripcion, datos_extra = EXCLUDED.datos_extra, updated_at = now()`,
          [FUENTE, descripcion, origenId, datosExtra]
        );
      }
      procesados++;
    } catch (err) {
      errores.push({ origenId: String(origenId).slice(0, 30), error: err.message });
    }
  }

  const totalConFuente = await query(
    `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1`,
    [FUENTE]
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  console.log('[ingest-agendate] Resumen:');
  console.log('  Fuente usada:', sourceUsed);
  if (fallbackReason) console.log('  Fallback aplicado (ArcGIS no accesible):', fallbackReason);
  console.log('  Procesados (upsert):', procesados);
  console.log('  Total en BD con fuente', FUENTE + ':', totalConFuente);
  if (errores.length > 0) {
    console.log('  Errores:', errores.length);
    errores.slice(0, 5).forEach((e) => console.log('   -', e.origenId, e.error));
  }
  if (sinGeom > 0) {
    console.log('  Features sin geometría:', sinGeom);
  }
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-agendate]', err.message);
  process.exit(1);
});
