/**
 * Dominios ArcGIS (coded values) desde MapServer layer metadata.
 * Cache 24h en memoria. Uso: GET /api/arcgis/domains y enriquecimiento de /api/obras/:id/detail.
 */

const DEFAULT_OBRAS_MAPSERVER_URL =
  process.env.ARCGIS_BASE_URL ||
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer';

const TTL_MS = 24 * 60 * 60 * 1000;

const cache = {
  data: null,
  fetchedAt: 0,
  key: null,
};

async function fetchLayerJson(baseUrl, layerId) {
  const url = `${baseUrl.replace(/\/$/, '')}/${layerId}?f=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ArcGIS layer ${res.status}`);
  return res.json();
}

/**
 * Extrae dominios tipo coded-value de la respuesta JSON de un layer.
 * @param {object} layerJson - Respuesta de MapServer/{layerId}?f=json
 * @returns {{ [fieldName: string]: { [code: string]: string } }}
 */
function extractDomainsFromLayer(layerJson) {
  const out = {};
  const fields = layerJson?.fields || layerJson?.fieldDefinitions || [];
  for (const f of fields) {
    const name = f.name;
    const domain = f.domain;
    if (!name || !domain || domain.type !== 'coded-value') continue;
    const codedValues = domain.codedValues || [];
    const map = {};
    for (const cv of codedValues) {
      const code = cv.code != null ? String(cv.code) : '';
      const label = cv.name != null ? String(cv.name).trim() : code;
      map[code] = label;
    }
    if (Object.keys(map).length > 0) out[name] = map;
  }
  return out;
}

/**
 * Obtiene dominios para un servicio y layer; usa cache 24h.
 * @param {string} [serviceUrl] - Base URL del MapServer (default Obras Distritales)
 * @param {number} [layerId] - Índice del layer (default 0)
 * @returns {Promise<{ [fieldName: string]: { [code: string]: string } }>}
 */
export async function getDomains(serviceUrl = DEFAULT_OBRAS_MAPSERVER_URL, layerId = 0) {
  const key = `${serviceUrl}|${layerId}`;
  if (cache.data && cache.key === key && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.data;
  }
  try {
    const layerJson = await fetchLayerJson(serviceUrl, layerId);
    const data = extractDomainsFromLayer(layerJson);
    cache.data = data;
    cache.key = key;
    cache.fetchedAt = Date.now();
    return data;
  } catch (err) {
    if (cache.data && cache.key === key) return cache.data;
    throw err;
  }
}

export { extractDomainsFromLayer, fetchLayerJson, DEFAULT_OBRAS_MAPSERVER_URL };
