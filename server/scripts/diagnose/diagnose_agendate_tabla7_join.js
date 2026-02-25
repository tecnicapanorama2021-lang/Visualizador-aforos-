/**
 * Diagnóstico automático del join eventos (tabla 7 raw) ↔ LUGAR_EVENTO (BD).
 * Sin llamadas a internet. Imprime campos disponibles y tasa de match por estrategia.
 *
 * Uso: node server/scripts/diagnose/diagnose_agendate_tabla7_join.js
 *      npm run diag:agendate:join
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';
import {
  extractRecords,
  getAttrs,
  CANDIDATE_NAME_KEYS,
  CANDIDATE_KEY_KEYS,
  detectEventKeys,
  detectPlaceMetaKeys,
  runJoinDiagnosis,
} from '../../utils/agendate_tabla7_join.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
const RAW_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'agendate_eventos_tabla7_raw.json');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const SAMPLE_SIZE = 20;

async function main() {
  console.log('\n=== Diagnóstico join Agéndate tabla 7 ↔ LUGAR_EVENTO (BD) ===\n');

  let raw;
  try {
    raw = await fs.readFile(RAW_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('ERROR: No se encontró el archivo raw:', RAW_PATH);
      console.error('  Copie el JSON de la tabla 7 a public/data/agendate_eventos_tabla7_raw.json');
    } else {
      console.error('Error leyendo raw:', err.message);
    }
    process.exit(1);
  }

  const parsed = JSON.parse(raw);
  const records = extractRecords(parsed);
  const eventsAttrs = records.map((item) => getAttrs(item)).filter((a) => Object.keys(a || {}).length > 0);

  if (eventsAttrs.length === 0) {
    console.error('ERROR: El raw no contiene registros (features/records/results vacíos o sin attributes).');
    process.exit(1);
  }

  // 1–2) Muestra 20 eventos y listar keys
  const sampleAttrs = eventsAttrs.slice(0, SAMPLE_SIZE);
  const eventKeys = detectEventKeys(sampleAttrs);
  console.log('1) Raw: muestra de', Math.min(SAMPLE_SIZE, eventsAttrs.length), 'eventos');
  console.log('   Keys en attributes:', eventKeys.sort().join(', '));
  const hasCandidatos = {
    name: CANDIDATE_NAME_KEYS.filter((k) => eventKeys.includes(k)),
    key: CANDIDATE_KEY_KEYS.filter((k) => eventKeys.includes(k)),
  };
  console.log('   Candidatos nombre presentes:', hasCandidatos.name.length ? hasCandidatos.name.join(', ') : 'ninguno');
  console.log('   Candidatos key presentes:', hasCandidatos.key.length ? hasCandidatos.key.join(', ') : 'ninguno');
  console.log('');

  // 3) BD: muestra 20 LUGAR_EVENTO
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('ERROR: Configura DATABASE_URL o PGHOST/PGDATABASE para consultar LUGAR_EVENTO.');
    process.exit(1);
  }

  const hasUbicacion = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'ubicacion_texto'`
  ).then((r) => r.rows[0]);
  const titleExpr = hasUbicacion ? "COALESCE(ubicacion_texto, descripcion)" : "descripcion";

  const placeRows = await query(
    `SELECT id, ${titleExpr} AS titulo, datos_extra FROM contexto_eventos WHERE tipo = 'LUGAR_EVENTO' AND geom IS NOT NULL LIMIT ${SAMPLE_SIZE}`
  );
  const places = placeRows.rows.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    datos_extra: r.datos_extra,
  }));

  console.log('2) BD: muestra de', places.length, 'LUGAR_EVENTO (con geom)');
  for (let i = 0; i < Math.min(3, places.length); i++) {
    const p = places[i];
    const meta = p.datos_extra && typeof p.datos_extra === 'object' ? p.datos_extra : {};
    const metaKeys = Object.keys(meta);
    const globalId = meta.GLOBALID ?? meta.GlobalID ?? meta.guid_2 ?? meta.GUID_2;
    console.log('   [', i + 1, '] titulo:', (p.titulo || '').slice(0, 50), '| metadata keys:', metaKeys.slice(0, 10).join(', '), '| GlobalID/GUID_2:', globalId ?? '—');
  }
  const placeMetaKeys = detectPlaceMetaKeys(places);
  console.log('   Keys en datos_extra (muestra):', placeMetaKeys.sort().join(', '));
  const hasGlobalId = places.some((p) => {
    const d = p.datos_extra || {};
    return d.GLOBALID ?? d.GlobalID ?? d.GUID_2 ?? d.guid_2;
  });
  console.log('   ¿Algún lugar tiene GlobalID/GUID_2 en metadata?', hasGlobalId ? 'Sí' : 'No');
  console.log('');

  // 4–5) Probar estrategias (sobre todos los eventos con attrs, o muestra grande)
  const attrsForDiagnosis = eventsAttrs.length > 500 ? eventsAttrs.slice(0, 500) : eventsAttrs;
  const allPlaces = await query(
    `SELECT id, ${titleExpr} AS titulo, datos_extra FROM contexto_eventos WHERE tipo = 'LUGAR_EVENTO' AND geom IS NOT NULL`
  );
  const allPlacesList = allPlaces.rows.map((r) => ({ id: r.id, titulo: r.titulo, datos_extra: r.datos_extra }));

  const result = runJoinDiagnosis(attrsForDiagnosis, allPlacesList);

  // 6) Imprimir resultados
  console.log('3) Resultados de estrategias (muestra', attrsForDiagnosis.length, 'eventos,', allPlacesList.length, 'lugares)');
  console.log('   A) Key match:   ', result.matchRates.key.toFixed(1) + '%', result.keyEventField && result.keyPlaceField ? `(evento.${result.keyEventField} ↔ lugar.datos_extra.${result.keyPlaceField})` : '');
  console.log('   B) Name match: ', result.matchRates.name.toFixed(1) + '%', result.nameField ? `(evento.${result.nameField} ↔ titulo)` : '');
  console.log('   C) Contains:   ', result.matchRates.contains.toFixed(1) + '%', result.nameField ? `(titulo contiene token de evento.${result.nameField})` : '');
  console.log('');

  if (result.join_quality === 'INVALID_LOCALIDAD') {
    console.log('--- NO HAY JOIN CONFIABLE (join_quality = INVALID_LOCALIDAD) ---');
    console.log('   La mejor tasa era CONTAINS usando EVLOC u otro campo de localidad/barrio.');
    console.log('   EVLOC es localidad, NO identifica un lugar puntual. No se permite asignar geom por localidad (regla Waze).');
    console.log('   Solo son válidos para geom: KEY-match (GlobalID/GUID/OBJECTID del lugar) o NAME-match por nombre de venue (EVNLUGAR, ESCENARIO).');
  } else if (result.strategy) {
    console.log('--- Estrategia ganadora:', result.strategy.toUpperCase(), '---');
    if (result.strategy === 'key') {
      console.log('   Campo evento:', result.keyEventField);
      console.log('   Campo lugar (datos_extra):', result.keyPlaceField);
      console.log('   % match:', result.bestKey.toFixed(1));
    } else {
      console.log('   Campo nombre evento:', result.nameField);
      console.log('   % match:', (result.strategy === 'name' ? result.bestName : result.bestContains).toFixed(1));
    }
    if (result.bestKey < 70 && result.bestName < 70) {
      console.log('   ⚠ Menos del 70%: el ingest usará esta estrategia pero muchos eventos quedarán sin geom.');
    }
  } else {
    console.log('--- NO HAY JOIN CONFIABLE (ninguna estrategia válida ≥ 30%) ---');
    console.log('   Posibles causas:');
    if (!hasCandidatos.name.length) console.log('   - Falta campo de nombre de lugar en el raw (p. ej. EVNLUGAR, LUGAR, ESCENARIO).');
    if (!hasCandidatos.key.length) console.log('   - Falta campo de ID de lugar en el raw (p. ej. GUID_2, GLOBALID).');
    if (!hasGlobalId) console.log('   - Los LUGAR_EVENTO en BD no tienen GLOBALID/GUID_2 en datos_extra (reingestar lugares desde ArcGIS layer 4).');
    console.log('   Sugerencia: usar snapshot desde queryRelatedRecords (desde lugares) para obtener eventos ya enlazados por relación.');
  }
  console.log('');

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
