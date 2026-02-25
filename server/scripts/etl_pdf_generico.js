/**
 * ETL PDF genérico: extrae tablas de PDFs registrados (cualquier origen: SECOP, PRIVADO, UNIVERSIDAD),
 * adapta a CSV estándar y carga con etl_fuente_externa_csv.js.
 *
 * Rutas de PDF en disco:
 * - SECOP: data/secop/anexos/<origen_id>/<nombre_archivo>
 * - PRIVADO / UNIVERSIDAD: data/privado/anexos/<origen>/<nombre_archivo>
 *
 * --dry-run: extrae tablas y genera CSV estándar sin ejecutar ETL ni marcar procesado.
 * --origen=SECOP|PRIVADO|UNIVERSIDAD: procesar solo ese origen (opcional).
 *
 * Uso: node server/scripts/etl_pdf_generico.js
 *      node server/scripts/etl_pdf_generico.js --dry-run
 *      node server/scripts/etl_pdf_generico.js --origen=PRIVADO
 *      npm run etl:pdf
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import {
  adaptarPlantillaPDF_1,
  adaptarPlantillaPDF_2,
  adaptarPlantillaPDF_3,
  getAdaptadorPdfParaArchivo,
} from './secop_adaptadores_pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const SECOP_ANEXOS = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');
const PRIVADO_ANEXOS = path.join(PROJECT_ROOT, 'data', 'privado', 'anexos');
const ESTUDIOS_TRANSITO_PDFS = path.join(PROJECT_ROOT, 'data', 'estudios-transito', 'PDFs');
const PDF_EXTRACCIONES_BASE = path.join(PROJECT_ROOT, 'data', 'pdf_extracciones');
const PYTHON_SCRIPT = path.join(__dirname, 'pdf_extract_tablas.py');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const ORIGEN_FILTER = (() => {
  const arg = process.argv.find((a) => a.startsWith('--origen='));
  return arg ? arg.split('=')[1].trim().toUpperCase() : null;
})();

/** Resuelve la ruta del PDF: primero estructura unificada data/estudios-transito/PDFs/<origen>/, luego rutas antiguas. */
function rutaPdfParaArchivo(row) {
  const origen = (row.origen || '').toUpperCase();
  const nombre = row.nombre_archivo;
  const dirUnificado = path.join(ESTUDIOS_TRANSITO_PDFS, origen);
  const rutaUnificada = path.join(dirUnificado, nombre);
  if (fs.existsSync(rutaUnificada)) return rutaUnificada;
  if (origen === 'SECOP') {
    const idProceso = row.origen_id || 'unknown';
    const rutaSecop = path.join(SECOP_ANEXOS, idProceso, nombre);
    if (fs.existsSync(rutaSecop)) return rutaSecop;
    const prefijada = path.join(dirUnificado, `${idProceso}_${nombre}`);
    if (fs.existsSync(prefijada)) return prefijada;
    return rutaSecop;
  }
  const rutaPrivado = path.join(PRIVADO_ANEXOS, row.origen, nombre);
  return rutaPrivado;
}

function runPythonExtract(pdfPath, outDir) {
  return new Promise((resolve, reject) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(py, [PYTHON_SCRIPT, pdfPath, outDir], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdf_extract_tablas.py salió con código ${code}`));
    });
    child.on('error', reject);
  });
}

function runEtlCsv(csvPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server/scripts/etl_fuente_externa_csv.js', `--path=${csvPath}`], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ETL salió con código ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  let sql = `SELECT id, nombre_archivo, origen, origen_id
             FROM archivos_fuente
             WHERE tipo = 'PDF' AND procesado = FALSE`;
  const params = [];
  if (ORIGEN_FILTER) {
    sql += ` AND origen = $1`;
    params.push(ORIGEN_FILTER);
  }
  sql += ` ORDER BY id`;

  const res = params.length ? await query(sql, params) : await query(sql);

  console.log('[etl-pdf] PDFs pendientes:', res.rows.length, ORIGEN_FILTER ? `(origen=${ORIGEN_FILTER})` : '');
  if (DRY_RUN) console.log('[etl-pdf] Modo --dry-run: no se ejecutará ETL ni se marcará procesado.');

  let procesados = 0;
  let errores = 0;

  for (const row of res.rows) {
    const rutaPdf = rutaPdfParaArchivo(row);

    if (!fs.existsSync(rutaPdf)) {
      console.warn('[etl-pdf] No encontrado en disco, omitiendo:', rutaPdf);
      errores++;
      continue;
    }

    const outDir = path.join(PDF_EXTRACCIONES_BASE, String(row.id));

    try {
      await runPythonExtract(rutaPdf, outDir);
    } catch (err) {
      console.error('[etl-pdf] Error extrayendo tablas:', row.nombre_archivo, err.message);
      errores++;
      continue;
    }

    const tablaFiles = fs.readdirSync(outDir).filter((f) => f.startsWith('tabla_') && f.endsWith('.csv')).sort();
    if (tablaFiles.length === 0) {
      console.warn('[etl-pdf] No se generaron tablas CSV en', outDir);
      errores++;
      continue;
    }

    const tablasCsvPaths = tablaFiles.map((f) => path.join(outDir, f));
    const { adaptador, tablaIndex } = getAdaptadorPdfParaArchivo(row, tablasCsvPaths);
    const num = adaptador.match(/PlantillaPDF_(\d)/)?.[1] || '1';
    const csvEstandarPath = path.join(outDir, `estandar_plantilla${num}.csv`);
    const metadatos = {
      origen: row.origen,
      outPath: csvEstandarPath,
      fecha: new Date().toISOString().slice(0, 10),
    };

    let adaptado = false;
    const indicesToTry = [];
    if (tablaIndex >= 0 && tablaIndex < tablasCsvPaths.length) indicesToTry.push(tablaIndex);
    for (let i = 0; i < tablasCsvPaths.length; i++) {
      if (!indicesToTry.includes(i)) indicesToTry.push(i);
    }
    for (const idx of indicesToTry) {
      const tablaElegida = tablasCsvPaths[idx];
      try {
        if (adaptador === 'adaptarPlantillaPDF_1') {
          await adaptarPlantillaPDF_1(tablaElegida, row.nombre_archivo, metadatos);
          adaptado = true;
        } else if (adaptador === 'adaptarPlantillaPDF_2') {
          await adaptarPlantillaPDF_2(tablaElegida, row.nombre_archivo, metadatos);
          adaptado = true;
        } else if (adaptador === 'adaptarPlantillaPDF_3') {
          await adaptarPlantillaPDF_3(tablaElegida, row.nombre_archivo, metadatos);
          adaptado = true;
        } else {
          console.warn('[etl-pdf] Adaptador no implementado:', adaptador);
          break;
        }
      } catch {
        continue;
      }
      if (adaptado) break;
    }
    if (!adaptado) {
      console.warn('[etl-pdf] Ninguna tabla con columnas de aforos en', row.nombre_archivo);
      errores++;
      continue;
    }

    console.log('[etl-pdf] CSV estándar generado:', csvEstandarPath);

    if (DRY_RUN) {
      console.log('[etl-pdf] (dry-run) Omitiendo ETL y actualización de procesado.');
      continue;
    }

    await runEtlCsv(csvEstandarPath);
    await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [row.id]);
    procesados++;
    console.log('[etl-pdf] Procesado (procesado=TRUE):', row.id, row.nombre_archivo, row.origen);
  }

  await closePool();
  console.log('[etl-pdf] Resumen: procesados', procesados, '| errores', errores);
}

main().catch((err) => {
  console.error('[etl-pdf]', err.message);
  process.exit(1);
});
