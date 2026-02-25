/**
 * Carga localidades y UPZ de Bogotá desde GeoJSON de Datos Abiertos (IDECA/CKAN)
 * o desde archivos locales en data/zonas/, y actualiza nodos con upz_id y localidad_id.
 *
 * Uso: node server/scripts/etl_zonas_ideca.js
 *      npm run etl:zonas
 *      CKAN_INSECURE_TLS=1 npm run etl:zonas
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import { crearProxyAgent } from '../utils/crearProxyAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const ZONAS_DIR = path.resolve(__dirname, '../../data/zonas');
const LOCALIDADES_LOCAL = path.resolve(__dirname, '../../data/zonas/localidades_bogota.geojson');
const UPZ_LOCAL = path.resolve(__dirname, '../../data/zonas/upz_bogota.geojson');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const CKAN_BASE = process.env.CKAN_BASE_URL || 'https://datosabiertos.bogota.gov.co';
const CKAN_PACKAGE_SHOW = `${CKAN_BASE}/api/3/action/package_show`;
const CKAN_PACKAGE_SEARCH = `${CKAN_BASE}/api/3/action/package_search`;
const AXIOS_OPTS = {
  timeout: 60000,
  httpsAgent: crearProxyAgent(process.env.PROXY_URL),
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Aforos-Bogota/1.0)', Accept: 'application/json' },
};

const UPZ_SLUGS = [
  'unidad-de-planeamiento-zonal-upz-bogota-d-c',
  'upz-bogota',
  'unidad-planeamiento-zonal-bogota',
  'upz',
];

/** URL directa WFS IDECA (117 UPZ, GeoJSON, EPSG:4326). */
const UPZ_IDECA_WFS_URL =
  'https://mapas.bogota.gov.co/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=ide_urbano:UPZ&outputFormat=application/json&srsName=EPSG:4326';

/** URL ArcGIS FeatureServer UPZ (paginada). */
const UPZ_ARCGIS_URL =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/UPZ_Bogota/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson';

function getProp(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  return null;
}

/** Devuelve el primer valor no nulo de props para las claves candidatas. */
function getField(props, candidates) {
  if (!props || typeof props !== 'object') return null;
  for (const key of candidates) {
    if (props[key] !== undefined && props[key] !== null) {
      return String(props[key]).trim();
    }
  }
  return null;
}

/** Candidatos para código UPZ (IDECA/CKAN). */
const UPZ_CODIGO_KEYS = [
  'UPlCodigo', 'CODIGO', 'codigo', 'UPZ_CODIGO', 'COD_UPZ',
  'CODUPZ', 'upz_codigo', 'cod_upz',
];

/** Candidatos para nombre UPZ. */
const UPZ_NOMBRE_KEYS = [
  'UPlNombre', 'NOMBRE', 'nombre', 'UPZ_NOMBRE', 'NOM_UPZ',
  'NOMUPZ', 'upz_nombre', 'nom_upz',
];

/** Candidatos para código de localidad (JOIN con localidades). */
const UPZ_LOCALIDAD_KEYS = [
  'LocCodigo', 'LOC_CODIGO', 'cod_localidad', 'CODLOCALIDAD',
  'localidad_codigo', 'COD_LOC',
];

/** Convierte geometría Esri (rings) a GeoJSON Polygon. */
function esriRingsToGeoJsonPolygon(geometry) {
  const rings = geometry.rings;
  if (!rings || !Array.isArray(rings) || rings.length === 0) return null;
  // Esri: primer anillo exterior, resto huecos. GeoJSON: coordinates = [ exterior, hole1, ... ]
  const coords = rings.map((ring) => (Array.isArray(ring) && ring.length ? ring.map((p) => [Number(p[0]), Number(p[1])]) : []).filter((p) => p.length === 2));
  if (!coords.length || !coords[0].length) return null;
  return { type: 'Polygon', coordinates: coords };
}

/** SRID de referencia espacial Esri. 102100 = Web Mercator (≈ EPSG:3857). */
function esriWkidToSrid(wkid) {
  if (wkid == null || wkid === 4326) return 4326;
  if (Number(wkid) === 102100 || Number(wkid) === 3857) return 3857;
  return Number(wkid) || 4326;
}

/** Si las coordenadas parecen proyectadas (fuera de grados), asumir 3857. */
function sridDesdeGeometriaEsri(geometry) {
  let srid = esriWkidToSrid(geometry?.spatialReference?.wkid);
  if (srid === 4326 && geometry?.rings?.[0]?.[0]) {
    const x = Number(geometry.rings[0][0][0]);
    const y = Number(geometry.rings[0][0][1]);
    if (Math.abs(x) > 180 || Math.abs(y) > 90) srid = 3857;
  }
  return srid;
}

/** Normaliza GeometryCollection extrayendo solo polígonos en un MultiPolygon. Devuelve solo Polygon o MultiPolygon. */
function normalizarGeometria(geometry) {
  if (!geometry) return null;
  // Formato Esri (ArcGIS): { rings: [[[x,y],...]], spatialReference: {...} }
  if (geometry.rings && Array.isArray(geometry.rings)) {
    const poly = esriRingsToGeoJsonPolygon(geometry);
    if (!poly) return null;
    const srid = sridDesdeGeometriaEsri(geometry);
    // Solo invertir [lat,lng] si está en grados (4326); si es proyectada (3857) no tocar
    return srid === 4326 ? corregirOrdenCoordenadas(poly) : poly;
  }
  const type = (geometry.type || '').trim();
  if (type === 'GeometryCollection' || type.toLowerCase() === 'geometrycollection') {
    const poligonos = (geometry.geometries || []).filter(
      (g) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon')
    );
    if (poligonos.length === 0) return null;
    if (poligonos.length === 1) return poligonos[0];
    return {
      type: 'MultiPolygon',
      coordinates: poligonos.flatMap((g) =>
        g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
      ),
    };
  }
  if (type === 'Polygon' && geometry.coordinates) {
    return { type: 'Polygon', coordinates: geometry.coordinates };
  }
  if (type === 'MultiPolygon' && geometry.coordinates) {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates };
  }
  if ((type.toLowerCase() === 'polygon' || type.toLowerCase() === 'multipolygon') && geometry.coordinates) {
    return { type: type.toLowerCase() === 'polygon' ? 'Polygon' : 'MultiPolygon', coordinates: geometry.coordinates };
  }
  return null;
}

/** Devuelve la primera coordenada [x, y] del geometry (primer vértice del primer anillo). */
function primeraCoordenada(geometry) {
  if (!geometry?.coordinates?.length) return null;
  const c = geometry.coordinates;
  if (geometry.type === 'Polygon' && c[0]?.[0]) return c[0][0];
  if (geometry.type === 'MultiPolygon' && c[0]?.[0]?.[0]) return c[0][0][0];
  return null;
}

/** Invierte [lat, lng] → [lng, lat] en todos los anillos. */
function invertirCoordenadas(geometry) {
  const invertir = (coords) =>
    coords.map((c) => (Array.isArray(c[0]) ? invertir(c) : [c[1], c[0]]));
  if (geometry.type === 'Polygon' && geometry.coordinates) {
    return { type: 'Polygon', coordinates: invertir(geometry.coordinates) };
  }
  if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(invertir) };
  }
  return geometry;
}

/** Si la primera coordenada está en rango lat Bogotá (4–5), asume [lat,lng] y invierte. */
function corregirOrdenCoordenadas(geometry) {
  const prim = primeraCoordenada(geometry);
  if (!prim || prim.length < 2) return geometry;
  const val = Number(prim[0]);
  if (Number.isFinite(val) && val >= 4 && val <= 5.5) return invertirCoordenadas(geometry);
  return geometry;
}

/** Obtiene la URL del recurso GeoJSON de un dataset CKAN por package id. */
async function getGeoJsonResourceUrl(packageId) {
  const res = await axios.get(CKAN_PACKAGE_SHOW, { ...AXIOS_OPTS, params: { id: packageId } });
  const data = res.data;
  if (!data?.success || !data?.result?.resources?.length) return null;
  const geo = data.result.resources.find(
    (r) => (r.format || '').toUpperCase().replace(/\s/g, '') === 'GEOJSON' || (r.format || '').toUpperCase() === 'JSON'
  );
  return geo?.url || null;
}

/** Busca dataset UPZ por package_search y devuelve URL del recurso GeoJSON. */
async function getUpzGeoJsonUrlBySearch() {
  try {
    const res = await axios.get(CKAN_PACKAGE_SEARCH, {
      ...AXIOS_OPTS,
      params: { q: 'unidad planeamiento zonal UPZ bogota', rows: 5 },
    });
    const data = res.data;
    if (!data?.success || !data?.result?.results?.length) return null;
    const lower = (s) => (s || '').toLowerCase();
    const pkg = data.result.results.find(
      (p) =>
        lower(p.name).includes('upz') ||
        lower(p.title).includes('upz') ||
        lower(p.title).includes('unidad de planeamiento')
    );
    if (!pkg?.resources?.length) return null;
    const geo = pkg.resources.find(
      (r) => (r.format || '').toUpperCase().replace(/\s/g, '') === 'GEOJSON' || (r.format || '').toUpperCase() === 'JSON'
    );
    return geo?.url || null;
  } catch {
    return null;
  }
}

/** Intenta obtener URL del recurso UPZ probando slugs en orden. */
async function getUpzGeoJsonUrlBySlugs() {
  for (const slug of UPZ_SLUGS) {
    try {
      const url = await getGeoJsonResourceUrl(slug);
      if (url) return url;
    } catch {
      continue;
    }
  }
  return null;
}

/** Obtiene features UPZ: 1) IDECA WFS, 2) ArcGIS FeatureServer, 3) CKAN. Devuelve { features, source }. */
async function fetchUpzFromRemote() {
  try {
    const res = await axios.get(UPZ_IDECA_WFS_URL, { ...AXIOS_OPTS, timeout: 120000 });
    const data = res.data;
    const features = data?.features && Array.isArray(data.features) ? data.features : [];
    if (res.status === 200 && features.length > 0) {
      return { features, source: 'IDECA WFS' };
    }
  } catch {
    // Siguiente intento
  }
  try {
    const features = await downloadGeoJson(UPZ_ARCGIS_URL);
    if (features.length > 0) return { features, source: 'ArcGIS FeatureServer' };
  } catch {
    // Siguiente intento
  }
  try {
    let urlUpz = await getUpzGeoJsonUrlBySearch();
    if (!urlUpz) urlUpz = await getUpzGeoJsonUrlBySlugs();
    if (urlUpz) {
      const features = await downloadGeoJson(urlUpz);
      if (features.length > 0) return { features, source: 'CKAN' };
    }
  } catch {
    // fallback
  }
  return { features: [], source: null };
}

/** Descarga GeoJSON; si es FeatureServer/ArcGIS, pagina (resultOffset/resultRecordCount). */
async function downloadGeoJson(url) {
  const isFeatureServer = url && url.includes('FeatureServer');
  if (!isFeatureServer) {
    const res = await axios.get(url, { ...AXIOS_OPTS, timeout: 90000 });
    const data = res.data;
    if (data?.features && Array.isArray(data.features)) return data.features;
    if (Array.isArray(data)) return data;
    return [];
  }
  const features = [];
  let offset = 0;
  const limit = 500;
  const sep = url.includes('?') ? '&' : '?';
  while (true) {
    const urlPag = `${url}${sep}resultOffset=${offset}&resultRecordCount=${limit}&f=geojson`;
    const res = await axios.get(urlPag, { ...AXIOS_OPTS, timeout: 60000 });
    const data = res.data;
    const feats = data?.features && Array.isArray(data.features) ? data.features : [];
    features.push(...feats);
    if (feats.length < limit) break;
    offset += limit;
  }
  return features;
}

/** Lee features desde un archivo GeoJSON local. */
function readFeaturesFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data?.features && Array.isArray(data.features)) return data.features;
    if (Array.isArray(data)) return data;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(ZONAS_DIR)) fs.mkdirSync(ZONAS_DIR, { recursive: true });

  const hasLocalidades = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'localidades'`
  ).then((r) => r.rows[0]);
  const hasUpz = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'upz'`
  ).then((r) => r.rows[0]);
  if (!hasLocalidades || !hasUpz) {
    console.error('[etl-zonas] Ejecuta npm run db:migrate (tablas localidades y upz).');
    process.exit(1);
  }

  let localidadesCargadas = 0;
  let upzCargadas = 0;

  // --- Localidades: archivo local o CKAN ---
  let featuresLoc = readFeaturesFromFile(LOCALIDADES_LOCAL);
  if (featuresLoc && featuresLoc.length > 0) {
    console.log('[etl-zonas] Leyendo localidades desde archivo local:', LOCALIDADES_LOCAL);
  } else {
    const urlLocalidades = await getGeoJsonResourceUrl('localidad-bogota-d-c');
    if (urlLocalidades) {
      console.log('[etl-zonas] Descargando localidades...');
      featuresLoc = await downloadGeoJson(urlLocalidades);
    } else {
      console.warn('[etl-zonas] No se encontró recurso GeoJSON para dataset localidad-bogota-d-c. Coloca data/zonas/localidades_bogota.geojson y vuelve a correr.');
    }
  }
  if (featuresLoc && featuresLoc.length > 0) {
    let locConGeom = 0;
    let locSinGeom = 0;
    for (const f of featuresLoc) {
      const props = f.properties || f.attributes || {};
      const codigo = String(getProp(props, 'LocCodigo', 'CODIGO', 'codigo', 'LocCodigo') ?? '').trim().slice(0, 10) || null;
      const nombre = String(getProp(props, 'LocNombre', 'NOMBRE', 'nombre', 'LocNombre') ?? 'Sin nombre').trim().slice(0, 100);
      if (!nombre) continue;
      let geomNorm = normalizarGeometria(f.geometry);
      if (geomNorm && !f.geometry?.rings) geomNorm = corregirOrdenCoordenadas(geomNorm);
      const geomJson = geomNorm ? JSON.stringify(geomNorm) : null;
      const sridLoc = f.geometry?.rings ? sridDesdeGeometriaEsri(f.geometry) : 4326;
      if (geomJson) locConGeom++; else locSinGeom++;
      try {
        if (geomJson) {
          await query(
            `INSERT INTO localidades (codigo, nombre, geom)
             VALUES ($1, $2, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($3), $4), 4326))
             ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, geom = EXCLUDED.geom`,
            [codigo || `LOC_${localidadesCargadas}`, nombre, geomJson, sridLoc]
          );
        } else {
          await query(
            `INSERT INTO localidades (codigo, nombre, geom)
             VALUES ($1, $2, NULL)
             ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, geom = EXCLUDED.geom`,
            [codigo || `LOC_${localidadesCargadas}`, nombre]
          );
        }
        localidadesCargadas++;
      } catch (err) {
        console.warn('[etl-zonas] Localidad', codigo || nombre, err.message);
      }
    }
    console.log('[etl-zonas] Localidades cargadas/actualizadas:', localidadesCargadas, '(con geom:', locConGeom, ', sin geom:', locSinGeom, ')');
  }

  // --- UPZ: archivo local o IDECA WFS → ArcGIS → CKAN ---
  const UPZ_LOCAL_PATH = path.resolve(
    __dirname, '../../data/zonas/upz_bogota.geojson'
  );

  let upzFeatures = [];
  let upzSource = 'desconocida';

  if (fs.existsSync(UPZ_LOCAL_PATH)) {
    const raw = JSON.parse(fs.readFileSync(UPZ_LOCAL_PATH, 'utf8'));
    upzFeatures = raw.features || [];
    upzSource = 'archivo local';
    console.log(
      `[etl-zonas] Fuente UPZ: archivo local (${upzFeatures.length} features)`
    );
  } else {
    console.log('[etl-zonas] Archivo local no encontrado, usando CKAN...');
    const result = await fetchUpzFromRemote();
    upzFeatures = result.features || [];
    upzSource = result.source || 'CKAN';
    console.log(`[etl-zonas] Fuente UPZ: ${upzSource}`);
  }

  if (upzFeatures && upzFeatures.length > 0) {
    // Reset UPZ si hay pocas y estamos cargando desde remoto (completar con 117)
    if (upzSource !== 'archivo local') {
      const countUpz = await query('SELECT COUNT(*) AS c FROM upz').then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
      if (countUpz < 100) {
        await query('UPDATE nodos SET upz_id = NULL WHERE upz_id IS NOT NULL');
        await query('DELETE FROM upz');
        console.log('[etl-zonas] UPZ existentes < 100: reset aplicado (nodos.upz_id = NULL, upz vacía).');
      }
    }
    let upzConGeom = 0;
    let upzSinGeom = 0;
    for (const f of upzFeatures) {
      const props = f.properties || f.attributes || {};
      const codigoRaw = getField(props, UPZ_CODIGO_KEYS);
      const codigo = codigoRaw ? codigoRaw.slice(0, 10) : null;
      const nombreRaw = getField(props, UPZ_NOMBRE_KEYS);
      const nombre = (nombreRaw || 'Sin nombre').slice(0, 100);
      const codigoLocRaw = getField(props, UPZ_LOCALIDAD_KEYS);
      const codigoLoc = codigoLocRaw ? codigoLocRaw.slice(0, 10) : null;
      if (!nombre) continue;
      let geomNormUpz = normalizarGeometria(f.geometry);
      if (geomNormUpz && !f.geometry?.rings) geomNormUpz = corregirOrdenCoordenadas(geomNormUpz);
      const geomJsonUpz = geomNormUpz ? JSON.stringify(geomNormUpz) : null;
      let sridUpz = 4326;
      if (f.geometry?.rings) sridUpz = sridDesdeGeometriaEsri(f.geometry);
      else if (geomNormUpz) {
        const prim = primeraCoordenada(geomNormUpz);
        if (prim && prim.length >= 2) {
          const a = Number(prim[0]), b = Number(prim[1]);
          if (Math.abs(a) > 180 || Math.abs(b) > 90) sridUpz = 3857;
        }
      }
      if (geomJsonUpz) upzConGeom++; else upzSinGeom++;
      try {
        if (geomJsonUpz) {
          await query(
            `INSERT INTO upz (codigo, nombre, localidad_id, geom)
             VALUES ($1, $2, (SELECT id FROM localidades WHERE codigo = $3 LIMIT 1), ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($4), $5), 4326))
             ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, geom = EXCLUDED.geom, localidad_id = EXCLUDED.localidad_id`,
            [codigo || `UPZ_${upzCargadas}`, nombre, codigoLoc, geomJsonUpz, sridUpz]
          );
        } else {
          await query(
            `INSERT INTO upz (codigo, nombre, localidad_id, geom)
             VALUES ($1, $2, (SELECT id FROM localidades WHERE codigo = $3 LIMIT 1), NULL)
             ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, geom = EXCLUDED.geom, localidad_id = EXCLUDED.localidad_id`,
            [codigo || `UPZ_${upzCargadas}`, nombre, codigoLoc]
          );
        }
        upzCargadas++;
      } catch (err) {
        console.warn('[etl-zonas] UPZ', codigo || nombre, err.message);
      }
    }
    console.log('[etl-zonas] UPZ insertadas/actualizadas:', upzCargadas, '(con geom:', upzConGeom, ', sin geom:', upzSinGeom, ')');
  }

  // --- Reasignar upz_id y localidad_id a nodos (ST_Intersects), siempre al final ---
  await query(`
    UPDATE nodos n
    SET upz_id = u.id
    FROM upz u
    WHERE ST_Intersects(n.geom, u.geom)
      AND n.geom IS NOT NULL
  `);
  const upzAsignados = await query(
    'SELECT COUNT(*) AS c FROM nodos WHERE upz_id IS NOT NULL'
  );

  await query(`
    UPDATE nodos n
    SET localidad_id = l.id
    FROM localidades l
    WHERE ST_Intersects(n.geom, l.geom)
      AND n.geom IS NOT NULL
  `);
  const locAsignados = await query(
    'SELECT COUNT(*) AS c FROM nodos WHERE localidad_id IS NOT NULL'
  );

  const sinGeom = await query(
    `SELECT COUNT(*) AS c FROM nodos WHERE geom IS NULL`
  ).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
  const totalNodos = await query(`SELECT COUNT(*) AS c FROM nodos`).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));

  await closePool();

  console.log('\n[etl-zonas] Resumen:');
  console.log('  Localidades cargadas/actualizadas:', localidadesCargadas);
  console.log('  UPZ insertadas/actualizadas:', upzCargadas);
  console.log(`  Nodos con upz_id asignado:       ${upzAsignados.rows[0].c}`);
  console.log(`  Nodos con localidad_id asignado: ${locAsignados.rows[0].c}`);
  console.log('  Nodos sin geometría (no asignables):', sinGeom);
  console.log('  Total nodos:', totalNodos);
}

main().catch((err) => {
  console.error('[etl-zonas]', err.message);
  process.exit(1);
});
