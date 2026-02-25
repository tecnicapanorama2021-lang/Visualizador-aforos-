/**
 * Descarga archivos registrados en archivos_fuente con origen='DATOS_ABIERTOS' y url_remota no nula.
 * Guarda en data/datos_abiertos/<id>/<nombre_archivo> y opcionalmente ejecuta el ETL (CSV estándar)
 * o deja listos para procesar manualmente.
 *
 * Uso: node server/scripts/descargar_datos_abiertos.js
 *      node server/scripts/descargar_datos_abiertos.js --procesar   (descarga + intenta ETL CSV para CSV/GeoJSON)
 *      npm run datos-abiertos:descargar
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import { crearProxyAgent } from '../utils/crearProxyAgent.js';
import { adaptarCgtCsv, inspeccionarCsv } from './adaptador_ckan_cgt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const DOWNLOAD_BASE = path.join(PROJECT_ROOT, 'data', 'datos_abiertos');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const MAX_DESCARGAS = Math.max(1, parseInt(process.env.MAX_DESCARGAS || '20', 10));
const HTTPS_AGENT_CKAN = crearProxyAgent(process.env.PROXY_URL);

async function headOk(url) {
  try {
    const res = await axios.head(url, {
      timeout: 10000,
      httpsAgent: HTTPS_AGENT_CKAN,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Aforos-Bogota/1.0)' },
      maxRedirects: 5,
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

async function downloadToFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000,
    httpsAgent: HTTPS_AGENT_CKAN,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Aforos-Bogota/1.0)' },
    maxRedirects: 5,
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', () => resolve(fs.readFileSync(destPath)));
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

function sanitize(n) {
  return n.replace(/[<>:"/\\|?*]/g, '_').slice(0, 200) || 'recurso';
}

/** Indica si la URL corresponde a dataset CGT / conteo vehiculos (CKAN). */
function isCgtConteoVehiculosUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('cgt') || u.includes('conteo-vehiculos');
}

/**
 * Ejecuta ETL para una fila: si es CSV CGT/conteo-vehiculos, inspecciona, adapta y corre ETL sobre CSV estándar; si no, ETL directo.
 * @param {object} row - fila archivos_fuente (id, nombre_archivo, tipo, url_remota)
 * @param {string} filePath - ruta del archivo descargado
 * @returns {Promise<{ pathUsado: string }>} path sobre el que se corrió ETL
 */
async function runEtlParaFila(row, filePath) {
  const esCsv = row.tipo === 'CSV';
  const esCgt = esCsv && isCgtConteoVehiculosUrl(row.url_remota);
  let pathParaEtl = filePath;
  if (esCgt) {
    try {
      inspeccionarCsv(filePath);
      const pathEstandar = adaptarCgtCsv(filePath, {
        archivo_nombre: row.nombre_archivo || path.basename(filePath),
        origen: 'DATOS_ABIERTOS',
      });
      if (pathEstandar) pathParaEtl = pathEstandar;
    } catch (e) {
      console.warn('[datos-abiertos] Adaptador CGT:', e.message);
    }
  }
  const child = spawn('node', ['server/scripts/etl_fuente_externa_csv.js', `--path=${pathParaEtl}`], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
  });
  await new Promise((resolve, reject) => {
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ETL ${code}`))));
    child.on('error', reject);
  });
  return { pathUsado: pathParaEtl };
}

async function main() {
  const procesar = process.argv.includes('--procesar');
  const verificar = process.argv.includes('--verificar');

  const res = await query(
    `SELECT id, nombre_archivo, tipo, url_remota
     FROM archivos_fuente
     WHERE origen = 'DATOS_ABIERTOS' AND url_remota IS NOT NULL AND url_remota != '' AND (procesado = FALSE OR procesado IS NULL)
     ORDER BY id
     LIMIT $1`,
    [MAX_DESCARGAS]
  );

  console.log('[datos-abiertos] Registros pendientes (límite', MAX_DESCARGAS, '):', res.rows.length);

  let descargados = 0;
  let pasadosEtl = 0;
  let errores = 0;

  for (const row of res.rows) {
    if (verificar) {
      const ok = await headOk(row.url_remota);
      if (!ok) {
        console.warn('[datos-abiertos] HEAD no OK, omitiendo:', row.url_remota.slice(0, 60) + '...');
        errores++;
        continue;
      }
    }
    const dir = path.join(DOWNLOAD_BASE, String(row.id));
    const nombre = sanitize(row.nombre_archivo || path.basename(new URL(row.url_remota).pathname) || 'recurso');
    const filePath = path.join(dir, nombre);

    if (fs.existsSync(filePath)) {
      console.log('[datos-abiertos] Ya existe:', filePath);
      if (procesar && (row.tipo === 'CSV' || row.tipo === 'JSON')) {
        try {
          await runEtlParaFila(row, filePath);
          await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [row.id]);
          pasadosEtl++;
        } catch (e) {
          console.warn('[datos-abiertos] ETL no aplicable o error:', e.message);
        }
      }
      continue;
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      const buf = await downloadToFile(row.url_remota, filePath);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      await query(
        'UPDATE archivos_fuente SET hash = $1, updated_at = NOW() WHERE id = $2',
        [hash, row.id]
      );
      descargados++;
      console.log('[datos-abiertos] Descargado:', nombre);

      if (procesar && (row.tipo === 'CSV' || row.tipo === 'JSON')) {
        if (row.tipo === 'CSV') {
          try {
            await runEtlParaFila(row, filePath);
            await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [row.id]);
            pasadosEtl++;
          } catch (e) {
            console.warn('[datos-abiertos] ETL no aplicable:', e.message);
          }
        }
      }
    } catch (err) {
      console.warn('[datos-abiertos] Error:', row.url_remota, err.message);
      errores++;
    }
  }

  await closePool();
  console.log('[datos-abiertos] Resumen: descargados', descargados, '| pasados a ETL CSV', pasadosEtl, '| errores', errores);
  if (res.rows.length && !procesar) {
    console.log('[datos-abiertos] Archivos en:', DOWNLOAD_BASE);
    console.log('[datos-abiertos] Para descargar y procesar: node server/scripts/descargar_datos_abiertos.js --procesar [--verificar]');
  }
}

main().catch((err) => {
  console.error('[datos-abiertos]', err.message);
  process.exit(1);
});
