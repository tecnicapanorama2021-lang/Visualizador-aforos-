/**
 * Descarga anexos candidatos (XLSX/CSV) del catálogo SECOP y los registra en archivos_fuente.
 * Idempotente: no redescarga si el archivo ya existe (por ruta); no duplica en BD (por hash + origen).
 *
 * Entrada: server/scripts/tmp/secop_catalogo_estudios.json (generado por secop_catalogo_estudios.js)
 * Salida: data/secop/anexos/<id_proceso>/<nombre_archivo>
 *
 * Uso: node server/scripts/secop_descargar_anexos.js
 *      node server/scripts/secop_descargar_anexos.js --solo-bogota
 *      PROXY_URL=socks5://127.0.0.1:9150 node ... (Tor Browser)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import { crearProxyAgent } from '../utils/crearProxyAgent.js';
import { esAnexoAforo, getTipoFromFilename } from './utils_aforos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const DEFAULT_CATALOG = path.join(__dirname, 'tmp', 'secop_catalogo_estudios.json');
const ANEXOS_BASE = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');

function getCatalogPath() {
  const arg = process.argv.find((a) => a.startsWith('--catalog='));
  if (arg) return path.resolve(PROJECT_ROOT, arg.split('=')[1]);
  return DEFAULT_CATALOG;
}

const BOGOTA_KEYWORDS = ['BOGOTA', 'DISTRITO', 'SDM', 'SDP', 'IDU', 'TRANSMILENIO'];

function isSoloBogota() {
  return process.argv.includes('--solo-bogota');
}

function filtrarCatalogBogota(catalog) {
  return catalog.filter((p) => {
    const entidad = (p.entidad || p.cliente || (p.datos_extra && p.datos_extra.cliente) || '').toString().toUpperCase();
    return BOGOTA_KEYWORDS.some((k) => entidad.includes(k));
  });
}

function delayAleatorioMs(min = 3000, max = 8000) {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

function isCandidateAnexo(anexo) {
  const nombre = anexo.nombre || path.basename((anexo.url || anexo.href || '').split('?')[0]) || '';
  return esAnexoAforo(nombre);
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 200) || 'anexo';
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function ensureTable() {
  const r = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'archivos_fuente'`
  );
  if (!r.rows[0]) {
    console.error('[secop-descarga] Ejecuta primero: npm run db:migrate');
    process.exit(1);
  }
}

async function registerOrSkipArchivo(nombre_archivo, hash, id_proceso, tipo, url_remota) {
  const hasUrlRemota = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'url_remota'`
  ).then((r) => r.rows[0]);
  const existingByHash = await query(
    'SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1',
    [hash, 'SECOP']
  );
  if (existingByHash.rows[0]) {
    return { action: 'skip', id: existingByHash.rows[0].id };
  }
  if (hasUrlRemota && url_remota) {
    const existingByUrl = await query(
      'SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1',
      [url_remota, 'SECOP']
    );
    if (existingByUrl.rows[0]) return { action: 'skip', id: existingByUrl.rows[0].id };
  }
  const hasOrigenId = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'origen_id'`
  ).then((r) => r.rows[0]);
  if (hasUrlRemota && hasOrigenId) {
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, origen_id, url_remota, updated_at)
       VALUES ($1, 'SECOP', $2, $3, FALSE, $4, $5, NOW())`,
      [tipo, nombre_archivo, hash, id_proceso || null, url_remota || null]
    );
  } else if (hasOrigenId) {
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, origen_id, updated_at)
       VALUES ($1, 'SECOP', $2, $3, FALSE, $4, NOW())`,
      [tipo, nombre_archivo, hash, id_proceso || null]
    );
  } else if (hasUrlRemota) {
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, url_remota, updated_at)
       VALUES ($1, 'SECOP', $2, $3, FALSE, $4, NOW())`,
      [tipo, nombre_archivo, hash, url_remota || null]
    );
  } else {
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, updated_at)
       VALUES ($1, 'SECOP', $2, $3, FALSE, NOW())`,
      [tipo, nombre_archivo, hash]
    );
  }
  const r = await query('SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1', [hash, 'SECOP']);
  return { action: 'registered', id: r.rows[0].id };
}

async function downloadTo(url, filePath) {
  const agent = crearProxyAgent(process.env.PROXY_URL);
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    httpsAgent: agent,
    headers: { 'User-Agent': 'PanoramaAforos/1.0 (descarga anexos SECOP)' },
    maxRedirects: 5,
  });
  if (res.status < 200 || res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(res.data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  return buf;
}

async function main() {
  const catalogPath = getCatalogPath();
  if (!fs.existsSync(catalogPath)) {
    console.error('[secop-descarga] No encontrado:', catalogPath);
    console.error('  Ejecuta primero: npm run secop:catalogo (consulta la API real de SECOP II en datos.gov.co)');
    process.exit(1);
  }

  await ensureTable();

  let catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!Array.isArray(catalog)) {
    console.error('[secop-descarga] El catálogo debe ser un array de procesos.');
    process.exit(1);
  }

  if (isSoloBogota()) {
    catalog = filtrarCatalogBogota(catalog);
    console.log('[secop-descarga] --solo-bogota: procesos filtrados a Bogotá/DISTRITO/SDM/SDP/IDU/TRANSMILENIO:', catalog.length);
  }

  const candidates = [];
  for (const proc of catalog) {
    const anexos = proc.anexos || [];
    const idProceso = (proc.id_proceso || proc.referencia_proceso || 'sin-id').replace(/[<>:"/\\|?*]/g, '_');
    for (const anexo of anexos) {
      if (!isCandidateAnexo(anexo)) continue;
      const url = anexo.url || anexo.href;
      if (!url) continue;
      const nombre = sanitizeFilename(anexo.nombre || path.basename(new URL(url).pathname) || 'anexo.xlsx');
      candidates.push({ id_proceso: idProceso, nombre, url, tipo: anexo.tipo || getTipoFromFilename(nombre), proceso: proc });
    }
  }

  const procesosConAnexos = catalog.filter((p) => (p.anexos || []).length > 0).length;
  console.log('[secop-descarga] Procesos en catálogo:', catalog.length);
  console.log('[secop-descarga] Procesos con anexos en catálogo:', procesosConAnexos);
  console.log('[secop-descarga] Anexos candidatos (pasaron esAnexoAforo):', candidates.length);

  if (candidates.length > 0) {
    const ejemplos = candidates.slice(0, 3);
    console.log('[secop-descarga] Ejemplos de anexos:');
    ejemplos.forEach((c, i) => {
      console.log('  ', i + 1, '| id_proceso:', c.id_proceso, '| nombre:', c.nombre.slice(0, 50), '| tipo:', c.tipo, '| url:', c.url.slice(0, 70) + (c.url.length > 70 ? '...' : ''));
    });
  }

  if (candidates.length === 0) {
    console.log('[secop-descarga] No hay anexos candidatos. Ejecuta: npm run secop:catalogo:headless');
    await closePool();
    return;
  }

  let downloaded = 0;
  let reused = 0;
  let registered = 0;
  let skipped = 0;
  let errors = 0;

  for (const c of candidates) {
    const relPath = path.join(c.id_proceso, c.nombre);
    const filePath = path.join(ANEXOS_BASE, relPath);

    try {
      let buf;
      if (fs.existsSync(filePath)) {
        buf = fs.readFileSync(filePath);
        reused++;
      } else {
        buf = await downloadTo(c.url, filePath);
        downloaded++;
        await delayAleatorioMs(3000, 8000);
      }

      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const result = await registerOrSkipArchivo(c.nombre, hash, c.id_proceso, c.tipo, c.url);

      if (result.action === 'registered') registered++;
      else skipped++;

      const urlProceso = c.proceso?.url_proceso || c.proceso?.url_remota;
      if (urlProceso) {
        await query(
          `UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE url_remota = $1 AND origen = 'SECOP'`
        , [urlProceso]);
      }
    } catch (err) {
      console.warn('[secop-descarga] Error:', c.url, err.message);
      errors++;
    }
  }

  await closePool();

  console.log('[secop-descarga] Descargados nuevos:', downloaded, '| Reutilizados (ya en disco):', reused);
  console.log('[secop-descarga] Registrados en archivos_fuente:', registered, '| Ya existían (hash):', skipped);
  if (errors) console.log('[secop-descarga] Errores:', errors);
  console.log('[secop-descarga] Anexos guardados en:', ANEXOS_BASE);
}

main().catch((err) => {
  console.error('[secop-descarga] Error:', err.message);
  process.exit(1);
});
