/**
 * Genera agendate_eventos_snapshot.json desde lugares (layer 4) + eventos relacionados (queryRelatedRecords).
 * Join REAL por OBJECTID. Sin EVLOC ni contains.
 *
 * Uso: node server/scripts/import/build_snapshot_from_related_records.js [--dry|--apply]
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const LUGARES_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_lugares_layer4.json');
const RELATED_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_relacionados.json');
const SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_snapshot.json');

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

function getAttr(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function parseEpoch(val) {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Construye Map OBJECTID -> { titulo, lon, lat } y Map GLOBALID -> { titulo, lon, lat } desde features del layer 4. */
function parseLugares(data) {
  const byObjectId = new Map();
  const byGlobalId = new Map();
  const features = data?.features ?? data?.results ?? (Array.isArray(data) ? data : []);
  for (const f of features) {
    const attrs = f?.attributes ?? f?.properties ?? f;
    const geom = f?.geometry ?? {};
    const objectId = attrs?.OBJECTID ?? attrs?.objectid ?? attrs?.ObjectID;
    const globalId = (attrs?.GLOBALID ?? attrs?.GlobalID ?? attrs?.globalid ?? '').toString().trim();
    const titulo = (attrs?.EVNLUGAR ?? attrs?.evnlugar ?? attrs?.name ?? '').toString().trim() || null;
    let lon = geom?.x ?? geom?.lon ?? (Array.isArray(geom?.coordinates) ? geom.coordinates[0] : null);
    let lat = geom?.y ?? geom?.lat ?? (Array.isArray(geom?.coordinates) ? geom.coordinates[1] : null);
    if (lon != null && lat != null) {
      lon = Number(lon);
      lat = Number(lat);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        const place = { titulo, lon, lat };
        if (objectId != null) byObjectId.set(Number(objectId), place);
        if (globalId) byGlobalId.set(globalId, place);
      }
    }
  }
  return { byObjectId, byGlobalId };
}

/** Extrae relatedRecordGroups del JSON de queryRelatedRecords. */
function getRelatedGroups(data) {
  return data?.relatedRecordGroups ?? (Array.isArray(data) ? data : []);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dry = process.argv.includes('--dry') || !apply;

  let lugaresData;
  let relatedData;
  try {
    lugaresData = JSON.parse(await fs.readFile(LUGARES_PATH, 'utf8'));
  } catch (e) {
    console.error('[build-snapshot-related] No se pudo leer lugares:', LUGARES_PATH, e.code === 'ENOENT' ? '(no existe)' : e.message);
    process.exit(1);
  }
  try {
    relatedData = JSON.parse(await fs.readFile(RELATED_PATH, 'utf8'));
  } catch (e) {
    console.error('[build-snapshot-related] No se pudo leer eventos relacionados:', RELATED_PATH, e.code === 'ENOENT' ? '(no existe)' : e.message);
    process.exit(1);
  }

  const { byObjectId, byGlobalId } = parseLugares(lugaresData);
  const groups = getRelatedGroups(relatedData);
  const featuresEventos = relatedData?.features ?? [];

  let total_eventos_raw = 0;
  let eventos_sin_fecha = 0;
  let eventos_sin_lugar = 0;
  const events = [];

  if (groups.length > 0) {
    for (const group of groups) {
      const objectId = group?.objectId ?? group?.objectID ?? group?.ObjectID;
      const records = group?.relatedRecords ?? group?.records ?? [];
      const place = objectId != null ? byObjectId.get(Number(objectId)) : null;

      for (const rec of records) {
        total_eventos_raw++;
        const attrs = rec?.attributes ?? rec?.properties ?? rec ?? {};
        const titulo = (getAttr(attrs, ['EVNEVENTO', 'evnevento', 'nombre']) ?? '').toString().trim() || 'Evento sin nombre';
        const startMs = getAttr(attrs, ['EVDINICIAL', 'evdinicial', 'fecha_inicio']);
        const startDate = parseEpoch(startMs);
        if (!startDate) {
          eventos_sin_fecha++;
          continue;
        }
        const fecha_inicio = startDate.toISOString();
        const endMs = getAttr(attrs, ['EVDFINAL', 'evdfinal', 'fecha_fin']);
        let fecha_fin = null;
        if (endMs != null) {
          const endDate = parseEpoch(endMs);
          if (endDate) fecha_fin = endDate.toISOString();
        }
        if (!fecha_fin) {
          const endDate = new Date(startDate.getTime() + THREE_HOURS_MS);
          fecha_fin = endDate.toISOString();
        }

        if (!place || place.lon == null || place.lat == null) {
          eventos_sin_lugar++;
          continue;
        }

        const origen_id = crypto
          .createHash('sha256')
          .update(String(objectId) + '|' + fecha_inicio + '|' + titulo)
          .digest('hex')
          .slice(0, 32);

        events.push({
          origen_id,
          titulo,
          fecha_inicio,
          fecha_fin,
          lugar_nombre: place.titulo ?? null,
          lon: place.lon,
          lat: place.lat,
          raw: attrs,
        });
      }
    }
    console.log('[build-snapshot-related] modo: queryRelatedRecords | total_grupos:', groups.length);
  } else if (featuresEventos.length > 0 && byGlobalId.size > 0) {
    console.log('[build-snapshot-related] modo: tabla7 + lugares (join GUID_2 = GLOBALID)');
    for (const f of featuresEventos) {
      const attrs = f?.attributes ?? f?.properties ?? f ?? {};
      total_eventos_raw++;
      const guid2 = (getAttr(attrs, ['GUID_2', 'guid_2', 'GLOBALID']) ?? '').toString().trim();
      const place = guid2 ? byGlobalId.get(guid2) : null;
      const titulo = (getAttr(attrs, ['EVNEVENTO', 'evnevento', 'nombre']) ?? '').toString().trim() || 'Evento sin nombre';
      const startMs = getAttr(attrs, ['EVDINICIAL', 'evdinicial', 'fecha_inicio']);
      const startDate = parseEpoch(startMs);
      if (!startDate) {
        eventos_sin_fecha++;
        continue;
      }
      const fecha_inicio = startDate.toISOString();
      const endMs = getAttr(attrs, ['EVDFINAL', 'evdfinal', 'fecha_fin']);
      let fecha_fin = null;
      if (endMs != null) {
        const endDate = parseEpoch(endMs);
        if (endDate) fecha_fin = endDate.toISOString();
      }
      if (!fecha_fin) {
        fecha_fin = new Date(startDate.getTime() + THREE_HOURS_MS).toISOString();
      }
      if (!place || place.lon == null || place.lat == null) {
        eventos_sin_lugar++;
        continue;
      }
      const origen_id = crypto
        .createHash('sha256')
        .update(guid2 + '|' + fecha_inicio + '|' + titulo)
        .digest('hex')
        .slice(0, 32);
      events.push({
        origen_id,
        titulo,
        fecha_inicio,
        fecha_fin,
        lugar_nombre: place.titulo ?? null,
        lon: place.lon,
        lat: place.lat,
        raw: attrs,
      });
    }
  } else {
    if (featuresEventos.length > 0) {
      console.error('[build-snapshot-related] Eventos en formato tabla 7 (features) pero lugares sin GLOBALID o sin geometría.');
    } else {
      console.error('[build-snapshot-related] No se encontró relatedRecordGroups ni features en el archivo de eventos.');
    }
    process.exit(1);
  }

  const snapshot = {
    source: 'AGENDATE_ARCGIS_MANUAL_RELATED',
    exportedAt: new Date().toISOString(),
    events,
  };

  console.log('[build-snapshot-related] total_eventos_raw:', total_eventos_raw);
  console.log('[build-snapshot-related] eventos_exportados:', events.length);
  console.log('[build-snapshot-related] eventos_sin_fecha:', eventos_sin_fecha);
  console.log('[build-snapshot-related] eventos_sin_lugar:', eventos_sin_lugar);

  if (dry) {
    console.log('[build-snapshot-related] --dry: no se escribió snapshot.');
    return;
  }

  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('[build-snapshot-related] Escrito:', SNAPSHOT_PATH);
}

main().catch((err) => {
  console.error('[build-snapshot-related]', err);
  process.exit(1);
});
