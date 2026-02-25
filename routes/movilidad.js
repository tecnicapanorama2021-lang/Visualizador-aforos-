import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const axios = require('axios');

const router = express.Router();

// Cache simple en memoria
const cache = {
  sensores: { data: null, timestamp: null },
  cicloparqueaderos: { data: null, timestamp: null },
  obras: { data: null, timestamp: null },
  signals: [] // Señales guardadas (en producción usar base de datos)
};

const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

/**
 * Helper para obtener datos con cache
 */
const getCachedData = async (cacheKey, fetchFn) => {
  const cached = cache[cacheKey];
  if (cached && cached.data && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const data = await fetchFn();
    cache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    // Si hay error y tenemos cache, devolver cache aunque esté expirado
    if (cached && cached.data) {
      console.warn(`⚠️ Error obteniendo datos frescos para ${cacheKey}, usando cache expirado`);
      return cached.data;
    }
    throw error;
  }
};

/**
 * GET /api/movilidad/sensores
 * Obtiene sensores de tráfico vehicular
 */
router.get('/sensores', async (req, res) => {
  try {
    const data = await getCachedData('sensores', async () => {
      // URL basada en patrón IDECA - ajustar según servicio real
      const url = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Movilidad/Movilidad/MapServer/1/query';
      const response = await axios.get(url, {
        params: {
          where: '1=1',
          outFields: '*',
          returnGeometry: 'true',
          f: 'json',
          outSR: '4326',
          resultRecordCount: 2000
        },
        timeout: 30000
      });
      
      if (response.data.error) {
        throw new Error(response.data.error.message || 'Error en respuesta de ArcGIS');
      }
      
      return response.data;
    });
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error obteniendo sensores:', error.message);
    res.status(500).json({ 
      error: 'Error al obtener sensores',
      message: error.message 
    });
  }
});

/**
 * GET /api/movilidad/cicloparqueaderos
 * Obtiene cicloparqueaderos públicos
 */
router.get('/cicloparqueaderos', async (req, res) => {
  try {
    const data = await getCachedData('cicloparqueaderos', async () => {
      const url = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Movilidad/Movilidad/MapServer/0/query';
      const response = await axios.get(url, {
        params: {
          where: '1=1',
          outFields: '*',
          returnGeometry: 'true',
          f: 'json',
          outSR: '4326',
          resultRecordCount: 2000
        },
        timeout: 30000
      });
      
      if (response.data.error) {
        throw new Error(response.data.error.message || 'Error en respuesta de ArcGIS');
      }
      
      return response.data;
    });
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error obteniendo cicloparqueaderos:', error.message);
    res.status(500).json({ 
      error: 'Error al obtener cicloparqueaderos',
      message: error.message 
    });
  }
});

/**
 * GET /api/movilidad/obras
 * Obtiene obras activas de SIMUR
 */
router.get('/obras', async (req, res) => {
  try {
    const data = await getCachedData('obras', async () => {
      const url = process.env.SIMUR_OBRAS_URL || 'https://sig.simur.gov.co/arcgis/rest/services/MovilApp/Simur_web/MapServer/9/query';
      const response = await axios.get(url, {
        params: {
          where: '1=1',
          outFields: '*',
          returnGeometry: 'true',
          f: 'json',
          outSR: '4326',
          resultRecordCount: 2000
        },
        timeout: 30000
      });
      
      if (response.data.error) {
        throw new Error(response.data.error.message || 'Error en respuesta de ArcGIS');
      }
      
      return response.data;
    });
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error obteniendo obras:', error.message);
    res.status(500).json({ 
      error: 'Error al obtener obras',
      message: error.message 
    });
  }
});

/**
 * GET /api/movilidad/signals
 * Obtiene señales guardadas
 */
router.get('/signals', async (req, res) => {
  try {
    // En producción, obtener de base de datos
    res.json(cache.signals);
  } catch (error) {
    console.error('❌ Error obteniendo señales:', error.message);
    res.status(500).json({ 
      error: 'Error al obtener señales',
      message: error.message 
    });
  }
});

/**
 * POST /api/movilidad/signals
 * Crea una nueva señal
 */
router.post('/signals', async (req, res) => {
  try {
    const { type, geometry, description, priority } = req.body;
    
    // Validar datos requeridos
    if (!type || !geometry) {
      return res.status(400).json({ 
        error: 'Faltan campos requeridos',
        required: ['type', 'geometry']
      });
    }
    
    // Validar tipos permitidos
    const validTypes = ['obras', 'accidentes', 'congestion', 'cierres', 'punto-interes', 'personalizado'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        error: 'Tipo de señal inválido',
        validTypes 
      });
    }
    
    // Validar prioridades
    const validPriorities = ['alta', 'media', 'baja'];
    const signalPriority = priority || 'media';
    if (!validPriorities.includes(signalPriority)) {
      return res.status(400).json({ 
        error: 'Prioridad inválida',
        validPriorities 
      });
    }
    
    // Crear señal
    const signal = {
      id: Date.now() + Math.random(),
      type,
      geometry,
      description: description || '',
      priority: signalPriority,
      timestamp: new Date().toISOString(),
      user: req.user?.id || 'anonymous'
    };
    
    // Guardar en cache (en producción, guardar en base de datos)
    cache.signals.push(signal);
    
    // Limitar a 1000 señales en memoria
    if (cache.signals.length > 1000) {
      cache.signals = cache.signals.slice(-1000);
    }
    
    console.log('✅ Señal creada:', signal.id);
    
    res.json({ 
      success: true, 
      signal 
    });
  } catch (error) {
    console.error('❌ Error creando señal:', error.message);
    res.status(500).json({ 
      error: 'Error al crear señal',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/movilidad/signals/:id
 * Elimina una señal
 */
router.delete('/signals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const signalId = parseFloat(id);
    
    const index = cache.signals.findIndex(s => s.id === signalId);
    if (index === -1) {
      return res.status(404).json({ 
        error: 'Señal no encontrada' 
      });
    }
    
    cache.signals.splice(index, 1);
    
    console.log('✅ Señal eliminada:', signalId);
    
    res.json({ 
      success: true,
      message: 'Señal eliminada correctamente'
    });
  } catch (error) {
    console.error('❌ Error eliminando señal:', error.message);
    res.status(500).json({ 
      error: 'Error al eliminar señal',
      message: error.message 
    });
  }
});

/**
 * GET /api/movilidad/health
 * Health check del servicio
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cache: {
      sensores: cache.sensores.timestamp ? 'active' : 'empty',
      cicloparqueaderos: cache.cicloparqueaderos.timestamp ? 'active' : 'empty',
      obras: cache.obras.timestamp ? 'active' : 'empty',
      signals: cache.signals.length
    }
  });
});

export default router;
