import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

const pkg = require('./package.json');
const PORT = process.env.PORT || 3001;
console.log('[BOOT] Backend canónico incidentes v1');
console.log('[BOOT] Entrypoint:', process.argv[1] || 'server.js');
console.log('[BOOT] Versión:', pkg.version, '|', new Date().toISOString());
console.log('[BOOT] NODE_ENV:', process.env.NODE_ENV, '| PORT:', PORT);

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import movilidadRoutes from './routes/movilidad.js';
import pmtRoutes from './routes/pmt.js';
import datosUnificadosRoutes from './routes/datosUnificados.js';
import aforosRoutes from './routes/aforos.js';
import nodosRoutes from './routes/nodos.js';
import nodosRulesRoutes from './routes/nodos_rules.js';
import estudiosTransitoRoutes from './routes/estudiosTransito.js';
import grafoRoutes from './routes/grafo.js';
import simularRoutes from './routes/simular.js';
import debugRoutes from './routes/debug.js';
import capasRoutes from './routes/capas.js';
import arcgisRoutes from './routes/arcgis.js';
import prediccionRoutes from './routes/prediccion.js';
import senalesRoutes from './routes/senales.js';
import adminRoutes from './routes/admin.js';
import { analizarExcelBuffer } from './server/utils/aforoAnalisis.js';
import { getExcelBufferForStudy } from './server/utils/dimExcel.js';
import { healthCheck as dbHealthCheck } from './server/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const distPath = path.join(__dirname, 'dist');
const serveFrontend = process.env.NODE_ENV === 'production' || process.env.SERVE_STATIC === '1' || fs.existsSync(distPath);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

// Cache simple en memoria
const cache = {
  data: null,
  timestamp: null,
  ttl: 15 * 60 * 1000 // 15 minutos
};

// Función para extraer categoría del título
function extraerCategoria(titulo) {
  const t = titulo.toLowerCase();
  if (t.includes('cierre') || t.includes('cierra')) return 'Cierres';
  if (t.includes('obra') || t.includes('construcción') || t.includes('construccion')) return 'Obras';
  if (t.includes('pmt') || t.includes('plan manejo') || t.includes('plan de manejo')) return 'PMT';
  if (t.includes('transmilenio') || t.includes('sitp') || t.includes('transporte público')) return 'Transporte';
  return 'Tránsito';
}

// Función para deduplicar noticias
function deduplicar(noticias) {
  const vistas = new Set();
  return noticias.filter(noticia => {
    const key = noticia.url || noticia.titulo;
    if (vistas.has(key)) return false;
    vistas.add(key);
    return true;
  });
}

// Configurar parser RSS
const parser = new Parser({
  customFields: {
    item: ['media:content', 'description', 'enclosure']
  }
});

// Ruta API para obtener noticias
app.get('/api/noticias', async (req, res) => {
  try {
    // Verificar cache
    if (cache.data && Date.now() - cache.timestamp < cache.ttl) {
      return res.json(cache.data);
    }

    const noticias = [];

    // Fuente 1: Google News RSS - Bogotá Tránsito
    try {
      const googleNewsUrl = 'https://news.google.com/rss/search?q=tránsito+cierre+vía+obra+Bogotá+Colombia&hl=es&gl=CO&ceid=CO:es';
      const feed = await parser.parseURL(googleNewsUrl);
      
      feed.items.slice(0, 10).forEach(item => {
        noticias.push({
          id: item.guid || item.link || Math.random().toString(),
          titulo: item.title || 'Sin título',
          descripcion: item.contentSnippet || item.content?.substring(0, 200) || item.description?.substring(0, 200) || 'Sin descripción',
          url: item.link || '#',
          fecha: new Date(item.pubDate || Date.now()),
          fuente: item.source?.name || 'Google News',
          imagen: item['media:content']?.['$']?.url || item.enclosure?.url || null,
          categoria: extraerCategoria(item.title || '')
        });
      });
    } catch (err) {
      console.error('Error Google News:', err.message);
    }

    // Fuente 2: El Tiempo RSS - Bogotá (filtrar por palabras clave)
    try {
      const elTiempoUrl = 'https://www.eltiempo.com/rss/colombia/bogota.xml';
      const feed = await parser.parseURL(elTiempoUrl);
      
      feed.items
        .filter(item => {
          const titulo = (item.title || '').toLowerCase();
          return titulo.includes('tránsito') ||
                 titulo.includes('cierre') ||
                 titulo.includes('obra') ||
                 titulo.includes('movilidad') ||
                 titulo.includes('vía') ||
                 titulo.includes('calle') ||
                 titulo.includes('avenida');
        })
        .slice(0, 5)
        .forEach(item => {
          noticias.push({
            id: item.guid || item.link || Math.random().toString(),
            titulo: item.title || 'Sin título',
            descripcion: item.contentSnippet || item.content?.substring(0, 200) || item.description?.substring(0, 200) || 'Sin descripción',
            url: item.link || '#',
            fecha: new Date(item.pubDate || Date.now()),
            fuente: 'El Tiempo',
            imagen: item.enclosure?.url || null,
            categoria: extraerCategoria(item.title || '')
          });
        });
    } catch (err) {
      console.error('Error El Tiempo:', err.message);
    }

    // Fuente 3: El Espectador - Bogotá
    try {
      const espectadorUrl = 'https://www.elespectador.com/rss/bogota/';
      const feed = await parser.parseURL(espectadorUrl);
      
      feed.items
        .filter(item => {
          const titulo = (item.title || '').toLowerCase();
          return titulo.includes('tránsito') ||
                 titulo.includes('cierre') ||
                 titulo.includes('obra') ||
                 titulo.includes('movilidad') ||
                 titulo.includes('vía');
        })
        .slice(0, 5)
        .forEach(item => {
          noticias.push({
            id: item.guid || item.link || Math.random().toString(),
            titulo: item.title || 'Sin título',
            descripcion: item.contentSnippet || item.content?.substring(0, 200) || item.description?.substring(0, 200) || 'Sin descripción',
            url: item.link || '#',
            fecha: new Date(item.pubDate || Date.now()),
            fuente: 'El Espectador',
            imagen: item.enclosure?.url || null,
            categoria: extraerCategoria(item.title || '')
          });
        });
    } catch (err) {
      console.error('Error El Espectador:', err.message);
    }

    // Si no hay noticias, agregar noticias de ejemplo como fallback
    if (noticias.length === 0) {
      noticias.push(
        {
          id: '1',
          titulo: 'Nuevas normativas para PMT en Bogotá 2025',
          descripcion: 'La Secretaría de Movilidad actualiza los requisitos para Planes de Manejo de Tránsito en obras de construcción. Conoce los cambios y cómo afectan tu proyecto.',
          url: 'https://www.simur.gov.co/pmt',
          fecha: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Hace 2 días
          fuente: 'SDM Bogotá',
          imagen: null,
          categoria: 'PMT'
        },
        {
          id: '2',
          titulo: 'Cierre temporal en Avenida 68 por obras de mantenimiento',
          descripcion: 'La Secretaría de Movilidad informa sobre el cierre parcial de la Avenida 68 entre calles 80 y 100 por trabajos de mantenimiento de infraestructura vial.',
          url: '#',
          fecha: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Ayer
          fuente: 'SDM Bogotá',
          imagen: null,
          categoria: 'Cierres'
        },
        {
          id: '3',
          titulo: 'Obras de ampliación en la Calle 13 afectarán tránsito',
          descripcion: 'Inician obras de ampliación de carriles en la Calle 13 entre Carreras 7 y 15. Se implementarán desvíos temporales y señalización especial.',
          url: '#',
          fecha: new Date(Date.now() - 3 * 60 * 60 * 1000), // Hace 3 horas
          fuente: 'El Tiempo',
          imagen: null,
          categoria: 'Obras'
        },
        {
          id: '4',
          titulo: 'Actualización en normativa de señalización vial',
          descripcion: 'Nuevos estándares para señalización en obras. Conoce los cambios en los requisitos de PMT y señalización temporal.',
          url: '#',
          fecha: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // Hace 5 días
          fuente: 'SDM Bogotá',
          imagen: null,
          categoria: 'PMT'
        },
        {
          id: '5',
          titulo: 'Cambios en rutas de TransMilenio por obras en la Calle 26',
          descripcion: 'Ajustes temporales en las rutas de TransMilenio debido a obras de mantenimiento en la Calle 26. Consulta las rutas alternas.',
          url: '#',
          fecha: new Date(Date.now() - 6 * 60 * 60 * 1000), // Hace 6 horas
          fuente: 'TransMilenio',
          imagen: null,
          categoria: 'Transporte'
        },
        {
          id: '6',
          titulo: 'Recomendaciones para PMT en temporada de lluvias',
          descripcion: 'La SDM emite recomendaciones especiales para Planes de Manejo de Tránsito durante la temporada de lluvias en Bogotá.',
          url: '#',
          fecha: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Hace 7 días
          fuente: 'SDM Bogotá',
          imagen: null,
          categoria: 'PMT'
        }
      );
    }

    // Deduplicar por URL/título
    const unicas = deduplicar(noticias);
    
    // Ordenar por fecha (más recientes primero)
    unicas.sort((a, b) => b.fecha - a.fecha);

    // Actualizar cache
    cache.data = { 
      noticias: unicas.slice(0, 12), 
      actualizado: new Date() 
    };
    cache.timestamp = Date.now();

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    res.json(cache.data);
  } catch (error) {
    console.error('Error general:', error);
    // En caso de error, devolver noticias de ejemplo
    const noticiasEjemplo = [
      {
        id: '1',
        titulo: 'Nuevas normativas para PMT en Bogotá 2025',
        descripcion: 'La Secretaría de Movilidad actualiza los requisitos para Planes de Manejo de Tránsito en obras de construcción. Conoce los cambios y cómo afectan tu proyecto.',
        url: 'https://www.simur.gov.co/pmt',
        fecha: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        fuente: 'SDM Bogotá',
        imagen: null,
        categoria: 'PMT'
      },
      {
        id: '2',
        titulo: 'Cierre temporal en Avenida 68 por obras de mantenimiento',
        descripcion: 'La Secretaría de Movilidad informa sobre el cierre parcial de la Avenida 68 entre calles 80 y 100 por trabajos de mantenimiento de infraestructura vial.',
        url: '#',
        fecha: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        fuente: 'SDM Bogotá',
        imagen: null,
        categoria: 'Cierres'
      },
      {
        id: '3',
        titulo: 'Obras de ampliación en la Calle 13 afectarán tránsito',
        descripcion: 'Inician obras de ampliación de carriles en la Calle 13 entre Carreras 7 y 15. Se implementarán desvíos temporales y señalización especial.',
        url: '#',
        fecha: new Date(Date.now() - 3 * 60 * 60 * 1000),
        fuente: 'El Tiempo',
        imagen: null,
        categoria: 'Obras'
      }
    ];
    
    res.json({ 
      noticias: noticiasEjemplo,
      actualizado: new Date()
    });
  }
});

app.get('/api/aforos/descargar/:fileId', async (req, res) => {
  const idEstudio = req.params.fileId?.trim();
  if (!idEstudio) return res.status(400).json({ error: 'fileId requerido' });
  console.log(`[Aforos] Descarga solicitada id_estudio=${idEstudio}`);
  try {
    const { buffer, nombreOriginal } = await getExcelBufferForStudy(idEstudio);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreOriginal}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error proxy descarga aforo:', err);
    const status = err.message?.includes('404') || err.message?.includes('no encontrado') ? 404 : 502;
    res.status(status).json({ error: err.message || 'Error al descargar el aforo' });
  }
});

const DEBUG_AFORO = process.env.DEBUG_AFORO === '1' || process.env.DEBUG_AFORO === 'true';

app.get('/api/aforos/analisis/:idEstudio', async (req, res) => {
  const idEstudio = req.params.idEstudio?.trim();
  if (!idEstudio) return res.status(400).json({ error: 'idEstudio requerido' });
  console.log(`[Aforos] Análisis solicitado id_estudio=${idEstudio}`);
  try {
    const { buffer } = await getExcelBufferForStudy(idEstudio);
    const resultado = analizarExcelBuffer(buffer);
    res.json(resultado);
  } catch (err) {
    console.error('Error análisis aforo:', err);
    if (DEBUG_AFORO) {
      console.warn('[DEBUG_AFORO] analisis error:', err.message);
      console.warn('[DEBUG_AFORO] quality:', err.quality);
    }
    const status = err.message?.includes('no encontrado') || err.message?.includes('404') ? 404 : 502;
    const quality =
      err.quality && typeof err.quality === 'object'
        ? err.quality
        : { dimId: idEstudio, debugHint: 'Revisar DEBUG_AFORO logs' };
    res.status(status).json({
      error: err.message || 'No se pudieron interpretar filas del aforo',
      quality
    });
  }
});

// Rutas de aforos (historial y geocode desde BD; no se lee ia_historial.json en runtime)
app.use('/api/aforos', aforosRoutes);
app.use('/api/nodos/rules', nodosRulesRoutes); // GET/POST/PATCH /api/nodos/rules, POST /api/nodos/rules/apply
app.use('/api/nodos', nodosRoutes); // GET /api/nodos/:nodeId/estudios

// Rutas de movilidad
app.use('/api/movilidad', movilidadRoutes);

// Rutas de PMT
app.use('/api/pmt', pmtRoutes);

// Rutas de datos unificados (calendario obras/eventos, velocidades por nodo)
app.use('/api/datos-unificados', datosUnificadosRoutes);

// Estudios de tránsito enriquecidos (vías, puntos críticos, infraestructura, proyecciones)
app.use('/api/estudios-transito', estudiosTransitoRoutes);
app.use('/api/grafo', grafoRoutes);
app.use('/api/simular', simularRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/prediccion', prediccionRoutes);
app.use('/api/senales', senalesRoutes);
app.use('/api/arcgis', arcgisRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', capasRoutes);

// Ruta de salud (incluye DB y PostGIS cuando hay conexión)
app.get('/health', async (req, res) => {
  let db = 'not_configured';
  let postgis = null;
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    try {
      postgis = await dbHealthCheck();
      db = postgis ? 'ok' : 'error';
    } catch (err) {
      db = 'error';
      postgis = err.message || 'connection failed';
    }
  }
  res.json({
    ok: true,
    status: 'ok',
    timestamp: new Date(),
    db,
    postgis: postgis === null ? null : (typeof postgis === 'string' ? postgis : String(postgis)),
    services: {
      movilidad: 'active',
      pmt: 'active',
      llm: {
        google_gemini: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
        anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not_configured'
      }
    }
  });
});

// Servir frontend (build de Vite) desde el mismo servidor cuando dist existe
if (serveFrontend) {
  app.use(express.static(distPath));
  app.get('*path', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  if (serveFrontend) {
    console.log(`📂 Sirviendo frontend desde /dist (mismo origen que /api)`);
  }
  console.log(`📰 Noticias: /api/noticias`);
  console.log(`📥 Descarga aforos: /api/aforos/descargar/:fileId`);
  console.log(`🗺️  Movilidad: /api/movilidad`);
  console.log(`🤖 PMT: /api/pmt`);
  console.log(`📊 Datos unificados: /api/datos-unificados`);
  console.log(`📑 Estudios tránsito: /api/estudios-transito/vias, /puntos-criticos, /infraestructura, /proyecciones`);
  console.log(`📌 Nodos (estudios por nodo): GET /api/nodos/:nodeId/estudios`);
  console.log(`\n📋 Configuración LLM:`);
  console.log(`   - Google Gemini: ${process.env.GOOGLE_GEMINI_API_KEY ? '✅ Configurado' : '❌ No configurado'}`);
  console.log(`   - OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Configurado' : '❌ No configurado'}`);
  console.log(`   - Anthropic: ${process.env.ANTHROPIC_API_KEY ? '✅ Configurado' : '❌ No configurado'}`);
});
