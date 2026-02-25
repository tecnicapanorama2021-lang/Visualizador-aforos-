/**
 * Extrae URLs de documentos de procesos SECOP vía API REST (SECOP II).
 * No usa proxy; la API community.secop.gov.co responde a requests directos.
 *
 * Para cada proceso del catálogo (tmp/secop_catalogo_estudios.json) con uid:
 *   GET https://community.secop.gov.co/api/v2/Records/{uid}/documents
 * De la respuesta se extraen: nombre, url de descarga, tipo (PDFs de tránsito/aforo/PMT/ETT/PPRU).
 * Actualiza archivos_fuente.url_remota (y ruta_local si existe).
 *
 * Uso:
 *   node server/scripts/secop_extraer_urls_documentos.js
 *   SECOP_EXTRAER_LIMIT=3 node ...   (solo primeros 3 procesos; imprime JSON completo)
 *   npm run secop:extraer-urls
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const TMP_DIR = path.join(__dirname, 'tmp');
const CATALOG_PATH = path.join(TMP_DIR, 'secop_catalogo_estudios.json');
const ANEXOS_BASE = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');

// community.secop.gov.co suele devolver 403 a requests directos; si tienes el endpoint correcto (p.ej. otro host), configúralo.
const API_BASE = process.env.SECOP_DOCUMENTS_API_BASE || 'https://community.secop.gov.co/api/v2';
const API_ALT_BASE = 'https://www.contratos.gov.co';
const RELEVANTE_KEYWORDS = ['transito', 'transit', 'trafico', 'traffic', 'aforo', 'pmt', 'ett', 'ppru', 'estudio', 'conteo', 'movilidad'];

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

/** Extrae noticeUID de url_proceso (ej. noticeUID=CO1.NTC.9288596). */
function extraerUid(proc) {
  const url = proc.url_proceso || proc.url_contrato || '';
  const match = url.match(/noticeUID=([^&\s]+)/i) || url.match(/numConstancia=([^&\s]+)/i);
  if (match) return match[1].trim();
  return (proc.uid_proceso || proc.referencia_proceso || proc.id_proceso || '').toString().trim() || null;
}

/** Indica si el nombre de archivo suena a documento relevante (tránsito, aforo, PMT, ETT, PPRU). */
function esDocumentoRelevante(nombre) {
  if (!nombre) return false;
  const n = String(nombre).toLowerCase();
  return RELEVANTE_KEYWORDS.some((kw) => n.includes(kw));
}

const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'es-CO,es;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://community.secop.gov.co/',
  Origin: 'https://community.secop.gov.co',
};

/** GET documentos del proceso. Sin proxy. Prueba API_BASE y, si 403, opcionalmente API alternativa. */
async function fetchDocuments(uid) {
  const url = `${API_BASE}/Records/${encodeURIComponent(uid)}/documents`;
  const res = await axios.get(url, {
    timeout: 20000,
    headers: DEFAULT_HEADERS,
    validateStatus: (s) => s < 500,
  });
  const contentType = (res.headers['content-type'] || '').toLowerCase();
  const data = contentType.includes('application/json') && typeof res.data === 'object' ? res.data : res.data;
  if (res.status === 403 && API_ALT_BASE) {
    const altUrl = `${API_ALT_BASE}/api/v2/Records/${encodeURIComponent(uid)}/documents`;
    try {
      const alt = await axios.get(altUrl, { timeout: 15000, headers: { ...DEFAULT_HEADERS, Referer: API_ALT_BASE + '/' }, validateStatus: (s) => s < 500 });
      const altCt = (alt.headers['content-type'] || '').toLowerCase();
      const altData = altCt.includes('application/json') && typeof alt.data === 'object' ? alt.data : alt.data;
      return { status: alt.status, data: altData };
    } catch (_) {
      /* usar respuesta original */
    }
  }
  return { status: res.status, data };
}

/**
 * Normaliza la respuesta de la API a una lista { nombre, url, tipo }.
 * Acepta estructuras: array de { nombre, urlDocumento }, o { documents: [...] }, etc.
 */
function extraerDocumentos(apiData) {
  const out = [];
  if (!apiData) return out;

  let list = Array.isArray(apiData) ? apiData : apiData.documents || apiData.data || apiData.records || [];
  if (!Array.isArray(list)) list = [];

  for (const item of list) {
    const nombre = item.nombre || item.name || item.fileName || item.file_name || item.documentName || item.document_name || '';
    const url = item.urlDocumento || item.url_documento || item.url || item.downloadUrl || item.download_url || item.link || '';
    if (!url) continue;
    const ext = path.extname(String(nombre)).toLowerCase();
    const tipo = ext === '.pdf' ? 'PDF' : ['.xlsx', '.xls'].includes(ext) ? 'XLSX' : ext === '.csv' ? 'CSV' : 'PDF';
    const esPdf = tipo === 'PDF';
    if (esPdf && esDocumentoRelevante(nombre)) out.push({ nombre: nombre || path.basename(new URL(url).pathname) || 'documento.pdf', url, tipo });
    if (!esPdf && esDocumentoRelevante(nombre)) out.push({ nombre: nombre || 'documento', url, tipo });
  }
  return out;
}

function sanitizeFilename(name) {
  return (name || 'documento').replace(/[<>:"/\\|?*]/g, '_').slice(0, 200);
}

async function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('[secop-extraer-urls] No encontrado:', CATALOG_PATH);
    console.error('  Ejecuta primero: npm run secop:catalogo');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (!Array.isArray(catalog)) {
    console.error('[secop-extraer-urls] El catálogo debe ser un array.');
    process.exit(1);
  }

  const limit = Math.max(1, parseInt(process.env.SECOP_EXTRAER_LIMIT || '0', 10) || 999999);
  const procesos = catalog.slice(0, limit);
  const logFullJson = limit <= 3;

  console.log('[secop-extraer-urls] Procesos a consultar:', procesos.length, limit <= 3 ? '(mostrando JSON completo para validar estructura)' : '');

  let hasRutaLocal = false;
  try {
    hasRutaLocal = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'ruta_local'`
    ).then((r) => r.rows[0]);
  } catch (e) {
    console.warn('[secop-extraer-urls] BD no disponible o sin columna ruta_local; solo se mostrará JSON / documentos extraídos.');
  }

  let totalDocumentos = 0;
  let actualizados = 0;
  let insertados = 0;
  let errores = 0;
  const soloValidar = logFullJson && procesos.length <= 3;

  for (let i = 0; i < procesos.length; i++) {
    const proc = procesos[i];
    const uid = extraerUid(proc);
    const idProceso = (proc.id_proceso || proc.referencia_proceso || 'sin-id').replace(/[<>:"/\\|?*]/g, '_');

    if (!uid) {
      console.warn('[secop-extraer-urls] Sin UID, salto:', idProceso);
      continue;
    }

    try {
      const { status, data } = await fetchDocuments(uid);

      if (logFullJson) {
        console.log('\n--- JSON completo proceso', i + 1, 'uid=', uid, 'id_proceso=', idProceso, '---');
        console.log(JSON.stringify(data, null, 2));
        console.log('--- fin JSON ---\n');
      }

      if (status !== 200) {
        console.warn('[secop-extraer-urls] HTTP', status, 'uid=', uid);
        errores++;
        continue;
      }

      const docs = extraerDocumentos(data);
      totalDocumentos += docs.length;

      if (soloValidar) {
        console.log('[secop-extraer-urls] Documentos relevantes extraídos (proceso', i + 1, '):', docs.length);
        docs.forEach((d, j) => console.log('  ', j + 1, d.nombre, '|', d.url?.slice(0, 80) + (d.url?.length > 80 ? '...' : '')));
      }

      if (!soloValidar) {
        for (const doc of docs) {
          const nombreArchivo = sanitizeFilename(doc.nombre);
          const urlRemota = doc.url;
          const tipo = doc.tipo || 'PDF';
          const rutaRel = path.join(idProceso, nombreArchivo);
          const rutaLocal = path.join(ANEXOS_BASE, rutaRel);

          const existe = await query(
            'SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1',
            [urlRemota, 'SECOP']
          );
          if (existe.rows[0]) {
            if (hasRutaLocal) {
              await query(
                'UPDATE archivos_fuente SET ruta_local = $1, updated_at = NOW() WHERE id = $2',
                [rutaLocal, existe.rows[0].id]
              );
            }
            actualizados++;
          } else {
            await query(
              `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, url_remota, procesado, origen_id, updated_at)
               VALUES ($1, 'SECOP', $2, $3, FALSE, $4, NOW())`,
              [tipo, nombreArchivo, urlRemota, idProceso]
            );
            if (hasRutaLocal) {
              const r = await query('SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1', [urlRemota, 'SECOP']);
              if (r.rows[0]) {
                await query('UPDATE archivos_fuente SET ruta_local = $1, updated_at = NOW() WHERE id = $2', [rutaLocal, r.rows[0].id]);
              }
            }
            insertados++;
          }
        }
      }

      if (docs.length > 0 && !logFullJson) {
        console.log('[secop-extraer-urls] uid=', uid, 'documentos relevantes:', docs.length);
      }
    } catch (err) {
      console.warn('[secop-extraer-urls] Error uid=', uid, err.message);
      errores++;
    }
  }

  await closePool();

  console.log('[secop-extraer-urls] Total documentos relevantes extraídos:', totalDocumentos);
  console.log('[secop-extraer-urls] Insertados en archivos_fuente:', insertados, '| Actualizados (url_remota/ruta_local):', actualizados);
  if (errores) console.log('[secop-extraer-urls] Errores:', errores);
}

main().catch((err) => {
  console.error('[secop-extraer-urls]', err.message);
  process.exit(1);
});
