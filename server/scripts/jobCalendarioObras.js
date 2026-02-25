/**
 * Job diario: actualiza calendario_obras_eventos.json con obras desde IDU (Instituto de Desarrollo Urbano)
 * como fuente principal, y CKAN/ArcGIS como respaldo. Calcula rango de afectación (buffer) y nodos_afectados.
 * Mantiene la sección "eventos" existente; reemplaza solo "obras".
 *
 * Uso: node server/scripts/jobCalendarioObras.js
 * Opciones: --output=path (default: public/data/calendario_obras_eventos.json)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CKAN_BASE = process.env.CKAN_OBRAS_BASE || 'https://datosabiertos.bogota.gov.co/api/3/action';
const CKAN_RESOURCE_ID = process.env.CKAN_OBRAS_RESOURCE_ID || '';
const OBRAS_IDU_URL = process.env.OBRAS_IDU_URL ||
  'https://webidu.idu.gov.co/servergis1/rest/services/ProyectoGeneralIDU/ProyectosGeneralIDU/FeatureServer/0/query';
const OUTPUT_ARG = process.argv.find(a => a.startsWith('--output='));
const CALENDAR_PATH = OUTPUT_ARG
  ? path.resolve(process.cwd(), OUTPUT_ARG.split('=')[1])
  : path.join(__dirname, '../../public/data/calendario_obras_eventos.json');
const NODOS_PATH = path.join(__dirname, '../../public/data/nodos_unificados.json');
const BATCH_SIZE = 2000;
const IDU_BATCH_SIZE = 100;
const BUFFER_METERS = Number(process.env.OBRAS_BUFFER_METERS) || 300;
const MAX_DISTANCE_M = 500;
const DEDUPE_DISTANCE_KM = 0.05;

function geometryToCentroid(geom) {
  if (!geom) return null;
  if (geom.x != null && geom.y != null) return [geom.x, geom.y];
  if (geom.rings && geom.rings.length > 0) {
    const ring = geom.rings[0];
    let sumLng = 0, sumLat = 0, n = 0;
    for (const p of ring) {
      sumLng += p[0];
      sumLat += p[1];
      n++;
    }
    return n ? [sumLng / n, sumLat / n] : null;
  }
  if (geom.paths && geom.paths.length > 0) {
    const path = geom.paths[0];
    if (!Array.isArray(path) || path.length === 0) return null;
    let sumLng = 0, sumLat = 0, n = 0;
    for (const p of path) {
      if (Array.isArray(p) && p.length >= 2) {
        sumLng += p[0];
        sumLat += p[1];
        n++;
      }
    }
    return n ? [sumLng / n, sumLat / n] : null;
  }
  if (geom.points && geom.points.length > 0) {
    const pts = geom.points;
    let sumLng = 0, sumLat = 0;
    for (const p of pts) {
      sumLng += p[0];
      sumLat += p[1];
    }
    return [sumLng / pts.length, sumLat / pts.length];
  }
  return null;
}

function haversineApproxKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function loadNodosUnificados() {
  try {
    const raw = fs.readFileSync(NODOS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data.features || [];
  } catch {
    return [];
  }
}

function normalizeObra(obra) {
  return {
    id: obra.id || null,
    nombre: (obra.nombre || obra.descripcion || '').trim() || 'Sin nombre',
    estado: obra.estado || '',
    descripcion: obra.descripcion || '',
    tipo: obra.tipo || 'obra',
    entidad: obra.entidad || '',
    geometry: obra.geometry || null,
    timestamp: obra.timestamp || new Date().toISOString(),
    fuente: obra.fuente || 'ArcGIS',
    fecha_inicio: obra.fecha_inicio || null,
    fecha_fin: obra.fecha_fin || null,
    nodo_id: obra.nodo_id,
    rango_afectacion: obra.rango_afectacion || null,
    nodos_afectados: Array.isArray(obra.nodos_afectados) ? obra.nodos_afectados : []
  };
}

async function fetchObrasFromCKAN() {
  const obras = [];
  try {
    let resourceId = CKAN_RESOURCE_ID;
    if (!resourceId) {
      const searchRes = await axios.get(`${CKAN_BASE}/package_search`, {
        params: { q: 'obras', rows: 10 },
        timeout: 15000
      });
      const results = searchRes.data?.result?.results || [];
      for (const pkg of results) {
        const resIds = pkg.resources?.filter((r) => r.datastore_active && r.id).map((r) => r.id) || [];
        if (resIds.length > 0) {
          resourceId = resIds[0];
          break;
        }
      }
    }
    if (!resourceId) {
      console.warn('  CKAN: no se encontró resource_id de obras (opcional: CKAN_OBRAS_RESOURCE_ID)');
      return [];
    }
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    while (hasMore) {
      const res = await axios.get(`${CKAN_BASE}/datastore_search`, {
        params: { resource_id: resourceId, limit, offset },
        timeout: 20000
      });
      const records = res.data?.result?.records || [];
      const fields = res.data?.result?.fields || [];
      const latIdx = fields.findIndex((f) => /lat|y|coord/i.test(f.id));
      const lngIdx = fields.findIndex((f) => /lng|lon|x|long/i.test(f.id));
      for (const rec of records) {
        const lat = latIdx >= 0 ? Number(rec[fields[latIdx]?.id]) : null;
        const lng = lngIdx >= 0 ? Number(rec[fields[lngIdx]?.id]) : null;
        const geometry =
          typeof lat === 'number' && typeof lng === 'number' && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
            ? { type: 'Point', coordinates: [lng, lat] }
            : null;
        const nombre =
          rec.nombre || rec.name || rec.titulo || rec.descripcion || rec.proyecto || rec.obra || '';
        obras.push(
          normalizeObra({
            id: rec._id != null ? `ckan_obra_${rec._id}` : null,
            nombre: String(nombre).slice(0, 500),
            tipo: rec.tipo || rec.clase || rec.categoria || 'obra',
            entidad: rec.entidad || rec.responsable || rec.idu || '',
            descripcion: rec.descripcion || rec.observaciones || '',
            geometry,
            fuente: 'CKAN',
            fecha_inicio: rec.fecha_inicio || rec.inicio || null,
            fecha_fin: rec.fecha_fin || rec.fin || null
          })
        );
      }
      hasMore = records.length === limit;
      offset += records.length;
    }
    if (obras.length > 0) console.log(`  CKAN: ${obras.length} registros obtenidos`);
  } catch (err) {
    console.warn('  CKAN no disponible:', err.message);
  }
  return obras;
}

const OBRAS_ARCGIS_URLS = [
  OBRAS_IDU_URL,
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer/0/query',
  'https://sig.simur.gov.co/arcgis/rest/services/MovilApp/Simur_web/MapServer/9/query',
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/SIMUR/SIMUR/MapServer/9/query'
];

function isIduUrl(url) {
  return url && url.includes('idu.gov.co');
}

async function fetchObrasFromArcGIS() {
  for (const url of OBRAS_ARCGIS_URLS) {
    try {
      const obras = [];
      const fromIdu = isIduUrl(url);
      const batchSize = fromIdu ? IDU_BATCH_SIZE : BATCH_SIZE;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await axios.get(url, {
          params: {
            where: '1=1',
            outFields: '*',
            returnGeometry: 'true',
            f: 'json',
            outSR: '4326',
            resultRecordCount: batchSize,
            resultOffset: offset
          },
          timeout: 60000
        });
        if (res.data.error) throw new Error(res.data.error.message || 'Error ArcGIS');
        const features = res.data.features || [];
        for (const f of features) {
          const attrs = f.attributes || {};
          const etapa = (attrs.ETAPA || attrs.ESTADO || attrs.etapa || attrs.estado || '').toString().trim();
          if (fromIdu && /Terminado/i.test(etapa)) continue;
          const geom = f.geometry || {};
          const centroid = geometryToCentroid(geom);
          const geometry = centroid ? { type: 'Point', coordinates: centroid } : null;
          const raw = {
            id: attrs.OBJECTID != null ? `arcgis_obra_${attrs.OBJECTID}` : null,
            nombre: attrs.NOMBRE || attrs.nombre || attrs.Nombre || attrs.PROYECTO || '',
            estado: attrs.ESTADO || attrs.estado || attrs.ETAPA || '',
            descripcion: attrs.DESCRIPCION || attrs.descripcion || attrs.OBJETIVO || attrs.UBICACION || '',
            tipo: attrs.TIPO || attrs.tipo || attrs.TIPO_OBRA || attrs.TIPO_INTERVENCION || 'obra',
            geometry,
            fuente: fromIdu ? 'IDU' : 'ArcGIS',
            fecha_inicio: attrs.FECHA_INICIO || attrs.fecha_inicio || attrs.FECHA_ACTUALIZACION || null,
            fecha_fin: attrs.FECHA_FIN || attrs.fecha_fin || null,
            entidad: attrs.ENTIDAD || attrs.entidad || ''
          };
          if (fromIdu && (attrs.CONTRATO || attrs.NO_CONTRATO || attrs.CODIGO)) {
            raw.id = `idu_${attrs.CONTRATO || attrs.NO_CONTRATO || attrs.CODIGO}`;
          }
          obras.push(normalizeObra(raw));
        }
        offset += features.length;
        hasMore = features.length === batchSize;
      }
      if (obras.length > 0) {
        const label = fromIdu ? 'IDU' : url.split('/').slice(-3, -1).join('/');
        console.log(`  ArcGIS (${label}): ${obras.length} registros`);
        return obras;
      }
    } catch (err) {
      console.warn(`  ArcGIS no disponible (${url.split('/').slice(-2, -1).join('/')}):`, err.message);
    }
  }
  return [];
}

function mergeAndDedupe(obrasCKAN, obrasArcGIS) {
  const byKey = new Map();
  function add(o) {
    if (!o) return;
    const coords = o.geometry?.coordinates;
    const key =
      coords && coords.length >= 2
        ? `${o.fuente}_${coords[0].toFixed(5)}_${coords[1].toFixed(5)}_${(o.nombre || '').slice(0, 30)}`
        : `${o.fuente}_${(o.nombre || '').slice(0, 80)}_${Math.random()}`;
    if (byKey.has(key)) return;
    byKey.set(key, normalizeObra({ ...o, id: o.id || key }));
  }
  const findDup = (o) => {
    const coords = o.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    return Array.from(byKey.values()).find(
      (e) => e.geometry?.coordinates && haversineApproxKm(coords[0], coords[1], e.geometry.coordinates[0], e.geometry.coordinates[1]) < DEDUPE_DISTANCE_KM
    );
  };
  obrasArcGIS.forEach(add);
  obrasCKAN.forEach((o) => {
    if (!findDup(o)) add(o);
  });
  return Array.from(byKey.values());
}

function computeRangoAndNodos(obras, nodes) {
  return obras.map((o) => {
    const coords = o.geometry?.coordinates;
    if (!coords || coords.length < 2) {
      return { ...o, rango_afectacion: null, nodos_afectados: [] };
    }
    try {
      const point = turf.point(coords);
      const buffered = turf.buffer(point, BUFFER_METERS / 1000, { units: 'kilometers' });
      const polygon = buffered.geometry;
      const nodos_afectados = [];
      for (const f of nodes) {
        const c = f.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const pt = turf.point([c[0], c[1]]);
        if (turf.booleanPointInPolygon(pt, polygon)) {
          const nid = f.properties?.id || f.properties?.raw_data?.siteid || f.attributes?.id;
          if (nid != null) nodos_afectados.push(String(nid));
        }
      }
      return {
        ...o,
        rango_afectacion: polygon,
        nodos_afectados: [...new Set(nodos_afectados)]
      };
    } catch (e) {
      return { ...o, rango_afectacion: null, nodos_afectados: [] };
    }
  });
}

function main() {
  (async () => {
    console.log('Job Calendario Obras (IDU principal + CKAN/ArcGIS respaldo): iniciando...');
    const nodes = loadNodosUnificados();
    console.log(`Nodos cargados: ${nodes.length}`);

    const [obrasCKAN, obrasArcGIS] = await Promise.all([
      fetchObrasFromCKAN(),
      fetchObrasFromArcGIS()
    ]);

    let merged = mergeAndDedupe(obrasCKAN, obrasArcGIS);
    if (merged.length === 0) {
      try {
        const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
        const prev = JSON.parse(raw);
        if (Array.isArray(prev.obras) && prev.obras.length > 0) {
          merged = prev.obras.map(normalizeObra);
          console.log(`Sin datos nuevos; se mantienen ${merged.length} obras previas.`);
        }
      } catch (_) {}
    } else {
      console.log(`Obras combinadas (sin duplicados): ${merged.length}`);
    }

    const withRango = computeRangoAndNodos(merged, nodes);
    const obrasToSave = withRango.map((o) => {
      const nodo_id =
        o.geometry?.coordinates && nodes.length > 0
          ? (() => {
              let best = null;
              let bestKm = MAX_DISTANCE_M / 1000;
              for (const f of nodes) {
                const c = f.geometry?.coordinates;
                if (!Array.isArray(c) || c.length < 2) continue;
                const km = haversineApproxKm(o.geometry.coordinates[0], o.geometry.coordinates[1], c[0], c[1]);
                if (km < bestKm) {
                  bestKm = km;
                  best = f.properties?.id || f.properties?.raw_data?.siteid || f.attributes?.id;
                }
              }
              return best != null ? String(best) : undefined;
            })()
          : undefined;
      return { ...o, nodo_id: nodo_id || undefined };
    });

    let existing = { metadata: { version: '1.0' }, obras: [], eventos: [] };
    try {
      const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch {}

    const output = {
      metadata: {
        ...existing.metadata,
        version: '1.0',
        updated_at: new Date().toISOString(),
        description: 'Calendario unificado de obras (IDU como referencia, CKAN/ArcGIS respaldo) y eventos por nodo/timestamp',
        total_obras: obrasToSave.length,
        fuentes: {
          idu: obrasToSave.filter((o) => o.fuente === 'IDU').length,
          ckan: obrasToSave.filter((o) => o.fuente === 'CKAN').length,
          arcgis: obrasToSave.filter((o) => o.fuente === 'ArcGIS').length
        }
      },
      obras: obrasToSave,
      eventos: Array.isArray(existing.eventos) ? existing.eventos : []
    };

    fs.mkdirSync(path.dirname(CALENDAR_PATH), { recursive: true });
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(output, null, 2), 'utf8');
    const conGeometria = obrasToSave.filter((o) => o.geometry?.coordinates?.length >= 2).length;
    console.log(`Calendario guardado: ${CALENDAR_PATH} (${output.obras.length} obras, ${output.eventos.length} eventos)`);
    console.log(`Obras registradas: ${output.obras.length}. Con geometría (implementadas en mapa): ${conGeometria}`);
  })().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

main();
