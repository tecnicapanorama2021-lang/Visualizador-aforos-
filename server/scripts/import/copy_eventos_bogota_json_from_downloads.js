/**
 * Copia eventos_bogota_2026_completo.json desde la carpeta Descargas a public/data.
 * Acepta cualquier nombre que empiece por eventos_bogota_2026_completo y termine en .json.
 * Elige el más reciente por mtime. Elimina snapshot previo de esta fuente.
 *
 * Uso: node server/scripts/import/copy_eventos_bogota_json_from_downloads.js
 *      npm run import:eventos:bogota:copy
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

const DOWNLOADS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, 'Downloads')
  : path.join(process.env.HOME || '', 'Downloads');

const BASE_PREFIX = 'eventos_bogota_2026_completo';
const TARGET_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'eventos_bogota_2026_completo.json');
const SNAPSHOT_TO_REMOVE = path.join(PROJECT_ROOT, 'public', 'data', 'eventos_bogota_2026_snapshot.json');

/** Candidatos: empiezan por BASE_PREFIX y terminan en .json (case-insensitive). */
function isCandidate(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(BASE_PREFIX.toLowerCase()) && lower.endsWith('.json');
}

async function main() {
  let names = [];
  try {
    names = await fs.readdir(DOWNLOADS_DIR);
  } catch (err) {
    console.error('[copy-eventos-bogota] No se pudo leer', DOWNLOADS_DIR, err.message);
    process.exit(1);
  }

  const candidates = names.filter(isCandidate);
  if (candidates.length === 0) {
    console.error('[copy-eventos-bogota] No se encontró ningún archivo que empiece por', BASE_PREFIX, 'y termine en .json en', DOWNLOADS_DIR);
    process.exit(1);
  }

  const withStat = await Promise.all(
    candidates.map(async (name) => {
      const full = path.join(DOWNLOADS_DIR, name);
      const stat = await fs.stat(full);
      return { name, full, mtime: stat.mtimeMs, size: stat.size };
    })
  );
  withStat.sort((a, b) => b.mtime - a.mtime);
  const chosen = withStat[0];

  await fs.mkdir(path.dirname(TARGET_PATH), { recursive: true });
  await fs.copyFile(chosen.full, TARGET_PATH);

  console.log('[copy-eventos-bogota] Origen:', chosen.full);
  console.log('[copy-eventos-bogota] Destino:', TARGET_PATH);
  console.log('[copy-eventos-bogota] Tamaño (bytes):', chosen.size);

  try {
    await fs.unlink(SNAPSHOT_TO_REMOVE);
    console.log('[copy-eventos-bogota] Eliminado snapshot previo:', SNAPSHOT_TO_REMOVE);
  } catch {
    // snapshot no existe
  }
}

main().catch((err) => {
  console.error('[copy-eventos-bogota]', err.message);
  process.exit(1);
});
