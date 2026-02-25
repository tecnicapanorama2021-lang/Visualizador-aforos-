/**
 * Diagnóstico de hojas del Excel DIM (solo lectura, no escribe BD).
 * Lista hojas, headerRowIdx candidato, headers normalizados y flags por hoja.
 *
 * Uso: node server/scripts/debug_dim_workbook_sheets.js [dimId=388]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { getExcelBufferForStudy } from '../utils/dimExcel.js';
import { getWorkbookSheetsDiagnostics } from '../utils/aforoAnalisis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

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

const dimArg = process.argv.find(a => a.startsWith('dimId='));
const dimId = dimArg ? dimArg.split('=')[1] : (process.argv[2] || '388');

async function main() {
  loadEnv();
  console.log('[debug_dim] dimId:', dimId);
  const { buffer } = await getExcelBufferForStudy(dimId);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const names = wb.SheetNames || [];
  console.log('[debug_dim] Hojas:', names.join(', '));

  const diagnostics = getWorkbookSheetsDiagnostics(wb);
  for (const d of diagnostics) {
    console.log('\n---', d.sheetName, '---');
    console.log('  headerRowIdx:', d.headerRowIdx);
    console.log('  headers (normalizados):', d.headers.length ? d.headers : '(vacío)');
    console.log('  hasSentido:', d.hasSentido);
    console.log('  hasPeriodo/hora/rango:', d.hasPeriodo);
    console.log('  hasMovimiento/acceso:', d.hasMovimiento);
    console.log('  classKeysCount:', d.classKeysCount);
  }
  console.log('\n[debug_dim] Fin (no se escribe BD).');
}

main().catch(err => {
  console.error('[debug_dim]', err.message);
  process.exit(1);
});
