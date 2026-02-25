/**
 * Servicio para obtener datos de ArcGIS Feature Server
 * Especializado en obtener todos los registros superando límites de paginación
 */

const BASE_URL = 'https://services2.arcgis.com/NEwhEo9GGSHXcRXV/arcgis/rest/services/Conteo_Vehiculos_CGT_Bogot%C3%A1_D_C/FeatureServer/0/query';

/**
 * Cache simple en memoria para evitar llamadas duplicadas
 */
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

/**
 * Obtiene TODOS los nodos de la API superando el límite de registros
 * Implementa paginación recursiva usando resultOffset
 * 
 * @returns {Promise<Array>} Array completo de features con todos los nodos
 */
export const fetchAllNodes = async () => {
  const cacheKey = 'all-nodes';
  const cached = cache.get(cacheKey);
  
  // Verificar cache
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✅ Usando cache: ${cached.data.length} nodos`);
    return cached.data;
  }

  console.log('🔄 Iniciando carga de nodos desde ArcGIS...');
  
  let offset = 0;
  let allFeatures = [];
  let hasMore = true;
  let iteration = 0;
  const maxIterations = 100; // Protección contra bucles infinitos

  while (hasMore && iteration < maxIterations) {
    iteration++;
    
    try {
      // Construir URL con parámetros de paginación
      const params = new URLSearchParams({
        where: '1=1',
        outFields: '*',
        f: 'json',
        resultRecordCount: '2000',
        resultOffset: offset.toString(),
        outSR: '4326' // Sistema de coordenadas WGS84
      });

      const url = `${BASE_URL}?${params.toString()}`;
      
      console.log(`📡 Fetch iteración ${iteration}: offset=${offset}, esperando hasta 2000 registros...`);

      // Fetch con timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        mode: 'cors',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Verificar errores en la respuesta
      if (data.error) {
        throw new Error(data.error.message || 'Error en respuesta de ArcGIS');
      }

      // Agregar features obtenidos
      const features = data.features || [];
      if (features.length > 0) {
        allFeatures = [...allFeatures, ...features];
        console.log(`✅ Iteración ${iteration}: ${features.length} nodos obtenidos. Total acumulado: ${allFeatures.length}`);
      }

      // Verificar si hay más datos
      // Si exceededTransferLimit es true, hay más datos
      // Si no hay features o exceededTransferLimit es false, terminamos
      if (data.exceededTransferLimit === true) {
        // Hay más datos, incrementar offset y continuar
        offset += 2000;
        hasMore = true;
        console.log(`⏭️  Hay más datos. Continuando con offset=${offset}...`);
        
        // Pequeña pausa para no saturar el servidor
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        // No hay más datos, terminar
        hasMore = false;
        console.log(`✅ Todos los datos obtenidos. Total final: ${allFeatures.length} nodos`);
      }

    } catch (error) {
      console.error(`❌ Error en iteración ${iteration}:`, error);
      
      // Si es el primer error y tenemos datos, retornar lo que tenemos
      if (allFeatures.length > 0) {
        console.warn(`⚠️  Retornando ${allFeatures.length} nodos obtenidos antes del error`);
        return allFeatures;
      }
      
      // Si no hay datos, lanzar error
      throw new Error(`Error obteniendo nodos: ${error.message}`);
    }
  }

  if (iteration >= maxIterations) {
    console.warn(`⚠️  Se alcanzó el límite de iteraciones. Retornando ${allFeatures.length} nodos obtenidos.`);
  }

  // Guardar en cache
  cache.set(cacheKey, { 
    data: allFeatures, 
    timestamp: Date.now() 
  });

  console.log(`🎉 Carga completada: ${allFeatures.length} nodos totales`);
  return allFeatures;
};

/**
 * Limpia el cache
 */
export const limpiarCache = () => {
  cache.clear();
  console.log('🗑️  Cache limpiado');
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
