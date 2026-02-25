/**
 * Script STANDALONE: genera snapshot local de eventos desde ArcGIS Agéndate Bogotá.
 * NO toca base de datos. Solo descarga datos y escribe public/data/agendate_eventos_snapshot.json.
 *
 * Uso (en entorno con acceso a ArcGIS):
 *   npm ci
 *   npm run export:agendate:arcgis:snapshot
 *
 * Luego copiar el archivo al entorno con red bloqueada y ejecutar:
 *   npm run ingest:agendate:arcgis:apply
 *   npm run ingest:eventos:incidentes -- --apply
 *   npm run verify:agendate:eventos
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

// Configuración ENV (sin BD)
const AGENDATE_BASE =
  process.env.AGENDATE_ARCGIS_BASE ??
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer';
const AGENDATE_LUGARES_LAYER_ID = Number(process.env.AGENDATE_LUGARES_LAYER_ID ?? 4);
const AGENDATE_EVENTOS_RELATION_ID = Number(process.env.AGENDATE_EVENTOS_RELATION_ID ?? 0);
const AGENDATE_DIAS_FUTURO = Number(process.env.AGENDATE_DIAS_FUTURO ?? 60);
const AGENDATE_TIMEOUT_MS = Number(process.env.AGENDATE_TIMEOUT_MS ?? 15000);
const AGENDATE_BATCH_SIZE = Number(process.env.AGENDATE_BATCH_SIZE ?? 100);
const DURACION_DEFAULT_HORAS = 3;

const SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_snapshot.json');

/** fetch con timeout; lanza si falla. */
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(AGENDATE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

/**
 * Paso A — Descargar LUGARES (layer 4).
 * Paginación hasta que no haya más. Map: GLOBALID → { objectId, lugar_nombre, lon, lat }.
 */
async function downloadLugares() {
  const baseUrl = `${AGENDATE_BASE}/${AGENDATE_LUGARES_LAYER_ID}/query`;
  const lugaresByGlobalId = new Map();
  let resultOffset = 0;
  const resultRecordCount = 1000;

  while (true) {
    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      outFields: 'OBJECTID,GLOBALID,EVNLUGAR',
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(resultOffset),
      resultRecordCount: String(resultRecordCount),
    });
    const data = await fetchJson(`${baseUrl}?${params.toString()}`);
    const features = data?.features ?? [];
    if (features.length === 0) break;

    for (const f of features) {
      const attrs = f.attributes ?? {};
      const geom = f.geometry;
      const objectId = attrs.OBJECTID;
      const globalId = (attrs.GLOBALID ?? '').toString().trim();
      const lugar_nombre = (attrs.EVNLUGAR ?? '').toString().trim();
      const x = geom?.x;
      const y = geom?.y;
      if (globalId && objectId != null && x != null && y != null) {
        lugaresByGlobalId.set(globalId, {
          objectId,
          globalId,
          lugar_nombre: lugar_nombre || 'Sin nombre',
          lon: Number(x),
          lat: Number(y),
        });
      }
    }
    resultOffset += features.length;
    if (features.length < resultRecordCount) break;
  }

  return lugaresByGlobalId;
}

/**
 * Paso B — Descargar EVENTOS relacionados (queryRelatedRecords).
 * objectIds en lotes de AGENDATE_BATCH_SIZE.
 */
async function downloadEventosRelacionados(lugaresByGlobalId) {
  const objectIds = [...new Set([...lugaresByGlobalId.values()].map((l) => l.objectId))];
  const allGroups = [];

  for (let i = 0; i < objectIds.length; i += AGENDATE_BATCH_SIZE) {
    const batch = objectIds.slice(i, i + AGENDATE_BATCH_SIZE);
    const baseUrl = `${AGENDATE_BASE}/${AGENDATE_LUGARES_LAYER_ID}/queryRelatedRecords`;
    const params = new URLSearchParams({
      f: 'json',
      objectIds: batch.join(','),
      relationshipId: String(AGENDATE_EVENTOS_RELATION_ID),
      outFields: '*',
    });
    const data = await fetchJson(`${baseUrl}?${params.toString()}`);
    const groups = data?.relatedRecordGroups ?? [];
    allGroups.push(...groups);
  }

  return allGroups;
}

/** Ventana: EVDINICIAL entre now y now + AGENDATE_DIAS_FUTURO. */
function inVentana(epochMs) {
  if (epochMs == null || Number.isNaN(Number(epochMs))) return false;
  const now = Date.now();
  const end = now + AGENDATE_DIAS_FUTURO * 24 * 60 * 60 * 1000;
  const t = Number(epochMs);
  return t >= now && t <= end;
}

/**
 * Normalizar: para cada evento válido (lugar en Map, EVDINICIAL en ventana) construir
 * { titulo, fecha_inicio, fecha_fin, lugar_nombre, lon, lat, origen_id, raw }.
 */
function normalizarEventos(lugaresByGlobalId, relatedRecordGroups) {
  const tresHorasMs = DURACION_DEFAULT_HORAS * 60 * 60 * 1000;
  const events = [];
  const lugarByObjectId = new Map([...lugaresByGlobalId.values()].map((l) => [l.objectId, l]));

  for (const group of relatedRecordGroups) {
    const lugar = lugarByObjectId.get(group.objectId);
    if (!lugar) continue;

    for (const rec of group.relatedRecords ?? []) {
      const attrs = rec.attributes ?? {};
      const evnombre = (attrs.EVNEVENTO ?? '').toString().trim() || 'Evento sin nombre';
      const evdinicial = attrs.EVDINICIAL;
      if (!inVentana(evdinicial)) continue;

      const fecha_inicio = new Date(evdinicial).toISOString();
      const evdfinal = attrs.EVDFINAL;
      const fecha_fin = evdfinal
        ? new Date(evdfinal).toISOString()
        : new Date(Number(evdinicial) + tresHorasMs).toISOString();

      const origen_id = crypto
        .createHash('sha256')
        .update((lugar.globalId ?? lugar.objectId) + '|' + fecha_inicio + '|' + evnombre)
        .digest('hex')
        .slice(0, 32);

      events.push({
        titulo: evnombre,
        fecha_inicio,
        fecha_fin,
        lugar_nombre: lugar.lugar_nombre,
        lon: lugar.lon,
        lat: lugar.lat,
        origen_id,
        raw: attrs,
      });
    }
  }

  return events;
}

async function main() {
  console.log('[export-agendate-arcgis] Standalone: solo descarga + JSON. No toca BD.\n');
  console.log('[export-agendate-arcgis] Config:', {
    AGENDATE_BASE,
    AGENDATE_LUGARES_LAYER_ID,
    AGENDATE_EVENTOS_RELATION_ID,
    AGENDATE_DIAS_FUTURO,
    AGENDATE_TIMEOUT_MS,
    AGENDATE_BATCH_SIZE,
  });

  let lugaresByGlobalId;
  try {
    console.log('[export-agendate-arcgis] Paso A — Descargando lugares...');
    lugaresByGlobalId = await downloadLugares();
  } catch (err) {
    console.error('[export-agendate-arcgis] Error descargando lugares:', err.message);
    process.exit(1);
  }

  const total_lugares = lugaresByGlobalId.size;
  console.log('[export-agendate-arcgis] total_lugares:', total_lugares);

  let relatedRecordGroups;
  try {
    console.log('[export-agendate-arcgis] Paso B — Descargando eventos relacionados...');
    relatedRecordGroups = await downloadEventosRelacionados(lugaresByGlobalId);
  } catch (err) {
    console.error('[export-agendate-arcgis] Error descargando eventos. Abortando.', err.message);
    process.exit(1);
  }

  const total_eventos_raw = relatedRecordGroups.reduce(
    (s, g) => s + (g.relatedRecords?.length ?? 0),
    0
  );
  console.log('[export-agendate-arcgis] total_eventos_raw:', total_eventos_raw);

  const events = normalizarEventos(lugaresByGlobalId, relatedRecordGroups);
  const eventos_filtrados_por_ventana = events.length;
  const eventos_exportados = events.length;

  console.log('\n--- Resumen ---');
  console.log('  total_lugares:', total_lugares);
  console.log('  total_eventos_raw:', total_eventos_raw);
  console.log('  eventos_filtrados_por_ventana:', eventos_filtrados_por_ventana);
  console.log('  eventos_exportados:', eventos_exportados);

  if (events.length === 0) {
    console.warn('\n[export-agendate-arcgis] Advertencia: total events = 0. Se escribirá el archivo con events: [].');
  }

  const snapshot = {
    source: 'AGENDATE_ARCGIS_SNAPSHOT',
    exportedAt: new Date().toISOString(),
    window_dias: AGENDATE_DIAS_FUTURO,
    events,
  };

  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('\n[export-agendate-arcgis] Escrito:', SNAPSHOT_PATH);
}

main().catch((err) => {
  console.error('[export-agendate-arcgis]', err.message);
  process.exit(1);
});
