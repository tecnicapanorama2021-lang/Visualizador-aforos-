/**
 * Verifica endpoints existentes y nuevos; escribe VERIFICACION_ENDPOINTS_EXISTENTES.txt y VERIFICACION_ENDPOINTS_NUEVOS.txt
 * Requiere servidor corriendo en BASE_URL (default http://localhost:3001)
 * Uso: node server/scripts/verificacion_endpoints_report.js
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'verificacion-2026-02-19');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function fetchOk(url) {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const existentes = [];
  const nuevos = [];

  // --- Endpoints EXISTENTES ---
  existentes.push('=== VERIFICACIÓN ENDPOINTS EXISTENTES (sin cambios) ===');
  existentes.push('Base URL: ' + BASE_URL);
  existentes.push('');

  const urlsExistentes = [
    ['GET /api/aforos/historial/171', BASE_URL + '/api/aforos/historial/171'],
    ['GET /api/aforos/nodos?fuente=DIM', BASE_URL + '/api/aforos/nodos?fuente=DIM'],
    ['GET /api/aforos/geocode/171', BASE_URL + '/api/aforos/geocode/171'],
    ['GET /api/datos-unificados/contexto-eventos', BASE_URL + '/api/datos-unificados/contexto-eventos'],
    ['GET /api/datos-unificados/obras', BASE_URL + '/api/datos-unificados/obras'],
    ['GET /api/datos-unificados/eventos', BASE_URL + '/api/datos-unificados/eventos'],
  ];

  for (const [name, url] of urlsExistentes) {
    try {
      const r = await fetchOk(url);
      const ok = r.ok ? 'OK' : 'FALLO';
      existentes.push(name + ' → Status ' + r.status + ' ' + ok);
      if (!r.ok) existentes.push('   Error: ' + (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)).slice(0, 200));
      if (r.body && typeof r.body === 'object') {
        if (r.body.nodes) existentes.push('   (nodos: ' + Object.keys(r.body.nodes).length + ')');
        if (r.body.features) existentes.push('   (features: ' + r.body.features.length + ')');
        if (Array.isArray(r.body)) existentes.push('   (array length: ' + r.body.length + ')');
      }
    } catch (e) {
      existentes.push(name + ' → ERROR: ' + e.message);
    }
    existentes.push('');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'VERIFICACION_ENDPOINTS_EXISTENTES.txt'), existentes.join('\n'), 'utf8');

  // --- Endpoints NUEVOS ---
  nuevos.push('=== VERIFICACIÓN ENDPOINTS NUEVOS (estudios-transito) ===');
  nuevos.push('Base URL: ' + BASE_URL);
  nuevos.push('');

  const urlsNuevos = [
    ['GET /api/estudios-transito/infraestructura?estudio_id=72', BASE_URL + '/api/estudios-transito/infraestructura?estudio_id=72', 'FeatureCollection', 'features'],
    ['GET /api/estudios-transito/proyecciones?estudio_id=66', BASE_URL + '/api/estudios-transito/proyecciones?estudio_id=66', 'proyecciones', 'proyecciones'],
    ['GET /api/estudios-transito/puntos-criticos?estudio_id=72', BASE_URL + '/api/estudios-transito/puntos-criticos?estudio_id=72', 'FeatureCollection', 'features'],
    ['GET /api/estudios-transito/vias?estudio_id=72', BASE_URL + '/api/estudios-transito/vias?estudio_id=72', 'FeatureCollection', 'features'],
  ];

  for (const [name, url, expectedKey, countKey] of urlsNuevos) {
    try {
      const r = await fetchOk(url);
      nuevos.push('Endpoint: ' + name);
      nuevos.push('Status HTTP: ' + r.status);
      const body = r.body;
      const count = body && body[countKey] ? body[countKey].length : (Array.isArray(body) ? body.length : '-');
      nuevos.push('Número de features/registros: ' + count);
      if (body && body[countKey] && body[countKey][0]) {
        nuevos.push('Ejemplo primera fila/feature: ' + JSON.stringify(body[countKey][0], null, 2).slice(0, 500) + '...');
      } else if (body && Array.isArray(body) && body[0]) {
        nuevos.push('Ejemplo: ' + JSON.stringify(body[0], null, 2).slice(0, 500) + '...');
      }
      nuevos.push('');
    } catch (e) {
      nuevos.push(name + ' → ERROR: ' + e.message);
      nuevos.push('');
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'VERIFICACION_ENDPOINTS_NUEVOS.txt'), nuevos.join('\n'), 'utf8');
  console.log('Escritos: VERIFICACION_ENDPOINTS_EXISTENTES.txt, VERIFICACION_ENDPOINTS_NUEVOS.txt');
}

main().catch(e => { console.error(e); process.exit(1); });
