/**
 * Lista de lugares y vías de Bogotá con coordenadas aproximadas (lon, lat) para geocodificación interna.
 * Reutilizable por jobCalendarioEventos (extracción de texto) y etl_contexto_geocodificar_eventos (asignar geom).
 * Coordenadas en EPSG:4326; orden [lon, lat] para GeoJSON/PostGIS.
 */

const LUGARES_CON_COORDENADAS = [
  { nombre: 'Parque Simón Bolívar', lon: -74.094, lat: 4.657 },
  { nombre: 'Movistar Arena', lon: -74.093, lat: 4.658 },
  { nombre: 'Estadio El Campín', lon: -74.077, lat: 4.637 },
  { nombre: 'Parque de los Novios', lon: -74.084, lat: 4.698 },
  { nombre: 'Parque El Tunal', lon: -74.133, lat: 4.567 },
  { nombre: 'Maloka', lon: -74.084, lat: 4.638 },
  { nombre: 'Corferias', lon: -74.092, lat: 4.642 },
  { nombre: 'Autopista Norte', lon: -74.050, lat: 4.750 },
  { nombre: 'Autopista Sur', lon: -74.150, lat: 4.550 },
  { nombre: 'Avenida Caracas', lon: -74.069, lat: 4.651 },
  { nombre: 'Avenida 68', lon: -74.094, lat: 4.658 },
  { nombre: 'Calle 26', lon: -74.092, lat: 4.638 },
  { nombre: 'Carrera 7', lon: -74.069, lat: 4.651 },
  { nombre: 'Carrera 15', lon: -74.055, lat: 4.658 },
  { nombre: 'Calle 80', lon: -74.052, lat: 4.698 },
  { nombre: 'Calle 100', lon: -74.042, lat: 4.758 },
  { nombre: 'Avenida Suba', lon: -74.083, lat: 4.738 },
  { nombre: 'Carrera 50', lon: -74.118, lat: 4.628 },
  { nombre: 'Avenida Primero de Mayo', lon: -74.133, lat: 4.610 },
  { nombre: 'NQS', lon: -74.085, lat: 4.648 },
];

/** Normaliza texto para comparación (minúsculas, sin acentos opcional, trim). */
function normalizar(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca un match del texto contra la lista de lugares (por nombre estándar).
 * Devuelve { lon, lat } o null si no hay match.
 */
function geocode(texto) {
  const t = normalizar(texto);
  if (!t) return null;
  for (const lugar of LUGARES_CON_COORDENADAS) {
    const n = normalizar(lugar.nombre);
    if (t === n || t.includes(n) || n.includes(t)) return { lon: lugar.lon, lat: lugar.lat };
  }
  return null;
}

/**
 * Lista para uso en jobCalendarioEventos (patrones regex + nombre).
 * Mantiene compatibilidad con la estructura { pattern, nombre }.
 */
function getLugaresParaExtraccion() {
  return LUGARES_CON_COORDENADAS.map((l) => ({
    pattern: new RegExp(l.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi'),
    nombre: l.nombre,
  }));
}

export { LUGARES_CON_COORDENADAS, geocode, getLugaresParaExtraccion };
