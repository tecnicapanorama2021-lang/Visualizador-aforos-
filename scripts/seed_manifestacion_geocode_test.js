/**
 * Inserta una manifestación de prueba (NEWS_RSS, geom NULL) que matchea el diccionario de geocode v1,
 * luego ejecuta el procesador de geocode para asignar geom. Sirve para verificar que una manifestación
 * aparece en el mapa.
 *
 * Uso: node scripts/seed_manifestacion_geocode_test.js
 * Requiere: BD con tablas incidentes y migraciones aplicadas.
 */

import 'dotenv/config';
import { query } from '../server/db/client.js';
import { processNewsManifestationsGeocode } from '../server/worker/jobs/newsManifestationsGeocode.js';

const FUENTE = 'NEWS_RSS';
const TITULO = 'Manifestación en Autopista Norte y Calle 80';
const DESCRIPCION = 'Protesta y bloqueo en la Autopista Norte afecta tráfico. Usuarios reportan cierres.';

async function main() {
  const existing = await query(
    `SELECT id, titulo, geom IS NOT NULL AS tiene_geom, quality_status FROM incidentes WHERE tipo = 'MANIFESTACION' AND fuente_principal = $1 AND source_id = $2`,
    [FUENTE, 'test:seed:geocode:v1']
  ).then((r) => r.rows[0]);

  if (existing) {
    if (existing.tiene_geom) {
      console.log('[seed] Ya existe manifestación de prueba con geom. id=', existing.id);
      console.log('  Ver en mapa: GET /api/manifestaciones/nodos');
      process.exit(0);
      return;
    }
    console.log('[seed] Existe manifestación de prueba sin geom. Ejecutando geocode...');
  } else {
    await query(
      `INSERT INTO incidentes (tipo, titulo, descripcion, fuente_principal, source_id, estado, geom_kind, confidence_geo, confidence_tipo, metadata)
       VALUES ('MANIFESTACION', $1, $2, $3, $4, 'ACTIVO', 'POINT', 50, 70, '{"evidence":["https://example.com/test"]}'::jsonb)`,
      [TITULO, DESCRIPCION, FUENTE, 'test:seed:geocode:v1']
    );
    console.log('[seed] Manifestación de prueba insertada (geom NULL).');
  }

  await processNewsManifestationsGeocode();
  const updated = await query(
    `SELECT id, titulo, geom IS NOT NULL AS tiene_geom, quality_status, metadata->'geocode'->>'matched' AS geocode_matched FROM incidentes WHERE tipo = 'MANIFESTACION' AND source_id = 'test:seed:geocode:v1'`
  ).then((r) => r.rows[0]);

  if (updated?.tiene_geom) {
    console.log('[seed] Geocode aplicado. id=', updated.id, 'quality_status=', updated.quality_status, 'matched=', updated.geocode_matched);
    console.log('  Ver en mapa: GET /api/manifestaciones/nodos');
  } else {
    console.log('[seed] No se asignó geom (revisar diccionario o job).');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
