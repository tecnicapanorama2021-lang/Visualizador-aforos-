/**
 * Busca en Datos Abiertos Bogotá (CKAN) datasets sobre conteo/aforos/tránsito
 * y registra sus recursos (CSV, GeoJSON, XLSX) en archivos_fuente (origen=DATOS_ABIERTOS, url_remota).
 * No descarga; solo registra para procesar después.
 *
 * Uso: node server/scripts/ckan_registrar_recursos_aforos.js
 *      npm run ckan:registrar-aforos
 */

import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const FORMATOS_ACEPTADOS = ['CSV', 'GEOJSON', 'XLSX', 'XLS', 'JSON'];
const CKAN_TIMEOUT_MS = 30000;
const CKAN_RETRIES = 3;
const CKAN_BACKOFF_MS = 2000;

const QUERIES = [
  'aforo',
  'aforos',
  'conteo vehicular',
  'conteo',
  'tránsito',
  'movilidad',
  'velocidad',
  'sensores',
  'bicicleta',
  'conteo vehiculos CGT',
  'sensores conteo bicicleta',
  'velocidad actual en via',
  'plan de manejo de transito',
];

function getTipo(format) {
  const f = (format || '').toUpperCase();
  if (['XLSX', 'XLS'].includes(f)) return 'XLSX';
  if (f === 'CSV') return 'CSV';
  if (f === 'GEOJSON' || f === 'JSON') return 'JSON';
  return 'CSV';
}

function nombreDeUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean);
    const last = seg[seg.length - 1] || 'recurso';
    return last.length > 200 ? last.slice(0, 200) : last;
  } catch {
    return 'recurso';
  }
}

async function main() {
  const baseUrl = process.env.CKAN_BASE_URL || 'https://datosabiertos.bogota.gov.co';
  const apiPath = process.env.CKAN_API_PATH || '/api/3/action/package_search';

  const hasUrl = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'url_remota'`
  ).then((r) => r.rows[0]);
  if (!hasUrl) {
    console.error('[ckan-aforos] Ejecuta npm run db:migrate (columna url_remota).');
    process.exit(1);
  }

  const todosRecursos = [];
  const datasetsPorTermino = {};
  for (const q of QUERIES) {
    const searchUrl = new URL(apiPath.startsWith('http') ? apiPath : apiPath, baseUrl);
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('rows', '50');
    searchUrl.searchParams.set('sort', 'metadata_modified desc');

    const httpsAgent = process.env.CKAN_INSECURE_TLS === '1'
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
    let data = null;
    for (let intento = 1; intento <= CKAN_RETRIES; intento++) {
      try {
        const res = await axios.get(searchUrl.toString(), {
          timeout: CKAN_TIMEOUT_MS,
          httpsAgent,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Aforos-Bogota/1.0)',
            Accept: 'application/json',
          },
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        data = res.data;
        break;
      } catch (err) {
        if (intento === CKAN_RETRIES) {
          console.warn('[ckan-aforos] CKAN no disponible para término "' + q + '" después de ' + CKAN_RETRIES + ' intentos:', err.message);
          continue;
        }
        await new Promise((r) => setTimeout(r, CKAN_BACKOFF_MS));
      }
    }
    if (!data?.success || !data.result?.results) continue;

    const count = data.result.results.length;
    datasetsPorTermino[q] = count;
    for (const pkg of data.result.results) {
      const slug = (pkg.name || '').toLowerCase().replace(/\s+/g, '-');
      for (const r of pkg.resources || []) {
        const format = (r.format || '').toUpperCase().replace(/[\s.]/g, '');
        if (!FORMATOS_ACEPTADOS.includes(format)) continue;
        const url = r.url;
        if (!url || !url.startsWith('http')) continue;
        const nombre = (r.name || nombreDeUrl(url) || 'recurso').replace(/[<>:"/\\|?*]/g, '_').slice(0, 200);
        todosRecursos.push({
          nombre_archivo: nombre,
          tipo: getTipo(format),
          url_remota: url,
          origen: 'DATOS_ABIERTOS',
          packageSlug: slug,
          packageName: pkg.title || pkg.name,
        });
      }
    }
  }

  console.log('[ckan-aforos] Datasets por término de búsqueda:', JSON.stringify(datasetsPorTermino, null, 0));
  console.log('[ckan-aforos] Total recursos (CSV/GeoJSON/XLSX/JSON) encontrados:', todosRecursos.length);

  let registrados = 0;
  const registradosList = [];
  let tieneCGT = false;
  let tieneSensoresBici = false;

  for (const rec of todosRecursos) {
    const existing = await query(
      'SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1',
      [rec.url_remota, rec.origen]
    );
    if (existing.rows[0]) continue;
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, url_remota, updated_at)
       VALUES ($1, $2, $3, NULL, FALSE, $4, NOW())`,
      [rec.tipo, rec.origen, rec.nombre_archivo, rec.url_remota]
    );
    registrados++;
    if (registradosList.length < 3) {
      registradosList.push({ nombre: rec.nombre_archivo, tipo: rec.tipo, url_remota: rec.url_remota.slice(0, 80) + '...' });
    }
    const slug = (rec.packageSlug || '').toLowerCase();
    if (slug.includes('conteo-vehiculos-cgt') || slug.includes('cgt-bogota')) tieneCGT = true;
    if (slug.includes('sensores-conteo-bicicleta') || (slug.includes('bicicleta') && slug.includes('sensores'))) tieneSensoresBici = true;
    console.log('[ckan-aforos] Registrado:', rec.nombre_archivo.slice(0, 60), rec.tipo);
  }

  if (registradosList.length) {
    console.log('[ckan-aforos] Ejemplos de recursos registrados:');
    registradosList.forEach((r, i) => console.log('  ', i + 1, '|', r.nombre.slice(0, 50), '|', r.tipo, '|', r.url_remota));
  }

  await closePool();
  console.log('[ckan-aforos] Recursos encontrados:', todosRecursos.length, '| Registrados nuevos:', registrados);

  if (tieneCGT || tieneSensoresBici) {
    const { spawnSync } = await import('child_process');
    if (tieneCGT) {
      console.log('[ckan-aforos] Ejecutando etl:cgt (CGT vehiculos)...');
      const r = spawnSync('npm', ['run', 'etl:cgt'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: true });
      if (r.status !== 0) console.warn('[ckan-aforos] etl:cgt salió con código', r.status);
    }
    if (tieneSensoresBici) {
      console.log('[ckan-aforos] Ejecutando etl:sensores-bici...');
      const r = spawnSync('npm', ['run', 'etl:sensores-bici'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: true });
      if (r.status !== 0) console.warn('[ckan-aforos] etl:sensores-bici salió con código', r.status);
    }
  }
}

main().catch((err) => {
  console.error('[ckan-aforos]', err.message);
  process.exit(1);
});
