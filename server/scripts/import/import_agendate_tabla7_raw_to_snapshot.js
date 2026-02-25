/**
 * Lee el JSON raw de la tabla 7 (eventos Agéndate) y genera el snapshot normalizado.
 * No toca BD. Solo lectura de archivo + escritura de snapshot.
 *
 * Uso:
 *   node server/scripts/import/import_agendate_tabla7_raw_to_snapshot.js [--dry] [--input path] [--output path] [--days 60] [--all]
 *   --all: incluir todos los eventos con fecha válida (no filtrar por ventana now..now+days).
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_tabla7_raw.json');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_snapshot.json');

const FIELD_NAMES = {
  titulo: ['EVNEVENTO', 'evnevento', 'nombre', 'titulo'],
  start_at: ['EVDINICIAL', 'evdinicial', 'fecha_inicio', 'start_at'],
  end_at: ['EVDFINAL', 'evdfinal', 'fecha_fin', 'end_at'],
  lugar_key: ['GUID_2', 'guid_2', 'GLOBALID', 'globalid', 'lugar_key'],
  lugar_nombre: ['EVNLUGAR', 'evnlugar', 'lugar_nombre', 'lugar'],
};

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v !== undefined ? v : def;
}

function getVal(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Extrae el array de registros del raw (features, records, results o array directo). */
function extractRecords(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.features && Array.isArray(raw.features)) return raw.features;
  if (raw?.records && Array.isArray(raw.records)) return raw.records;
  if (raw?.results && Array.isArray(raw.results)) return raw.results;
  return [];
}

/** Obtiene el objeto "attributes" o el propio item si ya es plano. */
function getAttrs(item) {
  if (item?.attributes && typeof item.attributes === 'object') return item.attributes;
  if (typeof item === 'object' && item !== null) return item;
  return {};
}

function parseEpoch(val) {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}

function main() {
  const inputPath = getArg('--input', DEFAULT_INPUT);
  const outputPath = getArg('--output', DEFAULT_OUTPUT);
  const days = Number(getArg('--days', '60')) || 60;
  const dry = process.argv.includes('--dry');
  const includeAll = process.argv.includes('--all');

  const now = Date.now();
  const endWindow = now + days * 24 * 60 * 60 * 1000;
  const threeHoursMs = 3 * 60 * 60 * 1000;

  return fs
    .readFile(inputPath, 'utf8')
    .then((raw) => JSON.parse(raw))
    .then((raw) => {
      const records = extractRecords(raw);
      const events = [];
      let skippedNoStart = 0;
      let skippedOutOfWindow = 0;

      for (const item of records) {
        const attrs = getAttrs(item);
        const titulo = (getVal(attrs, FIELD_NAMES.titulo) ?? '').toString().trim() || 'Evento sin nombre';
        const startMs = getVal(attrs, FIELD_NAMES.start_at);
        const startDate = parseEpoch(startMs);
        if (!startDate) {
          skippedNoStart++;
          continue;
        }
        const startAt = startDate.toISOString();
        if (!includeAll && (startDate.getTime() < now || startDate.getTime() > endWindow)) {
          skippedOutOfWindow++;
          continue;
        }
        const endMs = getVal(attrs, FIELD_NAMES.end_at);
        let endDate = parseEpoch(endMs);
        if (!endDate) endDate = new Date(startDate.getTime() + threeHoursMs);
        const end_at = endDate.toISOString();
        const lugar_key = (getVal(attrs, FIELD_NAMES.lugar_key) ?? '').toString().trim() || null;
        const lugar_nombre = (getVal(attrs, FIELD_NAMES.lugar_nombre) ?? '').toString().trim() || null;
        const origen_id = crypto
          .createHash('sha256')
          .update((lugar_key ?? '') + '|' + startAt + '|' + titulo)
          .digest('hex')
          .slice(0, 32);

        events.push({
          origen_id,
          titulo,
          start_at: startAt,
          end_at,
          lugar_key,
          lugar_nombre,
          raw: attrs,
        });
      }

      const snapshot = {
        source: 'AGENDATE_ARCGIS_SNAPSHOT',
        exportedAt: new Date().toISOString(),
        window_dias: days,
        events,
      };

      console.log('[import-tabla7] Resumen:');
      console.log('  total_raw_records:', records.length);
      console.log('  skipped_no_start:', skippedNoStart);
      console.log('  skipped_out_of_window:', skippedOutOfWindow);
      console.log('  events_exportados:', events.length);

      if (dry) {
        console.log('[import-tabla7] --dry: no se escribió archivo.');
        return;
      }

      return fs
        .mkdir(path.dirname(outputPath), { recursive: true })
        .then(() => fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8'))
        .then(() => console.log('[import-tabla7] Escrito:', outputPath));
    })
    .catch((err) => {
      if (err.code === 'ENOENT') {
        console.error('[import-tabla7] Archivo no encontrado:', err.path || inputPath);
        console.error('  Copie el JSON raw a public/data/agendate_eventos_tabla7_raw.json o use --input <path>.');
      } else {
        console.error('[import-tabla7]', err.message);
      }
      process.exit(1);
    });
}

main();
