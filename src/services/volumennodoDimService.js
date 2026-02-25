/**
 * Servicio para cargar nodos desde el archivo DIM "volumennodo" (copiado como volumennodo_dim.json).
 * Fuente: https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/volumennodo
 * Archivo en proyecto: public/data/volumennodo_dim.json
 */

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

const VOLUMENNODO_DIM_URL = '/data/volumennodo_dim.json';

/**
 * Convierte un feature GeoJSON del DIM volumennodo al formato interno del mapa
 * (geometry: { x: lng, y: lat }, attributes, _original).
 */
function convertDimFeature(feature, index) {
  const { geometry, properties } = feature;
  if (!geometry?.coordinates || geometry.type !== 'Point') return null;
  const [lng, lat] = geometry.coordinates;
  return {
    geometry: { x: lng, y: lat },
    attributes: {
      OBJECTID: properties?.id_nodo ?? index,
      NOMBRE: properties?.nombre ?? properties?.direccion ?? '',
      DIRECCION: properties?.direccion ?? '',
      TIPO_NODO: properties?.tipo_nodo ? 'AFORO_MANUAL' : 'AFORO_MANUAL',
      ORIGEN: 'DIM_Volumennodo',
      total_estudios: properties?.total_estudios,
      volumen_hora_maxima_demanda: properties?.volumen_hora_maxima_demanda,
      intervalo_hora_maxima_demanda: properties?.intervalo_hora_maxima_demanda,
      via_principal: properties?.via_principal,
      via_secundaria: properties?.via_secundaria,
    },
    _original: feature,
  };
}

/**
 * Obtiene los nodos desde volumennodo_dim.json (DIM - Volumen por nodo).
 * @returns {Promise<Array>} Array de nodos en formato compatible con el mapa
 */
export const fetchVolumennodoDimNodes = async () => {
  const cacheKey = 'volumennodo-dim';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✅ Usando cache: ${cached.data.length} nodos DIM volumennodo`);
    return cached.data;
  }

  console.log('🔄 Cargando nodos desde volumennodo_dim.json (DIM)...');
  try {
    const response = await fetch(VOLUMENNODO_DIM_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = await response.json();
    if (!geojson?.features || !Array.isArray(geojson.features)) {
      throw new Error('Formato inválido: se esperaba FeatureCollection con features');
    }

    const converted = geojson.features
      .map((f, i) => convertDimFeature(f, i))
      .filter(Boolean);

    cache.set(cacheKey, { data: converted, timestamp: Date.now() });
    console.log(`🎉 Volumennodo DIM: ${converted.length} nodos cargados`);
    return converted;
  } catch (err) {
    console.warn('⚠️ No se pudo cargar volumennodo_dim.json:', err.message);
    return [];
  }
};

export const VOLUMENNODO_DIM_SOURCE_LABEL = 'DIM Volumen por nodo (volumennodo_dim.json)';
