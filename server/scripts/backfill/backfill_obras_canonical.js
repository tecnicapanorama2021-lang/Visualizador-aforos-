/**
 * Backfill de campos canónicos para incidentes tipo OBRA desde metadata.arcgis.attributes_raw.
 * Requiere: migración 029 y arcgis_domains_cache poblado (npm run arcgis:domains:sync).
 * Uso: node server/scripts/backfill/backfill_obras_canonical.js [--apply]
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DEFAULT_SERVICE_URL =
  process.env.ARCGIS_BASE_URL ||
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer';
const LAYER_ID = parseInt(process.env.LAYER_ID ?? '0', 10);

async function loadDomains() {
  const rows = await query(
    `SELECT field_name, code, name FROM arcgis_domains_cache WHERE service_url = $1 AND layer_id = $2`,
    [DEFAULT_SERVICE_URL.replace(/\/$/, ''), LAYER_ID]
  );
  const byField = {};
  for (const r of rows.rows) {
    if (!byField[r.field_name]) byField[r.field_name] = {};
    byField[r.field_name][r.code] = r.name;
  }
  return byField;
}

function resolveName(domains, fieldName, code) {
  if (code == null || String(code).trim() === '') return null;
  const map = domains[fieldName];
  return map?.[String(code)] ?? String(code).trim();
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[backfill-obras] Configura DATABASE_URL o variables PG*');
    process.exit(1);
  }

  const domains = await loadDomains();
  console.log('[backfill-obras] Dominios cargados para campos:', Object.keys(domains).join(', ') || '(ninguno)');

  const obras = await query(
    `SELECT id, metadata, ST_GeometryType(geom) AS geom_type
     FROM incidentes
     WHERE tipo = 'OBRA' AND metadata->'arcgis'->'attributes_raw' IS NOT NULL
     ORDER BY id`
  );
  console.log('[backfill-obras] Obras con attributes_raw:', obras.rows.length);

  let high = 0, med = 0, low = 0;
  for (const row of obras.rows) {
    const attrs = row.metadata?.arcgis?.attributes_raw || {};
    const title = (attrs.OBRA != null && String(attrs.OBRA).trim()) ? String(attrs.OBRA).trim() : null;
    const objetivo = (attrs.OBJETIVO != null && String(attrs.OBJETIVO).trim()) ? String(attrs.OBJETIVO).trim().slice(0, 2000) : null;
    const ubicacion = (attrs.UBICACION != null && String(attrs.UBICACION).trim()) ? String(attrs.UBICACION).trim().slice(0, 500) : null;
    const codRel = (attrs.COD_REL ?? attrs.CODREL) != null ? String(attrs.COD_REL ?? attrs.CODREL).trim() : null;
    const codObra = (attrs.COD_OBRA ?? attrs.CODOBRA) != null ? String(attrs.COD_OBRA ?? attrs.CODOBRA).trim() : null;
    const upz = (attrs.UPZ != null && String(attrs.UPZ).trim()) ? String(attrs.UPZ).trim() : null;
    const entidadCode = (attrs.ENTIDAD != null && String(attrs.ENTIDAD).trim()) ? String(attrs.ENTIDAD).trim() : null;
    const localidadCode = (attrs.LOCALIDAD != null && String(attrs.LOCALIDAD).trim()) ? String(attrs.LOCALIDAD).trim() : null;
    const estadoCode = (attrs.ESTADO != null && String(attrs.ESTADO).trim()) ? String(attrs.ESTADO).trim() : null;
    const tipoObraCode = (attrs.TIPO_OBRA != null && String(attrs.TIPO_OBRA).trim()) ? String(attrs.TIPO_OBRA).trim() : null;
    const entidadName = entidadCode ? resolveName(domains, 'ENTIDAD', entidadCode) : null;
    const localidadName = localidadCode ? resolveName(domains, 'LOCALIDAD', localidadCode) : null;
    const estadoName = estadoCode ? resolveName(domains, 'ESTADO', estadoCode) : null;
    const tipoObraName = tipoObraCode ? resolveName(domains, 'TIPO_OBRA', tipoObraCode) : null;
    const geomRich = row.geom_type && row.geom_type !== 'ST_Point';
    let qualityStatus = 'LOW';
    if (title && objetivo) {
      qualityStatus = geomRich ? 'HIGH' : 'MED';
    }
    if (qualityStatus === 'HIGH') high++;
    else if (qualityStatus === 'MED') med++;
    else low++;

    if (apply) {
      await query(
        `UPDATE incidentes SET
          title = $2, objetivo = $3, ubicacion = $4,
          cod_rel = $5, cod_obra = $6,
          entidad_code = $7, entidad_name = $8,
          localidad_code = $9, localidad_name = $10,
          estado_code = $11, estado_name = $12,
          tipo_obra_code = $13, tipo_obra_name = $14,
          upz = $15,
          source_system = COALESCE(source_system, fuente_principal),
          quality_status = $16,
          updated_at = now()
         WHERE id = $1`,
        [
          row.id, title, objetivo, ubicacion,
          codRel, codObra,
          entidadCode, entidadName,
          localidadCode, localidadName,
          estadoCode, estadoName,
          tipoObraCode, tipoObraName,
          upz,
          qualityStatus,
        ]
      );
    }
  }

  console.log('[backfill-obras] quality_status: HIGH=', high, 'MED=', med, 'LOW=', low);
  if (!apply) {
    console.log('[backfill-obras] Dry-run. Para aplicar: node server/scripts/backfill/backfill_obras_canonical.js --apply');
  }
  await closePool();
}

main().catch((err) => {
  console.error('[backfill-obras]', err);
  process.exit(1);
});
