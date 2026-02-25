/**
 * ETL Fase 1: nodos + estudios desde studies_dictionary.json y nodos_unificados.json.
 * Idempotente: UPSERT por node_id_externo y por (nodo_id, file_id_dim).
 *
 * Uso: node server/scripts/etl_nodos_estudios_from_json.js
 * Requiere: DATABASE_URL (o PGHOST, PGDATABASE, PGUSER, PGPASSWORD)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

const STUDIES_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'studies_dictionary.json');
const NODOS_UNIFICADOS_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'nodos_unificados.json');

function loadJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`[ETL] No encontrado: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[ETL] JSON inválido en ${label}:`, e.message);
    process.exit(1);
  }
}

/**
 * Construye mapa: node_id_externo (de nodos_unificados) -> { nombre, coords }.
 * También índice por dirección/nombre normalizado para cruce con studies_dictionary.
 */
function buildNodosUnificadosMap(data) {
  const byId = new Map();
  const byAddress = new Map();
  const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  const features = data?.features || [];
  for (const f of features) {
    const props = f.properties || {};
    const id = String(props.id ?? props.FID ?? '');
    const nombre = props.nombre || props.name || props.raw_data?.address || props.raw_data?.name || '';
    const coords = f.geometry?.coordinates;
    if (!id && !nombre) continue;

    const lon = coords?.[0];
    const lat = coords?.[1];
    const point = lon != null && lat != null ? { lon, lat } : null;

    if (id) {
      byId.set(id, { nombre, point, id });
    }
    if (nombre) {
      const key = normalize(nombre);
      if (!byAddress.has(key)) byAddress.set(key, { nombre, point });
    }
    const addr = props.raw_data?.address || props.address;
    if (addr) {
      const key = normalize(addr);
      if (!byAddress.has(key)) byAddress.set(key, { nombre: addr, point });
    }
  }
  return { byId, byAddress, normalize };
}

function main() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ETL] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  const studiesData = loadJson(STUDIES_PATH, 'studies_dictionary');
  const nodesDict = studiesData?.nodes;
  if (!nodesDict || typeof nodesDict !== 'object') {
    console.error('[ETL] studies_dictionary.json no tiene "nodes"');
    process.exit(1);
  }

  let nodosUnif = { byId: new Map(), byAddress: new Map(), normalize: (s) => s };
  if (fs.existsSync(NODOS_UNIFICADOS_PATH)) {
    const unifData = loadJson(NODOS_UNIFICADOS_PATH, 'nodos_unificados');
    nodosUnif = buildNodosUnificadosMap(unifData);
  }

  const pool = getPool();
  const now = new Date().toISOString();

  let stats = { nodosInsert: 0, nodosUpdate: 0, estudiosInsert: 0, estudiosUpdate: 0 };

  (async () => {
    try {
      // 1) UPSERT nodos
      for (const [nodeIdExterno, node] of Object.entries(nodesDict)) {
        const internalIdDim = node.internal_id != null ? parseInt(node.internal_id, 10) : null;
        const direccion = node.address || node.direccion || '';
        const nombre = node.nombre_nodo || node.via_principal || direccion || nodeIdExterno;

        let geom = null;
        const byIdMatch = nodosUnif.byId.get(nodeIdExterno);
        if (byIdMatch?.point) {
          geom = `SRID=4326;POINT(${byIdMatch.point.lon} ${byIdMatch.point.lat})`;
        } else {
          const key = nodosUnif.normalize(direccion || nombre);
          const byAddr = nodosUnif.byAddress.get(key);
          if (byAddr?.point) {
            geom = `SRID=4326;POINT(${byAddr.point.lon} ${byAddr.point.lat})`;
          }
        }

        const existedNodo = await query('SELECT id FROM nodos WHERE node_id_externo = $1', [nodeIdExterno]);
        const res = await query(
          `INSERT INTO nodos (node_id_externo, internal_id_dim, nombre, direccion, geom, fuente, updated_at)
           VALUES ($1, $2, $3, $4, $5::geometry, 'DIM', $6)
           ON CONFLICT (node_id_externo) DO UPDATE SET
             internal_id_dim = EXCLUDED.internal_id_dim,
             nombre = COALESCE(NULLIF(EXCLUDED.nombre,''), nodos.nombre),
             direccion = COALESCE(NULLIF(EXCLUDED.direccion,''), nodos.direccion),
             geom = COALESCE(EXCLUDED.geom, nodos.geom),
             updated_at = EXCLUDED.updated_at
           RETURNING id`,
          [nodeIdExterno, internalIdDim, nombre || null, direccion || null, geom, now]
        );
        const row = res.rows[0];
        if (existedNodo.rows.length > 0) stats.nodosUpdate++;
        else stats.nodosInsert++;

        const nodoPk = row?.id;
        if (!nodoPk) continue;

        const studies = node.studies || [];
        for (const s of studies) {
          const fileIdDim = s.file_id != null ? String(s.file_id) : null;
          const tipoEstudio = s.type || 'Volúmen vehicular';
          const fechaInicio = s.date ? new Date(s.date + 'T00:00:00Z') : new Date();
          const fechaFin = s.date_end ? new Date(s.date_end + 'T00:00:00Z') : null;
          const downloadUrl = s.download_url || null;
          const contratista = Array.isArray(s.contractors) && s.contractors.length ? s.contractors[0] : null;
          const totalRecords = s.total_records != null ? parseInt(s.total_records, 10) : null;
          const vehicleTypes = Array.isArray(s.vehicle_types) ? s.vehicle_types : null;

          const existedEst = await query(
            'SELECT 1 FROM estudios WHERE nodo_id = $1 AND file_id_dim = $2',
            [nodoPk, fileIdDim]
          );
          await query(
            `INSERT INTO estudios (nodo_id, file_id_dim, tipo_estudio, fecha_inicio, fecha_fin, download_url, contratista, total_records, vehicle_types, fuente, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DIM', $10)
             ON CONFLICT (nodo_id, file_id_dim) DO UPDATE SET
               tipo_estudio = EXCLUDED.tipo_estudio,
               fecha_inicio = EXCLUDED.fecha_inicio,
               fecha_fin = EXCLUDED.fecha_fin,
               download_url = EXCLUDED.download_url,
               contratista = EXCLUDED.contratista,
               total_records = EXCLUDED.total_records,
               vehicle_types = EXCLUDED.vehicle_types,
               updated_at = EXCLUDED.updated_at`,
            [nodoPk, fileIdDim, tipoEstudio, fechaInicio, fechaFin, downloadUrl, contratista, totalRecords, vehicleTypes, now]
          );
          if (existedEst.rows.length > 0) stats.estudiosUpdate++;
          else stats.estudiosInsert++;
        }
      }

      console.log('[ETL Fase 1] Resumen:');
      console.log('  Nodos insertados:', stats.nodosInsert);
      console.log('  Nodos actualizados:', stats.nodosUpdate);
      console.log('  Estudios insertados:', stats.estudiosInsert);
      console.log('  Estudios actualizados:', stats.estudiosUpdate);
    } catch (err) {
      console.error('[ETL Fase 1] Error:', err.message);
      process.exit(1);
    } finally {
      await closePool();
    }
  })();
}

main();
