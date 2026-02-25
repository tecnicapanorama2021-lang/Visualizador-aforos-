/**
 * ETL demo Tarea 2: ingesta de un estudio externo desde un JSON de ejemplo.
 * Muestra el flujo: archivos_fuente → resolver/crear nodo → estudio → conteos_resumen.
 * La lectura real de PDF/Excel se sustituye por este JSON; luego puedes adaptar el parser.
 *
 * Uso: node server/scripts/etl_fuente_externa_demo.js [--path=server/scripts/data/estudio_externo_ejemplo.json]
 * Requiere: migración 002 aplicada (archivos_fuente, estudios.archivo_fuente_id)
 * Requiere: DATABASE_URL (o PGHOST, PGDATABASE, PGUSER, PGPASSWORD)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const DEFAULT_INPUT = path.join(__dirname, 'data', 'estudio_externo_ejemplo.json');

const CLASS_TO_COL = {
  livianos: 'vol_autos', autos: 'vol_autos', l: 'vol_autos',
  motos: 'vol_motos', m: 'vol_motos',
  buses: 'vol_buses', buses_articulados: 'vol_buses', b: 'vol_buses',
  camiones: 'vol_pesados', pesados: 'vol_pesados', c: 'vol_pesados',
  bicicletas: 'vol_bicis', bicis: 'vol_bicis', bi: 'vol_bicis',
};

function normalizeClassKey(k) {
  return String(k || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
}

function mapClassesToVolumes(classes) {
  const out = { vol_autos: 0, vol_motos: 0, vol_buses: 0, vol_pesados: 0, vol_bicis: 0, vol_otros: 0 };
  if (!classes || typeof classes !== 'object') return out;
  for (const [k, v] of Object.entries(classes)) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : parseInt(v, 10) || 0;
    const key = normalizeClassKey(k);
    const col = CLASS_TO_COL[key];
    if (col && out[col] !== undefined) out[col] += n;
    else out.vol_otros += n;
  }
  return out;
}

function parseHoraRango(horaRango, fechaStr) {
  if (!horaRango || typeof horaRango !== 'string') return null;
  const s = horaRango.trim();
  const part = s.includes(' - ') ? s.split(' - ').map((p) => p.trim()) : [s, s];
  const parseTime = (t) => {
    if (t == null) return null;
    const str = String(t).trim();
    const m = str.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const n = parseInt(str.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n >= 0 && n < 2400) return Math.floor(n / 100) * 60 + (n % 100);
    return null;
  };
  const ini = parseTime(part[0]);
  let fin = parseTime(part[1] || part[0]);
  if (ini == null) return null;
  if (fin == null) fin = ini + 15;
  if (fin === ini) fin = ini + 15;
  const baseDate = fechaStr ? new Date(fechaStr + 'T00:00:00Z') : new Date(0, 0, 1);
  return {
    intervalo_ini: new Date(baseDate.getTime() + ini * 60 * 1000),
    intervalo_fin: new Date(baseDate.getTime() + fin * 60 * 1000),
  };
}

/** Normaliza texto para búsqueda (dirección/nombre) */
function normalizeUbicacion(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9\s]/g, '');
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
    console.error('[etl-fuente-externa] Configura DATABASE_URL o PGHOST/PGDATABASE/...');
    process.exit(1);
  }

  const pathArg = process.argv.find((a) => a.startsWith('--path='));
  const inputPath = pathArg ? path.resolve(process.cwd(), pathArg.split('=')[1]) : DEFAULT_INPUT;
  if (!fs.existsSync(inputPath)) {
    console.error('[etl-fuente-externa] No encontrado:', inputPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('[etl-fuente-externa] JSON inválido:', e.message);
    process.exit(1);
  }

  const ubicacion = data.ubicacion || data.direccion || 'Sin ubicación';
  const fechaInicio = data.fecha_inicio || data.fecha;
  const fechaFin = data.fecha_fin || fechaInicio;
  const tipoEstudio = data.tipo_estudio || 'Volúmen vehicular';
  const contratista = data.contratista || 'Externo';
  const conteos = data.conteos || [];

  if (!fechaInicio) {
    console.error('[etl-fuente-externa] Falta fecha_inicio en el JSON');
    process.exit(1);
  }

  const nombreArchivo = path.basename(inputPath);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  console.log('[etl-fuente-externa] Registrando archivo en archivos_fuente...');
  const insertArchivo = await query(
    `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING id`,
    ['JSON', 'demo', nombreArchivo, hash]
  );
  const archivoId = insertArchivo.rows[0].id;
  console.log('  archivo_fuente.id =', archivoId);

  const fileIdDim = `ext-${archivoId}-${fechaInicio}`;

  let nodoId;
  const normUbic = normalizeUbicacion(ubicacion);
  if (normUbic.length >= 3) {
    const likePattern = '%' + normUbic.split(/\s+/).filter(Boolean).join('%') + '%';
    const search = await query(
      `SELECT id, node_id_externo, direccion FROM nodos
       WHERE (COALESCE(direccion,'') || ' ' || COALESCE(nombre,'')) ILIKE $1
       LIMIT 1`,
      [likePattern]
    );
    if (search.rows[0]) {
      nodoId = search.rows[0].id;
      console.log('[etl-fuente-externa] Nodo existente:', search.rows[0].node_id_externo, search.rows[0].direccion);
    }
  }

  if (nodoId == null) {
    const nodeIdExterno = `ext-${archivoId}-1`;
    const insertNodo = await query(
      `INSERT INTO nodos (node_id_externo, nombre, direccion, fuente)
       VALUES ($1, $2, $3, 'EXTERNO')
       ON CONFLICT (node_id_externo) DO UPDATE SET direccion = EXCLUDED.direccion, updated_at = NOW()
       RETURNING id`,
      [nodeIdExterno, ubicacion, ubicacion]
    );
    nodoId = insertNodo.rows[0].id;
    console.log('[etl-fuente-externa] Nodo creado: node_id_externo =', nodeIdExterno);
  }

  const fechaInicioTs = new Date(fechaInicio + 'T00:00:00Z');
  const fechaFinTs = fechaFin ? new Date(fechaFin + 'T23:59:59Z') : fechaInicioTs;

  console.log('[etl-fuente-externa] Creando estudio en estudios...');
  await query(
    `INSERT INTO estudios (nodo_id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, contratista, fuente, archivo_fuente_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'EXTERNO', $7)
     ON CONFLICT (nodo_id, file_id_dim) DO UPDATE SET
       fecha_fin = EXCLUDED.fecha_fin,
       contratista = EXCLUDED.contratista,
       updated_at = NOW()`,
    [nodoId, fileIdDim, tipoEstudio, fechaInicioTs, fechaFinTs, contratista, archivoId]
  );
  const estudioRes = await query('SELECT id FROM estudios WHERE nodo_id = $1 AND file_id_dim = $2', [nodoId, fileIdDim]);
  const estudioId = estudioRes.rows[0].id;
  console.log('  estudio.id =', estudioId);

  console.log('[etl-fuente-externa] Insertando conteos en conteos_resumen (mismo formato que DIM)...');
  let inserted = 0;
  for (const row of conteos) {
    const sentido = row.sentido || row.sentidoDisplay || 'N/A';
    const parsed = parseHoraRango(row.horaRango || row.hora_rango, fechaInicio);
    if (!parsed) continue;
    const vols = mapClassesToVolumes(row.classes);
    let volTotal = row.total != null ? (typeof row.total === 'number' ? row.total : parseFloat(row.total)) : 0;
    if (!Number.isFinite(volTotal)) volTotal = 0;
    volTotal = Math.round(volTotal) || Math.round(vols.vol_autos + vols.vol_motos + vols.vol_buses + vols.vol_pesados + vols.vol_bicis + vols.vol_otros);

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
      [
        estudioId,
        sentido,
        parsed.intervalo_ini,
        parsed.intervalo_fin,
        volTotal,
        Math.round(vols.vol_autos) || 0,
        Math.round(vols.vol_motos) || 0,
        Math.round(vols.vol_buses) || 0,
        Math.round(vols.vol_pesados) || 0,
        Math.round(vols.vol_bicis) || 0,
        Math.round(vols.vol_otros) || 0,
      ]
    );
    inserted++;
  }

  await query('UPDATE archivos_fuente SET procesado = TRUE, updated_at = NOW() WHERE id = $1', [archivoId]);

  console.log('[etl-fuente-externa] Resumen:');
  console.log('  archivos_fuente.id =', archivoId, '(procesado = true)');
  console.log('  nodo_id =', nodoId);
  console.log('  estudio_id =', estudioId);
  console.log('  conteos_resumen insertados/actualizados =', inserted);
  await closePool();
  console.log('[etl-fuente-externa] Listo.');
}

main().catch((err) => {
  console.error('[etl-fuente-externa] Error:', err.message);
  process.exit(1);
});
