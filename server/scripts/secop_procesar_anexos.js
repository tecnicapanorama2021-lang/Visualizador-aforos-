/**
 * Procesa anexos SECOP ya registrados en archivos_fuente: convierte a CSV estándar y ejecuta ETL.
 * Solo archivos con origen='SECOP', tipo XLSX/CSV, procesado=FALSE y nombre que coincida con plantillas (Matriz Aforos, Resumen conteos).
 *
 * Uso: node server/scripts/secop_procesar_anexos.js
 *      npm run secop:procesar
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import {
  adaptarMatrizAforosXLSX,
  adaptarResumenConteosCSV,
  adaptarPlantillaC_XLSX,
  adaptarPlantillaD_CSV,
  adaptarPlantillaD_XLSX,
  getAdaptadorParaArchivo,
} from './secop_adaptadores.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const TMP_DIR = path.join(__dirname, 'tmp');
const ANEXOS_BASE = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

/** Coincide con plantilla A, B, C (Matriz Aforos Intersección) o D (Conteos PMT). */
function coincideConPlantilla(nombreArchivo) {
  const n = nombreArchivo.toLowerCase();
  return (
    (n.includes('matriz') && n.includes('aforo')) ||
    (n.includes('resumen') && n.includes('conteo')) ||
    n.includes('matriz_aforos') ||
    n.includes('resumen_conteos') ||
    (n.includes('matriz') && n.includes('aforos') && n.includes('interseccion')) ||
    n.includes('matriz_aforos_interseccion') ||
    n.includes('conteos_pmt') ||
    (n.includes('conteos') && n.includes('pmt'))
  );
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
    `SELECT id, nombre_archivo, origen_id, tipo
     FROM archivos_fuente
     WHERE origen = 'SECOP' AND tipo IN ('XLSX', 'CSV') AND procesado = FALSE`
  );
  const candidatos = res.rows.filter((r) => coincideConPlantilla(r.nombre_archivo));

  console.log('[secop-procesar] Archivos SECOP pendientes (XLSX/CSV):', res.rows.length);
  console.log('[secop-procesar] Candidatos por plantilla (A/B/C/D):', candidatos.length);

  let convertidos = 0;
  let cargados = 0;
  let errores = 0;

  for (const row of candidatos) {
    const idProceso = row.origen_id || 'unknown';
    const rutaEntrada = path.join(ANEXOS_BASE, idProceso, row.nombre_archivo);

    if (!fs.existsSync(rutaEntrada)) {
      console.warn('[secop-procesar] No encontrado en disco, omitiendo:', rutaEntrada);
      errores++;
      continue;
    }

    const csvRel = path.join('server', 'scripts', 'tmp', `secop_estudio_${row.id}.csv`);
    const rutaSalidaCsv = path.join(PROJECT_ROOT, csvRel);

    try {
      const adaptador = getAdaptadorParaArchivo(row.nombre_archivo);
      if (!adaptador) {
        console.warn('[secop-procesar] Sin adaptador para:', row.nombre_archivo);
        errores++;
        continue;
      }

      const opciones = {
        archivo_nombre: row.nombre_archivo,
        origen: 'SECOP',
      };

      if (adaptador === 'adaptarMatrizAforosXLSX') {
        await adaptarMatrizAforosXLSX(rutaEntrada, rutaSalidaCsv, opciones);
      } else if (adaptador === 'adaptarResumenConteosCSV') {
        await adaptarResumenConteosCSV(rutaEntrada, rutaSalidaCsv, opciones);
      } else if (adaptador === 'adaptarPlantillaC_XLSX') {
        await adaptarPlantillaC_XLSX(rutaEntrada, rutaSalidaCsv, opciones);
      } else if (adaptador === 'adaptarPlantillaD_CSV') {
        await adaptarPlantillaD_CSV(rutaEntrada, rutaSalidaCsv, opciones);
      } else if (adaptador === 'adaptarPlantillaD_XLSX') {
        await adaptarPlantillaD_XLSX(rutaEntrada, rutaSalidaCsv, opciones);
      } else {
        throw new Error('Adaptador no implementado: ' + adaptador);
      }

      convertidos++;
      console.log('[secop-procesar] Convertido:', row.nombre_archivo, '→', rutaSalidaCsv);

      await runEtlCsv(csvRel);
      await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [row.id]);
      cargados++;
      console.log('[secop-procesar] Cargado en BD (procesado=TRUE):', row.id, row.nombre_archivo);
    } catch (err) {
      console.error('[secop-procesar] Error:', row.nombre_archivo, err.message);
      errores++;
    }
  }

  await closePool();

  console.log('[secop-procesar] Resumen: convertidos', convertidos, '| cargados', cargados, '| errores', errores);
}

main().catch((err) => {
  console.error('[secop-procesar] Error:', err.message);
  process.exit(1);
});
