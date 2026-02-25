/**
 * Job diario: actualiza la sección "eventos" de calendario_obras_eventos.json
 * desde fuentes RSS públicas (Google News, El Tiempo Bogotá).
 * Solo incluye noticias con impacto directo en movilidad: conciertos, maratones,
 * festivales, cierres viales, manifestaciones, próximos eventos con fechas.
 * Excluye robos, atracos, crimen y noticias no relacionadas con movilidad.
 * Extrae ubicación/lugar cuando es posible para contexto de la IA por nodo.
 *
 * Uso: node server/scripts/jobCalendarioEventos.js
 * Opciones: --output=path (calendario JSON)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parser = new Parser({ timeout: 15000 });
const OUTPUT_ARG = process.argv.find(a => a.startsWith('--output='));
const CALENDAR_PATH = OUTPUT_ARG
  ? path.resolve(process.cwd(), OUTPUT_ARG.split('=')[1])
  : path.join(__dirname, '../../public/data/calendario_obras_eventos.json');

/** Términos que excluyen la noticia: no tienen impacto en movilidad */
const BLACKLIST = [
  'atraco', 'atracado', 'atracados', 'robo', 'hurto', 'sicariato', 'asesinato',
  'homicidio', 'crimen', 'fue atracado', 'resultó herida', 'resultó herido',
  'fusión de colegios', 'colegios se fusionan', 'morosos del ica', 'morosos del ica',
  'secretaría de hacienda', 'curso gratis de conducción', 'licencia c1 incluida',
  'adultos mayores fue atracado', 'cafetería en suba', 'atracado mientras',
  'grave accidente', 'camioneta perdió el control', 'terminó en el techo de una casa'
].map((t) => t.toLowerCase());

/** Lugares y vías de Bogotá para extraer ubicación (orden: más específico primero) */
const LUGARES_BOGOTA = [
  { pattern: /parque\s+simón\s+bolívar/gi, nombre: 'Parque Simón Bolívar' },
  { pattern: /movistar\s+arena/gi, nombre: 'Movistar Arena' },
  { pattern: /estadio\s+el\s+campín/gi, nombre: 'Estadio El Campín' },
  { pattern: /estadio\s+campín/gi, nombre: 'Estadio El Campín' },
  { pattern: /parque\s+de\s+los\s+novios/gi, nombre: 'Parque de los Novios' },
  { pattern: /parque\s+el\s+tunal/gi, nombre: 'Parque El Tunal' },
  { pattern: /parque\s+tunal/gi, nombre: 'Parque El Tunal' },
  { pattern: /maloka/gi, nombre: 'Maloka' },
  { pattern: /corferias/gi, nombre: 'Corferias' },
  { pattern: /autopista\s+norte/gi, nombre: 'Autopista Norte' },
  { pattern: /autopista\s+sur/gi, nombre: 'Autopista Sur' },
  { pattern: /av\.?\s*caracas/gi, nombre: 'Avenida Caracas' },
  { pattern: /avenida\s+caracas/gi, nombre: 'Avenida Caracas' },
  { pattern: /av\.?\s*68/gi, nombre: 'Avenida 68' },
  { pattern: /avenida\s+68/gi, nombre: 'Avenida 68' },
  { pattern: /calle\s+26/gi, nombre: 'Calle 26' },
  { pattern: /carrera\s+7/gi, nombre: 'Carrera 7' },
  { pattern: /carrera\s+15/gi, nombre: 'Carrera 15' },
  { pattern: /calle\s+80/gi, nombre: 'Calle 80' },
  { pattern: /calle\s+100/gi, nombre: 'Calle 100' },
  { pattern: /av\.?\s*suba/gi, nombre: 'Avenida Suba' },
  { pattern: /avenida\s+suba/gi, nombre: 'Avenida Suba' },
  { pattern: /carrera\s+50/gi, nombre: 'Carrera 50' },
  { pattern: /primero\s+de\s+mayo/gi, nombre: 'Avenida Primero de Mayo' },
  { pattern: /av\.?\s*primero\s+de\s+mayo/gi, nombre: 'Avenida Primero de Mayo' },
  { pattern: /nqs\s+con\s+calle|nqs\s+y\s+calle/gi, nombre: 'NQS' },
  { pattern: /entre\s+calle\s+(\d+)\s+y\s+calle\s+(\d+)/gi, nombre: null },
  { pattern: /calle\s+(\d+)\s+con\s+carrera\s+(\d+)/gi, nombre: null },
  { pattern: /carrera\s+(\d+)\s+con\s+calle\s+(\d+)/gi, nombre: null },
  { pattern: /localidad\s+de\s+(\w+)/gi, nombre: null },
  { pattern: /en\s+(usme|kennedy|suba|engativá|fontibón|puente\s+aranda|ciudad\s+bolívar|antonio\s+nariño|santa\s+fe|candelaria|rafael\s+uribe|barrios\s+unidos|teusaquillo|los\s+mártires|chapinero)/gi, nombre: null }
];

const FEEDS = [
  {
    url: 'https://news.google.com/rss/search?q=próximos+eventos+Bogotá+2026+conciertos+maratón+festival+fechas+movilidad+cierre+vial&hl=es&gl=CO&ceid=CO:es',
    fuente: 'Google News',
    keywords: [
      'concierto', 'maratón', 'festival', 'evento', 'cierre vial', 'cierre temporal',
      'manifestación', 'marcha', 'carrera', 'ciclovía', 'desfile', 'Bogotá',
      'programación', 'fechas', 'calendario', 'movilidad', 'afectación'
    ]
  },
  {
    url: 'https://news.google.com/rss/search?q=eventos+Bogotá+manifestaciones+maratón+conciertos+festival+cierre+cultural&hl=es&gl=CO&ceid=CO:es',
    fuente: 'Google News',
    keywords: [
      'manifestación', 'marcha', 'protesta', 'concentración', 'maratón', 'carrera',
      'concierto', 'festival', 'evento cultural', 'cierre cultural', 'cierre por evento',
      'cierre vial', 'cierre temporal', 'ciclovía', 'desfile', 'Bogotá'
    ]
  },
  {
    url: 'https://www.eltiempo.com/rss/bogota.xml',
    fuente: 'El Tiempo Bogotá',
    keywords: [
      'manifestación', 'marcha', 'maratón', 'concierto', 'festival', 'evento cultural',
      'cierre vial', 'cierre temporal', 'carrera', 'desfile', 'movilidad', 'Bogotá',
      'calle', 'avenida', 'pico y placa', 'cierres', 'desvíos'
    ]
  }
];

function isExcludedByBlacklist(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return BLACKLIST.some((term) => lower.includes(term));
}

function extractUbicacion(text) {
  if (!text || typeof text !== 'string') return null;
  for (const { pattern, nombre } of LUGARES_BOGOTA) {
    const match = text.match(pattern);
    if (match) {
      if (nombre) return nombre;
      const m = match[0];
      if (m) return m.replace(/\s+/g, ' ').trim();
    }
  }
  const calleCarrera = text.match(/(?:calle|kr\.?|carrera)\s*\d+\s*(?:con|y|entre)?\s*(?:calle|kr\.?|carrera)?\s*\d*/gi);
  if (calleCarrera && calleCarrera[0]) return calleCarrera[0].replace(/\s+/g, ' ').trim();
  const avMatch = text.match(/(?:av\.?|avenida)\s+[\w\s]+(?=\s|,|\.|$)/gi);
  if (avMatch && avMatch[0]) return avMatch[0].replace(/\s+/g, ' ').trim();
  return null;
}

/** Extrae fechas de evento mencionadas en el texto (ej. "10 de agosto", "4 de febrero") para contexto de días afectados */
function extractFechaEventoTexto(text) {
  if (!text || typeof text !== 'string') return null;
  const meses = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';
  const match = text.match(new RegExp(`(\\d{1,2})\\s+de\\s+(${meses})`, 'gi'));
  if (match && match[0]) return match[0].trim();
  const matchDia = text.match(/(?:domingo|lunes|martes|miércoles|jueves|viernes|sábado)\s+\d{1,2}\s+de\s+\w+/gi);
  if (matchDia && matchDia[0]) return matchDia[0].trim();
  return null;
}

function normalizeEvento(item, fuente) {
  const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
  const descripcion = [item.title, item.contentSnippet || item.content?.substring(0, 300) || item.description?.substring(0, 300)]
    .filter(Boolean)
    .join(' — ');
  const text = descripcion.trim() || '';
  const ubicacion = extractUbicacion(text);
  const fechaEventoTex = extractFechaEventoTexto(text);
  return {
    id: item.guid || item.link || `evento_${pubDate.getTime()}_${Math.random().toString(36).slice(2, 9)}`,
    tipo: 'evento',
    fuente,
    descripcion: text || 'Sin descripción',
    fecha_inicio: pubDate.toISOString(),
    fecha_fin: null,
    fecha_evento_tex: fechaEventoTex || null,
    timestamp: new Date().toISOString(),
    url: item.link || null,
    zona: ubicacion,
    ubicacion: ubicacion
  };
}

async function fetchEventosFromFeed(config) {
  const eventos = [];
  try {
    const feed = await parser.parseURL(config.url);
    const items = feed.items || [];
    const filtered = config.keywords
      ? items.filter((item) => {
          const text = ((item.title || '') + ' ' + (item.contentSnippet || item.content || item.description || '')).toLowerCase();
          if (isExcludedByBlacklist(text)) return false;
          return config.keywords.some((k) => text.includes(k.toLowerCase()));
        })
      : items;
    for (const item of filtered.slice(0, 15)) {
      const text = ((item.title || '') + ' ' + (item.contentSnippet || item.content || item.description || '')).toLowerCase();
      if (isExcludedByBlacklist(text)) continue;
      eventos.push(normalizeEvento(item, config.fuente));
    }
  } catch (err) {
    console.warn(`Error feed ${config.fuente}:`, err.message);
  }
  return eventos;
}

function main() {
  (async () => {
    console.log('Job Calendario Eventos: iniciando...');
    const allEventos = [];
    const seenUrls = new Set();

    for (const feedConfig of FEEDS) {
      const eventos = await fetchEventosFromFeed(feedConfig);
      for (const e of eventos) {
        if (isExcludedByBlacklist(e.descripcion || '')) continue;
        const key = e.url || e.id;
        if (key && !seenUrls.has(key)) {
          seenUrls.add(key);
          allEventos.push(e);
        } else if (!key) {
          allEventos.push(e);
        }
      }
    }

    const soloMovilidad = allEventos.filter((e) => !isExcludedByBlacklist(e.descripcion || ''));
    console.log(`Eventos extraídos (solo movilidad/eventos con impacto): ${soloMovilidad.length}`);

    let existing = { metadata: { version: '1.0' }, obras: [], eventos: [] };
    try {
      const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch {}

    const output = {
      metadata: {
        ...existing.metadata,
        version: '1.0',
        updated_at: new Date().toISOString(),
        description: 'Calendario unificado de obras (IDU) y eventos con impacto en movilidad (fechas, ubicación); excluye crimen/robos'
      },
      obras: Array.isArray(existing.obras) ? existing.obras : [],
      eventos: soloMovilidad
    };

    fs.mkdirSync(path.dirname(CALENDAR_PATH), { recursive: true });
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Calendario guardado: ${CALENDAR_PATH} (${output.obras.length} obras, ${output.eventos.length} eventos)`);
  })().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

main();
