/**
 * Ingesta automática CGT (Conteo Vehículos): descarga/consulta CGT → CSV estándar → ETL CSV.
 * No modifica etl_fuente_externa_csv.js; lo invoca como subproceso.
 *
 * Fuente: dataset "Conteo Vehiculos CGT Bogotá D.C." (Datos Abiertos / ArcGIS).
 * Configuración: CGT_CSV_URL (CSV directo) o CGT_ARCGIS_QUERY_URL (query ArcGIS f=json).
 *
 * Uso: npm run etl:cgt
 *      node server/scripts/fetch_and_convert_cgt_csv.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
const TMP_DIR = path.join(__dirname, 'tmp');
const RAW_CSV_PATH = path.join(TMP_DIR, 'cgt_raw.csv');
const RAW_JSON_PATH = path.join(TMP_DIR, 'cgt_raw.json');
const STANDARD_CSV_PATH = path.join(TMP_DIR, 'cgt_standard.csv');

const STANDARD_HEADER =
  'archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis';
const STANDARD_HEADER_WITH_GEOM = STANDARD_HEADER + ',lat,lng';

/** Escapa un campo para CSV (comillas si contiene coma). */
function escapeCsvField(val) {
  const s = String(val ?? '').trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Obtiene atributo de objeto con claves en mayúsculas (ArcGIS suele usar MAYUSCULAS). */
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

/** Parsea fecha/hora desde valor CGT (timestamp ms, o string ISO, o "YYYY-MM-DD", o "HH:MM"). */
function parseFechaHora(val, defaultDate) {
  if (val == null || val === '') return { fecha: defaultDate, horaInicio: '00:00', horaFin: '00:15' };
  const v = String(val).trim();
  const asNum = parseInt(v, 10);
  if (Number.isFinite(asNum) && asNum > 1e10) {
    const d = new Date(asNum);
    const fecha = d.toISOString().slice(0, 10);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const horaInicio = `${h}:${String(m).padStart(2, '0')}`;
    const m2 = m + 15;
    const horaFin = m2 < 60 ? `${h}:${String(m2).padStart(2, '0')}` : `${h + 1}:00`;
    return { fecha, horaInicio, horaFin };
  }
  if (v.match(/^\d{4}-\d{2}-\d{2}/)) {
    const fecha = v.slice(0, 10);
    const timePart = v.match(/T(\d{2}):(\d{2})/);
    const horaInicio = timePart ? `${timePart[1]}:${timePart[2]}` : '00:00';
    const [hh, mm] = horaInicio.split(':').map(Number);
    const mm2 = mm + 15;
    const horaFin = mm2 < 60 ? `${String(hh).padStart(2, '0')}:${String(mm2).padStart(2, '0')}` : `${String(hh + 1).padStart(2, '0')}:00`;
    return { fecha, horaInicio, horaFin };
  }
  if (v.match(/^\d{1,2}:\d{2}/)) return { fecha: defaultDate, horaInicio: v.slice(0, 5), horaFin: '00:15' };
  return { fecha: defaultDate, horaInicio: '00:00', horaFin: '00:15' };
}

/** Convierte features ArcGIS (array de { attributes }) a filas CSV estándar. */
function arcgisFeaturesToStandardRows(features, defaultDate) {
  const rows = [];
  for (const f of features) {
    const att = f.attributes || {};
    const nodoNombre = getAttr(att, 'NOMBRE_NODO', 'NOMBRE', 'NODO', 'NAME', 'DESCRIPCION') || 'Sin nombre';
    const direccion = getAttr(att, 'DIRECCION', 'DIRECCION_NODO', 'NOMBRE_NODO', 'ADDRESS', 'UBICACION') || nodoNombre;
    const sentido = getAttr(att, 'SENTIDO', 'DIRECCION_FLUJO', 'FLUJO') || 'NS';
    const volTotal = getAttr(att, 'VOL_TOTAL', 'VOLUMEN', 'TOTAL', 'CONTEO', 'CANTIDAD');
    const volNum = volTotal != null ? parseInt(volTotal, 10) : 0;
    if (!Number.isFinite(volNum) || volNum < 0) continue;

    const fechaVal = getAttr(att, 'FECHA', 'FECHA_CONTEO', 'FECHA_HORA', 'FECHA_INICIO');
    const horaInicioVal = getAttr(att, 'HORA_INICIO', 'HORA');
    const horaFinVal = getAttr(att, 'HORA_FIN');
    const { fecha, horaInicio, horaFin } = horaInicioVal != null && horaFinVal != null
      ? { fecha: (fechaVal && String(fechaVal).slice(0, 10)) || defaultDate, horaInicio: String(horaInicioVal).slice(0, 5), horaFin: String(horaFinVal).slice(0, 5) }
      : parseFechaHora(fechaVal || horaInicioVal, defaultDate);

    rows.push({
      archivo_nombre: 'cgt_standard.csv',
      origen: 'CGT_SDM',
      nodo_nombre: nodoNombre,
      direccion,
      fecha,
      sentido,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      vol_total: volNum,
      vol_livianos: 0,
      vol_motos: 0,
      vol_buses: 0,
      vol_pesados: 0,
      vol_bicis: 0,
    });
  }
  return rows;
}

/** Convierte features GeoJSON (properties + geometry) a filas CSV estándar. Incluye lat/lng si hay geometry. */
function geojsonFeaturesToStandardRows(features, defaultDate) {
  const rows = [];
  for (const f of features) {
    const props = f.properties || f.attributes || {};
    const getP = (...keys) => {
      for (const k of keys) {
        const v = props[k];
        if (v != null && v !== '') return String(v).trim();
      }
      return null;
    };
    const nodoNombre = getP('name', 'nombre', 'NOMBRE', 'nombre_nodo', 'description') || 'Sin nombre';
    const direccion = getP('address', 'direccion', 'DIRECCION', 'address', 'ubicacion') || nodoNombre;
    const fechaVal = getP('creationda', 'fecha', 'FECHA', 'fecha_conteo', 'creation_date');
    const fecha = fechaVal && fechaVal.match(/\d{4}-\d{2}-\d{2}/) ? fechaVal.slice(0, 10) : defaultDate;
    const sentido = getP('sentido', 'SENTIDO', 'direccion_flujo') || 'NS';
    let volTotal = 0;
    const v = getP('vol_total', 'VOL_TOTAL', 'volumen', 'total', 'conteo');
    if (v != null) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) volTotal = n;
    }
    let lat = null;
    let lng = null;
    if (f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2) {
      lng = f.geometry.coordinates[0];
      lat = f.geometry.coordinates[1];
    }
    const row = {
      archivo_nombre: 'cgt_standard.csv',
      origen: 'CGT_SDM',
      nodo_nombre: nodoNombre,
      direccion,
      fecha,
      sentido,
      hora_inicio: '00:00',
      hora_fin: '00:15',
      vol_total: volTotal,
      vol_livianos: 0,
      vol_motos: 0,
      vol_buses: 0,
      vol_pesados: 0,
      vol_bicis: 0,
    };
    if (lat != null && lng != null) {
      row.lat = lat;
      row.lng = lng;
    }
    rows.push(row);
  }
  return rows;
}

/** Parsea CSV simple (cabecera + filas) y mapea columnas CGT a estándar. */
function parseRawCsvToStandardRows(rawCsvText, defaultDate) {
  const lines = rawCsvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) {
        out.push(cur.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        cur = '';
      } else cur += c;
    }
    out.push(cur.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    return out;
  };

  const header = parseLine(lines[0]).map((h) => h.toUpperCase().replace(/\s/g, '_'));
  const col = (name) => header.indexOf(String(name).toUpperCase().replace(/\s/g, '_'));
  const get = (row, key) => {
    const i = col(key);
    return i >= 0 && row[i] !== undefined ? String(row[i] || '').trim() : '';
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseLine(lines[i]);
    const direccion = get(row, 'DIRECCION') || get(row, 'NOMBRE_NODO') || get(row, 'NOMBRE') || get(row, 'UBICACION') || 'Sin dirección';
    const nodoNombre = get(row, 'NOMBRE_NODO') || get(row, 'NOMBRE') || direccion;
    const fechaVal = get(row, 'FECHA') || get(row, 'FECHA_CONTEO') || get(row, 'FECHA_HORA');
    const fecha = (fechaVal && fechaVal.slice(0, 10)) || defaultDate;
    const horaInicio = get(row, 'HORA_INICIO') || get(row, 'HORA') || '00:00';
    let horaFin = get(row, 'HORA_FIN');
    if (!horaFin) {
      const [hh, mm] = horaInicio.split(':').map((n) => parseInt(n, 10) || 0);
      const m2 = mm + 15;
      horaFin = m2 < 60 ? `${String(hh).padStart(2, '0')}:${String(m2).padStart(2, '0')}` : `${String(hh + 1).padStart(2, '0')}:${String(m2 % 60).padStart(2, '0')}`;
    }
    const sentido = get(row, 'SENTIDO') || get(row, 'DIRECCION_FLUJO') || 'NS';
    const volTotal = parseInt(get(row, 'VOL_TOTAL') || get(row, 'VOLUMEN') || get(row, 'TOTAL') || '0', 10);
    if (!Number.isFinite(volTotal) || volTotal < 0) continue;

    rows.push({
      archivo_nombre: 'cgt_standard.csv',
      origen: 'CGT_SDM',
      nodo_nombre: nodoNombre,
      direccion,
      fecha,
      sentido,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      vol_total: volTotal,
      vol_livianos: 0,
      vol_motos: 0,
      vol_buses: 0,
      vol_pesados: 0,
      vol_bicis: 0,
    });
  }
  return rows;
}

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

function writeStandardCsv(rows, withGeom = false) {
  const header = withGeom ? STANDARD_HEADER_WITH_GEOM : STANDARD_HEADER;
  const lines = [header];
  for (const r of rows) {
    const base = [
      escapeCsvField(r.archivo_nombre),
      escapeCsvField(r.origen),
      escapeCsvField(r.nodo_nombre),
      escapeCsvField(r.direccion),
      escapeCsvField(r.fecha),
      escapeCsvField(r.sentido),
      escapeCsvField(r.hora_inicio),
      escapeCsvField(r.hora_fin),
      r.vol_total,
      r.vol_livianos,
      r.vol_motos,
      r.vol_buses,
      r.vol_pesados,
      r.vol_bicis,
    ];
    if (withGeom && r.lat != null && r.lng != null) {
      base.push(String(r.lat), String(r.lng));
    } else if (withGeom) {
      base.push('', '');
    }
    lines.push(base.join(','));
  }
  fs.writeFileSync(STANDARD_CSV_PATH, lines.join('\n'), 'utf8');
}

function runEtlCsv() {
  return new Promise((resolve, reject) => {
    const csvPathArg = path.join('server', 'scripts', 'tmp', 'cgt_standard.csv');
    const child = spawn('node', ['server/scripts/etl_fuente_externa_csv.js', `--path=${csvPathArg}`], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ETL salió con código ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  loadEnv();
  const csvUrl = process.env.CGT_CSV_URL;
  const arcgisUrl = process.env.CGT_ARCGIS_QUERY_URL;

  if (!csvUrl && !arcgisUrl) {
    console.error('[cgt] Configura CGT_CSV_URL (URL de CSV directo) o CGT_ARCGIS_QUERY_URL (URL de query ArcGIS con f=json).');
    console.error('  Ejemplo ArcGIS: https://serviciosgis.catastrobogota.gov.co/.../FeatureServer/0/query?where=1=1&outFields=*&f=json&resultRecordCount=5000');
    process.exit(1);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const defaultDate = new Date().toISOString().slice(0, 10);

  let standardRows = [];

  if (csvUrl) {
    const isGeoJsonUrl =
      (csvUrl.startsWith('http://') || csvUrl.startsWith('https://')) &&
      (csvUrl.endsWith('.geojson') || csvUrl.includes('geojson?'));
    if (isGeoJsonUrl) {
      console.log('[cgt] Descargando GeoJSON desde CGT_CSV_URL...');
      const res = await fetch(csvUrl, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const raw = await res.text();
      fs.writeFileSync(RAW_JSON_PATH, raw, 'utf8');
      console.log('[cgt] Guardado en', RAW_JSON_PATH);
      const data = JSON.parse(raw);
      const features = data.features || [];
      console.log('[cgt] Features GeoJSON:', features.length);
      standardRows = geojsonFeaturesToStandardRows(features, defaultDate);
    } else {
      const isLocalPath = !csvUrl.startsWith('http://') && !csvUrl.startsWith('https://');
      const localPath = isLocalPath ? path.resolve(PROJECT_ROOT, csvUrl) : null;
      if (localPath && fs.existsSync(localPath)) {
        console.log('[cgt] Leyendo CSV local:', localPath);
        const raw = fs.readFileSync(localPath, 'utf8');
        fs.writeFileSync(RAW_CSV_PATH, raw, 'utf8');
        console.log('[cgt] Copia en', RAW_CSV_PATH);
        standardRows = parseRawCsvToStandardRows(raw, defaultDate);
      } else {
        console.log('[cgt] Descargando CSV desde CGT_CSV_URL...');
        const res = await fetch(csvUrl, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const raw = await res.text();
        fs.writeFileSync(RAW_CSV_PATH, raw, 'utf8');
        console.log('[cgt] Guardado en', RAW_CSV_PATH);
        standardRows = parseRawCsvToStandardRows(raw, defaultDate);
      }
    }
  } else {
    const url = new URL(arcgisUrl);
    if (!url.searchParams.has('f')) url.searchParams.set('f', 'json');
    if (!url.searchParams.has('outFields')) url.searchParams.set('outFields', '*');
    if (!url.searchParams.has('where')) url.searchParams.set('where', '1=1');
    if (!url.searchParams.has('resultRecordCount')) url.searchParams.set('resultRecordCount', '5000');
    const queryUrl = url.toString();
    console.log('[cgt] Consultando ArcGIS...');
    const res = await fetch(queryUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    fs.writeFileSync(RAW_JSON_PATH, JSON.stringify(data, null, 0), 'utf8');
    console.log('[cgt] Guardado en', RAW_JSON_PATH);
    const features = data.features || [];
    console.log('[cgt] Features obtenidos:', features.length);
    standardRows = arcgisFeaturesToStandardRows(features, defaultDate);
  }

  if (standardRows.length === 0) {
    console.error('[cgt] No se generaron filas para el CSV estándar. Revisa la estructura del recurso CGT.');
    process.exit(1);
  }

  const withGeom = standardRows.some((r) => r.lat != null && r.lng != null);
  writeStandardCsv(standardRows, withGeom);
  console.log('[cgt] CSV estándar generado:', STANDARD_CSV_PATH, '(', standardRows.length, 'filas)', withGeom ? '(con lat/lng)' : '');

  console.log('[cgt] Ejecutando ETL CSV...');
  await runEtlCsv();

  console.log('[cgt] Resumen:');
  console.log('  CSV estándar:', STANDARD_CSV_PATH);
  console.log('  Filas convertidas:', standardRows.length);
  console.log('  ETL completado. Revisa el log anterior para node_id_externo de ejemplo.');
}

main().catch((err) => {
  console.error('[cgt] Error:', err.message);
  process.exit(1);
});
