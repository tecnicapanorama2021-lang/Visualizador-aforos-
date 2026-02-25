/**
 * ETL Tarea 2 (real): ingesta de aforos externos desde CSV.
 * Flujo: archivos_fuente → nodos (EXTERNO o existentes) → estudios (EXTERNO) → conteos_resumen.
 * Idempotente: mismo hash reutiliza archivo; nodos por dirección; estudios por (nodo, fecha); UPSERT conteos.
 *
 * Uso: node server/scripts/etl_fuente_externa_csv.js --path=ruta/al/archivo.csv
 * Requiere: migración 002, DATABASE_URL (o PGHOST/PGDATABASE/...)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { query, closePool } from '../db/client.js';
import { geocodeDireccion } from './utils/geocoding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

/** Parsea una línea CSV respetando comillas (valores con coma entre "...") */
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Normaliza texto para búsqueda (dirección/nombre) */
function normalizeKey(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9\s]/g, '');
}

/** Parsea HH:MM a Date en la fecha base (UTC). */
function parseHHMM(s, fechaStr) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (mins < 0 || mins >= 24 * 60) return null;
  const base = fechaStr ? new Date(fechaStr + 'T00:00:00Z') : new Date(0, 0, 1);
  return new Date(base.getTime() + mins * 60 * 1000);
}

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[etl-csv] Configura DATABASE_URL o PGHOST/PGDATABASE/...');
    process.exit(1);
  }

  const pathArg = process.argv.find((a) => a.startsWith('--path='));
  const csvPath = pathArg ? path.resolve(process.cwd(), pathArg.split('=')[1]) : null;
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('[etl-csv] Uso: node etl_fuente_externa_csv.js --path=ruta/al/archivo.csv');
    process.exit(1);
  }

  const nombreArchivo = path.basename(csvPath);
  const raw = fs.readFileSync(csvPath, 'utf8');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    console.error('[etl-csv] CSV debe tener cabecera y al menos una fila de datos.');
    process.exit(1);
  }

  const header = parseCSVLine(lines[0]);
  const col = (name) => {
    const i = header.findIndex((h) => h.toLowerCase().replace(/\s/g, '_') === name);
    return i >= 0 ? i : -1;
  };
  const idx = {
    archivo_nombre: col('archivo_nombre'),
    origen: col('origen'),
    nodo_nombre: col('nodo_nombre'),
    direccion: col('direccion'),
    fecha: col('fecha'),
    sentido: col('sentido'),
    hora_inicio: col('hora_inicio'),
    hora_fin: col('hora_fin'),
    vol_total: col('vol_total'),
    vol_livianos: col('vol_livianos'),
    vol_motos: col('vol_motos'),
    vol_buses: col('vol_buses'),
    vol_pesados: col('vol_pesados'),
    vol_bicis: col('vol_bicis'),
    lat: col('lat'),
    lng: col('lng'),
  };
  if (idx.direccion < 0 || idx.fecha < 0 || idx.sentido < 0 || idx.hora_inicio < 0 || idx.hora_fin < 0 || idx.vol_total < 0) {
    console.error('[etl-csv] Faltan columnas obligatorias: direccion, fecha, sentido, hora_inicio, hora_fin, vol_total');
    process.exit(1);
  }

  const get = (row, key) => (idx[key] >= 0 && row[idx[key]] !== undefined ? String(row[idx[key]] || '').trim() : '');
  const getNum = (row, key) => {
    const v = get(row, key);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  /** Máximo valor para columnas INTEGER en PostgreSQL; evita overflow por valores mal extraídos del PDF */
  const MAX_VOL = 2147483647;
  const getInt = (row, key) => {
    const v = get(row, key);
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(MAX_VOL, n));
  };

  let archivoId;
  const existing = await query(
    'SELECT id, origen FROM archivos_fuente WHERE hash = $1 AND tipo = $2 LIMIT 1',
    [hash, 'CSV']
  );
  if (existing.rows[0]) {
    archivoId = existing.rows[0].id;
    console.log('[etl-csv] Archivo ya registrado (mismo hash), reutilizando archivos_fuente.id =', archivoId);
    await query('UPDATE archivos_fuente SET procesado = FALSE, updated_at = NOW() WHERE id = $1', [archivoId]);
  } else {
    const primeraFila = parseCSVLine(lines[1]);
    const origenArchivo = (idx.origen >= 0 && primeraFila[idx.origen]) ? primeraFila[idx.origen].trim() : 'EXTERNO';
    const ins = await query(
      `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado)
       VALUES ('CSV', $1, $2, $3, FALSE)
       RETURNING id`,
      [origenArchivo, nombreArchivo, hash]
    );
    archivoId = ins.rows[0].id;
    console.log('[etl-csv] Registrado archivos_fuente.id =', archivoId);
  }

  const nodeCache = new Map();
  let newNodeConsecutivo = 0;
  const stats = { nodosCreados: 0, nodosReutilizados: 0, estudiosCreados: 0, estudiosReutilizados: 0, conteosUpsert: 0 };

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const direccion = get(row, 'direccion');
    const nodoNombre = get(row, 'nodo_nombre');
    const fecha = get(row, 'fecha');
    const sentido = get(row, 'sentido') || 'N/A';
    const horaInicio = get(row, 'hora_inicio');
    const horaFin = get(row, 'hora_fin');
    if (!direccion || !fecha) continue;

    const cacheKey = normalizeKey(direccion) || normalizeKey(nodoNombre) || 'sin_ubicacion';
    let nodoId = nodeCache.get(cacheKey);
    if (nodoId == null) {
      const likePattern = '%' + (direccion || nodoNombre).replace(/\s+/g, '%') + '%';
      const search = await query(
        `SELECT id FROM nodos WHERE (COALESCE(direccion,'') || ' ' || COALESCE(nombre,'')) ILIKE $1 LIMIT 1`,
        [likePattern]
      );
      if (search.rows[0]) {
        nodoId = search.rows[0].id;
        nodeCache.set(cacheKey, nodoId);
        stats.nodosReutilizados++;
      } else {
        newNodeConsecutivo++;
        const nodeIdExterno = `ext-${archivoId}-${newNodeConsecutivo}`;
        const latCsv = getNum(row, 'lat');
        const lngCsv = getNum(row, 'lng');
        const coords = (latCsv != null && lngCsv != null) ? { lat: latCsv, lng: lngCsv } : geocodeDireccion(direccion);
        if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
          await query(
            `INSERT INTO nodos (node_id_externo, nombre, direccion, fuente, geom)
             VALUES ($1, $2, $3, 'EXTERNO', ST_SetSRID(ST_MakePoint($4, $5), 4326))
             ON CONFLICT (node_id_externo) DO UPDATE SET direccion = EXCLUDED.direccion, updated_at = NOW()
             RETURNING id`,
            [nodeIdExterno, nodoNombre || direccion, direccion, coords.lng, coords.lat]
          );
        } else {
          await query(
            `INSERT INTO nodos (node_id_externo, nombre, direccion, fuente)
             VALUES ($1, $2, $3, 'EXTERNO')
             ON CONFLICT (node_id_externo) DO UPDATE SET direccion = EXCLUDED.direccion, updated_at = NOW()
             RETURNING id`,
            [nodeIdExterno, nodoNombre || direccion, direccion]
          );
        }
        const r = await query('SELECT id FROM nodos WHERE node_id_externo = $1', [nodeIdExterno]);
        nodoId = r.rows[0].id;
        nodeCache.set(cacheKey, nodoId);
        stats.nodosCreados++;
        if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
          await query(
            `UPDATE nodos SET upz_id = (SELECT u.id FROM upz u WHERE ST_Intersects(nodos.geom, u.geom) LIMIT 1)
             WHERE id = $1 AND upz_id IS NULL AND geom IS NOT NULL`,
            [nodoId]
          );
          await query(
            `UPDATE nodos SET localidad_id = (SELECT l.id FROM localidades l WHERE ST_Intersects(nodos.geom, l.geom) LIMIT 1)
             WHERE id = $1 AND localidad_id IS NULL AND geom IS NOT NULL`,
            [nodoId]
          );
        }
      }
    }

    const fileIdDim = `ext-${archivoId}-${fecha}`;
    let estudioRes = await query(
      'SELECT id FROM estudios WHERE nodo_id = $1 AND file_id_dim = $2',
      [nodoId, fileIdDim]
    );
    let estudioId = estudioRes.rows[0]?.id;
    if (!estudioId) {
      const fechaTs = new Date(fecha + 'T00:00:00Z');
      await query(
        `INSERT INTO estudios (nodo_id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, fuente, archivo_fuente_id)
         VALUES ($1, $2, 'Volúmen vehicular', $3, $3, 'EXTERNO', $4)
         ON CONFLICT (nodo_id, file_id_dim) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [nodoId, fileIdDim, fechaTs, archivoId]
      );
      estudioRes = await query('SELECT id FROM estudios WHERE nodo_id = $1 AND file_id_dim = $2', [nodoId, fileIdDim]);
      estudioId = estudioRes.rows[0].id;
      stats.estudiosCreados++;
    } else {
      stats.estudiosReutilizados++;
    }

    const intervalo_ini = parseHHMM(horaInicio, fecha);
    if (!intervalo_ini) continue;
    const finDate = parseHHMM(horaFin, fecha);
    const intervalo_fin = finDate && finDate.getTime() > intervalo_ini.getTime()
      ? finDate
      : new Date(intervalo_ini.getTime() + 15 * 60 * 1000);

    const vol_total = Math.max(0, getInt(row, 'vol_total'));
    const vol_autos = Math.max(0, getInt(row, 'vol_livianos'));
    const vol_motos = Math.max(0, getInt(row, 'vol_motos'));
    const vol_buses = Math.max(0, getInt(row, 'vol_buses'));
    const vol_pesados = Math.max(0, getInt(row, 'vol_pesados'));
    const vol_bicis = Math.max(0, getInt(row, 'vol_bicis'));
    const vol_otros = Math.max(0, vol_total - (vol_autos + vol_motos + vol_buses + vol_pesados + vol_bicis));

    await query(
      `INSERT INTO conteos_resumen (estudio_id, sentido, intervalo_ini, intervalo_fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (estudio_id, sentido, intervalo_ini) DO UPDATE SET
         intervalo_fin = EXCLUDED.intervalo_fin,
         vol_total = EXCLUDED.vol_total,
         vol_autos = EXCLUDED.vol_autos,
         vol_motos = EXCLUDED.vol_motos,
         vol_buses = EXCLUDED.vol_buses,
         vol_pesados = EXCLUDED.vol_pesados,
         vol_bicis = EXCLUDED.vol_bicis,
         vol_otros = EXCLUDED.vol_otros`,
      [estudioId, sentido, intervalo_ini, intervalo_fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros]
    );
    stats.conteosUpsert++;
  }

  await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [archivoId]);

  console.log('[etl-csv] Resumen:');
  console.log('  archivos_fuente.id =', archivoId, '(procesado = true)');
  console.log('  Nodos creados:', stats.nodosCreados, '| reutilizados:', stats.nodosReutilizados);
  console.log('  Estudios creados:', stats.estudiosCreados, '| reutilizados:', stats.estudiosReutilizados);
  console.log('  Conteos insertados/actualizados:', stats.conteosUpsert);

  const nodosExt = await query(
    "SELECT node_id_externo FROM nodos WHERE fuente = 'EXTERNO' AND node_id_externo LIKE $1 ORDER BY id",
    [`ext-${archivoId}-%`]
  );
  if (nodosExt.rows.length > 0) {
    console.log('  node_id_externo para probar API:', nodosExt.rows.map((r) => r.node_id_externo).join(', '));
    console.log('  Ejemplo: curl -s http://localhost:3001/api/aforos/historial/' + nodosExt.rows[0].node_id_externo + ' | jq .');
  }

  await closePool();
  console.log('[etl-csv] Listo.');
}

main().catch((err) => {
  console.error('[etl-csv] Error:', err.message);
  process.exit(1);
});
