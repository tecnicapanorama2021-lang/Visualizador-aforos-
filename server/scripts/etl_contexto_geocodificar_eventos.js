/**
 * Geocodifica eventos RSS en contexto_eventos que tienen ubicacion_texto o zona_texto
 * pero geom NULL, usando la lista interna de lugares/vías de Bogotá (server/utils/lugaresBogota.js).
 * Actualiza geom con ST_MakePoint(lon, lat). Tras ejecutar, correr etl:contexto-zonas para asignar localidad_id/upz_id.
 *
 * Uso: node server/scripts/etl_contexto_geocodificar_eventos.js
 *      npm run etl:contexto-geocode
 *
 * Secuencia recomendada: etl:contexto → etl:contexto-geocode → etl:contexto-zonas
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';
import { geocode } from '../utils/lugaresBogota.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

async function main() {
  const hasUbicacion = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'ubicacion_texto'`
  ).then((r) => r.rows[0]);
  if (!hasUbicacion) {
    console.error('[etl-contexto-geocode] Columna ubicacion_texto no existe. Ejecuta npm run db:migrate (012).');
    process.exit(1);
  }

  const candidatos = await query(`
    SELECT id, ubicacion_texto, zona_texto
    FROM contexto_eventos
    WHERE fuente = 'RSS' AND geom IS NULL
      AND (ubicacion_texto IS NOT NULL AND ubicacion_texto <> '' OR zona_texto IS NOT NULL AND zona_texto <> '')
  `);

  const filas = candidatos.rows;
  let geocodificados = 0;

  for (const row of filas) {
    const texto = (row.ubicacion_texto || row.zona_texto || '').trim();
    if (!texto) continue;
    const coords = geocode(texto);
    if (!coords) continue;
    try {
      await query(
        `UPDATE contexto_eventos SET geom = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
        [coords.lon, coords.lat, row.id]
      );
      geocodificados++;
    } catch (err) {
      console.warn('[etl-contexto-geocode] id', row.id, err.message);
    }
  }

  await closePool();
  console.log('[etl-contexto-geocode] Eventos candidatos:', filas.length);
  console.log('[etl-contexto-geocode] Eventos geocodificados:', geocodificados);
  console.log('[etl-contexto-geocode] Sin match:', filas.length - geocodificados);
  console.log('[etl-contexto-geocode] Siguiente paso: npm run etl:contexto-zonas');
}

main().catch((err) => {
  console.error('[etl-contexto-geocode]', err.message);
  process.exit(1);
});
