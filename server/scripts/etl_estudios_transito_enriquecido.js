/**
 * ETL enriquecido de estudios de tránsito: estructura unificada data/estudios-transito/PDFs/,
 * extrae aforos (conteos_resumen), vías, puntos críticos, infraestructura, proyecciones.
 *
 * 1. Escanea data/estudios-transito/PDFs/{SDP,SECOP,PRIVADO,OTROS}
 * 2. Lee/crea index.json; para cada PDF nuevo: crea estudios_transito + archivos_fuente,
 *    extrae tablas con pdf_extract_tablas.py, clasifica y carga en BD.
 * 3. Actualiza index.json con resumen.
 *
 * Uso: node server/scripts/etl_estudios_transito_enriquecido.js
 *      npm run etl:estudios-transito
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
const ESTUDIOS_TRANSITO = path.join(PROJECT_ROOT, 'data', 'estudios-transito');
const PDFS_BASE = path.join(ESTUDIOS_TRANSITO, 'PDFs');
const EXTRACCIONES_BASE = path.join(ESTUDIOS_TRANSITO, 'extracciones');
const INDEX_PATH = path.join(ESTUDIOS_TRANSITO, 'index.json');
const PYTHON_SCRIPT = path.join(__dirname, 'pdf_extract_tablas.py');

const ORIGENES = ['SDP', 'SECOP', 'PRIVADO', 'OTROS'];

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

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
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ETL CSV salió con código ${code}`))));
    child.on('error', reject);
  });
}

function slug(nombreArchivo) {
  return path.basename(nombreArchivo, '.pdf').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { version: 1, actualizado: null, estudios: [] };
  const raw = fs.readFileSync(INDEX_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return { version: 1, actualizado: null, estudios: [] };
  }
}

function saveIndex(obj) {
  obj.actualizado = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

/** Clasifica una tabla por cabeceras: 'aforos' | 'vias' | 'puntos_criticos' | 'infraestructura' | 'proyecciones' | null */
function clasificarTabla(headerNorm, headerOriginal) {
  const h = headerNorm.join(' ');
  const ho = (headerOriginal.join(' ') || '').toLowerCase();
  if (/\b(volumen|veh\/hora|conteo|vol_total|sentido|intervalo|hora_inicio|hora_fin)\b/.test(h) || /\b(volumen|conteo|aforo)\b/.test(ho)) return 'aforos';
  if (/\b(via|calle|carrera|vía|sentido|capacidad|velocidad|cicloinfra)\b/.test(h) || /\b(capacidad|velocidad|tipo_via)\b/.test(ho)) return 'vias';
  if (/\b(congestion|punto.critico|accidente|inseguro|riesgo|conflicto)\b/.test(h) || /\b(punto.critico|congestion)\b/.test(ho)) return 'puntos_criticos';
  if (/\b(semaforo|paso.peatonal|cicloinfra|refugio|anden|senalizacion)\b/.test(h)) return 'infraestructura';
  if (/\b(escenario|proyeccion|5.años|10.años|volumen.proyectado|nivel.congestion)\b/.test(h)) return 'proyecciones';
  return null;
}

/** Parsea CSV simple (una línea de cabecera, resto datos). */
function parseCSV(pathCsv) {
  const content = fs.readFileSync(pathCsv, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  const header = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row = {};
    header.forEach((k, j) => { row[k] = cells[j]; });
    rows.push(row);
  }
  return { header, rows };
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

async function main() {
  if (!fs.existsSync(PDFS_BASE)) {
    console.log('[etl-et] Creando', PDFS_BASE);
    fs.mkdirSync(PDFS_BASE, { recursive: true });
  }
  ORIGENES.forEach((o) => {
    const d = path.join(PDFS_BASE, o);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(EXTRACCIONES_BASE)) fs.mkdirSync(EXTRACCIONES_BASE, { recursive: true });

  const index = loadIndex();
  const byHash = new Map(index.estudios.map((e) => [e.hash, e]));

  const pdfsToProcess = [];
  for (const origen of ORIGENES) {
    const dir = path.join(PDFS_BASE, origen);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    for (const nombre of files) {
      const fullPath = path.join(dir, nombre);
      const buf = fs.readFileSync(fullPath);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (byHash.has(hash)) continue;
      pdfsToProcess.push({ origen, nombre, fullPath, hash });
    }
  }

  console.log('[etl-et] PDFs nuevos a procesar:', pdfsToProcess.length);
  if (pdfsToProcess.length === 0) {
    await closePool();
    return;
  }

  for (const { origen, nombre, fullPath, hash } of pdfsToProcess) {
    const urlDoc = `file:///estudios-transito/PDFs/${origen}/${encodeURIComponent(nombre)}`;
    let estudioTransitoId;
    let archivoFuenteId;
    const resumen = { aforos: 0, vias: 0, puntos_criticos: 0, infraestructura: 0, proyecciones: 0 };

    try {
      const nombreEstudio = path.basename(nombre, '.pdf').replace(/_/g, ' ').slice(0, 255);
      const rEt = await query(
        `INSERT INTO estudios_transito (nombre, tipo, fuente, url_documento_original, updated_at)
         VALUES ($1, 'ETT', $2, $3, NOW())
         ON CONFLICT (url_documento_original) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [nombreEstudio, origen, urlDoc]
      );
      if (!rEt?.rows?.[0]) throw new Error('INSERT estudios_transito no devolvió id');
      estudioTransitoId = rEt.rows[0].id;

      const existingAf = await query(
        'SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1',
        [hash, origen]
      );
      if (existingAf.rows[0]) {
        archivoFuenteId = existingAf.rows[0].id;
        await query(
          'UPDATE archivos_fuente SET estudio_transito_id = $1, procesado = FALSE, updated_at = NOW() WHERE id = $2',
          [estudioTransitoId, archivoFuenteId]
        );
      } else {
        const hasEtIdRes = await query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'estudio_transito_id'`
        );
        const hasEtId = hasEtIdRes.rows && hasEtIdRes.rows[0];
        const ins = hasEtId
          ? await query(
              `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, estudio_transito_id, updated_at)
               VALUES ('PDF', $1, $2, $3, FALSE, $4, NOW()) RETURNING id`,
              [origen, nombre, hash, estudioTransitoId]
            )
          : await query(
              `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, updated_at)
               VALUES ('PDF', $1, $2, $3, FALSE, NOW()) RETURNING id`,
              [origen, nombre, hash]
            );
        archivoFuenteId = ins.rows[0].id;
        if (hasEtId) {
          await query('UPDATE archivos_fuente SET estudio_transito_id = $1 WHERE id = $2', [estudioTransitoId, archivoFuenteId]);
        }
      }

      const extraccionDir = path.join(EXTRACCIONES_BASE, `${estudioTransitoId}_${slug(nombre)}`);
      fs.mkdirSync(extraccionDir, { recursive: true });

      await runPythonExtract(fullPath, extraccionDir);
      const tablaFiles = fs.readdirSync(extraccionDir).filter((f) => f.startsWith('tabla_') && f.endsWith('.csv')).sort();
      const tablasCsvPaths = tablaFiles.map((f) => path.join(extraccionDir, f));

      const rawTablesMeta = tablasCsvPaths.map((p) => ({ path: path.basename(p) }));
      fs.writeFileSync(path.join(extraccionDir, 'raw_tables.json'), JSON.stringify(rawTablesMeta, null, 2));

      const rowAf = { id: archivoFuenteId, nombre_archivo: nombre, origen };
      let aforosCsvPath = null;

      for (let i = 0; i < tablasCsvPaths.length; i++) {
        const csvPath = tablasCsvPaths[i];
        const { header, rows } = parseCSV(csvPath);
        const headerNorm = header.map(norm);
        const tipo = clasificarTabla(headerNorm, header);

        if (tipo === 'aforos' && !aforosCsvPath) {
          const { adaptador, tablaIndex } = getAdaptadorPdfParaArchivo(rowAf, tablasCsvPaths);
          const num = adaptador.match(/PlantillaPDF_(\d)/)?.[1] || '1';
          const csvEstandarPath = path.join(extraccionDir, `estandar_plantilla${num}.csv`);
          const metadatos = { origen, outPath: csvEstandarPath, fecha: new Date().toISOString().slice(0, 10) };
          const indicesToTry = tablaIndex >= 0 ? [tablaIndex] : [];
          for (let j = 0; j < tablasCsvPaths.length; j++) if (!indicesToTry.includes(j)) indicesToTry.push(j);
          for (const idx of indicesToTry) {
            try {
              if (adaptador === 'adaptarPlantillaPDF_1') await adaptarPlantillaPDF_1(tablasCsvPaths[idx], nombre, metadatos);
              else if (adaptador === 'adaptarPlantillaPDF_2') await adaptarPlantillaPDF_2(tablasCsvPaths[idx], nombre, metadatos);
              else if (adaptador === 'adaptarPlantillaPDF_3') await adaptarPlantillaPDF_3(tablasCsvPaths[idx], nombre, metadatos);
              aforosCsvPath = csvEstandarPath;
              break;
            } catch {}
          }
          if (aforosCsvPath) resumen.aforos = rows.length;
        } else if (tipo === 'vias' && rows.length > 0) {
          for (const row of rows) {
            const nombreVia = row.nombre_via || row.via || row.calle || row.carrera || row.Vía || '';
            const tipoVia = row.tipo_via || row.tipo || '';
            const sentidos = parseInt(row.sentidos || row.sentido || '1', 10) || 1;
            const capacidad = parseInt(row.capacidad_vehicular || row.capacidad || '0', 10) || null;
            const velocidad = parseInt(row.velocidad_permitida || row.velocidad || '0', 10) || null;
            if (!nombreVia && !tipoVia) continue;
            await query(
              `INSERT INTO vias_estudio (estudio_transito_id, nombre_via, tipo_via, sentidos, capacidad_vehicular, velocidad_permitida)
               VALUES ($1, $2, NULLIF($3,''), $4, $5, $6)`,
              [estudioTransitoId, nombreVia.slice(0, 255), tipoVia.slice(0, 50), sentidos, capacidad, velocidad]
            );
            resumen.vias++;
          }
        } else if (tipo === 'puntos_criticos' && rows.length > 0) {
          for (const row of rows) {
            const nombreP = row.nombre || row.punto || row.interseccion || '';
            const tipoP = row.tipo || 'congestión';
            const desc = row.descripcion || '';
            const freq = parseInt(row.frecuencia_anual || row.frecuencia || '0', 10) || null;
            await query(
              `INSERT INTO puntos_criticos_estudio (estudio_transito_id, nombre, tipo, descripcion, frecuencia_anual)
               VALUES ($1, $2, $3, NULLIF($4,''), $5)`,
              [estudioTransitoId, nombreP.slice(0, 255), tipoP.slice(0, 50), desc, freq]
            );
            resumen.puntos_criticos++;
          }
        } else if (tipo === 'infraestructura' && rows.length > 0) {
          for (const row of rows) {
            const tipoInfra = row.tipo || row.infraestructura || 'semaforo';
            const ubicacion = row.ubicacion || row.ubicación || row.via || '';
            const estado = row.estado || 'operativo';
            await query(
              `INSERT INTO infraestructura_vial (estudio_transito_id, tipo, ubicacion, estado)
               VALUES ($1, $2, NULLIF($3,''), $4)`,
              [estudioTransitoId, tipoInfra.slice(0, 50), ubicacion.slice(0, 255), estado.slice(0, 50)]
            );
            resumen.infraestructura++;
          }
        } else if (tipo === 'proyecciones' && rows.length > 0) {
          for (const row of rows) {
            const escenario = row.escenario || row.Escenario || '5-años';
            const desc = row.descripcion || '';
            const vol = parseInt(row.volumen_proyectado || row.volumen || '0', 10) || null;
            const vel = parseFloat(row.velocidad_promedio || row.velocidad || '') || null;
            const nivel = row.nivel_congestion || row.nivel || null;
            await query(
              `INSERT INTO proyecciones_estudio (estudio_transito_id, escenario, descripcion, volumen_proyectado, velocidad_promedio, nivel_congestion)
               VALUES ($1, $2, NULLIF($3,''), $4, $5, NULLIF($6,''))`,
              [estudioTransitoId, escenario.slice(0, 50), desc, vol, vel, nivel ? nivel.slice(0, 10) : null]
            );
            resumen.proyecciones++;
          }
        }
      }

      if (aforosCsvPath && fs.existsSync(aforosCsvPath)) {
        await runEtlCsv(aforosCsvPath);
        await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [archivoFuenteId]);
      }

      const metadata = {
        estudio_transito_id: estudioTransitoId,
        archivo: nombre,
        origen,
        hash,
        fecha_carga: new Date().toISOString(),
        resumen,
      };
      fs.writeFileSync(path.join(extraccionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

      index.estudios.push({
        archivo: nombre,
        origen,
        hash,
        fecha_carga: metadata.fecha_carga,
        tipo_estudio: 'ETT',
        estudio_transito_id: estudioTransitoId,
        resumen,
        estado: 'procesado',
      });
      saveIndex(index);
      byHash.set(hash, index.estudios[index.estudios.length - 1]);
      console.log('[etl-et] Procesado:', nombre, '→ estudio_transito_id', estudioTransitoId, 'resumen', resumen);
    } catch (err) {
      console.error('[etl-et] Error:', nombre, err.message);
      index.estudios.push({
        archivo: nombre,
        origen,
        hash,
        fecha_carga: new Date().toISOString(),
        estado: 'error',
        error: err.message,
      });
      saveIndex(index);
    }
  }

  await closePool();
  console.log('[etl-et] Fin. Index actualizado en', INDEX_PATH);
}

main().catch((err) => {
  console.error('[etl-et]', err.message);
  process.exit(1);
});
