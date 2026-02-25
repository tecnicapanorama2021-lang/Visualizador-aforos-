/**
 * Key canónica y única para markers/listas (evita "duplicate key" en React).
 * Orden: incidente_id > layer:fuente:source_id > layer:id|idx
 */
export function getMarkerKey(layerKey, feature, index) {
  const p = feature?.properties ?? {};
  if (p.incidente_id != null && String(p.incidente_id).trim() !== '') {
    return `inc:${p.incidente_id}`;
  }
  const fuente = p.fuente ?? '';
  const sourceId = p.source_id ?? p.id ?? '';
  if (fuente || sourceId) {
    const part = [layerKey, fuente, sourceId].filter(Boolean).join(':');
    if (part) return part;
  }
  const fid = feature?.id ?? p.id ?? '';
  if (fid != null && String(fid) !== '') return `${layerKey}:${fid}`;
  return `${layerKey}:idx:${index}`;
}

/** Dev-only: detecta keys repetidos en un array de features, loguea hasta 5 ejemplos. */
export function logDuplicateKeysInDev(layerKey, features, getKey = getMarkerKey) {
  if (!import.meta.env?.DEV || !Array.isArray(features) || features.length === 0) return;
  const byKey = new Map();
  features.forEach((f, i) => {
    const k = getKey(layerKey, f, i);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ index: i, feature: f });
  });
  const duplicates = [...byKey.entries()].filter(([, list]) => list.length > 1);
  if (duplicates.length === 0) return;
  const examples = duplicates.slice(0, 5).map(([key, list]) => ({ key, count: list.length, firstId: list[0]?.feature?.properties?.id ?? list[0]?.feature?.id }));
  console.warn(`[markerKey] duplicate keys in layer "${layerKey}" (${duplicates.length} keys, ${features.length} features). Examples:`, examples);
}
