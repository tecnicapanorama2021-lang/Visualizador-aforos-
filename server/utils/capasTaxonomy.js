/**
 * Taxonomía canónica para contexto_eventos: clasificación por keywords (no solo por tipo).
 * Clasificación robusta: MANIFESTACIONES, EVENTOS (incl. CONCIERTO), OBRAS.
 */

/** Normaliza texto para búsqueda: lowercase, sin tildes. */
export function normalizeString(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0301/g, '')
    .replace(/\u0300/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const KEYWORDS_MANIFESTACIONES = [
  'manifestacion',
  'marcha',
  'protesta',
  'bloqueo',
  'cierre',
  'planton',
  'disturbios',
  'paro',
];
const KEYWORDS_OBRAS = [
  'obra',
  'construccion',
  'construcción',
  'intervencion',
  'intervención',
  'cierres por obra',
];
const KEYWORDS_CONCIERTO = ['concierto', 'festival', 'show', 'gira'];
const KEYWORDS_TEATRO = ['teatro', 'obra de teatro', 'danza'];
const KEYWORDS_FERIA = ['feria', 'feria artesanal', 'exposicion', 'exposición'];

/**
 * Clasifica un registro de contexto_eventos por contenido (tipo, subtipo, descripcion, fuente).
 * Prioridad: tipo almacenado (EVENTO_CULTURAL, MANIFESTACION, LUGAR_EVENTO, etc.) tiene precedencia.
 * LUGAR_EVENTO / AGENDATE_BOGOTA no se consideran EVENTOS (son venues/lugares).
 * @param {{ tipo?: string, subtipo?: string, descripcion?: string, fuente?: string }} row
 * @returns {{ layer: 'EVENTOS'|'MANIFESTACIONES'|'OBRAS'|'LUGARES', subtype?: string }}
 */
export function classifyContextoEvento(row) {
  const tipo = (row.tipo || '').toUpperCase().trim();
  const fuente = (row.fuente || '').trim();
  const desc = normalizeString(row.descripcion || '');
  const subtipoRaw = normalizeString(row.subtipo || '');
  const combined = `${desc} ${subtipoRaw}`;

  // LUGARES: venues/lugares (Agéndate); no son instancias temporales
  if (tipo === 'LUGAR_EVENTO' || fuente === 'AGENDATE_BOGOTA') return { layer: 'LUGARES' };

  // OBRAS: solo tipo explícito OBRA (las obras vienen con tipo OBRA del ETL)
  if (tipo === 'OBRA') return { layer: 'OBRAS' };

  // Prioridad a tipos de evento/manifestación ya definidos en origen (evita que "obra de teatro" → OBRA)
  if (tipo === 'MANIFESTACION') return { layer: 'MANIFESTACIONES' };
  if (KEYWORDS_MANIFESTACIONES.some((k) => combined.includes(k))) return { layer: 'MANIFESTACIONES' };

  if (tipo === 'EVENTO_CULTURAL' || tipo === 'CIERRE_VIA' || tipo === 'EVENTO') {
    if (KEYWORDS_CONCIERTO.some((k) => combined.includes(k))) return { layer: 'EVENTOS', subtype: 'CONCIERTO' };
    if (KEYWORDS_TEATRO.some((k) => combined.includes(k))) return { layer: 'EVENTOS', subtype: 'TEATRO' };
    if (KEYWORDS_FERIA.some((k) => combined.includes(k))) return { layer: 'EVENTOS', subtype: 'FERIA' };
    return { layer: 'EVENTOS' };
  }

  // Keywords de obra solo cuando el tipo no es ya un evento (ej. registros sin tipo o genéricos)
  if (KEYWORDS_OBRAS.some((k) => combined.includes(normalizeString(k)))) return { layer: 'OBRAS' };

  // CONCIERTO como subtipo de EVENTOS (por descripción cuando tipo no está definido)
  if (KEYWORDS_CONCIERTO.some((k) => combined.includes(k))) return { layer: 'EVENTOS', subtype: 'CONCIERTO' };

  return { layer: 'EVENTOS' };
}
