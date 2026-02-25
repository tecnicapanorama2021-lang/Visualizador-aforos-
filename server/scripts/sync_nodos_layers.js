/**
 * Sincroniza nodos_layers desde estudios, obras, eventos_urbanos, semaforos.
 * Idempotente: upsert por (nodo_id, layer_key); desactiva capas sin datos.
 *
 * Uso:
 *   node server/scripts/sync_nodos_layers.js --dry-run
 *   node server/scripts/sync_nodos_layers.js --apply
 *
 * Requiere: migración 020.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

function loadEnv() {
  for (const envPath of [
    path.join(PROJECT_ROOT, '.env'),
    path.join(PROJECT_ROOT, 'server', '.env'),
  ]) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
}
loadEnv();

function parseArgs() {
  const apply = process.argv.includes('--apply');
  return { dryRun: !apply, apply };
}

async function main() {
  const { dryRun, apply } = parseArgs();

  const counts = { aforos: 0, obras: 0, eventos: 0, semaforos: 0 };

  if (dryRun) {
    const [a, o, e, s] = await Promise.all([
      query('SELECT COUNT(DISTINCT nodo_id) AS c FROM estudios'),
      query('SELECT COUNT(DISTINCT nodo_id) AS c FROM obras'),
      query('SELECT COUNT(DISTINCT nodo_id) AS c FROM eventos_urbanos'),
      query('SELECT COUNT(DISTINCT nodo_id) AS c FROM semaforos'),
    ]);
    counts.aforos = parseInt(a.rows[0]?.c ?? 0, 10);
    counts.obras = parseInt(o.rows[0]?.c ?? 0, 10);
    counts.eventos = parseInt(e.rows[0]?.c ?? 0, 10);
    counts.semaforos = parseInt(s.rows[0]?.c ?? 0, 10);
    console.log('[sync_nodos_layers] dry-run — would sync:', counts);
    await closePool();
    return;
  }

  // AFOROS: nodos con estudios
  const aforosRes = await query(`
    INSERT INTO nodos_layers (nodo_id, layer_key, is_active, meta, updated_at)
    SELECT DISTINCT e.nodo_id, 'AFOROS', true, '{"source":"estudios"}'::jsonb, now()
    FROM estudios e
    ON CONFLICT (nodo_id, layer_key) DO UPDATE SET is_active = true, meta = EXCLUDED.meta, updated_at = now()
  `);
  counts.aforos = aforosRes?.rowCount ?? 0;

  // OBRAS
  await query(`
    INSERT INTO nodos_layers (nodo_id, layer_key, is_active, meta, updated_at)
    SELECT DISTINCT o.nodo_id, 'OBRAS', true, jsonb_build_object('status', COALESCE(o.estado, 'ACTIVA')), now()
    FROM obras o
    ON CONFLICT (nodo_id, layer_key) DO UPDATE SET is_active = true, meta = EXCLUDED.meta, updated_at = now()
  `);
  const oCount = await query('SELECT COUNT(DISTINCT nodo_id) AS c FROM obras');
  counts.obras = parseInt(oCount.rows[0]?.c ?? 0, 10);

  // EVENTOS
  await query(`
    INSERT INTO nodos_layers (nodo_id, layer_key, is_active, meta, updated_at)
    SELECT DISTINCT ev.nodo_id, 'EVENTOS', true, '{}'::jsonb, now()
    FROM eventos_urbanos ev
    ON CONFLICT (nodo_id, layer_key) DO UPDATE SET is_active = true, updated_at = now()
  `);
  const eCount = await query('SELECT COUNT(DISTINCT nodo_id) AS c FROM eventos_urbanos');
  counts.eventos = parseInt(eCount.rows[0]?.c ?? 0, 10);

  // SEMAFOROS
  await query(`
    INSERT INTO nodos_layers (nodo_id, layer_key, is_active, meta, updated_at)
    SELECT DISTINCT s.nodo_id, 'SEMAFOROS', true, '{}'::jsonb, now()
    FROM semaforos s
    ON CONFLICT (nodo_id, layer_key) DO UPDATE SET is_active = true, updated_at = now()
  `);
  const sCount = await query('SELECT COUNT(DISTINCT nodo_id) AS c FROM semaforos');
  counts.semaforos = parseInt(sCount.rows[0]?.c ?? 0, 10);

  // Desactivar capas que ya no tienen datos
  await query(`
    UPDATE nodos_layers SET is_active = false, updated_at = now()
    WHERE layer_key = 'AFOROS' AND nodo_id NOT IN (SELECT DISTINCT nodo_id FROM estudios)
  `);
  await query(`
    UPDATE nodos_layers SET is_active = false, updated_at = now()
    WHERE layer_key = 'OBRAS' AND nodo_id NOT IN (SELECT DISTINCT nodo_id FROM obras)
  `);
  await query(`
    UPDATE nodos_layers SET is_active = false, updated_at = now()
    WHERE layer_key = 'EVENTOS' AND nodo_id NOT IN (SELECT DISTINCT nodo_id FROM eventos_urbanos)
  `);
  await query(`
    UPDATE nodos_layers SET is_active = false, updated_at = now()
    WHERE layer_key = 'SEMAFOROS' AND nodo_id NOT IN (SELECT DISTINCT nodo_id FROM semaforos)
  `);

  const aTotal = await query('SELECT COUNT(DISTINCT nodo_id) AS c FROM estudios');
  counts.aforos = parseInt(aTotal.rows[0]?.c ?? 0, 10);

  console.log('[sync_nodos_layers] apply — synced:', counts);
  await closePool();
}

main().catch((err) => {
  console.error('[sync_nodos_layers]', err.message);
  process.exit(1);
});
