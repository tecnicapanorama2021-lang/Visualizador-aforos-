/**
 * Mapeo de clases de vehículo (nombres en Excel/analisis) a columnas conteos_resumen.
 * Usado por etl_conteos_from_historial.js y etl_conteos_from_dim.js.
 */

export const CLASS_TO_COL = {
  livianos: 'vol_autos',
  liviano: 'vol_autos',
  autos: 'vol_autos',
  auto: 'vol_autos',
  automovil: 'vol_autos',
  carro: 'vol_autos',
  carros: 'vol_autos',
  pasajeros: 'vol_autos',
  vehiculo_ligero: 'vol_autos',
  vehiculos_ligeros: 'vol_autos',
  c2: 'vol_autos',
  c3: 'vol_autos',
  l: 'vol_autos',
  motos: 'vol_motos',
  moto: 'vol_motos',
  motocicleta: 'vol_motos',
  motocicletas: 'vol_motos',
  ciclomotor: 'vol_motos',
  m: 'vol_motos',
  buses: 'vol_buses',
  bus: 'vol_buses',
  buseta: 'vol_buses',
  busetas: 'vol_buses',
  buses_articulados: 'vol_buses',
  articulado: 'vol_buses',
  alimentador: 'vol_buses',
  b: 'vol_buses',
  camiones: 'vol_pesados',
  camion: 'vol_pesados',
  pesados: 'vol_pesados',
  pesado: 'vol_pesados',
  tractomula: 'vol_pesados',
  tractomulas: 'vol_pesados',
  tractocamion: 'vol_pesados',
  volqueta: 'vol_pesados',
  volquetas: 'vol_pesados',
  carga: 'vol_pesados',
  c2g: 'vol_pesados',
  c3g: 'vol_pesados',
  c: 'vol_pesados',
  transporte_intermunicipal: 'vol_pesados',
  bicicletas: 'vol_bicis',
  bicicleta: 'vol_bicis',
  bicis: 'vol_bicis',
  bici: 'vol_bicis',
  bi: 'vol_bicis',
};

export function normalizeClassKey(k) {
  return String(k || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

/**
 * Convierte objeto classes (keys del Excel) a vol_autos, vol_motos, etc.
 * @param {Record<string, number>} classes
 * @param {boolean} [debug] - Si true, imprime [ETL MAP DEBUG] por cada clase
 */
export function mapClassesToVolumes(classes, debug = false) {
  const out = {
    vol_autos: 0,
    vol_motos: 0,
    vol_buses: 0,
    vol_pesados: 0,
    vol_bicis: 0,
    vol_otros: 0,
  };
  if (!classes || typeof classes !== 'object') return out;
  for (const [k, v] of Object.entries(classes)) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : parseInt(v, 10) || 0;
    const key = normalizeClassKey(k);
    const col = CLASS_TO_COL[key];
    if (col && out[col] !== undefined) {
      out[col] += n;
      if (debug) console.log(`[ETL MAP DEBUG] class=${JSON.stringify(k)} normalized=${key} -> ${col}`);
    } else {
      out.vol_otros += n;
      if (debug) console.log(`[ETL MAP DEBUG] class=${JSON.stringify(k)} normalized=${key} -> vol_otros`);
    }
  }
  return out;
}
