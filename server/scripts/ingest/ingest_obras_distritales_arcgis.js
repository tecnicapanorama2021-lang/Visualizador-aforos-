/**
 * Ingesta idempotente: Obras Distritales (ArcGIS MapServer) → incidentes (tipo=OBRA) con geometría real.
 * Env: ARCGIS_BASE_URL, LAYER_ID, FUENTE_PRINCIPAL=OBRAS_DISTRITALES_ARCGIS.
 * Guarda atributos en metadata.arcgis.attributes_raw y trazabilidad (layer_url, layer_id, objectid).
 *
 * Uso:
 *   node server/scripts/ingest/ingest_obras_distritales_arcgis.js           # dry-run
 *   node server/scripts/ingest/ingest_obras_distritales_arcgis.js --apply    # aplicar
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';
import { esriFeatureSetToGeoJSON } from '../arcgis/esriToGeojson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const ARCGIS_BASE_URL =
  process.env.ARCGIS_BASE_URL ||
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer';
const LAYER_ID = Number(process.env.LAYER_ID ?? 0);
const FUENTE_PRINCIPAL = process.env.FUENTE_PRINCIPAL || 'OBRAS_DISTRITALES_ARCGIS';
const TIPO = process.env.TIPO || 'OBRA';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function getLayerInfo(baseUrl, layerId) {
  const url = `${baseUrl}/${layerId}?f=json`;
  const data = await fetchJson(url);
  return {
    objectIdFieldName: data.objectIdFieldName || 'OBJECTID',
    maxRecordCount: Math.min(Number(data.maxRecordCount) || 1000, 2000),
    geometryType: data.geometryType,
  };
}

function extractAttr(attrs, ...keys) {
  if (!attrs || typeof attrs !== 'object') return null;
  for (const k of keys) {
    const v = attrs[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function parseDate(v) {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v).toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchAllFeatures(baseUrl, layerId, layerInfo) {
  const { objectIdFieldName, maxRecordCount } = layerInfo;
  const layerUrl = `${baseUrl}/${layerId}`;
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultOffset: '0',
    resultRecordCount: String(maxRecordCount),
  });
  let offset = 0;
  const allFeatures = [];

  while (true) {
    params.set('resultOffset', String(offset));
    const url = `${layerUrl}/query?${params.toString()}`;
    const data = await fetchJson(url);

    let features = [];
    if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
      features = data.features;
    } else {
      const converted = esriFeatureSetToGeoJSON(data);
      features = converted.features || [];
    }

    if (features.length === 0) break;
    for (const f of features) {
      const oid = f.properties?.[objectIdFieldName] ?? f.attributes?.[objectIdFieldName];
      if (oid != null) allFeatures.push({ ...f, _oid: oid });
    }
    if (features.length < maxRecordCount) break;
    offset += maxRecordCount;
  }

  return allFeatures;
}

function geomKindFromGeoJSON(geom) {
  if (!geom?.type) return 'POINT';
  const t = geom.type.toUpperCase();
  if (t === 'POINT') return 'POINT';
  if (t === 'LINESTRING' || t === 'MULTILINESTRING') return 'LINESTRING';
  if (t === 'POLYGON' || t === 'MULTIPOLYGON') return 'POLYGON';
  return 'POINT';
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ingest-obras-arcgis] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incidentes'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[ingest-obras-arcgis] Ejecuta npm run db:migrate (migración 022).');
    await closePool();
    process.exit(1);
  }

  const layerInfo = await getLayerInfo(ARCGIS_BASE_URL, LAYER_ID);
  const objectIdFieldName = layerInfo.objectIdFieldName;
  console.log('[ingest-obras-arcgis] Layer', LAYER_ID, 'objectIdFieldName=', objectIdFieldName, 'maxRecordCount=', layerInfo.maxRecordCount);

  const features = await fetchAllFeatures(ARCGIS_BASE_URL, LAYER_ID, layerInfo);
  console.log('[ingest-obras-arcgis] Features obtenidas:', features.length);
  if (features.length === 0) {
    console.log('[ingest-obras-arcgis] Nada que ingestar.');
    await closePool();
    process.exit(0);
  }

  if (!apply) {
    console.log('[ingest-obras-arcgis] Dry-run. Para aplicar: node server/scripts/ingest/ingest_obras_distritales_arcgis.js --apply');
    console.log('[ingest-obras-arcgis] Ejemplo primera feature:', JSON.stringify({
      source_id: features[0]._oid,
      geometry_type: features[0].geometry?.type,
      properties_keys: features[0].properties ? Object.keys(features[0].properties).slice(0, 10) : [],
    }));
    await closePool();
    process.exit(0);
  }

  const layerUrl = `${ARCGIS_BASE_URL}/${LAYER_ID}`;
  let inserted = 0;
  let updated = 0;

  for (const feature of features) {
    const attrs = feature.properties || feature.attributes || {};
    const sourceId = String(feature._oid ?? attrs[objectIdFieldName] ?? attrs.OBJECTID ?? '').slice(0, 255);
    if (!sourceId) continue;

    const titulo = extractAttr(attrs, 'NOMBRE', 'TITULO', 'NOMBRE_OBRA', 'DESCRIPCION', 'NOMBRE_PROYECTO', 'nombre', 'titulo')?.slice(0, 1000) ?? null;
    const descripcion = extractAttr(attrs, 'DESCRIPCION', 'DESCRIPCIÓN', 'descripcion', 'OBSERVACIONES')?.slice(0, 5000) ?? null;
    const estadoRaw = extractAttr(attrs, 'ESTADO', 'estado', 'ESTADO_OBRA');
    let estado = 'ACTIVO';
    if (estadoRaw && /finaliza|termina|culmina|inactivo/i.test(estadoRaw)) estado = 'FINALIZADO';
    else if (estadoRaw && /programa|pendiente|futuro/i.test(estadoRaw)) estado = 'PROGRAMADO';

    const startAt = parseDate(attrs.FECHA_INICIO ?? attrs.fecha_inicio ?? attrs.INICIO ?? attrs.FECHA_INI) ?? null;
    const endAt = parseDate(attrs.FECHA_FIN ?? attrs.fecha_fin ?? attrs.FIN ?? attrs.FECHA_FIN_) ?? null;

    const geom = feature.geometry;
    if (!geom || !geom.type) continue;
    const geomKind = geomKindFromGeoJSON(geom);
    const geomJson = JSON.stringify(geom);

    const metadata = {
      arcgis: {
        layer_url: layerUrl,
        layer_id: LAYER_ID,
        objectid: feature._oid ?? attrs[objectIdFieldName],
        attributes_raw: attrs,
        ingested_at: new Date().toISOString(),
      },
    };

    const exists = await query(
      `SELECT id FROM incidentes WHERE fuente_principal = $1 AND source_id = $2`,
      [FUENTE_PRINCIPAL, sourceId]
    ).then((r) => r.rows[0]);

    await query(
      `INSERT INTO incidentes (
        tipo, subtipo, titulo, descripcion, fuente_principal, source_id, estado,
        start_at, end_at, geom, geom_kind, confidence_geo, confidence_tipo, metadata, updated_at
      ) VALUES (
        $1, NULL, $2, $3, $4, $5, $6,
        $7::timestamptz, $8::timestamptz,
        ST_SetSRID(ST_GeomFromGeoJSON($9::jsonb), 4326), $10,
        90, 90, $11::jsonb, now()
      )
      ON CONFLICT (fuente_principal, source_id) WHERE source_id IS NOT NULL
      DO UPDATE SET
        titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, estado = EXCLUDED.estado,
        start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
        geom = EXCLUDED.geom, geom_kind = EXCLUDED.geom_kind, metadata = EXCLUDED.metadata,
        updated_at = now()`,
      [TIPO, titulo, descripcion, FUENTE_PRINCIPAL, sourceId, estado, startAt, endAt, geomJson, geomKind, JSON.stringify(metadata)]
    );

    const incidenteRow = await query(
      `SELECT id FROM incidentes WHERE fuente_principal = $1 AND source_id = $2`,
      [FUENTE_PRINCIPAL, sourceId]
    ).then((r) => r.rows[0]);
    if (incidenteRow) {
      const rawPayload = { feature_properties: attrs, geometry_type: geom?.type, _oid: feature._oid };
      await query(
        `INSERT INTO incidentes_sources (incidente_id, fuente, source_id, payload, fetched_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (incidente_id, fuente, source_id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
        [incidenteRow.id, FUENTE_PRINCIPAL, sourceId, JSON.stringify(rawPayload)]
      );
    }

    if (!exists) inserted++;
    else updated++;
  }

  console.log('[ingest-obras-arcgis] Insertados:', inserted, 'Actualizados:', updated);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-obras-arcgis]', err.message);
  process.exit(1);
});
