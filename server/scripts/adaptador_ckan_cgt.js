/**
 * Adaptador CSV CKAN CGT → CSV estándar (archivo_nombre, origen, nodo_nombre, direccion, fecha, sentido, hora_inicio, hora_fin, vol_*).
 * Para recursos del dataset "Conteo Vehiculos CGT Bogotá D.C." o URLs con "cgt" / "conteo-vehiculos".
 *
 * Uso: node server/scripts/adaptador_ckan_cgt.js --path=ruta/al/archivo.csv
 *      node server/scripts/adaptador_ckan_cgt.js --path=ruta/al/archivo.csv --inspeccionar   (solo imprime header + 3 filas)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STANDARD_HEADER =
  'archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis';

function escapeCsvField(val) {
  const s = String(val ?? '').trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line) {
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
}

/**
 * Convierte CSV crudo CKAN/CGT a filas estándar. Mapea columnas típicas (DIRECCION, NOMBRE_NODO, FECHA, VOL_TOTAL, etc.).
 * @param {string} rawCsvText
 * @param {string} defaultDate - YYYY-MM-DD
 * @param {{ archivo_nombre?: string, origen?: string }} opts
 * @returns {{ header: string[], rows: object[], standardRows: object[] }}
 */
function parseRawCsvToStandard(rawCsvText, defaultDate, opts = {}) {
  const archivoNombre = opts.archivo_nombre || 'cgt_ckan.csv';
  const origen = opts.origen || 'DATOS_ABIERTOS';
  const lines = rawCsvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { header: [], rows: [], standardRows: [] };

  const header = parseCsvLine(lines[0]);
  const headerNorm = header.map((h) => h.toUpperCase().replace(/\s/g, '_'));
  const col = (name) => headerNorm.indexOf(String(name).toUpperCase().replace(/\s/g, '_'));
  const get = (row, ...keys) => {
    for (const key of keys) {
      const i = col(key);
      if (i >= 0 && row[i] !== undefined) {
        const v = String(row[i] || '').trim();
        if (v !== '') return v;
      }
    }
    return '';
  };

  const standardRows = [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    rows.push(row);
    const direccion = get(row, 'DIRECCION', 'NOMBRE_NODO', 'NOMBRE', 'UBICACION', 'PUNTO', 'NODO') || 'Sin dirección';
    const nodoNombre = get(row, 'NOMBRE_NODO', 'NOMBRE', 'PUNTO') || direccion;
    const fechaVal = get(row, 'FECHA', 'FECHA_CONTEO', 'FECHA_HORA', 'FECHA_INICIO');
    const fecha = (fechaVal && fechaVal.slice(0, 10)) || defaultDate;
    const horaInicio = get(row, 'HORA_INICIO', 'HORA', 'HORA_INICIO_1') || '00:00';
    let horaFin = get(row, 'HORA_FIN', 'HORA_FIN_1');
    if (!horaFin) {
      const [hh, mm] = horaInicio.split(':').map((n) => parseInt(n, 10) || 0);
      const m2 = mm + 15;
      horaFin = m2 < 60 ? `${String(hh).padStart(2, '0')}:${String(m2).padStart(2, '0')}` : `${String(hh + 1).padStart(2, '0')}:${String(m2 % 60).padStart(2, '0')}`;
    }
    const sentido = get(row, 'SENTIDO', 'DIRECCION_FLUJO', 'FLUJO') || 'NS';
    const volTotal = parseInt(get(row, 'VOL_TOTAL', 'VOLUMEN', 'TOTAL', 'CONTEO', 'CANTIDAD', 'VEHICULOS') || '0', 10);
    if (!Number.isFinite(volTotal) || volTotal < 0) continue;
    const volLivianos = parseInt(get(row, 'VOL_LIVIANOS', 'LIVIANOS', 'AUTOS') || '0', 10) || 0;
    const volMotos = parseInt(get(row, 'VOL_MOTOS', 'MOTOS') || '0', 10) || 0;
    const volBuses = parseInt(get(row, 'VOL_BUSES', 'BUSES') || '0', 10) || 0;
    const volPesados = parseInt(get(row, 'VOL_PESADOS', 'PESADOS') || '0', 10) || 0;
    const volBicis = parseInt(get(row, 'VOL_BICIS', 'BICIS', 'BICICLETAS') || '0', 10) || 0;

    standardRows.push({
      archivo_nombre: archivoNombre,
      origen,
      nodo_nombre: nodoNombre,
      direccion,
      fecha,
      sentido,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      vol_total: volTotal,
      vol_livianos: volLivianos,
      vol_motos: volMotos,
      vol_buses: volBuses,
      vol_pesados: volPesados,
      vol_bicis: volBicis,
    });
  }
  return { header, rows, standardRows };
}

/**
 * Escribe CSV estándar en outPath y devuelve outPath.
 * @param {string} csvPath - Ruta del CSV original
 * @param {object[]} standardRows
 * @param {{ archivo_nombre?: string, origen?: string }} opts
 * @returns {string} ruta del CSV estándar
 */
function writeStandardCsv(csvPath, standardRows, opts = {}) {
  const archivoNombre = opts.archivo_nombre || path.basename(csvPath);
  const dir = path.dirname(csvPath);
  const base = path.basename(csvPath, path.extname(csvPath));
  const outPath = path.join(dir, `${base}_estandar.csv`);
  const lines = [STANDARD_HEADER];
  for (const r of standardRows) {
    lines.push([
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
    ].join(','));
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

/**
 * Adapta un CSV CKAN CGT al formato estándar. Escribe *_estandar.csv en el mismo directorio.
 * @param {string} csvPath - Ruta del CSV descargado
 * @param {{ archivo_nombre?: string, origen?: string }} opts
 * @returns {string|null} ruta del CSV estándar o null si no hubo filas válidas
 */
export function adaptarCgtCsv(csvPath, opts = {}) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const defaultDate = new Date().toISOString().slice(0, 10);
  const { standardRows } = parseRawCsvToStandard(raw, defaultDate, {
    archivo_nombre: opts.archivo_nombre || path.basename(csvPath),
    origen: opts.origen || 'DATOS_ABIERTOS',
  });
  if (standardRows.length === 0) return null;
  return writeStandardCsv(csvPath, standardRows, opts);
}

/**
 * Inspección: imprime header y primeras 3 filas del CSV (para ver columnas CKAN).
 * @param {string} csvPath
 */
export function inspeccionarCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    console.log('[adaptador-ckan-cgt] Archivo vacío.');
    return;
  }
  const header = parseCsvLine(lines[0]);
  console.log('[adaptador-ckan-cgt] Header:', header.join(' | '));
  console.log('[adaptador-ckan-cgt] Primeras 3 filas:');
  for (let i = 1; i <= Math.min(3, lines.length - 1); i++) {
    console.log('  Fila', i, ':', parseCsvLine(lines[i]).join(' | '));
  }
}

// CLI cuando se ejecuta como script (node adaptador_ckan_cgt.js --path=...)
const pathArg = process.argv.find((a) => a.startsWith('--path='));
if (pathArg) {
  const csvPath = path.resolve(process.cwd(), pathArg.split('=')[1]);
  const inspeccionar = process.argv.includes('--inspeccionar');
  if (!fs.existsSync(csvPath)) {
    console.error('Archivo no encontrado:', csvPath);
    process.exit(1);
  }
  if (inspeccionar) {
    inspeccionarCsv(csvPath);
    process.exit(0);
  }
  const outPath = adaptarCgtCsv(csvPath);
  if (outPath) console.log('[adaptador-ckan-cgt] CSV estándar escrito:', outPath);
  else console.warn('[adaptador-ckan-cgt] No se generaron filas válidas.');
}
