/**
 * Test mínimo: coherencia sheet/headers (evitar bug SHEET_HEADER_MISMATCH).
 * Ejecutar: node server/utils/aforoAnalisis.test.js
 */
import XLSX from 'xlsx';
import { selectBestSheet, analizarExcelBuffer } from './aforoAnalisis.js';

function assert(condition, message) {
  if (!condition) {
    console.error('[FAIL]', message);
    process.exit(1);
  }
}

// Workbook mock: Hoja1 = marco contractual (fila 0 sin sentido/periodo), Identificacion = aforo (sentido, periodo, movimiento, pt).
const hoja1Data = [
  ['Resumen del marco contractual del estudio', '', '', ''],
  ['Identificador', 'Contratista', 'Objeto', 'Fechas']
];
const identData = [
  ['nodo', 'fecha', 'periodo', 'sentido', 'movimiento', 'pt', 'observaciones'],
  [25640, 44855, 500, 'we', 'n', 21, 'obs1'],
  [25640, 44855, 515, 'we', 'n', 5, '']
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja1Data), 'Hoja1');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(identData), 'Identificacion');

const best = selectBestSheet(wb);

assert(best.sheetName === 'Identificacion', `expected sheetName "Identificacion", got "${best.sheetName}"`);
assert(Array.isArray(best.headers), 'headers must be array');
assert(best.headers.includes('sentido'), `headers must include "sentido", got ${JSON.stringify(best.headers)}`);
assert(best.headers.includes('periodo'), `headers must include "periodo", got ${JSON.stringify(best.headers)}`);
assert(best.headers.includes('movimiento') || best.headers.some(h => h && h.includes('movimiento')), `headers must include movimiento, got ${JSON.stringify(best.headers)}`);
assert(best.classKeys.includes('pt'), `classKeys must include "pt", got ${JSON.stringify(best.classKeys)}`);
assert(best.headers[0] !== 'resumen_del_marco_contractual_del_estudio', 'headers must NOT be from Hoja1 (marco)');

console.log('[OK] selectBestSheet elige Identificacion y headers/classKeys vienen de Identificacion');

// Verificar que analizarExcelBuffer usa la misma hoja: buffer del mismo workbook debe dar coherencia (error con mensaje claro si no hay filas válidas).
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
try {
  analizarExcelBuffer(buffer);
  console.log('[OK] analizarExcelBuffer terminó (con datos mínimos)');
} catch (err) {
  assert(err.message.includes('No se pudieron interpretar') || err.message.includes('hora pico'), `expected no-rows or hora pico error, got: ${err.message}`);
  if (err.quality) {
    assert(err.quality.sheetName === 'Identificacion', `error.quality.sheetName should be Identificacion, got ${err.quality.sheetName}`);
  }
  console.log('[OK] analizarExcelBuffer lanza error descriptivo y quality alineado con Identificacion');
}

console.log('Tests pasaron.');
process.exit(0);
