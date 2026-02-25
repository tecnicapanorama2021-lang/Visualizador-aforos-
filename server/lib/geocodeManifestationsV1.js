/**
 * Geocodificación v1 para manifestaciones (heurística por diccionario de corredores/lugares).
 * Sin servicios externos pagos. Uso: geocodeFromText(text) -> { geom, centroid, confidence, method, matched, buffer_m, debug } | null
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_PATH = path.join(__dirname, '..', 'data', 'corredores_bogota.json');

/** Normaliza texto: minúsculas, sin tildes. */
function normalizeText(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

let cachedDict = null;

function loadDictionary() {
  if (cachedDict) return cachedDict;
  try {
    const raw = fs.readFileSync(DICT_PATH, 'utf8');
    cachedDict = JSON.parse(raw);
    return cachedDict;
  } catch (err) {
    console.warn('[geocodeManifestationsV1] No se pudo cargar', DICT_PATH, err.message);
    return [];
  }
}

/**
 * Geocodifica texto (título + descripción + evidencia) usando diccionario de corredores/lugares.
 * @param {string} text - Texto a analizar
 * @returns {{ geom: object, centroid: object, confidence: number, method: string, matched: string, buffer_m: number, debug: object } | null}
 */
export function geocodeFromText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const dict = loadDictionary();
  if (!Array.isArray(dict) || dict.length === 0) return null;

  for (const entry of dict) {
    const pattern = entry.pattern;
    if (!pattern) continue;
    let re;
    try {
      re = new RegExp(pattern, 'i');
    } catch (_) {
      if (normalized.includes(normalizeText(pattern))) re = { test: () => true };
      else continue;
    }
    if (!re.test(normalized)) continue;

    const lng = Number(entry.lng);
    const lat = Number(entry.lat);
    const bufferM = Number(entry.buffer_m) || 300;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const point = turf.point([lng, lat]);
    const bufferKm = bufferM / 1000;
    const polygon = turf.buffer(point, bufferKm, { units: 'kilometers' });
    const centroid = turf.centroid(polygon);

    return {
      geom: polygon.geometry,
      centroid: centroid.geometry,
      confidence: 60,
      method: 'DICT_V1',
      matched: entry.id || entry.pattern,
      buffer_m: bufferM,
      debug: { pattern: entry.pattern, lng, lat },
    };
  }

  return null;
}

export default geocodeFromText;
