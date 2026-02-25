/**
 * Inspección temporal de GeoJSON en data/datos_abiertos (IDs 15, 17, 22).
 * Muestra tipo, número de features, geometry y properties para decidir destino.
 *
 * Uso: node server/scripts/inspeccionar_geojson.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ids = [15, 17, 22];
for (const id of ids) {
  const dir = path.resolve(__dirname, `../../data/datos_abiertos/${id}`);
  if (!fs.existsSync(dir)) {
    console.log(`ID ${id}: carpeta no encontrada`);
    continue;
  }
  const files = fs.readdirSync(dir);
  console.log(`\n=== ID ${id} ===`);
  console.log('Archivos en carpeta:', files);
  for (const f of files) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, f), 'utf8')
      );
      const features = raw.features || [];
      console.log(`  Tipo: ${raw.type}`);
      console.log(`  Features: ${features.length}`);
      if (features[0]) {
        console.log('  geometry.type:', features[0].geometry?.type);
        console.log('  properties keys:',
          Object.keys(features[0].properties || {}).join(', '));
        console.log('  Primera feature properties:',
          JSON.stringify(features[0].properties, null, 2));
      }
    } catch (e) {
      console.log(`  Error leyendo ${f}:`, e.message);
    }
  }
}
