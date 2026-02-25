/**
 * Registra PDFs en data/pdfs_estudios/ en archivos_fuente y estudios_transito (SDP).
 *
 * Uso: node server/scripts/registrar_pdf_estudio_transito.js
 *      npm run estudios:registrar-pdfs
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const PDFS_DIR = path.join(PROJECT_ROOT, 'data', 'pdfs_estudios');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const URL_POR_NOMBRE = [
  { clave: 'nueva_aranda', url: 'https://www.sdp.gov.co/sites/default/files/001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf' },
  { clave: 'el_carmen_v5', url: 'https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v5.pdf' },
  { clave: 'el_carmen_v4', url: 'https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v4.pdf' },
  { clave: 'fenicia', url: 'https://www.sdp.gov.co/sites/default/files/4_190805_informe_de_transito_vf.pdf' },
  { clave: 'v2_estudio', url: 'https://portal.dapd.gov.co/sites/default/files/v2_estudio_de_transito.pdf' },
  { clave: 'dapd', url: 'https://portal.dapd.gov.co/sites/default/files/v2_estudio_de_transito.pdf' },
  { clave: 'pp3q', url: 'https://www.sdp.gov.co/sites/default/files/estudio_transito_pp3q_v2.1_27062024.pdf' },
  { clave: 'el_carmen', url: 'https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v4.pdf' },
  { clave: 'carmen', url: 'https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v4.pdf' },
];

function urlParaArchivo(nombreArchivo) {
  const n = (nombreArchivo || '').toLowerCase();
  for (const { clave, url } of URL_POR_NOMBRE) {
    if (n.includes(clave)) return url;
  }
  return `file://data/pdfs_estudios/${nombreArchivo}`;
}

function tipoYNombreEstudio(nombreArchivo) {
  const n = (nombreArchivo || '').toLowerCase();
  const sinExt = path.basename(nombreArchivo, '.pdf');
  if (n.includes('nueva_aranda')) return { tipo: 'PPRU', nombre: 'PPRU Nueva Aranda' };
  if (n.includes('el_carmen') || n.includes('carmen')) return { tipo: 'PPRU', nombre: 'PPRU El Carmen' };
  if (n.includes('fenicia')) return { tipo: 'PPRU', nombre: 'PPRU Triángulo de Fenicia' };
  if (n.includes('dapd') || n.includes('v2_estudio')) return { tipo: 'PPRU', nombre: 'Estudio Tránsito DAPD' };
  if (n.includes('pp3q')) return { tipo: 'PPRU', nombre: 'PPRU PP3Q 2024' };
  return { tipo: 'OTRO', nombre: sinExt };
}

async function main() {
  if (!fs.existsSync(PDFS_DIR)) {
    fs.mkdirSync(PDFS_DIR, { recursive: true });
  }
  const archivos = fs.readdirSync(PDFS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (archivos.length === 0) {
    console.log('[estudios:registrar-pdfs] No hay PDFs en data/pdfs_estudios/');
    await closePool();
    return;
  }

  console.log('[estudios:registrar-pdfs] PDFs encontrados en data/pdfs_estudios/:', archivos.length);
  let nuevosArchivo = 0;
  let nuevosEstudio = 0;
  const lista = [];

  for (const nombreArchivo of archivos) {
    const ruta = path.join(PDFS_DIR, nombreArchivo);
    const buf = fs.readFileSync(ruta);
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    const urlOrigen = urlParaArchivo(nombreArchivo);
    const { tipo: tipoEstudio, nombre: nombreEstudio } = tipoYNombreEstudio(nombreArchivo);

    let archivoId;
    const existente = await query(
      'SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1',
      [hash, 'SDP']
    );
    if (existente.rows[0]) {
      archivoId = existente.rows[0].id;
    } else {
      await query(
        `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, url_remota, updated_at)
         VALUES ('PDF', 'SDP', $1::text, $2::text, FALSE, $3::text, NOW())`,
        [nombreArchivo, hash, urlOrigen]
      );
      const r = await query('SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1', [hash, 'SDP']);
      archivoId = r.rows[0].id;
      nuevosArchivo++;
    }

    const yaEstudio = await query(
      'SELECT id FROM estudios_transito WHERE url_documento_original = $1 LIMIT 1',
      [urlOrigen]
    );
    const ins = await query(
      `INSERT INTO estudios_transito
         (nombre, tipo, fuente, url_documento_original, fecha_inicio, datos_extra)
       VALUES ($1::varchar(255), $2::varchar(50), 'SDP', $3::text, NULL::date, jsonb_build_object('archivo_local', $4::text))
       ON CONFLICT (url_documento_original) DO UPDATE
         SET datos_extra = estudios_transito.datos_extra || jsonb_build_object('archivo_local', $4::text)
       RETURNING id`,
      [nombreEstudio, tipoEstudio, urlOrigen, nombreArchivo]
    );
    const etId = ins.rows[0].id;
    if (!yaEstudio.rows[0]) nuevosEstudio++;

    await query(
      'UPDATE archivos_fuente SET estudio_transito_id = $1::int WHERE id = $2::int',
      [etId, archivoId]
    );

    lista.push({ nombre: nombreArchivo, tipo: tipoEstudio, url_origen: urlOrigen });
  }

  await closePool();

  console.log('[estudios:registrar-pdfs] Registrados en archivos_fuente (nuevos):', nuevosArchivo);
  console.log('[estudios:registrar-pdfs] Registrados en estudios_transito (nuevos):', nuevosEstudio);
  console.log('[estudios:registrar-pdfs] Lista: nombre | tipo | url_origen');
  lista.forEach((l) => console.log(' ', l.nombre, '|', l.tipo, '|', l.url_origen));
}

main().catch((err) => {
  console.error('[estudios:registrar-pdfs]', err.message);
  process.exit(1);
});
