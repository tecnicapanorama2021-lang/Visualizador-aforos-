/**
 * One-off: reorder package.json scripts by groups. No rename, no delete.
 * node scripts/reorder_package_scripts.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const s = pkg.scripts;

const order = [
  // Core
  'dev', 'dev:client', 'dev:api', 'dev:web', 'dev:all', 'kill:ports', 'check:root', 'build', 'preview', 'start', 'deploy',
  // Workers/Jobs/Seeds
  'worker', 'jobs:seed', 'bootstrap:local', 'seed:manifestacion-geocode-test', 'seed:aforos-secop',
  // DB
  'db:migrate', 'db:migrate:win', 'db:migrate:url', 'db:schema-check', 'db:full-load', 'db:seed:festivos',
  // Verify
  'verify:build', 'verify:dev:api', 'verify:worker', 'verify:all', 'verify:canon', 'verify:debug',
  'verify:agendate:eventos', 'verify:eventos:bogota', 'diag:agendate:join', 'verify:predictor',
  // Ingest/ETL (alphabetic)
  'arcgis:domains:sync', 'backfill:obras-canonical',
  'build:agendate:snapshot:related:dry', 'build:agendate:snapshot:related:apply',
  'catalogo:sdm-transporte', 'ckan:registrar-aforos',
  'datos-abiertos:descargar', 'datos-abiertos:descartar-irrelevantes', 'datos-abiertos:full',
  'datos-unificados:obras', 'datos-unificados:eventos', 'datos-unificados:velocidades',
  'etl:nodos-estudios', 'etl:nodos:ckan-geojson', 'etl:conteos', 'etl:fuente-externa-demo', 'etl:fuente-externa-csv',
  'etl:cgt', 'etl:sensores-bici', 'etl:velocidades:cgt', 'etl:pdf', 'etl:estudios-transito', 'etl:contexto',
  'etl:contexto-zonas', 'etl:contexto-geocode', 'etl:zonas', 'etl:cgt:daily', 'etl:sensores-bici:daily',
  'export:agendate:arcgis:snapshot',
  'historial:build', 'historial:incremental', 'historial:test',
  'import:agendate:tabla7:snapshot:dry', 'import:agendate:tabla7:snapshot:apply', 'import:agendate:tabla7:snapshot:apply:all',
  'import:eventos:bogota:copy', 'import:eventos:bogota:contexto:dry', 'import:eventos:bogota:contexto:apply',
  'ingest:obras', 'ingest:obras:dry', 'ingest:obras:incidentes', 'ingest:obras:incidentes:dry',
  'ingest:obras:arcgis', 'ingest:obras:arcgis:dry',
  'ingest:eventos', 'ingest:eventos:dry', 'ingest:eventos:incidentes', 'ingest:eventos:incidentes:dry',
  'ingest:eventos:web:dry', 'ingest:eventos:web:apply',
  'ingest:agendate:contexto:dry', 'ingest:agendate:contexto:apply', 'ingest:agendate:contexto:file:dry', 'ingest:agendate:contexto:file:apply', 'ingest:agendate:contexto:force',
  'ingest:agendate:arcgis:dry', 'ingest:agendate:arcgis:apply',
  'ingest:agendate:tabla7:contexto:dry', 'ingest:agendate:tabla7:contexto:apply',
  'ingest:agenda:manual:dry', 'ingest:agenda:manual:apply',
  'pipeline:full', 'pipeline:full:tor',
  'secop:catalogo', 'secop:catalogo:headless', 'secop:catalogo:anexos', 'secop:descargar', 'secop:procesar',
  'secop:ejemplo', 'secop:pdf', 'secop:registrar-pdf', 'secop:registrar-carpeta', 'secop:extraer-urls', 'secop:registrar-relevantes',
  'secop:catalogo:tor', 'secop:descargar:tor', 'secop:descargar:tor:bogota',
  'sdp:descargar', 'sdp:descargar:tor', 'sdp:descargar:tor-service',
  // Ops/Diag/Net
  'net:diag:agendate', 'net:diag:agendate:arcgis',
  'test:conectividad', 'test:conectividad:tor',
  'validacion:pre-t2', 'stats:fuentes', 'estudios:registrar-pdfs', 'scraper:portales',
];

const seen = new Set(order);
const ordered = {};
for (const k of order) {
  if (s[k] !== undefined) ordered[k] = s[k];
}
for (const k of Object.keys(s)) {
  if (!seen.has(k)) ordered[k] = s[k];
}

pkg.scripts = ordered;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Reordered', Object.keys(ordered).length, 'scripts');
