/**
 * Servicio para cargar nodos unificados desde el archivo JSON local
 * Integra datos de Red Semafórica SIMUR y Sensores de Velocidad
 */

/**
 * Cache simple en memoria para evitar cargas duplicadas
 */
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Obtiene todos los nodos unificados desde el archivo JSON
 * Convierte el formato GeoJSON a formato compatible con el componente del mapa
 * 
 * @returns {Promise<Array>} Array de features con estructura compatible
 */
export const fetchUnifiedNodes = async () => {
  const cacheKey = 'unified-nodes';
  const cached = cache.get(cacheKey);
  
  // Verificar cache
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✅ Usando cache: ${cached.data.length} nodos unificados`);
    return cached.data;
  }

  console.log('🔄 Cargando nodos unificados desde archivo local...');
  
  try {
    // Cargar el archivo JSON desde la carpeta public/data
    const response = await fetch('/data/nodos_unificados.json', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojsonData = await response.json();

    // Verificar estructura
    if (!geojsonData.features || !Array.isArray(geojsonData.features)) {
      throw new Error('Formato de datos inválido: se esperaba FeatureCollection');
    }

    // Convertir formato GeoJSON a formato compatible con el componente del mapa
    const convertedFeatures = geojsonData.features.map((feature, index) => {
      const { geometry, properties } = feature;
      
      // Convertir coordenadas GeoJSON [lng, lat] a formato Esri {x, y}
      let x, y;
      if (geometry.type === 'Point' && geometry.coordinates) {
        [x, y] = geometry.coordinates; // GeoJSON usa [lng, lat]
      } else {
        console.warn(`Feature ${index} tiene geometría no soportada: ${geometry.type}`);
        return null;
      }

      // Crear estructura compatible con el componente del mapa
      return {
        geometry: {
          x: x, // Longitud
          y: y  // Latitud
        },
        attributes: {
          OBJECTID: properties.id || index,
          NOMBRE: properties.nombre || 'Sin nombre',
          TIPO_NODO: properties.tipo,
          ORIGEN: properties.origen,
          COLOR: properties.color,
          // Incluir todos los datos raw para acceso completo
          ...properties.raw_data
        },
        // Guardar también la estructura original para referencia
        _original: feature
      };
    }).filter(feature => feature !== null); // Filtrar features inválidos

    // Guardar en cache
    cache.set(cacheKey, {
      data: convertedFeatures,
      timestamp: Date.now()
    });

    console.log(`🎉 Carga completada: ${convertedFeatures.length} nodos unificados`);
    return convertedFeatures;

  } catch (error) {
    console.error('❌ Error cargando nodos unificados:', error);
    throw new Error(`Error obteniendo nodos unificados: ${error.message}`);
  }
};

/**
 * Obtiene estadísticas de los nodos por tipo y origen
 * 
 * @returns {Promise<Object>} Estadísticas de los nodos
 */
export const getUnifiedNodesStats = async () => {
  const nodes = await fetchUnifiedNodes();
  
  const stats = {
    total: nodes.length,
    porTipo: {},
    porOrigen: {}
  };

  nodes.forEach(node => {
    const tipo = node.attributes.TIPO_NODO || 'UNKNOWN';
    const origen = node.attributes.ORIGEN || 'UNKNOWN';
    
    stats.porTipo[tipo] = (stats.porTipo[tipo] || 0) + 1;
    stats.porOrigen[origen] = (stats.porOrigen[origen] || 0) + 1;
  });

  return stats;
};

/**
 * Limpia el cache
 */
export const limpiarCache = () => {
  cache.clear();
  console.log('🗑️  Cache de nodos unificados limpiado');
};

/**
 * Obtiene estadísticas del cache
 */
export const obtenerStatsCache = () => {
  return {
    tamaño: cache.size,
    entradas: Array.from(cache.keys())
  };
};
