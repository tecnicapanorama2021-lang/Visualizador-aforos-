/**
 * Migra todos los PDFs desde data/privado/anexos y data/secop/anexos
 * a data/estudios-transito/PDFs/{SDP,PRIVADO,SECOP,OTROS}.
 * No elimina las carpetas antiguas (hacerlo manualmente tras verificar).
 *
 * Uso: node server/scripts/migrar_pdfs_estudios_transito.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const BASE = path.join(PROJECT_ROOT, 'data', 'estudios-transito', 'PDFs');
const PRIVADO_ANEXOS = path.join(PROJECT_ROOT, 'data', 'privado', 'anexos');
const SECOP_ANEXOS = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos');

const ORIGENES = ['SDP', 'PRIVADO', 'OTROS'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let copied = 0;
let skipped = 0;

// Carpetas unificadas
ORIGENES.forEach((o) => ensureDir(path.join(BASE, o)));
ensureDir(path.join(BASE, 'SECOP'));

// Migrar desde data/privado/anexos/<origen>/
if (fs.existsSync(PRIVADO_ANEXOS)) {
  for (const origen of ORIGENES) {
    const srcDir = path.join(PRIVADO_ANEXOS, origen);
    if (!fs.existsSync(srcDir)) continue;
    const destDir = path.join(BASE, origen);
    const files = fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    for (const f of files) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (fs.existsSync(dest)) {
        skipped++;
        continue;
      }
      fs.copyFileSync(src, dest);
      console.log('[migrar]', origen + '/', f);
      copied++;
    }
  }
}

// Migrar desde data/secop/anexos/<id_proceso>/
if (fs.existsSync(SECOP_ANEXOS)) {
  const procesos = fs.readdirSync(SECOP_ANEXOS, { withFileTypes: true }).filter((d) => d.isDirectory());
  const destSecop = path.join(BASE, 'SECOP');
  for (const p of procesos) {
    const srcDir = path.join(SECOP_ANEXOS, p.name);
    const files = fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    for (const f of files) {
      const src = path.join(srcDir, f);
      let dest = path.join(destSecop, f);
      if (fs.existsSync(dest)) {
        dest = path.join(destSecop, `${p.name}_${f}`);
      }
      fs.copyFileSync(src, dest);
      console.log('[migrar] SECOP/', path.basename(dest));
      copied++;
    }
  }
}

console.log('[migrar] Copiados:', copied, '| Omitidos (ya existían):', skipped);
console.log('[migrar] Siguiente paso: npm run etl:estudios-transito (o etl:pdf si aún usas archivos_fuente antiguo).');
