/**
 * ETL PDF SECOP: extrae tablas de PDFs registrados, adapta a CSV estándar y carga con etl_fuente_externa_csv.js.
 * Solo archivos_fuente con origen='SECOP', tipo='PDF', procesado=FALSE.
 *
 * --dry-run: extrae tablas y genera CSV estándar en data/secop/pdf_extracciones/<id>/ sin ejecutar ETL ni marcar procesado.
 *
 * Uso: node server/scripts/etl_pdf_secop.js
 *      node server/scripts/etl_pdf_secop.js --dry-run
 *      npm run secop:pdf
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
const ANEXOS_BASE = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');
const PDF_EXTRACCIONES_BASE = path.join(PROJECT_ROOT, 'data', 'secop', 'pdf_extracciones');
const PYTHON_SCRIPT = path.join(__dirname, 'pdf_extract_tablas.py');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

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

function runEtlCsv(csvPathRel) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server/scripts/etl_fuente_externa_csv.js', `--path=${csvPathRel}`], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ETL salió con código ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  const res = await query(
    `SELECT id, nombre_archivo, origen_id
     FROM archivos_fuente
     WHERE origen = 'SECOP' AND tipo = 'PDF' AND procesado = FALSE`
  );

  console.log('[etl-pdf-secop] PDFs SECOP pendientes:', res.rows.length);
  if (DRY_RUN) console.log('[etl-pdf-secop] Modo --dry-run: no se ejecutará ETL ni se marcará procesado.');

  let procesados = 0;
  let errores = 0;

  for (const row of res.rows) {
    const idProceso = row.origen_id || 'unknown';
    const rutaPdf = path.join(ANEXOS_BASE, idProceso, row.nombre_archivo);

    if (!fs.existsSync(rutaPdf)) {
      console.warn('[etl-pdf-secop] No encontrado en disco, omitiendo:', rutaPdf);
      errores++;
      continue;
    }

    const outDir = path.join(PDF_EXTRACCIONES_BASE, String(row.id));

    try {
      await runPythonExtract(rutaPdf, outDir);
    } catch (err) {
      console.error('[etl-pdf-secop] Error extrayendo tablas:', row.nombre_archivo, err.message);
      errores++;
      continue;
    }

    const tablaFiles = fs.readdirSync(outDir).filter((f) => f.startsWith('tabla_') && f.endsWith('.csv')).sort();
    if (tablaFiles.length === 0) {
      console.warn('[etl-pdf-secop] No se generaron tablas CSV en', outDir);
      errores++;
      continue;
    }

    const tablasCsvPaths = tablaFiles.map((f) => path.join(outDir, f));
    const { adaptador, tablaIndex } = getAdaptadorPdfParaArchivo(row, tablasCsvPaths);
    const num = adaptador.match(/PlantillaPDF_(\d)/)?.[1] || '1';
    const csvEstandarPath = path.join(outDir, `estandar_plantilla${num}.csv`);
    const metadatos = {
      origen: 'SECOP',
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
          console.warn('[etl-pdf-secop] Adaptador no implementado:', adaptador);
          break;
        }
      } catch (err) {
        continue;
      }
      if (adaptado) break;
    }
    if (!adaptado) {
      console.warn('[etl-pdf-secop] Ninguna tabla con columnas de aforos en', row.nombre_archivo);
      errores++;
      continue;
    }

    console.log('[etl-pdf-secop] CSV estándar generado:', csvEstandarPath);

    if (DRY_RUN) {
      console.log('[etl-pdf-secop] (dry-run) Omitiendo ETL y actualización de procesado.');
      continue;
    }

    await runEtlCsv(csvEstandarPath);
    await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [row.id]);
    procesados++;
    console.log('[etl-pdf-secop] Procesado (procesado=TRUE):', row.id, row.nombre_archivo);
  }

  await closePool();
  console.log('[etl-pdf-secop] Resumen: procesados', procesados, '| errores', errores);
}

main().catch((err) => {
  console.error('[etl-pdf-secop]', err.message);
  process.exit(1);
});
