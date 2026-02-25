/**
 * Geocoding para direcciones de nodos EXTERNO.
 * Paso 1: diccionario local (direcciones de CSV de ejemplo).
 * Paso 2 (opcional): fallback con ArcGIS — comentado o detrás de flag.
 */

/** Normaliza dirección para búsqueda: mayúsculas, sin tildes, conector " X ". */
function normalizarDireccion(direccion) {
  if (typeof direccion !== 'string') return '';
  const sinTildes = direccion
    .normalize('NFD')
    .replace(/\u0301/g, '')
    .replace(/[\u0300-\u036f]/g, '');
  const upper = sinTildes.toUpperCase().trim();
  const conector = upper.replace(/\s*[xX×]\s*/g, ' X ');
  return conector.replace(/\s+/g, ' ').trim();
}

/** Diccionario: dirección normalizada → { lat, lng } (WGS84, Bogotá). */
const DICCIONARIO_DIRECCIONES = Object.freeze({
  [normalizarDireccion('CALLE 13 X CARRERA 7')]: { lat: 4.6486, lng: -74.0976 },
  [normalizarDireccion('AK 30 X CL 53')]: { lat: 4.628, lng: -74.14 },
  [normalizarDireccion('CALLE 80 X NQS')]: { lat: 4.69, lng: -74.12 },
  [normalizarDireccion('AK 15 X CL 127')]: { lat: 4.72, lng: -74.03 },
});

/**
 * Geocodifica una dirección: primero diccionario local; opcionalmente ArcGIS.
 * @param {string} direccion - Texto de la dirección o intersección.
 * @returns {{ lat: number, lng: number } | null}
 */
export function geocodeDireccion(direccion) {
  const key = normalizarDireccion(direccion);
  if (DICCIONARIO_DIRECCIONES[key]) {
    return DICCIONARIO_DIRECCIONES[key];
  }

  // --- Paso 2 (opcional): fallback con ArcGIS ---
  // Descomentar y definir USE_ARCGIS_FALLBACK = true o leer de process.env para activar.
  // if (process.env.GEOCODE_ARCGIS_FALLBACK === 'true') {
  //   const coords = await geocodeDireccionArcGIS(direccion);
  //   if (coords) return coords;
  // }

  return null;
}

/**
 * Fallback opcional: geocodificar "<direccion>, Bogotá, Colombia" con ArcGIS.
 * Si hay candidato devuelve { lat, lng }; si falla o no hay resultado, null.
 * Requiere: URL en env (ej. GEOCODING_ARCGIS_URL o constante en front).
 *
 * async function geocodeDireccionArcGIS(direccion) {
 *   const url = process.env.GEOCODING_ARCGIS_URL || 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
 *   const search = encodeURIComponent(`${direccion}, Bogotá, Colombia`);
 *   const full = `${url}?SingleLine=${search}&outFields=*&f=json&maxLocations=1`;
 *   try {
 *     const res = await fetch(full);
 *     const data = await res.json();
 *     const cand = data.candidates && data.candidates[0];
 *     if (cand && cand.location) {
 *       return { lat: cand.location.y, lng: cand.location.x };
 *     }
 *   } catch (_) {}
 *   return null;
 * }
 */

export { normalizarDireccion, DICCIONARIO_DIRECCIONES };
