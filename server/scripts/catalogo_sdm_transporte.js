/**
 * Catálogo de datasets SDM / transporte desde Datos Abiertos Bogotá (CKAN).
 * Lista datasets del grupo transporte (y opcionalmente filtros por organización/tags)
 * y guarda el resultado en server/scripts/tmp/catalogo_sdm_transporte.json.
 *
 * No integra con BD; sirve para tener un panorama de fuentes disponibles.
 *
 * Uso: npm run catalogo:sdm-transporte
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
const TMP_DIR = path.join(__dirname, 'tmp');
const OUT_PATH = path.join(TMP_DIR, 'catalogo_sdm_transporte.json');

const DEFAULT_ROWS = 100;

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

async function main() {
  loadEnv();
  const baseUrl = process.env.CKAN_BASE_URL || process.env.CKAN_API_BASE || 'https://datosabiertos.bogota.gov.co';
  const apiPath = process.env.CKAN_API_PATH || '/api/3/action/package_search';
  const rows = parseInt(process.env.CATALOGO_ROWS || String(DEFAULT_ROWS), 10) || DEFAULT_ROWS;

  const searchUrl = new URL(apiPath.startsWith('http') ? apiPath : apiPath, baseUrl);
  searchUrl.searchParams.set('q', 'transporte movilidad');
  searchUrl.searchParams.set('rows', String(rows));
  searchUrl.searchParams.set('sort', 'metadata_modified desc');

  console.log('[catalogo] Consultando CKAN:', searchUrl.toString());
  const res = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    console.error('[catalogo] HTTP', res.status, res.statusText);
    process.exit(1);
  }
  const data = await res.json();
  if (!data.success || !data.result) {
    console.error('[catalogo] Respuesta CKAN sin result:', data.error || data);
    process.exit(1);
  }

  const results = data.result.results || [];
  const total = data.result.count ?? results.length;
  console.log('[catalogo] Datasets encontrados:', results.length, '(total:', total, ')');

  const catalog = results.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    title: pkg.title || pkg.name,
    url: pkg.url || `${baseUrl}/dataset/${pkg.name}`,
    notes: pkg.notes || null,
    tags: (pkg.tags || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean),
    organization: pkg.organization ? { name: pkg.organization.name, title: pkg.organization.title } : null,
    resources: (pkg.resources || []).map((r) => ({
      id: r.id,
      name: r.name || r.description,
      format: (r.format || '').toUpperCase(),
      url: r.url,
      created: r.created,
      last_modified: r.last_modified,
    })),
  }));

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  console.log('[catalogo] Guardado:', OUT_PATH);
}

main().catch((err) => {
  console.error('[catalogo] Error:', err.message);
  process.exit(1);
});
