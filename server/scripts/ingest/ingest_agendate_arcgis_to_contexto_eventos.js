/**
 * Ingesta idempotente: ArcGIS "Agéndate con Bogotá" (lugares + eventos relacionados)
 * → contexto_eventos tipo EVENTO_CULTURAL con fecha + geom.
 * Fuentes diferenciadas: AGENDATE_ARCGIS (directo) | AGENDATE_SNAPSHOT (archivo local).
 * No toca LUGAR_EVENTO (AGENDATE_BOGOTA).
 *
 * Uso:
 *   node server/scripts/ingest/ingest_agendate_arcgis_to_contexto_eventos.js           # dry-run
 *   node server/scripts/ingest/ingest_agendate_arcgis_to_contexto_eventos.js --apply    # UPSERT en BD
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

/** Ruta del snapshot cuando la red bloquea ArcGIS. */
const SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_snapshot.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const AGENDATE_BASE =
  process.env.AGENDATE_ARCGIS_BASE ??
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer';

const LAYER_LUGARES_ID = Number(process.env.AGENDATE_LUGARES_LAYER_ID ?? 4);
const RELATION_EVENTOS_ID = Number(process.env.AGENDATE_EVENTOS_RELATION_ID ?? 0);
const DIAS_FUTURO = Number(process.env.AGENDATE_DIAS_FUTURO ?? 60);
const DURACION_DEFAULT_HORAS = Number(process.env.AGENDATE_DURACION_DEFAULT_HORAS ?? 3);
const PAGE_SIZE = Number(process.env.AGENDATE_ARCGIS_PAGE_SIZE ?? 1000);
const TIMEOUT_MS = Number(process.env.AGENDATE_ARCGIS_TIMEOUT_MS ?? 25000);
const RETRIES = Number(process.env.AGENDATE_ARCGIS_RETRIES ?? 2);

const FUENTE_ARCGIS = 'AGENDATE_ARCGIS';
const FUENTE_SNAPSHOT = 'AGENDATE_SNAPSHOT';
const SNAPSHOT_VALID_MIN_RATIO = 0.8;

/** Campos conocidos de la tabla relacionada Eventos_Agendate (layer 4 → relationshipId 0). */
const EVENTO_ATTR = {
  NOMBRE: 'EVNEVENTO',
  FECHA_INICIO: 'EVDINICIAL',
  FECHA_FIN: 'EVDFINAL',
  GUID_LUGAR: 'GUID_2',
};

function getApply() {
  return process.argv.includes('--apply');
}

/** GET con reintentos. */
async function fetchWithRetries(url, retries = RETRIES) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i === retries) {
        console.error('[ingest-agendate-arcgis] Fetch fallido:', url.slice(0, 80) + '...');
        console.error('[ingest-agendate-arcgis] Error:', err?.message || err, err?.cause?.message || '');
        if (isConnectivityError(err)) {
          console.error('[ingest-agendate-arcgis] Si el navegador funciona pero Node no, revise Proxy/PAC. Ejecute: npm run net:diag:agendate:arcgis');
        }
      }
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Errores típicos de red/proxy (no HTTP 4xx de negocio). */
function isConnectivityError(err) {
  const msg = (err && (err.message || err.cause?.message)) || String(err);
  return (
    /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|Could not connect|Connection refused/i.test(msg)
  );
}

/**
 * Paso A — Descargar todos los lugares (layer 4): GLOBALID, EVNLUGAR, geom (4326).
 * @returns { Promise<Map<string, { objectId: number, lugar_nombre: string, lon: number, lat: number }>> }
 *   key = GLOBALID
 */
async function fetchLugares() {
  const baseUrl = `${AGENDATE_BASE}/${LAYER_LUGARES_ID}/query`;
  const lugaresByGlobalId = new Map();
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      outFields: 'OBJECTID,GLOBALID,EVNLUGAR',
      outSR: '4326',
      returnGeometry: 'true',
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
    });
    const data = await fetchWithRetries(`${baseUrl}?${params.toString()}`);
    const features = data?.features ?? [];
    if (features.length === 0) break;

    for (const f of features) {
      const attrs = f.attributes ?? {};
      const geom = f.geometry;
      const objectId = attrs.OBJECTID;
      const globalId = (attrs.GLOBALID ?? '').toString().trim();
      const lugar_nombre = (attrs.EVNLUGAR ?? '').toString().trim();
      const x = geom?.x;
      const y = geom?.y;
      if (globalId && objectId != null && x != null && y != null) {
        lugaresByGlobalId.set(globalId, {
          globalId,
          objectId,
          lugar_nombre: lugar_nombre || 'Sin nombre',
          lon: Number(x),
          lat: Number(y),
        });
      }
    }
    offset += features.length;
    hasMore = features.length >= PAGE_SIZE && data?.exceededTransferLimit !== true;
  }

  return lugaresByGlobalId;
}

/**
 * Paso B — Descargar eventos relacionados (queryRelatedRecords).
 * objectIds puede ser largo; algunos servicios aceptan hasta N ids. Hacemos lotes.
 */
async function fetchEventosRelacionados(lugaresByGlobalId) {
  const objectIds = [...new Set([...lugaresByGlobalId.values()].map((l) => l.objectId))];
  const batchSize = 100;
  const allGroups = [];

  for (let i = 0; i < objectIds.length; i += batchSize) {
    const batch = objectIds.slice(i, i + batchSize);
    const baseUrl = `${AGENDATE_BASE}/${LAYER_LUGARES_ID}/queryRelatedRecords`;
    const params = new URLSearchParams({
      f: 'json',
      relationshipId: String(RELATION_EVENTOS_ID),
      objectIds: batch.join(','),
      outFields: '*',
      returnGeometry: 'false',
    });
    const data = await fetchWithRetries(`${baseUrl}?${params.toString()}`);
    const groups = data?.relatedRecordGroups ?? [];
    allGroups.push(...groups);
  }

  return allGroups;
}

/** Parsea fecha desde valor ArcGIS (epoch ms o string ISO). */
function parseFecha(val) {
  if (val == null) return null;
  if (typeof val === 'number' && val > 0) return new Date(val);
  if (typeof val === 'string') return new Date(val);
  return null;
}

/** Ventana temporal: ahora hasta ahora + DIAS_FUTURO días. */
function inVentanaFutura(startAt) {
  if (!startAt) return false;
  const now = Date.now();
  const endWindow = now + DIAS_FUTURO * 24 * 60 * 60 * 1000;
  const t = startAt instanceof Date ? startAt.getTime() : new Date(startAt).getTime();
  return t >= now && t <= endWindow;
}

/**
 * Construye registros para contexto_eventos a partir de lugares + relatedRecordGroups.
 * Filtra por ventana [now, now+DIAS_FUTURO] y por lugar con geom.
 */
function buildContextoEventosRecords(lugaresByGlobalId, relatedRecordGroups) {
  const now = Date.now();
  const duracionMs = DURACION_DEFAULT_HORAS * 60 * 60 * 1000;
  const records = [];
  let skipped_sin_lugar = 0;
  let skipped_sin_fecha = 0;

  for (const group of relatedRecordGroups) {
    const parentObjectId = group.objectId;
    const lugar = [...lugaresByGlobalId.values()].find((l) => l.objectId === parentObjectId);
    if (!lugar) {
      skipped_sin_lugar += (group.relatedRecords ?? []).length;
      continue;
    }

    for (const rec of group.relatedRecords ?? []) {
      const attrs = rec.attributes ?? {};
      const titulo = (attrs[EVENTO_ATTR.NOMBRE] ?? '').toString().trim() || null;
      const fechaInicio = parseFecha(attrs[EVENTO_ATTR.FECHA_INICIO]);
      if (!fechaInicio) {
        skipped_sin_fecha++;
        continue;
      }
      if (!inVentanaFutura(fechaInicio)) continue;

      let fechaFin = parseFecha(attrs[EVENTO_ATTR.FECHA_FIN]);
      if (!fechaFin) {
        fechaFin = new Date(fechaInicio.getTime() + duracionMs);
      }

      const tituloSafe = titulo || 'Evento sin nombre';
      const fechaInicioIso = fechaInicio.toISOString();
      const origen_id = crypto
        .createHash('sha256')
        .update(`${lugar.globalId}|${fechaInicioIso}|${tituloSafe}`)
        .digest('hex')
        .slice(0, 32);

      records.push({
        tipo: 'EVENTO_CULTURAL',
        fuente: FUENTE_ARCGIS,
        origen_id,
        descripcion: tituloSafe,
        lugar_nombre: lugar.lugar_nombre,
        geom: { lon: lugar.lon, lat: lugar.lat },
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        raw: attrs,
      });
    }
  }

  return { records, skipped_sin_lugar, skipped_sin_fecha };
}

/**
 * Valida schema del snapshot: { source, exportedAt, window_dias, events: [] }.
 */
function validateSnapshotSchema(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.events)) return false;
  if (data.source == null || data.exportedAt == null || data.window_dias == null) return false;
  return true;
}

/**
 * Carga y valida snapshot local (cuando ArcGIS no es accesible).
 * Criterio de validez: >= 80% con fecha y >= 80% con lon/lat.
 * @returns {{ valid: boolean, records?: Array, exportedAt?: string, window_dias?: number, stats?: { total, con_fecha, con_lonlat }, error?: string, message?: string }}
 */
async function loadSnapshotFallback() {
  let raw;
  try {
    raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { valid: false, error: 'missing', message: `Snapshot no encontrado: ${SNAPSHOT_PATH}. Ejecute export en entorno con acceso y copie el archivo.` };
    }
    return { valid: false, error: 'read', message: err?.message || String(err) };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { valid: false, error: 'json', message: `JSON inválido: ${err?.message || err}` };
  }

  if (!validateSnapshotSchema(data)) {
    return { valid: false, error: 'schema', message: 'Snapshot debe tener { source, exportedAt, window_dias, events: [] }.' };
  }

  const events = data.events;
  const total = events.length;
  if (total === 0) {
    return { valid: false, error: 'empty', message: 'Snapshot sin eventos (events: []).', stats: { total: 0, con_fecha: 0, con_lonlat: 0 } };
  }

  let con_fecha = 0;
  let con_lonlat = 0;
  for (const ev of events) {
    const fechaInicio = ev.fecha_inicio ? new Date(ev.fecha_inicio) : null;
    if (fechaInicio && !Number.isNaN(fechaInicio.getTime())) con_fecha++;
    if (ev.lon != null && ev.lat != null && !Number.isNaN(Number(ev.lon)) && !Number.isNaN(Number(ev.lat))) con_lonlat++;
  }

  const ratioFecha = con_fecha / total;
  const ratioLonlat = con_lonlat / total;
  const stats = { total, con_fecha, con_lonlat };

  if (ratioFecha < SNAPSHOT_VALID_MIN_RATIO || ratioLonlat < SNAPSHOT_VALID_MIN_RATIO) {
    return {
      valid: false,
      error: 'invalid_threshold',
      message: `Snapshot inválido: se requiere al menos ${SNAPSHOT_VALID_MIN_RATIO * 100}% con fecha y con lon/lat. Actual: con_fecha=${con_fecha}/${total} (${(ratioFecha * 100).toFixed(0)}%), con_lonlat=${con_lonlat}/${total} (${(ratioLonlat * 100).toFixed(0)}%). Regenerar snapshot con npm run export:agendate:arcgis:snapshot.`,
      stats,
    };
  }

  const records = events.map((ev) => {
    const titulo = (ev.titulo ?? '').toString().trim() || 'Evento sin nombre';
    const fecha_inicio = ev.fecha_inicio ? new Date(ev.fecha_inicio) : null;
    const fecha_fin = ev.fecha_fin ? new Date(ev.fecha_fin) : null;
    if (!fecha_inicio || Number.isNaN(fecha_inicio.getTime())) return null;
    const origen_id = (ev.origen_id ?? crypto.createHash('sha256').update(`${ev.titulo}|${ev.fecha_inicio}|${ev.lon ?? ''}|${ev.lat ?? ''}`).digest('hex').slice(0, 32)).toString();
    const geom = ev.lon != null && ev.lat != null ? { lon: Number(ev.lon), lat: Number(ev.lat) } : null;
    return {
      tipo: 'EVENTO_CULTURAL',
      fuente: FUENTE_SNAPSHOT,
      origen_id,
      descripcion: titulo,
      lugar_nombre: (ev.lugar_nombre ?? '').toString() || null,
      geom,
      fecha_inicio,
      fecha_fin: fecha_fin && !Number.isNaN(fecha_fin.getTime()) ? fecha_fin : new Date(fecha_inicio.getTime() + DURACION_DEFAULT_HORAS * 60 * 60 * 1000),
      raw: ev.raw ?? {},
    };
  }).filter(Boolean);

  return {
    valid: true,
    records,
    exportedAt: data.exportedAt,
    window_dias: data.window_dias,
    stats,
  };
}

async function main() {
  const apply = getApply();

  console.log('[ingest-agendate-arcgis] Config:', {
    AGENDATE_BASE,
    LAYER_LUGARES_ID,
    RELATION_EVENTOS_ID,
    DIAS_FUTURO,
    apply,
  });

  let records = [];
  let resumen = { source: 'arcgis', total_lugares: 0, total_eventos_raw: 0, eventos_con_lugar_y_fecha: 0, skipped_sin_lugar: 0, skipped_sin_fecha: 0, window_dias_futuro: DIAS_FUTURO };

  try {
    const lugaresByGlobalId = await fetchLugares();
    const total_lugares = lugaresByGlobalId.size;
    console.log('[ingest-agendate-arcgis] Lugares descargados:', total_lugares);

    const relatedRecordGroups = await fetchEventosRelacionados(lugaresByGlobalId);
    const total_eventos_raw = relatedRecordGroups.reduce(
      (sum, g) => sum + (g.relatedRecords?.length ?? 0),
      0
    );
    console.log('[ingest-agendate-arcgis] Grupos (lugares con eventos):', relatedRecordGroups.length, '| Total eventos raw:', total_eventos_raw);

    const built = buildContextoEventosRecords(lugaresByGlobalId, relatedRecordGroups);
    records = built.records;
    resumen = {
      source: 'arcgis',
      fuente: FUENTE_ARCGIS,
      total_lugares,
      total_eventos_raw,
      eventos_con_lugar_y_fecha: records.length,
      skipped_sin_lugar: built.skipped_sin_lugar,
      skipped_sin_fecha: built.skipped_sin_fecha,
      window_dias_futuro: DIAS_FUTURO,
    };
  } catch (err) {
    const isConnectivity = isConnectivityError(err);
    console.warn('[ingest-agendate-arcgis] ArcGIS no accesible:', err?.message || err);
    if (isConnectivity) {
      console.error('[ingest-agendate-arcgis] Si el navegador funciona pero Node no, revise Proxy/PAC. Ejecute: npm run net:diag:agendate:arcgis');
    }
    console.log('[ingest-agendate-arcgis] Intentando fuente alternativa: snapshot local', SNAPSHOT_PATH);
    const fallback = await loadSnapshotFallback();

    if (!fallback.valid) {
      const msg = fallback.message || `Snapshot inválido (${fallback.error}).`;
      if (apply) {
        console.error('[ingest-agendate-arcgis]', msg);
        console.error('[ingest-agendate-arcgis] Ver docs/EVENTOS_WAZE_AGENDATE_ARCGIS.md sección "Red bloqueada". Regenerar con: npm run export:agendate:arcgis:snapshot');
        await closePool();
        process.exit(1);
      }
      console.warn('[ingest-agendate-arcgis] ⚠️  DRY RUN: ArcGIS falló y snapshot no válido. No se insertará nada.');
      console.warn('[ingest-agendate-arcgis]', msg);
      if (fallback.stats) console.warn('[ingest-agendate-arcgis] Stats snapshot:', fallback.stats);
      console.warn('[ingest-agendate-arcgis] Para aplicar con snapshot: exporte en entorno con acceso, copie el archivo y vuelva a ejecutar --apply.');
      process.exit(0);
    }

    records = fallback.records;
    resumen = {
      source: 'snapshot',
      fuente: FUENTE_SNAPSHOT,
      eventos_con_lugar_y_fecha: records.length,
      window_dias_futuro: fallback.window_dias,
      ...fallback.stats,
    };
    console.log('[ingest-agendate-arcgis] Usando snapshot. exportedAt:', fallback.exportedAt, '| window_dias:', fallback.window_dias);
    console.log('[ingest-agendate-arcgis] Snapshot válido:', fallback.stats?.total, 'total,', fallback.stats?.con_fecha, 'con_fecha,', fallback.stats?.con_lonlat, 'con_lonlat');
  }

  const currentFuente = resumen.fuente || (resumen.source === 'arcgis' ? FUENTE_ARCGIS : FUENTE_SNAPSHOT);
  const eventos_con_lugar_y_fecha = records.length;
  console.log('[ingest-agendate-arcgis] Resumen:', JSON.stringify(resumen, null, 2));

  if (!apply) {
    console.log('[ingest-agendate-arcgis] DRY RUN - no se hicieron cambios en contexto_eventos.');
    process.exit(0);
  }

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[ingest-agendate-arcgis] No existe tabla contexto_eventos. Ejecuta npm run db:migrate.');
    await closePool();
    process.exit(1);
  }

  let upserted = 0;
  let upserted_con_geom = 0;
  let upserted_sin_geom = 0;
  const errores = [];

  for (const r of records) {
    try {
      const datosExtra = JSON.stringify({ raw: r.raw, lugar_nombre: r.lugar_nombre });
      if (r.geom?.lon != null && r.geom?.lat != null) {
        upserted_con_geom++;
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, origen_id, descripcion, fecha_inicio, fecha_fin, geom, datos_extra)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9::jsonb)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET
             descripcion = EXCLUDED.descripcion,
             fecha_inicio = EXCLUDED.fecha_inicio,
             fecha_fin = EXCLUDED.fecha_fin,
             geom = EXCLUDED.geom,
             datos_extra = EXCLUDED.datos_extra`,
          [
            r.tipo,
            r.fuente,
            r.origen_id,
            r.descripcion,
            r.fecha_inicio.toISOString(),
            r.fecha_fin.toISOString(),
            r.geom.lon,
            r.geom.lat,
            datosExtra,
          ]
        );
      } else {
        upserted_sin_geom++;
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, origen_id, descripcion, fecha_inicio, fecha_fin, datos_extra)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET
             descripcion = EXCLUDED.descripcion,
             fecha_inicio = EXCLUDED.fecha_inicio,
             fecha_fin = EXCLUDED.fecha_fin,
             datos_extra = EXCLUDED.datos_extra`,
          [
            r.tipo,
            r.fuente,
            r.origen_id,
            r.descripcion,
            r.fecha_inicio.toISOString(),
            r.fecha_fin.toISOString(),
            datosExtra,
          ]
        );
      }
      upserted++;
    } catch (err) {
      errores.push({ origen_id: r.origen_id?.slice(0, 20), error: err.message });
    }
  }

  if (errores.length > 0) {
    console.warn('[ingest-agendate-arcgis] Errores en upsert:', errores.length);
    errores.slice(0, 5).forEach((e) => console.warn('  -', e.origen_id, e.error));
  }

  console.log('[ingest-agendate-arcgis] Resumen final: inserted/updated=', upserted, '| con_geom=', upserted_con_geom, '| sin_geom=', upserted_sin_geom);
  if (resumen.skipped_sin_lugar != null || resumen.skipped_sin_fecha != null) {
    console.log('[ingest-agendate-arcgis] Skipped (ArcGIS): sin_lugar=', resumen.skipped_sin_lugar ?? 0, '| sin_fecha=', resumen.skipped_sin_fecha ?? 0);
  }

  const totalFuente = await query(
    `SELECT COUNT(*) AS c FROM contexto_eventos WHERE fuente = $1`,
    [currentFuente]
  ).then((res) => parseInt(res.rows[0]?.c ?? 0, 10));

  console.log('[ingest-agendate-arcgis] Total en BD con fuente', currentFuente + ':', totalFuente);
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-agendate-arcgis]', err.message);
  process.exit(1);
});
