/**
 * Script de depuración: lee el Excel del aforo y muestra qué se suma para NS en hora pico.
 * Ejecutar desde raíz del proyecto: node server/debug-aforo.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeHeader(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
}
function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const raw = value.trim().replace(/\s+/g, '');
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function periodToNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2400) return value;
  const s = String(value).trim().replace(/\s+/g, ' ');
  const part = s.includes(' - ') ? s.split(' - ')[0].trim() : s;
  const n = parseInt(part.replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(n) && n >= 0 && n < 2400) return n;
  const match = part.match(/^(\d{1,2}):(\d{2})$/);
  if (match) return parseInt(match[1], 10) * 100 + parseInt(match[2], 10);
  return null;
}
function formatPeriodNum(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const h = Math.floor(n / 100);
  const m = n % 100;
  return `${h}:${String(m).padStart(2, '0')}`;
}
function add15Min(hhmm) {
  if (hhmm == null || !Number.isFinite(hhmm)) return null;
  let h = Math.floor(hhmm / 100);
  let m = hhmm % 100;
  m += 15;
  if (m >= 60) { m -= 60; h += 1; }
  return h * 100 + m;
}
function detectHeaderRowIndex(table) {
  for (let i = 0; i < Math.min(table.length, 50); i++) {
    const row = table[i];
    if (!Array.isArray(row)) continue;
    const headers = row.map(normalizeHeader).filter(Boolean);
    const hasSentido = headers.some(h => h === 'sentido' || h.includes('sentido'));
    const hasHora = headers.some(h => h.includes('hora') || h.includes('rango') || h.includes('intervalo') || h.includes('franja') || h.includes('periodo'));
    if (hasSentido && hasHora) return i;
  }
  return 0;
}

const excelPath = path.join('C:', 'Users', 'diego', 'Downloads', '20218_AV_BOYACA_X_CL_79A_01072025_VOL_V0.xlsx');

if (!fs.existsSync(excelPath)) {
  console.error('No se encontró el archivo:', excelPath);
  process.exit(1);
}

const buffer = fs.readFileSync(excelPath);
const wb = XLSX.read(buffer, { type: 'buffer' });
const volData = wb.SheetNames.find(n => String(n).toLowerCase() === 'vol-data');
const ws = wb.Sheets[volData || wb.SheetNames[0]];
const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

const headerRowIdx = detectHeaderRowIndex(table);
const headers = (table[headerRowIdx] || []).map(v => normalizeHeader(v));
const colIndex = new Map(headers.map((h, i) => [h, i]).filter(([h]) => h));

const getCell = (row, key) => {
  const i = colIndex.get(key);
  return i != null ? row?.[i] : null;
};
const findKey = (pred) => {
  for (const [k] of colIndex) {
    if (pred(k)) return k;
  }
  return null;
};

const sentidoKey = findKey(h => h === 'sentido' || h.includes('sentido')) || findKey(h => h.includes('direccion'));
const rangoHoraKey = findKey(h => h.includes('periodo') || h.includes('rango') || h.includes('franja'));
const totalKey = findKey(h => h.includes('mixt') || h === 'total');
const observKey = findKey(h => h.includes('observacion') || h.includes('conflicto'));

const nonDataKeys = new Set([sentidoKey, rangoHoraKey, totalKey, observKey].filter(Boolean));
for (const h of headers) {
  if (!h) continue;
  if (h === 'nodo' || h === 'fecha' || h === 'acceso') nonDataKeys.add(h);
  if (h.includes('movimiento')) nonDataKeys.add(h);
}
const classKeys = headers.filter(Boolean).filter(h => !nonDataKeys.has(h));

console.log('=== CABECERAS (normalizadas) ===');
console.log(headers.join(', '));
console.log('Columnas que SÍ se suman (classKeys):', classKeys.join(', '));
console.log('');

const rows = [];
for (let r = headerRowIdx + 1; r < table.length; r++) {
  const row = table[r];
  if (!Array.isArray(row)) continue;
  const sentido = sentidoKey ? String(getCell(row, sentidoKey) ?? '').trim() : null;
  if (!sentido) continue;
  const horaRango = rangoHoraKey ? String(getCell(row, rangoHoraKey) ?? '').trim() : null;
  if (!horaRango) continue;
  const totalCell = totalKey ? toNumber(getCell(row, totalKey)) : null;
  let sum = 0;
  const classes = {};
  for (const k of classKeys) {
    const v = toNumber(getCell(row, k));
    if (v != null) {
      classes[k] = v;
      sum += v;
    }
  }
  const total = totalCell != null ? totalCell : (sum > 0 ? sum : null);
  if (total == null) continue;
  const periodNum = periodToNumber(horaRango);
  const acceso = colIndex.has('acceso') ? getCell(row, 'acceso') : null;
  rows.push({ sentido, horaRango, periodNum, total, classes, acceso });
}

const uniquePeriods = [...new Set(rows.map(r => r.periodNum).filter(n => n != null))].sort((a, b) => a - b);
const WINDOW_SIZE = 4;
let peakWindow = null;
let peakSum = -Infinity;
for (let i = 0; i <= uniquePeriods.length - WINDOW_SIZE; i++) {
  const window = uniquePeriods.slice(i, i + WINDOW_SIZE);
  const windowSet = new Set(window);
  const sum = rows.filter(r => windowSet.has(r.periodNum)).reduce((acc, r) => acc + r.total, 0);
  if (sum > peakSum) {
    peakSum = sum;
    peakWindow = window;
  }
}

console.log('=== HORA PICO (bloque de 4 periodos) ===');
console.log('Periodos:', peakWindow?.map(formatPeriodNum).join(', '));
console.log('Rango mostrado:', peakWindow ? `${formatPeriodNum(peakWindow[0])}-${formatPeriodNum(add15Min(peakWindow[3]))}` : 'N/A');
console.log('');

const peakWindowSet = new Set(peakWindow);

function dumpSentido(name) {
  const rowsS = rows.filter(r => (r.sentido || '').toUpperCase() === name && peakWindowSet.has(r.periodNum));
  console.log(`=== FILAS ${name} EN HORA PICO (${rowsS.length} filas) ===`);
  let sum = 0;
  for (const r of rowsS) {
    console.log(`  periodo ${r.horaRango} (${r.periodNum}) -> total: ${r.total}`);
    sum += r.total;
  }
  console.log(`  SUMA: ${sum}`);
  return sum;
}

dumpSentido('NS');
console.log('');
dumpSentido('SN');
console.log('');
console.log('=== DETALLE SN (periodo, total, acceso) ===');
const rowsSN = rows.filter(r => (r.sentido || '').toUpperCase() === 'SN' && peakWindowSet.has(r.periodNum));
for (const r of rowsSN) {
  console.log(`  ${r.periodNum} total=${r.total} acceso=${r.acceso}`);
}
console.log('');

console.log('=== TODOS LOS SENTIDOS EN EL BLOQUE (cantidad de filas) ===');
const bySentidoCount = new Map();
for (const r of rows) {
  if (!peakWindowSet.has(r.periodNum)) continue;
  const key = (r.sentido || '').trim();
  bySentidoCount.set(key, (bySentidoCount.get(key) || 0) + 1);
}
for (const [sentido, count] of [...bySentidoCount.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  "${sentido}": ${count} filas`);
}
