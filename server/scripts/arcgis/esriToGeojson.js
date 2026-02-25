/**
 * Convierte geometría Esri JSON a GeoJSON (Point, LineString, Polygon).
 * Para uso cuando el MapServer no devuelve f=geojson.
 */
export function esriGeometryToGeoJSON(esriGeom) {
  if (!esriGeom) return null;
  if (esriGeom.x != null && esriGeom.y != null) {
    return {
      type: 'Point',
      coordinates: [Number(esriGeom.x), Number(esriGeom.y)],
    };
  }
  if (Array.isArray(esriGeom.paths) && esriGeom.paths.length > 0) {
    const path = esriGeom.paths[0];
    if (Array.isArray(path) && path.length > 0) {
      const coords = path.map((p) => [Number(p[0]), Number(p[1])]);
      if (coords.length === 1) return { type: 'Point', coordinates: coords[0] };
      return { type: 'LineString', coordinates: coords };
    }
  }
  if (Array.isArray(esriGeom.rings) && esriGeom.rings.length > 0) {
    const ring = esriGeom.rings[0];
    if (Array.isArray(ring) && ring.length >= 3) {
      const coords = ring.map((p) => [Number(p[0]), Number(p[1])]);
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
      return { type: 'Polygon', coordinates: [coords] };
    }
  }
  return null;
}

/**
 * Convierte respuesta ArcGIS f=json (features array con geometry esri) a GeoJSON FeatureCollection.
 */
export function esriFeatureSetToGeoJSON(data) {
  const features = Array.isArray(data?.features) ? data.features : [];
  const geojsonFeatures = features.map((f) => {
    const geom = esriGeometryToGeoJSON(f.geometry);
    const props = { ...(f.attributes || {}) };
    return {
      type: 'Feature',
      geometry: geom,
      properties: props,
    };
  }).filter((f) => f.geometry != null);
  return { type: 'FeatureCollection', features: geojsonFeatures };
}
