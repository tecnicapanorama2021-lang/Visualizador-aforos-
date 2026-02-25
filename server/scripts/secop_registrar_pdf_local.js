/**
 * Copia un PDF local a la carpeta correspondiente y lo registra en archivos_fuente (tipo PDF, procesado=FALSE).
 * Origen configurable: SECOP (data/secop/anexos), PRIVADO o UNIVERSIDAD (data/privado/anexos/<origen>).
 *
 * Uso: node server/scripts/secop_registrar_pdf_local.js --path=ruta/al/estudio.pdf
 *      node server/scripts/secop_registrar_pdf_local.js --path=ruta/al/estudio.pdf --origen=PRIVADO
 *      node server/scripts/secop_registrar_pdf_local.js --path=ruta/al/estudio.pdf --origen=UNIVERSIDAD
 * Opcional: --id-proceso=ID (para SECOP); --origen=SECOP|PRIVADO|UNIVERSIDAD (default SECOP)
 *
 * Luego: npm run etl:pdf (procesa PDFs de todos los orígenes) o node server/scripts/etl_pdf_secop.js (solo SECOP).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const ESTUDIOS_TRANSITO_PDFS = path.join(PROJECT_ROOT, 'data', 'estudios-transito', 'PDFs');
const SECOP_ANEXOS = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');
const PRIVADO_ANEXOS = path.join(PROJECT_ROOT, 'data', 'privado', 'anexos');

const ORIGENES_VALIDOS = ['SECOP', 'SDP', 'SDM', 'PRIVADO', 'UNIVERSIDAD', 'OTROS'];

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

function getPdfPath() {
  const arg = process.argv.find((a) => a.startsWith('--path='));
  if (arg) return path.resolve(process.cwd(), arg.split('=')[1].replace(/^["']|["']$/g, ''));
  return process.env.PDF_EJEMPLO_PATH ? path.resolve(process.cwd(), process.env.PDF_EJEMPLO_PATH) : null;
}

function getOrigen() {
  const arg = process.argv.find((a) => a.startsWith('--origen='));
  const v = arg ? arg.split('=')[1].trim().toUpperCase() : 'SECOP';
  return ORIGENES_VALIDOS.includes(v) ? v : 'SECOP';
}

function getIdProceso() {
  const arg = process.argv.find((a) => a.startsWith('--id-proceso='));
  return arg ? arg.split('=')[1].trim() : 'local';
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 200) || 'estudio_transito.pdf';
}

async function main() {
  const pdfPath = getPdfPath();
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('[registrar-pdf] Uso: node secop_registrar_pdf_local.js --path=ruta/al/estudio.pdf [--origen=SECOP|SDP|SDM|PRIVADO|UNIVERSIDAD]');
    process.exit(1);
  }

  const origen = getOrigen();
  const idProceso = getIdProceso();
  const nombreArchivo = sanitizeFilename(path.basename(pdfPath));
  if (!nombreArchivo.toLowerCase().endsWith('.pdf')) {
    console.error('[registrar-pdf] El archivo debe ser .pdf');
    process.exit(1);
  }

  const buf = fs.readFileSync(pdfPath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  const existing = await query(
    'SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1',
    [hash, origen]
  );
  if (existing.rows[0]) {
    console.log('[registrar-pdf] Ya registrado (mismo hash y origen), id:', existing.rows[0].id);
    await closePool();
    return;
  }

  // Estructura unificada: data/estudios-transito/PDFs/<origen>/
  const destDir = path.join(ESTUDIOS_TRANSITO_PDFS, origen);
  const destPath = path.join(destDir, nombreArchivo);
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, buf);
  console.log('[registrar-pdf] Copiado a:', destPath);

  const origenId = origen === 'SECOP' ? idProceso : null;

  const hasOrigenId = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'origen_id'`
  ).then((r) => r.rows[0]);

  if (hasOrigenId) {
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, origen_id, updated_at)
       VALUES ('PDF', $1, $2, $3, FALSE, $4, NOW())`,
      [origen, nombreArchivo, hash, origenId]
    );
  } else {
    await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, updated_at)
       VALUES ('PDF', $1, $2, $3, FALSE, NOW())`,
      [origen, nombreArchivo, hash]
    );
  }
  const r = await query('SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1', [hash, origen]);
  console.log('[registrar-pdf] Registrado en archivos_fuente, id:', r.rows[0].id, 'origen:', origen);
  console.log('[registrar-pdf] Siguiente paso: npm run etl:pdf   (o node server/scripts/etl_pdf_generico.js --dry-run para revisar)');
  await closePool();
}

main().catch((err) => {
  console.error('[registrar-pdf]', err.message);
  process.exit(1);
});
