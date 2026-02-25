/**
 * Adaptadores SECOP: tablas extraídas de PDF (CSV crudos) → CSV estándar.
 * PlantillaPDF_1: basada en estudios tipo PPRU Nueva Aranda (001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf).
 * Ver docs/TAREA3_PDF_SECOP.md.
 */

import fs from 'fs';
import path from 'path';

const STANDARD_HEADER =
  'archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis';

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function findCol(headerNorm, ...candidates) {
  for (const c of candidates) {
    const n = norm(c);
    const i = headerNorm.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function escapeCsv(val) {
  const s = String(val ?? '').trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizarSentido(v) {
  const s = String(v ?? '').toUpperCase().trim();
  if (/^N.*S|NS$/i.test(s)) return 'NS';
  if (/^S.*N|SN$/i.test(s)) return 'SN';
  if (/^E.*O|EO$/i.test(s)) return 'EO';
  if (/^O.*E|OE$/i.test(s)) return 'OE';
  return s || 'NS';
}

function parseFecha(v) {
  if (!v) return '';
  const s = String(v).trim();
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return s.slice(0, 10);
}

function parseHora(v) {
  if (!v) return '00:00';
  const s = String(v).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 0 && n < 24) return `${String(n).padStart(2, '0')}:00`;
  return '00:00';
}

function parseHoraRango(v) {
  const s = String(v ?? '').trim();
  const dash = s.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
  if (dash) return { inicio: parseHora(dash[1]), fin: parseHora(dash[2]) };
  const ini = parseHora(s);
  const [hh, mm] = ini.split(':').map(Number);
  const finMin = (mm || 0) + 15;
  const fin = finMin >= 60 ? `${String((hh || 0) + 1).padStart(2, '0')}:00` : `${String(hh || 0).padStart(2, '0')}:${String(finMin).padStart(2, '0')}`;
  return { inicio: ini, fin };
}

function parseCSVLine(line, sep = ',') {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === sep && !inQuotes) {
      out.push(cur.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
  return out;
}

/** Mapeo de columnas para PlantillaPDF_1 (tablas tipo estudio PPRU / consultora estándar). */
function buildColumnMapPlantillaPDF1(headerRow) {
  const headerNorm = headerRow.map((h) => norm(h));
  return {
    direccion: findCol(headerNorm, 'interseccion', 'interseccion', 'punto', 'ubicacion', 'direccion', 'cruce', 'localidad', 'int', 'puntoarco', 'nodo'),
    interseccion: findCol(headerNorm, 'interseccion', 'punto', 'ubicacion', 'int'),
    via_principal: findCol(headerNorm, 'via_principal', 'via_1', 'calle_principal'),
    via_secundaria: findCol(headerNorm, 'via_secundaria', 'via_2', 'calle_secundaria'),
    nodo_nombre: findCol(headerNorm, 'nodo_nombre', 'nombre', 'descripcion', 'nodo'),
    fecha: findCol(headerNorm, 'fecha', 'fecha_conteo', 'fecha_estudio', 'dia'),
    sentido: findCol(headerNorm, 'sentido', 'direccion_flujo', 'flujo', 'movimiento', 'mov'),
    hora_inicio: findCol(headerNorm, 'hora_inicio', 'hora_ini', 'hora', 'inicio'),
    hora_fin: findCol(headerNorm, 'hora_fin', 'hora_final', 'fin'),
    hora: findCol(headerNorm, 'hora', 'hora_inicio'),
    hora_rango: findCol(headerNorm, 'hora_rango', 'intervalo', 'rango_horario', 'periodo'),
    vol_total: findCol(headerNorm, 'vol_total', 'total', 'intensidad', 'volumen', 'conteo_total', 'vehiculos', 'mixos', 'mixtos', 'volumenobservado'),
    vol_livianos: findCol(headerNorm, 'vol_livianos', 'livianos', 'autos', 'liviano', 'vehiculos_livianos'),
    vol_motos: findCol(headerNorm, 'vol_motos', 'motos', 'motocicletas'),
    vol_buses: findCol(headerNorm, 'vol_buses', 'buses', 'bus'),
    vol_pesados: findCol(headerNorm, 'vol_pesados', 'pesados', 'camiones', 'c2', 'c3'),
    vol_bicis: findCol(headerNorm, 'vol_bicis', 'bicis', 'bicicletas', 'ciclas'),
  };
}

function rowToStandard(headerRow, dataRow, columnMap, archivoNombre, origen, fechaDefault) {
  const get = (key) => {
    const i = columnMap[key];
    if (i < 0 || dataRow[i] === undefined) return '';
    return String(dataRow[i] ?? '').trim();
  };
  const getNum = (key) => {
    const v = get(key);
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const direccion =
    get('direccion') ||
    get('interseccion') ||
    (get('via_principal') + ' ' + get('via_secundaria')).trim() ||
    get('nodo_nombre') ||
    'Punto de conteo';
  const nodoNombre = get('nodo_nombre') || direccion;
  const fecha = parseFecha(get('fecha')) || fechaDefault || '';
  const sentido = normalizarSentido(get('sentido'));
  const horaVal = get('hora_inicio') || get('hora') || get('hora_rango');
  const { inicio: hora_inicio, fin: hora_fin } = parseHoraRango(horaVal);
  let vol_total = getNum('vol_total') || getNum('volumen') || getNum('vehiculos');
  const vol_livianos = getNum('vol_livianos');
  const vol_motos = getNum('vol_motos');
  const vol_buses = getNum('vol_buses');
  const vol_pesados = getNum('vol_pesados');
  const vol_bicis = getNum('vol_bicis');
  if (vol_total <= 0 && (vol_livianos || vol_motos || vol_buses || vol_pesados || vol_bicis)) {
    vol_total = vol_livianos + vol_motos + vol_buses + vol_pesados + vol_bicis;
  }

  if (!direccion && !nodoNombre) return null;
  if (!fecha && !vol_total) return null;
  if (vol_total < 0) return null;

  return [
    escapeCsv(archivoNombre),
    escapeCsv(origen),
    escapeCsv(nodoNombre),
    escapeCsv(direccion),
    fecha,
    sentido,
    hora_inicio,
    hora_fin,
    vol_total,
    vol_livianos,
    vol_motos,
    vol_buses,
    vol_pesados,
    vol_bicis,
  ].join(',');
}

/**
 * Adapta una tabla CSV cruda (extraída del PDF) al CSV estándar.
 * @param {string} tablaCsvPath - Ruta al tabla_N.csv
 * @param {string} archivoOriginalNombre - Nombre del PDF original
 * @param {{ fecha?: string, origen?: string, outPath?: string }} metadatos - fecha YYYY-MM-DD (TODO: inferir del PDF), origen, ruta de salida
 * @returns {Promise<string>} Ruta del CSV estándar generado
 */
export async function adaptarPlantillaPDF_1(tablaCsvPath, archivoOriginalNombre, metadatos = {}) {
  const origen = metadatos.origen || 'SECOP';
  const fechaDefault = metadatos.fecha || ''; // TODO: inferir desde PDF o archivos_fuente
  const outPath = metadatos.outPath || path.join(path.dirname(tablaCsvPath), 'estandar_plantilla1.csv');

  const raw = fs.readFileSync(tablaCsvPath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('Tabla CSV con menos de 2 líneas');

  const sep = raw.includes(';') ? ';' : ',';
  const headerRow = parseCSVLine(lines[0], sep);
  const columnMap = buildColumnMapPlantillaPDF1(headerRow);
  if (headerRow.length > 0 && norm(headerRow[0]) === '') columnMap.direccion = 0;
  else if (columnMap.direccion < 0) columnMap.direccion = 0;
  if (columnMap.vol_total < 0 && columnMap.vol_livianos < 0 && columnMap.vol_motos < 0) {
    throw new Error('No se encontraron columnas esperadas (direccion/interseccion, vol_total o desglose)');
  }

  const standardLines = [STANDARD_HEADER];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i], sep);
    const out = rowToStandard(headerRow, row, columnMap, archivoOriginalNombre, origen, fechaDefault);
    if (out) standardLines.push(out);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, standardLines.join('\n'), 'utf8');
  return outPath;
}

/** PlantillaPDF_2: estudio_transito_pp_el_carmen_v4.pdf (misma estructura que PPRU; reutiliza PlantillaPDF_1). */
export async function adaptarPlantillaPDF_2(tablaCsvPath, archivoOriginalNombre, metadatos = {}) {
  const outPath = (metadatos.outPath || path.join(path.dirname(tablaCsvPath), 'estandar_plantilla2.csv'));
  return adaptarPlantillaPDF_1(tablaCsvPath, archivoOriginalNombre, { ...metadatos, outPath });
}

/** PlantillaPDF_3: 4_190805_informe_de_transito_vf.pdf (reutiliza PlantillaPDF_1; ajustar columnas si difiere). */
export async function adaptarPlantillaPDF_3(tablaCsvPath, archivoOriginalNombre, metadatos = {}) {
  const outPath = (metadatos.outPath || path.join(path.dirname(tablaCsvPath), 'estandar_plantilla3.csv'));
  return adaptarPlantillaPDF_1(tablaCsvPath, archivoOriginalNombre, { ...metadatos, outPath });
}

/**
 * Devuelve el adaptador PDF a usar según nombre de archivo (PDFs reales SDP/PPRU).
 * PlantillaPDF_1 → 001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf
 * PlantillaPDF_2 → estudio_transito_pp_el_carmen_v4.pdf
 * PlantillaPDF_3 → 4_190805_informe_de_transito_vf.pdf
 * PlantillaPDF_1 → 4.ESTUDIO-DE-MOVILIDAD.pdf (Fenicia) y resto por defecto
 * @param {object} archivoFuente - Fila de archivos_fuente (id, nombre_archivo, origen, ...)
 * @param {string[]} tablasCsvPaths - Rutas a tabla_1.csv, tabla_2.csv, ...
 * @returns {{ adaptador: string, tablaIndex?: number }}
 */
export function getAdaptadorPdfParaArchivo(archivoFuente, tablasCsvPaths) {
  const nombre = (archivoFuente.nombre_archivo || '').toLowerCase();
  let adaptador = 'adaptarPlantillaPDF_1';
  let tablaIndex = 1;
  if (nombre.includes('el_carmen') || nombre.includes('el carmen')) {
    adaptador = 'adaptarPlantillaPDF_2';
  } else if (nombre.includes('190805') || nombre.includes('informe_de_transito_vf')) {
    adaptador = 'adaptarPlantillaPDF_3';
  }
  return { adaptador, tablaIndex };
}
