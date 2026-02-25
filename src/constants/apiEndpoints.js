/**
 * Endpoints de API
 * En desarrollo: '' (Vite hace proxy de /api a localhost:3001)
 * En producción: definir VITE_API_URL con la URL base del API desplegado (ej: https://tu-api.railway.app)
 */
const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

export const API_ENDPOINTS = {
  // Noticias
  NOTICIAS: `${API_BASE_URL}/api/noticias`,
  // Proxy descarga aforos DIM (evita CORS)
  AFOROS_DESCARGAR: (fileId) => `${API_BASE_URL}/api/aforos/descargar/${fileId}`,
  // Análisis Excel (hora pico, distribución, conflictos). Usar dimId (ej. 388), NO estudio_id de BD.
  AFOROS_ANALISIS: (dimId) => `${API_BASE_URL}/api/aforos/analisis/${dimId}`,
  // Geocodificación por dirección del nodo (nodos con estudios)
  AFOROS_GEOCODE: (nodeId) => `${API_BASE_URL}/api/aforos/geocode/${encodeURIComponent(nodeId)}`,
  // Historial por nodeId (desde BD: nodos + estudios + conteos_resumen)
  AFOROS_HISTORIAL: (nodeId) => `${API_BASE_URL}/api/aforos/historial/${encodeURIComponent(nodeId)}`,
  // Listado de nodos (GeoJSON FeatureCollection) por capa real
  AFOROS_NODOS: `${API_BASE_URL}/api/aforos/nodos`,
  OBRAS_NODOS: `${API_BASE_URL}/api/obras/nodos`,
  EVENTOS_NODOS: `${API_BASE_URL}/api/eventos/nodos`,
  MANIFESTACIONES_NODOS: `${API_BASE_URL}/api/manifestaciones/nodos`,
  CONCIERTOS_NODOS: `${API_BASE_URL}/api/conciertos/nodos`,
  LUGARES_NODOS: `${API_BASE_URL}/api/lugares/nodos`,
  SEMAFOROS_NODOS: `${API_BASE_URL}/api/semaforos/nodos`,
  BASE_NODOS: `${API_BASE_URL}/api/base/nodos`,
  // Estudios de un nodo (para popup Aforos, "Ver análisis")
  AFOROS_NODO_ESTUDIOS: (nodoId) => `${API_BASE_URL}/api/aforos/nodo/${encodeURIComponent(nodoId)}/estudios`,
  // Diagnóstico multicapa
  DEBUG_LAYERS_STATS: `${API_BASE_URL}/api/debug/layers-summary-stats`,
  DEBUG_CAPAS_STATS: `${API_BASE_URL}/api/debug/capas-stats`,
  DEBUG_CAPAS_TEMPORAL_STATS: (params = '') => `${API_BASE_URL}/api/debug/capas-temporal-stats${params ? '?' + params : ''}`,
  DEBUG_ESTUDIOS_RELATION: `${API_BASE_URL}/api/debug/estudios-relation`,
  // Estudios por nodo (formato studies) desde BD (legacy; preferir AFOROS_NODO_ESTUDIOS para popup)
  NODOS_ESTUDIOS: (nodeId) => `${API_BASE_URL}/api/nodos/${encodeURIComponent(nodeId)}/estudios`,
  NODOS_LAYERS: (nodeId) => `${API_BASE_URL}/api/nodos/${encodeURIComponent(nodeId)}/layers`,
  NODOS_IMPACTO: (nodeId) => `${API_BASE_URL}/api/nodos/${encodeURIComponent(nodeId)}/impacto`,
  NODOS_SEARCH: (q, limit = 10) => `${API_BASE_URL}/api/nodos/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  OBRAS_DESVIOS: (incidenteId) => `${API_BASE_URL}/api/obras/${encodeURIComponent(incidenteId)}/desvios`,
  OBRAS_DETAIL: (incidenteId) => `${API_BASE_URL}/api/obras/${encodeURIComponent(incidenteId)}/detail`,
  OBRAS_AROUND: (incidenteId, radiusM = 500) => `${API_BASE_URL}/api/obras/${encodeURIComponent(incidenteId)}/around${radiusM ? `?radius_m=${radiusM}` : ''}`,
  // Reglas de clasificación de nodos (admin)
  NODOS_RULES: `${API_BASE_URL}/api/nodos/rules`,
  NODOS_RULES_APPLY: `${API_BASE_URL}/api/nodos/rules/apply`,
  // Movilidad
  MOVILIDAD: {
    SENSORES: `${API_BASE_URL}/api/movilidad/sensores`,
    CICLOPARQUEADEROS: `${API_BASE_URL}/api/movilidad/cicloparqueaderos`,
    OBRAS: `${API_BASE_URL}/api/movilidad/obras`,
    SIGNALS: `${API_BASE_URL}/api/movilidad/signals`,
    HEALTH: `${API_BASE_URL}/api/movilidad/health`
  },
  // Datos unificados (calendario obras/eventos, velocidades por nodo, contexto-eventos desde BD)
  DATOS_UNIFICADOS: {
    CALENDARIO: `${API_BASE_URL}/api/datos-unificados/calendario`,
    OBRAS: `${API_BASE_URL}/api/datos-unificados/obras`,
    CONTEXTO_EVENTOS: `${API_BASE_URL}/api/datos-unificados/contexto-eventos`,
    VELOCIDADES: (nodoId) => `${API_BASE_URL}/api/datos-unificados/velocidades/${encodeURIComponent(nodoId)}`
  },
  // Predicción baseline (validación histórica, por nodo, por zona)
  PREDICCION_VALIDACION: (dias = 90) => `${API_BASE_URL}/api/prediccion/validacion?dias=${dias}`,
  PREDICCION_NODO: (nodoId, fecha, hora) => `${API_BASE_URL}/api/prediccion/nodo/${encodeURIComponent(nodoId)}${fecha != null ? `?fecha=${fecha}` : ''}${hora != null ? `${fecha != null ? '&' : '?'}hora=${hora}` : ''}`,
  PREDICCION_ZONA: (localidad, fecha, hora) => `${API_BASE_URL}/api/prediccion/zona?localidad=${encodeURIComponent(localidad)}${fecha ? `&fecha=${fecha}` : ''}${hora != null ? `&hora=${hora}` : ''}`,
  // Estudios de tránsito enriquecidos (vías, puntos críticos, infraestructura, proyecciones)
  ESTUDIOS_TRANSITO: {
    VIAS: (estudioId) => `${API_BASE_URL}/api/estudios-transito/vias?estudio_id=${encodeURIComponent(estudioId)}`,
    PUNTOS_CRITICOS: (estudioId) => `${API_BASE_URL}/api/estudios-transito/puntos-criticos?estudio_id=${encodeURIComponent(estudioId)}`,
    INFRAESTRUCTURA: (estudioId) => `${API_BASE_URL}/api/estudios-transito/infraestructura?estudio_id=${encodeURIComponent(estudioId)}`,
    PROYECCIONES: (estudioId) => `${API_BASE_URL}/api/estudios-transito/proyecciones?estudio_id=${encodeURIComponent(estudioId)}`
  }
};

// URLs de geocodificación
export const GEOCODING = {
  ARCGIS: 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates',
  GOOGLE: 'https://maps.googleapis.com/maps/api/geocode/json'
};
