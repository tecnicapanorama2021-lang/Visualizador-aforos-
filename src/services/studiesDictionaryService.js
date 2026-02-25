/**
 * Servicio para cargar el diccionario de estudios desde el archivo JSON local
 * Conecta nodos geográficos con sus estudios de tráfico asociados
 */

/**
 * Cache simple en memoria para evitar cargas duplicadas
 */
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

/**
 * Obtiene el diccionario completo de estudios
 * 
 * @returns {Promise<Object>} Diccionario indexado por nombre_nodo
 */
export const fetchStudiesDictionary = async () => {
  const cacheKey = 'studies-dictionary';
  const cached = cache.get(cacheKey);
  
  // Verificar cache
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✅ Usando cache: ${Object.keys(cached.data.nodes || {}).length} nodos con estudios`);
    return cached.data;
  }

  console.log('🔄 Cargando diccionario de estudios desde archivo local...');
  
  try {
    // Cargar el archivo JSON desde la carpeta public/data
    const response = await fetch('/data/studies_dictionary.json', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const dictionaryData = await response.json();

    // Verificar estructura
    if (!dictionaryData.nodes || typeof dictionaryData.nodes !== 'object') {
      throw new Error('Formato de datos inválido: se esperaba objeto con propiedad "nodes"');
    }

    // Guardar en cache
    cache.set(cacheKey, {
      data: dictionaryData,
      timestamp: Date.now()
    });

    const nodeCount = Object.keys(dictionaryData.nodes).length;
    const totalStudies = Object.values(dictionaryData.nodes).reduce(
      (sum, node) => sum + (node.studies?.length || 0),
      0
    );

    console.log(`🎉 Diccionario cargado: ${nodeCount} nodos con ${totalStudies} estudios totales`);
    return dictionaryData;

  } catch (error) {
    console.error('❌ Error cargando diccionario de estudios:', error);
    throw new Error(`Error obteniendo diccionario de estudios: ${error.message}`);
  }
};

/**
 * Obtiene los estudios asociados a un nodo por su nombre_nodo (ID externo)
 * 
 * @param {string} nombreNodo - ID externo del nodo (ej: "171", "466")
 * @returns {Promise<Array|null>} Array de estudios o null si no se encuentra
 */
export const getStudiesByNodeId = async (nombreNodo) => {
  try {
    const dictionary = await fetchStudiesDictionary();
    
    // Buscar el nodo por nombre_nodo
    const nodeData = dictionary.nodes[nombreNodo];
    
    if (!nodeData) {
      return null;
    }

    return nodeData.studies || [];
  } catch (error) {
    console.error(`❌ Error obteniendo estudios para nodo ${nombreNodo}:`, error);
    return null;
  }
};

/**
 * Obtiene información completa de un nodo por su nombre_nodo
 * 
 * @param {string} nombreNodo - ID externo del nodo
 * @returns {Promise<Object|null>} Datos del nodo o null si no se encuentra
 */
export const getNodeInfo = async (nombreNodo) => {
  try {
    const dictionary = await fetchStudiesDictionary();
    return dictionary.nodes[nombreNodo] || null;
  } catch (error) {
    console.error(`❌ Error obteniendo información del nodo ${nombreNodo}:`, error);
    return null;
  }
};

/**
 * Busca nodos por dirección o nombre parcial
 * 
 * @param {string} searchTerm - Término de búsqueda
 * @returns {Promise<Array>} Array de nodos que coinciden
 */
export const searchNodes = async (searchTerm) => {
  try {
    const dictionary = await fetchStudiesDictionary();
    const term = searchTerm.toLowerCase();
    
    return Object.entries(dictionary.nodes)
      .filter(([nombreNodo, nodeData]) => {
        const address = (nodeData.address || '').toLowerCase();
        const nombreNodoLower = nombreNodo.toLowerCase();
        return address.includes(term) || nombreNodoLower.includes(term);
      })
      .map(([nombreNodo, nodeData]) => ({
        nombreNodo,
        ...nodeData
      }));
  } catch (error) {
    console.error(`❌ Error buscando nodos:`, error);
    return [];
  }
};

/**
 * Obtiene estadísticas del diccionario
 * 
 * @returns {Promise<Object>} Estadísticas
 */
export const getStudiesStats = async () => {
  try {
    const dictionary = await fetchStudiesDictionary();
    const nodes = Object.values(dictionary.nodes);
    
    const stats = {
      totalNodes: nodes.length,
      totalStudies: nodes.reduce((sum, node) => sum + (node.studies?.length || 0), 0),
      nodesWithStudies: nodes.filter(node => node.studies && node.studies.length > 0).length,
      averageStudiesPerNode: 0
    };
    
    if (stats.totalNodes > 0) {
      stats.averageStudiesPerNode = (stats.totalStudies / stats.totalNodes).toFixed(2);
    }
    
    return stats;
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    return {
      totalNodes: 0,
      totalStudies: 0,
      nodesWithStudies: 0,
      averageStudiesPerNode: 0
    };
  }
};

/**
 * Limpia el cache
 */
export const limpiarCache = () => {
  cache.clear();
  console.log('🗑️  Cache de diccionario de estudios limpiado');
};
