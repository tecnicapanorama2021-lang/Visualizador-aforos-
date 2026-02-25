/**
 * Adaptadores SECOP: Excel/CSV de anexos → CSV estándar para etl_fuente_externa_csv.js.
 * Plantilla A: Matriz Aforos (XLSX). Plantilla B: Resumen conteos (CSV).
 * Plantilla C: Matriz Aforos Intersección (XLSX). Plantilla D: Conteos PMT (CSV/XLSX).
 * Ver docs/TAREA2_SECOP.md para el mapeo de columnas.
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const STANDARD_HEADER =
  'archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis';

/** Normaliza nombre de columna para búsqueda: minúsculas, espacios → _ */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Busca índice de columna por varios nombres posibles (cabecera ya normalizada). */
function findCol(headerNorm, ...candidates) {
  for (const c of candidates) {
    const n = norm(c);
    const i = headerNorm.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** Escapa campo CSV. */
function escapeCsv(val) {
  const s = String(val ?? '').trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Normaliza sentido a NS/SN/EO/OE o deja tal cual. */
function normalizarSentido(v) {
  const s = String(v ?? '').toUpperCase().trim();
  if (/^N.*S|NS$/i.test(s)) return 'NS';
  if (/^S.*N|SN$/i.test(s)) return 'SN';
  if (/^E.*O|EO$/i.test(s)) return 'EO';
  if (/^O.*E|OE$/i.test(s)) return 'OE';
  return s || 'NS';
}

/** Parsea fecha a YYYY-MM-DD. */
function parseFecha(v) {
  if (!v) return '';
  const s = String(v).trim();
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return s.slice(0, 10);
}

/** Parsea hora a HH:MM. */
function parseHora(v) {
  if (!v) return '00:00';
  const s = String(v).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 0 && n < 24) return `${String(n).padStart(2, '0')}:00`;
  return '00:00';
}

/** Si el valor es un rango "07:00-07:15", devuelve { inicio, fin }; si no, fin = inicio + 15 min. */
function parseHoraRango(v) {
  const s = String(v ?? '').trim();
  const dash = s.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
  if (dash) return { inicio: parseHora(dash[1]), fin: parseHora(dash[2]) };
  const ini = parseHora(s);
  const [hh, mm] = ini.split(':').map(Number);
  const finMin = mm + 15;
  const fin = finMin >= 60 ? `${String(hh + 1).padStart(2, '0')}:00` : `${String(hh).padStart(2, '0')}:${String(finMin).padStart(2, '0')}`;
  return { inicio: ini, fin };
}

/** Convierte fila de datos (array) a fila CSV estándar usando índices de columna. */
function rowToStandard(headerNorm, dataRow, columnMap, archivoNombre, origen) {
  const get = (key) => {
    const i = columnMap[key];
    if (i < 0 || dataRow[i] === undefined) return '';
    return String(dataRow[i] ?? '').trim();
  };
  const getNum = (key) => {
    const v = get(key);
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };

  const direccion =
    get('direccion') ||
    get('interseccion') ||
    (get('via_principal') + ' ' + get('via_secundaria')).trim() ||
    get('punto');
  const nodoNombre = get('nodo_nombre') || direccion || 'Sin nombre';
  const fecha = parseFecha(get('fecha'));
  const sentido = normalizarSentido(get('sentido'));
  const horaVal = get('hora_inicio') || get('hora') || get('hora_rango');
  const { inicio: hora_inicio, fin: hora_fin } = parseHoraRango(horaVal);
  const vol_total = getNum('vol_total') || getNum('total') || getNum('intensidad') || getNum('volumen');
  const vol_livianos = getNum('vol_livianos') || getNum('livianos') || getNum('autos');
  const vol_motos = getNum('vol_motos') || getNum('motos');
  const vol_buses = getNum('vol_buses') || getNum('buses');
  const vol_pesados = getNum('vol_pesados') || getNum('pesados') || getNum('camiones');
  const vol_bicis = getNum('vol_bicis') || getNum('bicis') || getNum('bicicletas');

  if (!direccion && !nodoNombre) return null;
  if (!fecha) return null;
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
 * Construye el mapa de columnas para Plantilla A (Matriz Aforos XLSX).
 * Cabecera: array de nombres de columna (primera fila del sheet).
 */
function buildColumnMapPlantillaA(headerRow) {
  const headerNorm = headerRow.map((h) => norm(h));
  return {
    direccion: findCol(headerNorm, 'interseccion', 'direccion', 'ubicacion', 'punto', 'punto_de_conteo'),
    interseccion: findCol(headerNorm, 'interseccion', 'direccion'),
    via_principal: findCol(headerNorm, 'via_principal', 'via_1', 'calle_principal'),
    via_secundaria: findCol(headerNorm, 'via_secundaria', 'via_2', 'calle_secundaria'),
    nodo_nombre: findCol(headerNorm, 'nodo_nombre', 'nombre', 'descripcion'),
    fecha: findCol(headerNorm, 'fecha', 'fecha_conteo', 'fecha_estudio'),
    sentido: findCol(headerNorm, 'sentido', 'direccion_flujo', 'flujo'),
    hora_inicio: findCol(headerNorm, 'hora_inicio', 'hora_ini', 'hora'),
    hora_fin: findCol(headerNorm, 'hora_fin', 'hora_final'),
    hora: findCol(headerNorm, 'hora', 'hora_inicio'),
    hora_rango: findCol(headerNorm, 'hora_rango', 'intervalo', 'rango_horario'),
    vol_total: findCol(headerNorm, 'vol_total', 'total', 'intensidad', 'volumen', 'conteo_total'),
    vol_livianos: findCol(headerNorm, 'vol_livianos', 'livianos', 'autos', 'liviano'),
    vol_motos: findCol(headerNorm, 'vol_motos', 'motos'),
    vol_buses: findCol(headerNorm, 'vol_buses', 'buses'),
    vol_pesados: findCol(headerNorm, 'vol_pesados', 'pesados', 'camiones'),
    vol_bicis: findCol(headerNorm, 'vol_bicis', 'bicis', 'bicicletas'),
  };
}

/**
 * Plantilla C: Matriz Aforos Intersección (columnas con prefijo V_, INTERSECCION, HORA_INI/HORA_FIN).
 */
function buildColumnMapPlantillaC(headerRow) {
  const headerNorm = headerRow.map((h) => norm(h));
  return {
    direccion: findCol(headerNorm, 'interseccion', 'punto_medicion', 'ubicacion', 'punto', 'direccion'),
    interseccion: findCol(headerNorm, 'interseccion', 'punto_medicion', 'direccion'),
    via_principal: findCol(headerNorm, 'via_principal', 'via_1', 'calle_principal'),
    via_secundaria: findCol(headerNorm, 'via_secundaria', 'via_2', 'calle_secundaria'),
    nodo_nombre: findCol(headerNorm, 'nodo_nombre', 'nombre', 'descripcion', 'interseccion'),
    fecha: findCol(headerNorm, 'fecha', 'fecha_conteo', 'fecha_estudio'),
    sentido: findCol(headerNorm, 'sentido', 'direccion_flujo', 'flujo'),
    hora_inicio: findCol(headerNorm, 'hora_ini', 'hora_inicio', 'hora'),
    hora_fin: findCol(headerNorm, 'hora_fin', 'hora_final'),
    hora: findCol(headerNorm, 'hora', 'hora_ini'),
    hora_rango: findCol(headerNorm, 'intervalo', 'hora_rango', 'rango_horario'),
    vol_total: findCol(headerNorm, 'v_total', 'vol_total', 'total', 'intensidad', 'volumen'),
    vol_livianos: findCol(headerNorm, 'v_livianos', 'vol_livianos', 'livianos', 'autos'),
    vol_motos: findCol(headerNorm, 'v_motos', 'vol_motos', 'motos'),
    vol_buses: findCol(headerNorm, 'v_buses', 'vol_buses', 'buses'),
    vol_pesados: findCol(headerNorm, 'v_pesados', 'vol_pesados', 'pesados', 'camiones'),
    vol_bicis: findCol(headerNorm, 'v_bicis', 'vol_bicis', 'bicis', 'bicicletas'),
  };
}

/**
 * Plantilla D: Conteos PMT (PUNTO, FECHA_ESTUDIO, INTERVALO, VOL_*).
 */
function buildColumnMapPlantillaD(headerRow) {
  const headerNorm = headerRow.map((h) => norm(h));
  return {
    direccion: findCol(headerNorm, 'punto', 'interseccion', 'ubicacion', 'direccion', 'punto_medicion'),
    interseccion: findCol(headerNorm, 'interseccion', 'punto', 'ubicacion'),
    via_principal: findCol(headerNorm, 'via_principal', 'via_1', 'calle_principal'),
    via_secundaria: findCol(headerNorm, 'via_secundaria', 'via_2', 'calle_secundaria'),
    nodo_nombre: findCol(headerNorm, 'nodo_nombre', 'nombre', 'descripcion', 'punto'),
    fecha: findCol(headerNorm, 'fecha_estudio', 'fecha', 'fecha_conteo'),
    sentido: findCol(headerNorm, 'sentido', 'flujo', 'direccion_flujo'),
    hora_inicio: findCol(headerNorm, 'hora_ini', 'hora_inicio', 'hora'),
    hora_fin: findCol(headerNorm, 'hora_fin', 'hora_final'),
    hora: findCol(headerNorm, 'hora', 'hora_ini'),
    hora_rango: findCol(headerNorm, 'intervalo', 'hora_rango', 'rango_horario'),
    vol_total: findCol(headerNorm, 'vol_total', 'v_total', 'total', 'intensidad'),
    vol_livianos: findCol(headerNorm, 'vol_livianos', 'v_livianos', 'livianos', 'autos'),
    vol_motos: findCol(headerNorm, 'vol_motos', 'v_motos', 'motos'),
    vol_buses: findCol(headerNorm, 'vol_buses', 'v_buses', 'buses'),
    vol_pesados: findCol(headerNorm, 'vol_pesados', 'v_pesados', 'pesados', 'camiones'),
    vol_bicis: findCol(headerNorm, 'vol_bicis', 'v_bicis', 'bicis', 'bicicletas'),
  };
}

/**
 * Adapta un Excel tipo "Matriz Aforos" (Plantilla A) al CSV estándar.
 * @param {string} rutaEntrada - Ruta al .xlsx
 * @param {string} rutaSalidaCsv - Ruta donde escribir el CSV estándar
 * @param {{ archivo_nombre?: string, origen?: string }} opciones
 */
export async function adaptarMatrizAforosXLSX(rutaEntrada, rutaSalidaCsv, opciones = {}) {
  const archivoNombre = opciones.archivo_nombre || path.basename(rutaSalidaCsv);
  const origen = opciones.origen || 'SECOP';

  const buf = fs.readFileSync(rutaEntrada);
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error('Excel sin hojas');
  const ws = wb.Sheets[firstSheet];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!data.length) throw new Error('Excel sin datos');

  const headerRow = data[0].map((c) => String(c ?? ''));
  const columnMap = buildColumnMapPlantillaA(headerRow);

  if (columnMap.fecha < 0 && columnMap.direccion < 0 && columnMap.vol_total < 0) {
    throw new Error('No se encontraron columnas esperadas (fecha, direccion/interseccion, vol_total/total)');
  }

  const lines = [STANDARD_HEADER];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const out = rowToStandard(headerRow, row, columnMap, archivoNombre, origen);
    if (out) lines.push(out);
  }

  fs.mkdirSync(path.dirname(rutaSalidaCsv), { recursive: true });
  fs.writeFileSync(rutaSalidaCsv, lines.join('\n'), 'utf8');
  return lines.length - 1;
}

/**
 * Adapta un Excel tipo "Matriz Aforos Intersección" (Plantilla C) al CSV estándar.
 * Usa buildColumnMapPlantillaC (columnas V_*, INTERSECCION, HORA_INI/HORA_FIN).
 */
export async function adaptarPlantillaC_XLSX(rutaEntrada, rutaSalidaCsv, opciones = {}) {
  const archivoNombre = opciones.archivo_nombre || path.basename(rutaSalidaCsv);
  const origen = opciones.origen || 'SECOP';

  const buf = fs.readFileSync(rutaEntrada);
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error('Excel sin hojas');
  const ws = wb.Sheets[firstSheet];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!data.length) throw new Error('Excel sin datos');

  const headerRow = data[0].map((c) => String(c ?? ''));
  const columnMap = buildColumnMapPlantillaC(headerRow);

  if (columnMap.fecha < 0 && columnMap.direccion < 0 && columnMap.vol_total < 0) {
    throw new Error('No se encontraron columnas esperadas (fecha, direccion/interseccion, vol_total/v_total)');
  }

  const lines = [STANDARD_HEADER];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const out = rowToStandard(headerRow, row, columnMap, archivoNombre, origen);
    if (out) lines.push(out);
  }

  fs.mkdirSync(path.dirname(rutaSalidaCsv), { recursive: true });
  fs.writeFileSync(rutaSalidaCsv, lines.join('\n'), 'utf8');
  return lines.length - 1;
}

/**
 * Parsea una línea CSV respetando comillas (y opcionalmente punto y coma).
 */
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

/**
 * Adapta un CSV tipo "Resumen conteos" (Plantilla B) al CSV estándar.
 * Acepta separador coma o punto y coma.
 * @param {string} rutaEntrada - Ruta al .csv
 * @param {string} rutaSalidaCsv - Ruta donde escribir el CSV estándar
 * @param {{ archivo_nombre?: string, origen?: string, separador?: string }} opciones
 */
export async function adaptarResumenConteosCSV(rutaEntrada, rutaSalidaCsv, opciones = {}) {
  const archivoNombre = opciones.archivo_nombre || path.basename(rutaSalidaCsv);
  const origen = opciones.origen || 'SECOP';
  const sep = opciones.separador || (fs.readFileSync(rutaEntrada, 'utf8').includes(';') ? ';' : ',');

  const raw = fs.readFileSync(rutaEntrada, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV con menos de 2 líneas');

  const headerRow = parseCSVLine(lines[0], sep);
  const columnMap = buildColumnMapPlantillaA(headerRow);

  if (columnMap.fecha < 0 && columnMap.direccion < 0 && columnMap.vol_total < 0) {
    throw new Error('No se encontraron columnas esperadas (fecha, direccion/interseccion, vol_total/total)');
  }

  const standardLines = [STANDARD_HEADER];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i], sep);
    const out = rowToStandard(headerRow, row, columnMap, archivoNombre, origen);
    if (out) standardLines.push(out);
  }

  fs.mkdirSync(path.dirname(rutaSalidaCsv), { recursive: true });
  fs.writeFileSync(rutaSalidaCsv, standardLines.join('\n'), 'utf8');
  return standardLines.length - 1;
}

/**
 * Adapta un CSV tipo "Conteos PMT" (Plantilla D) al CSV estándar.
 * Usa buildColumnMapPlantillaD (PUNTO, FECHA_ESTUDIO, INTERVALO, VOL_*).
 */
export async function adaptarPlantillaD_CSV(rutaEntrada, rutaSalidaCsv, opciones = {}) {
  const archivoNombre = opciones.archivo_nombre || path.basename(rutaSalidaCsv);
  const origen = opciones.origen || 'SECOP';
  const sep = opciones.separador || (fs.readFileSync(rutaEntrada, 'utf8').includes(';') ? ';' : ',');

  const raw = fs.readFileSync(rutaEntrada, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV con menos de 2 líneas');

  const headerRow = parseCSVLine(lines[0], sep);
  const columnMap = buildColumnMapPlantillaD(headerRow);

  if (columnMap.fecha < 0 && columnMap.direccion < 0 && columnMap.vol_total < 0) {
    throw new Error('No se encontraron columnas esperadas (fecha_estudio/fecha, punto/direccion, vol_total/total)');
  }

  const standardLines = [STANDARD_HEADER];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i], sep);
    const out = rowToStandard(headerRow, row, columnMap, archivoNombre, origen);
    if (out) standardLines.push(out);
  }

  fs.mkdirSync(path.dirname(rutaSalidaCsv), { recursive: true });
  fs.writeFileSync(rutaSalidaCsv, standardLines.join('\n'), 'utf8');
  return standardLines.length - 1;
}

/**
 * Adapta un Excel tipo "Conteos PMT" (Plantilla D) al CSV estándar.
 */
export async function adaptarPlantillaD_XLSX(rutaEntrada, rutaSalidaCsv, opciones = {}) {
  const archivoNombre = opciones.archivo_nombre || path.basename(rutaSalidaCsv);
  const origen = opciones.origen || 'SECOP';

  const buf = fs.readFileSync(rutaEntrada);
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error('Excel sin hojas');
  const ws = wb.Sheets[firstSheet];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!data.length) throw new Error('Excel sin datos');

  const headerRow = data[0].map((c) => String(c ?? ''));
  const columnMap = buildColumnMapPlantillaD(headerRow);

  if (columnMap.fecha < 0 && columnMap.direccion < 0 && columnMap.vol_total < 0) {
    throw new Error('No se encontraron columnas esperadas (fecha_estudio, punto/direccion, vol_total)');
  }

  const lines = [STANDARD_HEADER];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const out = rowToStandard(headerRow, row, columnMap, archivoNombre, origen);
    if (out) lines.push(out);
  }

  fs.mkdirSync(path.dirname(rutaSalidaCsv), { recursive: true });
  fs.writeFileSync(rutaSalidaCsv, lines.join('\n'), 'utf8');
  return lines.length - 1;
}

/** Devuelve el adaptador adecuado por extensión y nombre de archivo. */
export function getAdaptadorParaArchivo(nombreArchivo) {
  const lower = nombreArchivo.toLowerCase();
  const hasMatrizAforosInterseccion = (lower.includes('matriz') && lower.includes('aforos') && lower.includes('interseccion')) ||
    lower.includes('matriz_aforos_interseccion');
  const hasConteosPmt = lower.includes('conteos_pmt') || (lower.includes('conteos') && lower.includes('pmt'));

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    if (hasMatrizAforosInterseccion) return 'adaptarPlantillaC_XLSX';
    if (hasConteosPmt) return 'adaptarPlantillaD_XLSX';
    if (lower.includes('matriz') && lower.includes('aforo')) return 'adaptarMatrizAforosXLSX';
    return 'adaptarMatrizAforosXLSX';
  }
  if (lower.endsWith('.csv')) {
    if (hasConteosPmt) return 'adaptarPlantillaD_CSV';
    if (lower.includes('resumen') && lower.includes('conteo')) return 'adaptarResumenConteosCSV';
    return 'adaptarResumenConteosCSV';
  }
  return null;
}
