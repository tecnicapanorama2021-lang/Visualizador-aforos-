/**
 * Aplica reglas de nodos_categoria_rules a nodos (tipo_nodo, tipo_nodo_source, tipo_nodo_rule_id, tipo_nodo_confidence).
 * No toca nodos con tipo_nodo_source = 'MANUAL'. Respeta prioridad (mayor primero).
 *
 * Uso:
 *   node server/scripts/apply_nodos_rules.js --dry-run   (solo muestra cuántos cambiarían)
 *   node server/scripts/apply_nodos_rules.js --apply     (ejecuta UPDATE)
 *   node server/scripts/apply_nodos_rules.js --apply --reset-defaults  (resetea no-MANUAL a OTROS antes de aplicar)
 *
 * Requiere: migración 018, DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { closePool } from '../db/client.js';
import { runApply } from './apply_nodos_rules_lib.js';

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
  const args = process.argv.slice(2);
  let dryRun = true;
  let apply = false;
  let resetDefaults = false;
  for (const a of args) {
    if (a === '--apply') apply = true;
    if (a === '--dry-run') dryRun = true;
    if (a === '--reset-defaults') resetDefaults = true;
  }
  if (apply) dryRun = false;
  return { dryRun, apply, resetDefaults };
}

async function main() {
  const { dryRun, apply, resetDefaults } = parseArgs();

  const result = await runApply({ dryRun, apply, resetDefaults });

  if (result.rulesCount === 0) {
    console.log('[apply_nodos_rules] No hay reglas habilitadas.');
    await closePool();
    return;
  }

  if (result.resetCount != null) {
    console.log('[apply_nodos_rules] Reset no-MANUAL:', result.resetCount, 'nodos.');
  }

  console.log('[apply_nodos_rules] Resumen:');
  console.log('  total_nodos:', result.totalNodos);
  console.log('  manual_locked:', result.manualLocked);
  console.log('  updated_by_rules:', dryRun ? '(dry-run) ' + result.updatedTotal : result.updatedTotal);
  console.log('  unchanged (no match o ya MANUAL):', result.unchanged);
  console.log('  Por tipo_nodo:', result.byTipo.map((r) => `${r.tipo_nodo}=${r.c}`).join(', '));

  if (dryRun) {
    console.log('[apply_nodos_rules] Modo --dry-run. Ejecuta con --apply para escribir.');
  }

  await closePool();
}

main().catch((err) => {
  console.error('[apply_nodos_rules]', err.message);
  process.exit(1);
});
