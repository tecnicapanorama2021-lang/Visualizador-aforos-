/**
 * Colores y estilos de nodos para el mapa de Aforos Predictivos.
 * Usado por AforosMap y PanelNodo para mantener consistencia visual.
 */

/** Color cuando el nodo está seleccionado (todos los tipos) */
export const NODE_COLOR_SELECTED = '#2979FF';

/** Colores por tipo de nodo (TIPO_NODO) */
export const NODE_COLORS_BY_TYPE = {
  INFRAESTRUCTURA: '#94A3B8',   // Slate - Red vial / nodo base (sin estudios)
  SEMAFORO: '#FFC107',          // Amarillo - Semáforos (BD/API)
  SENSOR_AUTO: '#00E676',       // Verde - Sensores automáticos
  AFORO_MANUAL: '#32CD32',      // Verde lima - Aforos manuales
  default: '#32CD32',           // Verde lima por defecto
};

/** Nodos con estudios disponibles (hasStudies o DIM_Estudios_Geocodificado) */
export const NODE_COLOR_WITH_STUDIES = '#2979FF';

/** Radios de CircleMarker (px) */
export const NODE_RADIUS_DEFAULT = 5;
export const NODE_RADIUS_WITH_STUDIES = 7;

/** Opacidades */
export const NODE_FILL_OPACITY_DEFAULT = 0.7;
export const NODE_FILL_OPACITY_WITH_STUDIES = 0.9;
export const NODE_FILL_OPACITY_SELECTED = 1.0;

/** Peso del borde (stroke) */
export const NODE_WEIGHT_DEFAULT = 1;
export const NODE_WEIGHT_SELECTED = 3;

/**
 * Devuelve el color del marcador según el nodo.
 * Si tiene layers_summary, usa capa dominante (OBRAS > EVENTOS > SEMAFOROS > AFOROS > BASE).
 * Si no, usa attributes.COLOR o TIPO_NODO (INFRAESTRUCTURA, SEMAFORO, etc.).
 */
export function getMarkerColor(node) {
  const color = node?.attributes?.COLOR;
  if (color) return color;

  const ls = node?.attributes?.layers_summary ?? node?._original?.properties?.layers_summary;
  if (ls && (ls.aforos || (ls.obras ?? 0) > 0 || (ls.eventos ?? 0) > 0 || (ls.semaforos ?? 0) > 0)) {
    const layer = getDominantLayer({ layers_summary: ls });
    return LAYER_COLORS[layer] ?? LAYER_COLORS.BASE;
  }

  const tipoNodo = node?.attributes?.TIPO_NODO || '';
  if (tipoNodo === 'INFRAESTRUCTURA') return NODE_COLORS_BY_TYPE.INFRAESTRUCTURA;
  if (tipoNodo === 'SEMAFORO') return NODE_COLORS_BY_TYPE.SEMAFORO;
  if (tipoNodo === 'SENSOR_AUTO') return NODE_COLORS_BY_TYPE.SENSOR_AUTO;

  return NODE_COLORS_BY_TYPE.default;
}

/** Etiqueta legible del tipo de nodo. */
export const NODE_TYPE_LABELS = {
  INFRAESTRUCTURA: 'Red vial / nodo base',
  SEMAFORO: 'Semáforo',
  SENSOR_AUTO: 'Sensor',
  AFORO_MANUAL: 'Nodo con aforos',
  default: 'Nodo con estudios',
};

/** Colores fijos por capa real (layerType en GeoJSON). */
export const LAYER_COLORS = {
  AFOROS: '#16A34A',
  OBRAS: '#DC2626',
  EVENTOS: '#7C3AED',
  MANIFESTACIONES: '#EA580C',
  CONCIERTOS: '#DB2777',
  LUGARES: '#b39ddb',
  SEMAFOROS: '#F59E0B',
  BASE: '#94A3B8',
};

/**
 * Color del marcador por layerType (capas reales). Usar en features con properties.layerType.
 */
export function getMarkerColorByLayerType(layerType) {
  return LAYER_COLORS[layerType] ?? LAYER_COLORS.BASE;
}

/**
 * Normaliza layers_summary a forma consistente: { aforos: boolean, obras: number, eventos: number, semaforos: number }.
 * Acepta boolean/number/strings: aforos true|false|"true"|1|"1"; counts number|"0"|null => number >= 0.
 * Si ls es null/undefined devuelve null.
 */
export function normalizeLayersSummary(ls) {
  if (ls == null) return null;
  const truthy = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
  const num = (v) => Math.max(0, Number(v) || 0);
  return {
    aforos: truthy(ls.aforos),
    obras: num(ls.obras),
    eventos: num(ls.eventos),
    semaforos: num(ls.semaforos),
  };
}

/**
 * Devuelve la capa dominante para color del marcador (multicapa).
 * Usa layers_summary; si falta, hace fallback a BASE y emite warning.
 * @param {{ layers_summary?: { aforos?: boolean, obras?: number, eventos?: number, semaforos?: number } }} props - feature.properties
 * @returns {'OBRAS'|'EVENTOS'|'SEMAFOROS'|'AFOROS'|'BASE'}
 */
export function getDominantLayer(props) {
  const ls = props?.layers_summary;
  if (!ls) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[getDominantLayer] layers_summary ausente; usando BASE. properties:', props);
    }
    return 'BASE';
  }
  if ((ls.obras ?? 0) > 0) return 'OBRAS';
  if ((ls.eventos ?? 0) > 0) return 'EVENTOS';
  if ((ls.semaforos ?? 0) > 0) return 'SEMAFOROS';
  if (ls.aforos) return 'AFOROS';
  return 'BASE';
}

/** Etiqueta legible del origen del dato (ORIGEN). */
export const NODE_ORIGIN_LABELS = {
  Red_Semaforica_SIMUR: 'Red Semafórica SIMUR',
  DIM_Estudios_Geocodificado: 'Estudios DIM (geocodificado)',
  DIM_Volumennodo: 'DIM Volumen por nodo',
  Sensores_Velocidad: 'Sensores de velocidad',
};
