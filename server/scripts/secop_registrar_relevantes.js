/**
 * Registra los 50 contratos SECOP relevantes (filtro quirúrgico) en estudios_transito y archivos_fuente.
 *
 * Uso: node server/scripts/secop_registrar_relevantes.js
 *      npm run secop:registrar-relevantes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import { cumpleFiltro, tipoFromContrato } from './utils/secop_filtro_relevantes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const CATALOG_PATH = path.join(__dirname, 'tmp', 'secop_catalogo_estudios.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

function left(s, n) {
  return (s || '').toString().slice(0, n);
}

function getUrlDocumento(d) {
  const url = d.url_proceso || d.urlproceso || d.url_detalle;
  if (url) return url.trim();
  const uid = d.uid_proceso || (d.referencia_proceso && d.referencia_proceso.includes('NTC') ? d.referencia_proceso : null);
  if (uid) return `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${uid}`;
  return null;
}

async function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('[secop-registrar-relevantes] No encontrado:', CATALOG_PATH);
    console.error('  Ejecuta primero: npm run secop:catalogo (o secop:catalogo:headless)');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (!Array.isArray(data)) {
    console.error('[secop-registrar-relevantes] El catálogo debe ser un array.');
    process.exit(1);
  }

  const relevantes = data.filter(cumpleFiltro);
  let insertados = 0;
  let actualizados = 0;
  let saltados = 0;
  const breakdown = { ETT: 0, PMT: 0, AFORO: 0, PPRU: 0, OTRO: 0 };

  for (const d of relevantes) {
    const urlDoc = getUrlDocumento(d);
    if (!urlDoc) {
      console.warn('[secop-registrar-relevantes] Sin URL, salto:', d.id_proceso || d.referencia_proceso);
      saltados++;
      continue;
    }

    const tipo = tipoFromContrato(d);
    breakdown[tipo] = (breakdown[tipo] || 0) + 1;

    const nombre = left(d.objeto || d.nombre_procedimiento || d.descripcion_del_proceso, 255) || 'Contrato SECOP';
    const consultora = (d.nombre_proveedor || d.nombre_contratista || '').trim().slice(0, 255) || null;
    const cliente = (d.entidad || d.nombre_entidad || '').trim().slice(0, 255) || null;
    const contratoSecop = (d.referencia_proceso || d.id_proceso || d.referencia_contrato || d.numero_contrato || '').toString().slice(0, 100) || null;
    const datosExtra = {
      valor_contrato: d.valor_total_contrato ?? null,
      fecha_firma: d.fecha_de_firma ?? null,
      departamento: d.departamento ?? null,
      municipio: d.municipio ?? null,
      uid_proceso: (d.uid_proceso || d.referencia_proceso || d.id_proceso) || null,
    };

    const existing = await query(
      'SELECT id FROM estudios_transito WHERE url_documento_original = $1 LIMIT 1',
      [urlDoc]
    );

    if (existing.rows[0]) {
      await query(
        `UPDATE estudios_transito SET
           datos_extra = COALESCE(datos_extra, '{}')::jsonb || $1::jsonb,
           updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(datosExtra), existing.rows[0].id]
      );
      actualizados++;
    } else {
      await query(
        `INSERT INTO estudios_transito (
           nombre, tipo, consultora, cliente, contrato_secop, fuente,
           url_documento_original, datos_extra
         ) VALUES ($1, $2, $3, $4, $5, 'SECOP', $6, $7::jsonb)`,
        [nombre, tipo, consultora, cliente, contratoSecop, urlDoc, JSON.stringify(datosExtra)]
      );
      insertados++;
    }

    const etId = (await query('SELECT id FROM estudios_transito WHERE url_documento_original = $1 LIMIT 1', [urlDoc])).rows[0].id;
    const nombreArchivo = left(d.objeto || d.nombre_procedimiento, 200) || 'secop-' + (d.id_proceso || 'sin-id');

    const existeArchivo = await query(
      'SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1',
      [urlDoc, 'SECOP']
    );
    if (!existeArchivo.rows[0]) {
      await query(
        `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, url_remota, procesado, estudio_transito_id, updated_at)
         VALUES ('PDF', 'SECOP', $1, $2, FALSE, $3, NOW())`,
        [nombreArchivo, urlDoc, etId]
      );
    }
  }

  await closePool();

  console.log('[secop-registrar-relevantes] Contratos procesados:', relevantes.length);
  console.log('[secop-registrar-relevantes] Insertados en estudios_transito (nuevos):', insertados);
  console.log('[secop-registrar-relevantes] Actualizados:', actualizados);
  console.log('[secop-registrar-relevantes] Saltados (sin URL):', saltados);
  console.log('[secop-registrar-relevantes] Breakdown por tipo: ETT', breakdown.ETT, '| PMT', breakdown.PMT, '| AFORO', breakdown.AFORO, '| PPRU', breakdown.PPRU, '| OTRO', breakdown.OTRO);
}

main().catch((err) => {
  console.error('[secop-registrar-relevantes]', err.message);
  process.exit(1);
});
