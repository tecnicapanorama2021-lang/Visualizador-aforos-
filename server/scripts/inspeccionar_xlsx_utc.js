/**
 * Inspección temporal del XLSX UTC (UTC_CONTEO_20251130.xlsx).
 * Muestra hojas, columnas y primeras filas para diseñar el adaptador.
 *
 * Uso: node server/scripts/inspeccionar_xlsx_utc.js
 */

import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const xlsxPath = path.resolve(__dirname, '../../data/datos_abiertos/21/UTC_CONTEO_20251130.xlsx');
const wb = XLSX.readFile(xlsxPath);

console.log('Hojas:', wb.SheetNames);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
console.log('Columnas:', Object.keys(rows[0] || {}));
console.log('Primeras 5 filas:', JSON.stringify(rows.slice(0, 5), null, 2));
