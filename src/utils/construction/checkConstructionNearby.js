/**
 * Comprueba si hay obras de construcción dentro de un radio (metros) del punto.
 * @param {{ lat: number, lng: number }} point - Punto { lat, lng }
 * @param {Array} obrasList - Lista de obras con geometry.coordinates [lng, lat] o coordenadas
 * @param {number} radiusMeters - Radio en metros
 * @returns {{ hasNearby: boolean, nearbyObras: Array }}
 */
export function checkConstructionNearby(point, obrasList, radiusMeters = 500) {
  if (!point?.lat != null || point?.lng == null || !Array.isArray(obrasList) || obrasList.length === 0) {
    return { hasNearby: false, nearbyObras: [] };
  }
  const R = 6371000; // radio Tierra en m
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRad(point.lat);
  const lng1 = toRad(point.lng);
  const nearbyObras = [];
  for (const obra of obrasList) {
    const coords = obra.geometry?.coordinates;
    const lng = Array.isArray(coords) ? coords[0] : obra.lng;
    const lat = Array.isArray(coords) ? coords[1] : obra.lat;
    if (lat == null || lng == null) continue;
    const lat2 = toRad(lat);
    const lng2 = toRad(lng);
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    if (dist <= radiusMeters) nearbyObras.push({ ...obra, _distance: dist });
  }
  return { hasNearby: nearbyObras.length > 0, nearbyObras };
}
