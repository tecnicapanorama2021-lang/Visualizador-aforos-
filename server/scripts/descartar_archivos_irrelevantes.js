/**
 * Marca como procesado=TRUE los archivos DATOS_ABIERTOS que no son de tránsito
 * (personas únicas, beneficiarios, encuestas, metadatos SDIS, etc.) con nota en datos_extra.
 *
 * Uso: node server/scripts/descartar_archivos_irrelevantes.js
 *      npm run datos-abiertos:descartar-irrelevantes
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const UPDATE_SQL_PATRONES = `
UPDATE archivos_fuente
SET procesado = TRUE,
    datos_extra = jsonb_set(
      COALESCE(datos_extra, '{}'),
      '{descartado}', 'true'
    ) || jsonb_build_object(
      'razon', 'No contiene datos de tránsito vehicular',
      'descartado_en', NOW()::text
    )
WHERE origen = 'DATOS_ABIERTOS'
  AND procesado = FALSE
  AND (
    nombre_archivo ILIKE '%personas%unicas%'
    OR nombre_archivo ILIKE '%beneficiarios%'
    OR nombre_archivo ILIKE '%multiprop%'
    OR nombre_archivo ILIKE '%metadata%conteo%persona%'
    OR nombre_archivo ILIKE '%sdis%'
    OR nombre_archivo ILIKE '%encuesta%'
  )
`;

const UPDATE_SQL_UTC_GEOJSON22 = `
UPDATE archivos_fuente
SET procesado = TRUE,
    datos_extra = COALESCE(datos_extra, '{}')::jsonb
    || jsonb_build_object(
        'descartado', true,
        'razon', 'No contiene datos de tránsito vehicular',
        'descartado_en', NOW()::text
       )
WHERE origen = 'DATOS_ABIERTOS'
  AND procesado = FALSE
  AND (
    nombre_archivo ILIKE '%UTC_CONTEO%'
    OR id IN (22)
  )
`;

async function main() {
  const res1 = await query(UPDATE_SQL_PATRONES);
  const count1 = res1.rowCount ?? 0;
  const res2 = await query(UPDATE_SQL_UTC_GEOJSON22);
  const count2 = res2.rowCount ?? 0;
  await closePool();
  console.log('[datos-abiertos:descartar] Por patrones (personas/beneficiarios/encuesta/etc.):', count1);
  console.log('[datos-abiertos:descartar] Adicionales (UTC_CONTEO / id=22):', count2);
  console.log('[datos-abiertos:descartar] Total marcados como descartados:', count1 + count2);
}

main().catch((err) => {
  console.error('[datos-abiertos:descartar]', err.message);
  process.exit(1);
});
