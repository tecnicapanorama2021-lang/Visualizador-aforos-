/**
 * Descarga PDFs de estudios de tránsito PPRU (SDP/PRIVADO) desde URLs fijas y los registra en archivos_fuente.
 * Idempotente: no redescarga si ya existe y está procesado; UPSERT por url_remota + origen.
 *
 * Uso: node server/scripts/sdp_descargar_ppru.js
 *      npm run sdp:descargar
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import { crearProxyAgent } from '../utils/crearProxyAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const PRIVADO_BASE = path.join(PROJECT_ROOT, 'data', 'privado', 'anexos');

const PDF_SDP = [
  {
    url: 'https://www.sdp.gov.co/sites/default/files/001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf',
    nombre: '001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf',
    origen: 'SDP',
    descripcion: 'PPRU Nueva Aranda',
  },
  {
    url: 'https://www.sdp.gov.co/sites/default/files/4_190805_informe_de_transito_vf.pdf',
    nombre: '4_190805_informe_de_transito_vf.pdf',
    origen: 'SDP',
    descripcion: 'PPRU Informe tránsito VF',
  },
  {
    url: 'https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v4.pdf',
    nombre: 'estudio_transito_pp_el_carmen_v4.pdf',
    origen: 'SDP',
    descripcion: 'Plan Parcial El Carmen',
  },
  {
    url: 'https://portal.dapd.gov.co/sites/default/files/v2_estudio_de_transito.pdf',
    nombre: 'v2_estudio_de_transito.pdf',
    origen: 'SDP',
    descripcion: 'PPRU DAPD v2',
  },
  {
    url: 'https://fenicia.co/wp-content/uploads/2020/12/4.ESTUDIO-DE-MOVILIDAD.pdf',
    nombre: '4.ESTUDIO-DE-MOVILIDAD.pdf',
    origen: 'PRIVADO',
    descripcion: 'Fenicia – Estudio de Movilidad',
  },
];

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DOWNLOAD_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

async function hasUrlRemota() {
  const r = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'url_remota'`
  );
  return !!r.rows[0];
}

async function main() {
  const hasUrl = await hasUrlRemota();
  if (!hasUrl) {
    console.error('[sdp-descargar] Ejecuta npm run db:migrate (columna url_remota).');
    process.exit(1);
  }

  const skipTimeout = process.argv.includes('--skip-timeout');
  let listaTrabajo = PDF_SDP;
  if (skipTimeout) {
    const pendientes = await query(
      `SELECT url_remota, origen, nombre_archivo FROM archivos_fuente
       WHERE origen IN ('SDP','PRIVADO') AND tipo = 'PDF' AND (procesado = FALSE OR procesado IS NULL)`
    );
    const urlsPendientes = new Set(pendientes.rows.map((r) => r.url_remota));
    listaTrabajo = PDF_SDP.filter((item) => urlsPendientes.has(item.url));
    console.log('[sdp-descargar] Modo --skip-timeout: solo', listaTrabajo.length, 'URLs ya registradas como pendientes.');
  }

  let descargados = 0;
  let yaEstaban = 0;
  let pendientesOtraRed = 0;

  for (const item of listaTrabajo) {
    const dir = path.join(PRIVADO_BASE, item.origen);
    const filePath = path.join(dir, item.nombre);

    if (fs.existsSync(filePath)) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      const existing = await query(
        'SELECT id, procesado FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1',
        [hash, item.origen]
      );
      if (existing.rows[0] && existing.rows[0].procesado) {
        yaEstaban++;
        continue;
      }
      if (existing.rows[0]) {
        yaEstaban++;
        continue;
      }
    }

    let lastErr = null;
    for (let intento = 1; intento <= MAX_RETRIES; intento++) {
      try {
        const agent = crearProxyAgent(process.env.PROXY_URL);
        const res = await axios.get(item.url, {
          responseType: 'arraybuffer',
          timeout: DOWNLOAD_TIMEOUT_MS,
          maxRedirects: 5,
          httpsAgent: agent,
          headers: { 'User-Agent': 'PanoramaAforos/1.0 (descarga SDP PPRU)' },
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(res.data);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, buf);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');

        const byUrl = await query(
          'SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1',
          [item.url, item.origen]
        );
        if (byUrl.rows[0]) {
          await query(
            'UPDATE archivos_fuente SET hash = $1, nombre_archivo = $2, updated_at = NOW() WHERE id = $3',
            [hash, item.nombre, byUrl.rows[0].id]
          );
        } else {
          await query(
            `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, url_remota, updated_at)
             VALUES ('PDF', $1, $2, $3, FALSE, $4, NOW())`,
            [item.origen, item.nombre, hash, item.url]
          );
        }
        descargados++;
        console.log('[sdp-descargar] Descargado/registrado:', item.descripcion, item.nombre);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (intento < MAX_RETRIES) {
          console.warn('[sdp-descargar] Intento', intento, 'fallido, reintento en', RETRY_DELAY_MS / 1000, 's:', err.message);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    if (lastErr) {
      console.warn('[sdp-descargar] PDF pendiente para otra red:', item.url, lastErr.message);
      pendientesOtraRed++;
    }
  }

  await closePool();
  console.log('[sdp-descargar] Resumen: descargados/registrados', descargados, '| ya existían', yaEstaban, '| pendientes otra red', pendientesOtraRed);
}

main().catch((err) => {
  console.error('[sdp-descargar]', err.message);
  process.exit(1);
});
