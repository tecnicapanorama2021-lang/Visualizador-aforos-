/**
 * Lista layers y tablas de un MapServer ArcGIS (Obras Distritales u otro).
 * Uso: node server/scripts/arcgis/list_layers.js [baseUrl]
 *
 * Ejemplo:
 *   node server/scripts/arcgis/list_layers.js
 *   node server/scripts/arcgis/list_layers.js "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer"
 */

const DEFAULT_BASE =
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function getGeomType(esriType) {
  if (!esriType) return null;
  const t = String(esriType).toLowerCase();
  if (t.includes('point')) return 'esriGeometryPoint';
  if (t.includes('polyline') || t.includes('line')) return 'esriGeometryPolyline';
  if (t.includes('polygon')) return 'esriGeometryPolygon';
  return t;
}

async function main() {
  const baseUrl = (process.argv[2] || process.env.ARCGIS_BASE_URL || DEFAULT_BASE).replace(/\/?$/, '');
  console.log('MapServer:', baseUrl);
  console.log('');

  const root = await fetchJson(`${baseUrl}?f=json`);
  const layers = root.layers || [];
  const tables = root.tables || [];

  const all = [
    ...layers.map((l) => ({ ...l, kind: 'layer' })),
    ...tables.map((t) => ({ ...t, kind: 'table' })),
  ].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  for (const item of all) {
    const id = item.id ?? item.layerId ?? item.tableId;
    const name = item.name ?? 'Sin nombre';
    let geometryType = item.geometryType ?? null;
    let fields = item.fields ?? [];
    let objectIdFieldName = item.objectIdFieldName ?? 'OBJECTID';
    let maxRecordCount = item.maxRecordCount ?? 1000;

    try {
      const layerUrl = `${baseUrl}/${id}?f=json`;
      const detail = await fetchJson(layerUrl);
      geometryType = detail.geometryType ?? geometryType;
      fields = detail.fields ?? fields;
      objectIdFieldName = detail.objectIdFieldName ?? objectIdFieldName;
      maxRecordCount = detail.maxRecordCount ?? maxRecordCount;
    } catch (e) {
      console.warn(`  [${id}] No se pudo obtener detalle:`, e.message);
    }

    const geomLabel = getGeomType(geometryType) || geometryType || 'N/A';
    console.log(`--- ${item.kind === 'table' ? 'TABLE' : 'LAYER'} id=${id} ---`);
    console.log('  name:', name);
    console.log('  geometryType:', geomLabel);
    console.log('  objectIdFieldName:', objectIdFieldName);
    console.log('  maxRecordCount:', maxRecordCount);
    console.log('  fields:', fields.length);
    if (fields.length > 0 && fields.length <= 20) {
      fields.forEach((f) => console.log('    -', f.name, f.type));
    } else if (fields.length > 20) {
      console.log('    (primeros 5)', fields.slice(0, 5).map((f) => f.name).join(', '), '...');
    }
    console.log('');
  }

  console.log('Total:', all.length, '(', layers.length, 'layers +', tables.length, 'tables)');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
