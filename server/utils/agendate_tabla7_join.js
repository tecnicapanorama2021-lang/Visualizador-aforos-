/**
 * Descubrimiento de join evento (tabla 7 raw) ↔ LUGAR_EVENTO (BD).
 * Sin red. Usado por diagnose y por ingest.
 */

import { normalizeVenueName } from './venue_matcher.js';

/** Todos los candidatos nombre (para listar en diagnóstico). EVLOC/EVDIRECCIO son localidad/dirección, no venue. */
export const CANDIDATE_NAME_KEYS = [
  'EVNLUGAR', 'evnlugar', 'LUGAR', 'lugar', 'NOMBRE_LUGAR', 'ESCENARIO', 'EQUIPAMIENTO',
  'EVDIRECCIO', 'evdireccio', 'DIRECCION', 'ADDRESS', 'EVLOC',
];

/** Solo candidatos válidos para match de GEOM (nombre de venue/escenario). PROHIBIDO: EVLOC (localidad), EVDIRECCIO (dirección). */
export const CANDIDATE_NAME_KEYS_FOR_GEOM = [
  'EVNLUGAR', 'evnlugar', 'LUGAR', 'lugar', 'NOMBRE_LUGAR', 'ESCENARIO', 'EQUIPAMIENTO',
];

/** Keys consideradas localidad/barrio: no se usan para asignar geom. */
export const FORBIDDEN_KEYS_FOR_GEOM = new Set(['EVLOC', 'evloc', 'EVDIRECCIO', 'evdireccio', 'DIRECCION', 'ADDRESS']);

export const CANDIDATE_KEY_KEYS = [
  'GLOBALID', 'GlobalID', 'globalid', 'GUID_2', 'guid_2', 'GUID', 'guid',
  'OBJECTID', 'objectid', 'ID_LUGAR', 'OBJECTID_LUGAR', 'ORIGEN_ID',
];

const GENERIC_WORDS = new Set([
  'teatro', 'auditorio', 'parque', 'centro', 'sala', 'coliseo', 'arena', 'plaza', 'biblioteca', 'museo', 'cultural',
]);

export function extractRecords(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.features && Array.isArray(raw.features)) return raw.features;
  if (raw?.records && Array.isArray(raw.records)) return raw.records;
  if (raw?.results && Array.isArray(raw.results)) return raw.results;
  return [];
}

export function getAttrs(item) {
  if (item?.attributes && typeof item.attributes === 'object') return item.attributes;
  if (typeof item === 'object' && item !== null) return item;
  return {};
}

export function normalizeForMatch(str) {
  if (typeof str !== 'string') return '';
  let s = normalizeVenueName(str);
  const words = s.split(' ').filter((w) => w.length > 0 && !GENERIC_WORDS.has(w));
  return words.join(' ');
}

/** Obtiene valor de attrs probando varias keys (case-sensitive primero). */
export function getVal(attrs, keys) {
  if (!attrs || typeof attrs !== 'object') return null;
  const kk = Array.isArray(keys) ? keys : [keys];
  for (const k of kk) {
    if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '') return attrs[k];
  }
  return null;
}

/** Keys presentes en la muestra de eventos (raw attributes). */
export function detectEventKeys(sampleAttrs) {
  const allKeys = new Set();
  for (const attrs of sampleAttrs) {
    Object.keys(attrs || {}).forEach((k) => allKeys.add(k));
  }
  return Array.from(allKeys);
}

/** Keys presentes en datos_extra de lugares. */
export function detectPlaceMetaKeys(places) {
  const allKeys = new Set();
  for (const p of places) {
    const d = p.datos_extra || p.metadata;
    if (d && typeof d === 'object') Object.keys(d).forEach((k) => allKeys.add(k));
  }
  return Array.from(allKeys);
}

export function getPlaceKeyValue(d, placeKey) {
  if (!d || typeof d !== 'object') return null;
  const v = d[placeKey] ?? d[placeKey?.toLowerCase()] ?? d[placeKey?.toUpperCase()];
  return v != null && v !== '' ? String(v).trim() : null;
}

/** Estrategia A: match por key. event[eventKey] == place.datos_extra[placeKey]. */
export function tryKeyMatch(eventsAttrs, places, eventKey, placeKey) {
  const placeByKey = new Map();
  for (const p of places) {
    const d = p.datos_extra || p.metadata;
    const v = getPlaceKeyValue(d, placeKey);
    if (v) placeByKey.set(v, p);
  }
  let matched = 0;
  for (const attrs of eventsAttrs) {
    const v = attrs[eventKey];
    if (v != null && v !== '' && placeByKey.has(String(v).trim())) matched++;
  }
  return eventsAttrs.length ? (matched / eventsAttrs.length) * 100 : 0;
}

/** Estrategia B: match por nombre normalizado exacto. */
export function tryNameMatch(eventsAttrs, places, nameKey) {
  const placeByNorm = new Map();
  for (const p of places) {
    const t = (p.titulo || p.descripcion || '').toString().trim();
    if (!t) continue;
    const norm = normalizeForMatch(t);
    if (norm && !placeByNorm.has(norm)) placeByNorm.set(norm, p);
  }
  let matched = 0;
  for (const attrs of eventsAttrs) {
    const name = (getVal(attrs, [nameKey]) ?? '').toString().trim();
    if (!name) continue;
    const norm = normalizeForMatch(name);
    if (norm && placeByNorm.has(norm)) matched++;
  }
  return eventsAttrs.length ? (matched / eventsAttrs.length) * 100 : 0;
}

/** Estrategia C: lugar.titulo contiene token principal del nombre del evento. */
export function tryContainsMatch(eventsAttrs, places, nameKey) {
  let matched = 0;
  for (const attrs of eventsAttrs) {
    const name = (getVal(attrs, [nameKey]) ?? '').toString().trim();
    if (!name) continue;
    const norm = normalizeForMatch(name);
    const tokens = norm.split(' ').filter((w) => w.length > 1);
    const mainToken = tokens[0] || norm;
    if (!mainToken) continue;
    const found = places.some((p) => {
      const t = (p.titulo || p.descripcion || '').toString();
      const tNorm = normalizeForMatch(t);
      return tNorm.includes(mainToken) || mainToken.length >= 3 && tNorm.includes(mainToken.slice(0, 4));
    });
    if (found) matched++;
  }
  return eventsAttrs.length ? (matched / eventsAttrs.length) * 100 : 0;
}

/**
 * Ejecuta diagnóstico: prueba estrategias y devuelve ganadora y porcentajes.
 * @param {object[]} eventsAttrs - Array de attributes (del raw)
 * @param {object[]} places - { id, titulo, datos_extra }
 * @returns {{ strategy: 'key'|'name'|'contains'|null, keyEventField: string|null, keyPlaceField: string|null, nameField: string|null, matchRates: { key: number, name: number, contains: number }, details: object }}
 */
export function runJoinDiagnosis(eventsAttrs, places) {
  const eventKeys = detectEventKeys(eventsAttrs);
  const placeMetaKeys = detectPlaceMetaKeys(places);
  const details = { eventKeys, placeMetaKeys, tries: [] };

  let bestKey = { rate: 0, eventKey: null, placeKey: null };
  for (const ek of CANDIDATE_KEY_KEYS) {
    if (!eventKeys.includes(ek)) continue;
    for (const pk of ['GLOBALID', 'GlobalID', 'GUID_2', 'guid_2', 'OBJECTID', 'objectid', ...placeMetaKeys]) {
      const rate = tryKeyMatch(eventsAttrs, places, ek, pk);
      details.tries.push({ strategy: 'key', eventKey: ek, placeKey: pk, rate });
      if (rate > bestKey.rate) bestKey = { rate, eventKey: ek, placeKey: pk };
    }
  }

  let bestName = { rate: 0, nameKey: null };
  for (const nk of CANDIDATE_NAME_KEYS_FOR_GEOM) {
    if (!eventKeys.includes(nk)) continue;
    const rate = tryNameMatch(eventsAttrs, places, nk);
    details.tries.push({ strategy: 'name', nameKey: nk, rate });
    if (rate > bestName.rate) bestName = { rate, nameKey: nk };
  }

  let bestContains = { rate: 0, nameKey: null };
  for (const nk of CANDIDATE_NAME_KEYS) {
    if (!eventKeys.includes(nk)) continue;
    const rate = tryContainsMatch(eventsAttrs, places, nk);
    details.tries.push({ strategy: 'contains', nameKey: nk, rate });
    if (rate > bestContains.rate) bestContains = { rate, nameKey: nk };
  }

  const keyRate = bestKey.rate;
  const nameRate = bestName.rate;
  const containsRate = bestContains.rate;
  const matchRates = { key: keyRate, name: nameRate, contains: containsRate };

  let strategy = null;
  let keyEventField = null;
  let keyPlaceField = null;
  let nameField = null;
  let join_quality = 'OK';

  if (keyRate >= 30 && keyRate >= nameRate && keyRate >= containsRate) {
    strategy = 'key';
    keyEventField = bestKey.eventKey;
    keyPlaceField = bestKey.placeKey;
  } else if (nameRate >= 30 && nameRate >= keyRate && nameRate >= containsRate) {
    strategy = 'name';
    nameField = bestName.nameKey;
  } else if (containsRate >= 30 && containsRate >= keyRate && containsRate >= nameRate) {
    const containsNameKey = bestContains.nameKey;
    if (FORBIDDEN_KEYS_FOR_GEOM.has(containsNameKey)) {
      join_quality = 'INVALID_LOCALIDAD';
      strategy = null;
      nameField = null;
    } else {
      strategy = 'contains';
      nameField = containsNameKey;
    }
  }

  if (join_quality === 'INVALID_LOCALIDAD' || (strategy === 'contains' && nameField && FORBIDDEN_KEYS_FOR_GEOM.has(nameField))) {
    join_quality = 'INVALID_LOCALIDAD';
    strategy = null;
    keyEventField = null;
    keyPlaceField = null;
    nameField = null;
  }

  return {
    strategy,
    keyEventField,
    keyPlaceField,
    nameField,
    matchRates,
    details,
    bestKey: keyRate,
    bestName: nameRate,
    bestContains: containsRate,
    join_quality: join_quality,
  };
}
