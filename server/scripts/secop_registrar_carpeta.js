/**
 * Registra en lote todos los PDF de una carpeta en archivos_fuente (origen SECOP).
 * Reutiliza la lógica de secop_registrar_pdf_local.js llamándolo por cada PDF.
 *
 * Uso: node server/scripts/secop_registrar_carpeta.js --carpeta=data/secop/anexos/bogota_manual
 *      node server/scripts/secop_registrar_carpeta.js --carpeta=ruta/a/carpeta --id-proceso=PS-2024-001
 *
 * --carpeta: ruta a la carpeta que contiene los PDF (o subcarpetas con PDF).
 * --id-proceso: id_proceso SECOP para todos los PDF; si no se indica, se usa el nombre de la carpeta.
 *
 * Con subcarpetas: si la carpeta tiene subcarpetas, cada subcarpeta se interpreta como id_proceso
 * y los PDF en su interior se registran con ese id. (Sin --id-proceso.)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const SCRIPT_LOCAL = path.join(__dirname, 'secop_registrar_pdf_local.js');

function getCarpeta() {
  const arg = process.argv.find((a) => a.startsWith('--carpeta='));
  if (!arg) return null;
  return path.resolve(process.cwd(), arg.split('=')[1].replace(/^["']|["']$/g, '').trim());
}

function getIdProceso() {
  const arg = process.argv.find((a) => a.startsWith('--id-proceso='));
  return arg ? arg.split('=')[1].replace(/^["']|["']$/g, '').trim() : null;
}

/** Lista paths absolutos de todos los .pdf en dir (solo un nivel). */
function listPdfsInDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files = fs.readdirSync(dir, { withFileTypes: true });
  return files
    .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.pdf'))
    .map((f) => path.join(dir, f.name));
}

/**
 * Si no hay --id-proceso, recorre subcarpetas y devuelve { idProceso, pdfPaths }[].
 * Si hay --id-proceso, devuelve un solo grupo con todos los PDF de la carpeta.
 */
function gatherPdfsByProceso(carpeta, idProcesoExterno) {
  if (idProcesoExterno) {
    const pdfs = listPdfsInDir(carpeta);
    return pdfs.length ? [{ idProceso: idProcesoExterno, pdfPaths: pdfs }] : [];
  }
  const entries = fs.readdirSync(carpeta, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory());
  if (subdirs.length === 0) {
    const pdfs = listPdfsInDir(carpeta);
    const idProceso = path.basename(carpeta);
    return pdfs.length ? [{ idProceso, pdfPaths: pdfs }] : [];
  }
  const groups = [];
  for (const d of subdirs) {
    const subPath = path.join(carpeta, d.name);
    const pdfs = listPdfsInDir(subPath);
    if (pdfs.length) groups.push({ idProceso: d.name, pdfPaths: pdfs });
  }
  return groups;
}

function runRegistrarPdf(pdfPath, idProceso) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [SCRIPT_LOCAL, '--path=' + pdfPath, '--origen=SECOP', '--id-proceso=' + idProceso],
      { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false }
    );
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('exit ' + code))));
    child.on('error', reject);
  });
}

async function main() {
  const carpeta = getCarpeta();
  if (!carpeta || !fs.existsSync(carpeta)) {
    console.error('[registrar-carpeta] Uso: node secop_registrar_carpeta.js --carpeta=ruta/a/carpeta [--id-proceso=ID]');
    process.exit(1);
  }
  const idProcesoArg = getIdProceso();
  const groups = gatherPdfsByProceso(carpeta, idProcesoArg);
  if (groups.length === 0) {
    console.log('[registrar-carpeta] No se encontraron PDF en', carpeta);
    return;
  }
  let total = 0;
  for (const { idProceso, pdfPaths } of groups) {
    console.log('[registrar-carpeta] id_proceso:', idProceso, 'PDFs:', pdfPaths.length);
    for (const pdfPath of pdfPaths) {
      try {
        await runRegistrarPdf(pdfPath, idProceso);
        total++;
      } catch (err) {
        console.warn('[registrar-carpeta] Error en', pdfPath, err.message);
      }
    }
  }
  console.log('[registrar-carpeta] Total registrados:', total);
  console.log('[registrar-carpeta] Siguiente paso: npm run etl:pdf');
}

main().catch((err) => {
  console.error('[registrar-carpeta]', err.message);
  process.exit(1);
});
