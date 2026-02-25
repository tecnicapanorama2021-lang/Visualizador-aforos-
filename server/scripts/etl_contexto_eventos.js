/**
 * ETL: lee calendario_obras_eventos.json (obras + eventos) e inserta/actualiza
 * la tabla contexto_eventos. Idempotente vía ON CONFLICT (origen_id, fuente).
 *
 * Uso: node server/scripts/etl_contexto_eventos.js
 *      npm run etl:contexto
 *
 * No modifica los jobs que generan el JSON; solo consume su salida.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const CALENDAR_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'calendario_obras_eventos.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

/** Mapea tipo/descripción de evento a tipo contexto_eventos. */
function mapTipoEvento(ev) {
  const d = (ev.descripcion || '').toLowerCase();
  if (d.includes('cierre') && (d.includes('vial') || d.includes('desvío'))) return 'CIERRE_VIA';
  if (d.includes('manifestación') || d.includes('marcha') || d.includes('protesta')) return 'MANIFESTACION';
  return 'EVENTO_CULTURAL';
}

async function main() {
  if (!fs.existsSync(CALENDAR_PATH)) {
    console.error('[etl-contexto] No encontrado:', CALENDAR_PATH);
    process.exit(1);
  }

  const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('[etl-contexto] JSON inválido:', e.message);
    process.exit(1);
  }

  const obras = Array.isArray(data.obras) ? data.obras : [];
  const eventos = Array.isArray(data.eventos) ? data.eventos : [];

  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[etl-contexto] Ejecuta npm run db:migrate (tabla contexto_eventos).');
    process.exit(1);
  }

  let insertadosObras = 0;
  let insertadosEventos = 0;

  // --- Obras: tipo OBRA, fuente IDU/CKAN/ArcGIS, geom desde geometry ---
  for (const o of obras) {
    const origenId = o.id ? String(o.id).slice(0, 255) : null;
    if (!origenId) continue;
    const fuente = (o.fuente || 'IDU').slice(0, 50);
    const descripcion = (o.nombre || o.descripcion || '').slice(0, 2000) || null;
    const fechaInicio = o.fecha_inicio ? new Date(o.fecha_inicio).toISOString() : null;
    const fechaFin = o.fecha_fin ? new Date(o.fecha_fin).toISOString() : null;
    const geomJson = o.geometry && o.geometry.type && o.geometry.coordinates
      ? JSON.stringify(o.geometry)
      : null;

    try {
      if (geomJson) {
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota)
           VALUES ('OBRA', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6, $7)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, geom = EXCLUDED.geom`,
          [fuente, descripcion, fechaInicio, fechaFin, geomJson, origenId, null]
        );
      } else {
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, origen_id, url_remota)
           VALUES ('OBRA', $1, $2, $3::timestamptz, $4::timestamptz, $5, $6)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin`,
          [fuente, descripcion, fechaInicio, fechaFin, origenId, null]
        );
      }
      insertadosObras++;
    } catch (err) {
      console.warn('[etl-contexto] Obra', origenId, err.message);
    }
  }

  // --- Eventos: tipo EVENTO_CULTURAL/CIERRE_VIA/MANIFESTACION, fuente RSS; persistir zona/ubicacion texto ---
  const ubicacionTextoSql = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'ubicacion_texto'`
  ).then((r) => r.rows[0]);

  for (const e of eventos) {
    const origenId = e.id ? String(e.id).slice(0, 255) : null;
    if (!origenId) continue;
    const tipo = mapTipoEvento(e);
    const fuente = 'RSS';
    const descripcion = (e.descripcion || '').slice(0, 2000) || null;
    const fechaInicio = e.fecha_inicio ? new Date(e.fecha_inicio).toISOString() : null;
    const fechaFin = e.fecha_fin ? new Date(e.fecha_fin).toISOString() : null;
    const urlRemota = (e.url || null) ? String(e.url).slice(0, 2048) : null;
    const ubicacionTexto = (e.ubicacion || e.zona || null) ? String(e.ubicacion || e.zona).slice(0, 500) : null;
    const zonaTexto = (e.zona || e.ubicacion || null) ? String(e.zona || e.ubicacion).slice(0, 500) : null;

    try {
      if (ubicacionTextoSql) {
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, origen_id, url_remota, ubicacion_texto, zona_texto)
           VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, url_remota = EXCLUDED.url_remota, ubicacion_texto = EXCLUDED.ubicacion_texto, zona_texto = EXCLUDED.zona_texto`,
          [tipo, fuente, descripcion, fechaInicio, fechaFin, origenId, urlRemota, ubicacionTexto, zonaTexto]
        );
      } else {
        await query(
          `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, origen_id, url_remota)
           VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
           ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
           DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, url_remota = EXCLUDED.url_remota`,
          [tipo, fuente, descripcion, fechaInicio, fechaFin, origenId, urlRemota]
        );
      }
      insertadosEventos++;
    } catch (err) {
      console.warn('[etl-contexto] Evento', origenId.slice(0, 30) + '...', err.message);
    }
  }

  // Asignar upz_id y localidad_id a registros con geom (ST_Intersects con upz/localidades)
  const hasUpzCol = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'upz_id'`
  ).then((r) => r.rows[0]);
  if (hasUpzCol) {
    await query(`
      UPDATE contexto_eventos c SET upz_id = u.id
      FROM upz u WHERE ST_Intersects(c.geom, u.geom) AND c.geom IS NOT NULL AND u.geom IS NOT NULL
    `);
    await query(`
      UPDATE contexto_eventos c SET localidad_id = l.id
      FROM localidades l WHERE ST_Intersects(c.geom, l.geom) AND c.geom IS NOT NULL AND l.geom IS NOT NULL
    `);
    const upzCtx = await query('SELECT COUNT(*) AS c FROM contexto_eventos WHERE upz_id IS NOT NULL').then((r) => r.rows[0].c);
    const locCtx = await query('SELECT COUNT(*) AS c FROM contexto_eventos WHERE localidad_id IS NOT NULL').then((r) => r.rows[0].c);
    console.log('[etl-contexto] Zonas asignadas: upz_id', upzCtx, '| localidad_id', locCtx);
  }

  await closePool();
  console.log('[etl-contexto] Resumen: obras', insertadosObras, '| eventos', insertadosEventos);
}

main().catch((err) => {
  console.error('[etl-contexto]', err.message);
  process.exit(1);
});
