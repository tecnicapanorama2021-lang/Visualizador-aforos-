/**
 * Helper: KMZ desde URL, archivo o buffer. Extrae KML y parsea Placemarks.
 * Emite lista normalizada: origen_id, title, description, start_at?, end_at?, geom, raw.
 * SRID 4326 (WGS84); raw = objeto Placemark completo.
 */

import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Descarga buffer desde URL con timeout (solo host:port en logs, sin tokens).
 * @param {string} url
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<Buffer>}
 */
async function fetchWithTimeout(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

/**
 * Extrae el primer archivo .kml del buffer KMZ (zip).
 * @param {Buffer} kmzBuffer
 * @returns {string} contenido KML como string
 */
export function extractKmlFromKmz(kmzBuffer) {
  const zip = new AdmZip(kmzBuffer);
  const entries = zip.getEntries();
  const kmlEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('KMZ no contiene archivo .kml');
  return kmlEntry.getData().toString('utf8');
}

/**
 * Parsea coordenadas KML (lon,lat[,alt] o lon lat alt separados por espacio/coma).
 * @param {string} str
 * @returns {{ lon: number, lat: number } | null}
 */
function parseCoordinates(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(/[\s,]+/).filter(Boolean);
  const lon = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (Number.isNaN(lon) || Number.isNaN(lat)) return null;
  return { lon, lat };
}

/**
 * Extrae coordenadas de un Point o centroid de Polygon/LinearRing.
 * @param {object} node - nodo Point o Polygon
 * @returns {{ lon: number, lat: number } | null}
 */
function coordsFromGeometry(node) {
  if (!node) return null;
  if (node.Point && node.Point.coordinates) {
    return parseCoordinates(node.Point.coordinates);
  }
  if (node.Polygon && node.Polygon.outerBoundaryIs) {
    const ring = node.Polygon.outerBoundaryIs.LinearRing || node.Polygon.outerBoundaryIs;
    const coordStr = ring.coordinates || (typeof ring === 'string' ? ring : null);
    if (coordStr) {
      const parts = coordStr.trim().split(/[\s,]+/).filter(Boolean);
      let sumLon = 0, sumLat = 0, n = 0;
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const lon = parseFloat(parts[i]), lat = parseFloat(parts[i + 1]);
        if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
          sumLon += lon;
          sumLat += lat;
          n++;
        }
      }
      if (n) return { lon: sumLon / n, lat: sumLat / n };
    }
  }
  if (node.MultiGeometry) {
    const g = node.MultiGeometry.Polygon || node.MultiGeometry.Point;
    const first = Array.isArray(g) ? g[0] : g;
    return coordsFromGeometry(first ? { Point: first.Point, Polygon: first.Polygon } : null);
  }
  return null;
}

/**
 * Recorre recursivamente el árbol y recoge todos los Placemark.
 * @param {object} obj
 * @param {object[]} out
 */
function collectPlacemarks(obj, out) {
  if (!obj) return;
  if (obj.Placemark) {
    const list = Array.isArray(obj.Placemark) ? obj.Placemark : [obj.Placemark];
    list.forEach((p) => out.push(p));
  }
  if (obj.Folder) {
    const folders = Array.isArray(obj.Folder) ? obj.Folder : [obj.Folder];
    folders.forEach((f) => collectPlacemarks(f, out));
  }
  if (obj.Document) {
    const docs = Array.isArray(obj.Document) ? obj.Document : [obj.Document];
    docs.forEach((d) => collectPlacemarks(d, out));
  }
}

/**
 * Texto plano desde nodo (puede ser string o objeto con #text).
 */
function textOf(node) {
  if (node == null) return null;
  if (typeof node === 'string') return node.trim() || null;
  if (node['#text']) return String(node['#text']).trim() || null;
  return null;
}

/** Strip HTML básico para description. */
function stripHtml(html) {
  if (html == null || typeof html !== 'string') return null;
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/** Valor de ExtendedData por nombre (Data @_name o name). */
function extendedDataValue(ext, nameKey) {
  const dataList = ext.Data ? (Array.isArray(ext.Data) ? ext.Data : [ext.Data]) : [];
  const d = dataList.find((x) => x && (x['@_name'] === nameKey || x.name === nameKey));
  if (!d) return null;
  const v = d.value ?? d['#text'];
  return v != null ? String(v).trim() : null;
}

/** start_at/end_at desde TimeSpan, TimeStamp o ExtendedData. */
function parseTimeFields(pm) {
  let start_at = null;
  let end_at = null;
  const ext = pm.ExtendedData || {};
  if (pm.TimeSpan) {
    const ts = pm.TimeSpan;
    start_at = textOf(ts.begin) ?? extendedDataValue(ext, 'begin');
    end_at = textOf(ts.end) ?? extendedDataValue(ext, 'end');
  }
  if (pm.TimeStamp && !start_at) start_at = textOf(pm.TimeStamp);
  if (!start_at) start_at = extendedDataValue(ext, 'fecha_inicio') ?? extendedDataValue(ext, 'start');
  if (!end_at) end_at = extendedDataValue(ext, 'fecha_fin') ?? extendedDataValue(ext, 'end');
  return { start_at: start_at || null, end_at: end_at || null };
}

/**
 * Parsea KML string y devuelve lista normalizada de lugares.
 * origen_id: ExtendedData.GLOBALID si existe; si no: sha256(title+lat+lon).slice(0,32).
 */
export function parseKmlPlacemarks(kmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: true,
    trimValues: true,
  });
  const parsed = parser.parse(kmlString);
  const kml = parsed?.kml;
  if (!kml) return [];

  const placemarks = [];
  collectPlacemarks(kml, placemarks);

  const result = [];
  for (const pm of placemarks) {
    const name = textOf(pm.name) || textOf(pm.Name);
    const descRaw = textOf(pm.description) || textOf(pm.Description);
    const description = stripHtml(descRaw) || (descRaw ? descRaw.slice(0, 5000) : null);
    const ext = pm.ExtendedData || {};
    const coord = coordsFromGeometry(pm);
    const geom = coord
      ? { type: 'Point', coordinates: [coord.lon, coord.lat] }
      : null;
    const { start_at, end_at } = parseTimeFields(pm);
    const dataList = ext.Data ? (Array.isArray(ext.Data) ? ext.Data : [ext.Data]) : [];
    const globalId = dataList.find((d) => d && (d['@_name'] === 'GLOBALID' || d.name === 'GLOBALID'));
    const idVal = globalId && (globalId.value ?? globalId['#text']);
    const idFromExt = idVal != null ? String(idVal).trim() : null;
    const idAlt = dataList.find((d) => d && (d['@_name'] === 'id' || d.name === 'id'));
    const idAltVal = idAlt && (idAlt.value ?? idAlt['#text']);
    const idAltStr = idAltVal ? String(idAltVal).trim() : null;
    const origenId =
      (idFromExt && idFromExt.length > 0 ? idFromExt : null) ||
      (idAltStr && idAltStr.length > 0 ? idAltStr : null) ||
      (name && coord ? crypto.createHash('sha256').update(`${name}|${coord.lon},${coord.lat}`).digest('hex').slice(0, 32) : null) ||
      crypto.createHash('sha256').update(JSON.stringify(pm)).digest('hex').slice(0, 32);
    result.push({
      origen_id: String(origenId).slice(0, 255),
      title: name || null,
      description,
      start_at,
      end_at,
      geom,
      raw: pm,
    });
  }
  return result;
}

/**
 * Lee KMZ desde buffer (zip), extrae KML y parsea Placemarks.
 * @param {Buffer} buffer
 * @returns {Promise<Array<{ origen_id, title, description, start_at, end_at, geom, raw }>>}
 */
export async function readKmzFromBuffer(buffer) {
  const kml = extractKmlFromKmz(buffer);
  return parseKmlPlacemarks(kml);
}

/**
 * Lee KMZ desde archivo en disco (sin red).
 * @param {string} filepath - ruta absoluta o relativa al .kmz
 * @returns {Promise<Array<{ origen_id, title, description, start_at, end_at, geom, raw }>>}
 */
export async function readKmzFromFile(filepath) {
  const buffer = await fs.readFile(filepath);
  return readKmzFromBuffer(buffer);
}

/**
 * Descarga KMZ desde URL y parsea (usa fetch + readKmzFromBuffer).
 * @param {string} url
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<Array<{ origen_id, title, description, start_at, end_at, geom, raw }>>}
 */
export async function readKmzFromUrl(url, opts = {}) {
  const buffer = await fetchWithTimeout(url, opts);
  return readKmzFromBuffer(buffer);
}
