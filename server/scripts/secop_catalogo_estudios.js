/**
 * Catálogo de procesos/contratos SECOP con estudios de tránsito / ETT / EDAU en Bogotá.
 * Usa SOLO la API oficial de Datos Abiertos Colombia (Socrata): dataset SECOP Integrado (rpmr-utcd).
 * Escribe SIEMPRE en server/scripts/tmp/secop_catalogo_estudios.json con datos reales de la API.
 * Con SECOP_FETCH_ANEXOS=1 extrae anexos reales desde la página Colombia Compra (url_contrato).
 *
 * Salida: server/scripts/tmp/secop_catalogo_estudios.json
 *
 * Uso: node server/scripts/secop_catalogo_estudios.js
 *      SECOP_FETCH_ANEXOS=1 node server/scripts/secop_catalogo_estudios.js
 *      SECOP_DEBUG=1 node server/scripts/secop_catalogo_estudios.js
 *      SECOP_FETCH_LIMIT=50 SECOP_FETCH_ANEXOS=1 node server/scripts/secop_catalogo_estudios.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
// API datos.gov.co NO usa proxy (timeout con Tor). Solo Playwright usa SECOP_PLAYWRIGHT_PROXY.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const TMP_DIR = path.join(__dirname, 'tmp');
const OUT_PATH = path.join(TMP_DIR, 'secop_catalogo_estudios.json');

// API real: SECOP Integrado - https://www.datos.gov.co/Estad-sticas-Nacionales/SECOP-Integrado/rpmr-utcd
const SECOP_DATASET_ID = 'rpmr-utcd';
const BASE_URL = `https://www.datos.gov.co/resource/${SECOP_DATASET_ID}.json`;
const LIMIT = 1000;
const DELAY_MS = 800;
const FETCH_ANEXOS_DELAY_MS = 1500;
const FETCH_ANEXOS_DEFAULT_LIMIT = 100;
const MIN_PROCESSOS_PARA_SEGUNDA_PASA = 30;
const DEBUG_N_PROCESOS = 5;

// Keywords ampliadas: estudios de tránsito, caracterización sistema vial, aforos, etc.
const KEYWORDS = [
  'estudio de tránsito',
  'estudio de transito',
  'estudio de movilidad',
  'estudios de tránsito',
  'estudios de transito',
  'Plan de Manejo de Tránsito',
  'PMT',
  'ETT',
  'EDAU',
  'Bogotá',
  'aforos',
  'aforo',
  'conteos',
  'conteo vehicular',
  'caracterización del sistema vial',
  'caracterizacion del sistema vial',
  'caracterización del sistema de transporte',
  'caracterizacion del sistema de transporte',
  'caracterización del sistema vial y de transporte',
  'caracterizacion del sistema vial y de transporte',
  'estudios del sistema vial y de transporte',
  'modelación de tránsito',
  'modelacion de transito',
  'modelación de tránsito',
  'estudios de tráfico',
  'estudio de tráfico',
  'tránsito y transporte',
  'transito y transporte',
];

const BOGOTA_MARKERS = [
  'Bogotá',
  'BOGOTA',
  'Distrito Capital',
  'SDM',
  'Secretaría de Movilidad',
  'Secretaría Distrital de Planeación',
  'Secretaría Distrital de Planeacion',
  'SDP',
  'IDU',
  'Alcaldía Mayor',
  'Bogotá D.C.',
];

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// SECOP Integrado (rpmr-utcd): nombre_de_la_entidad, departamento_entidad, municipio_entidad, objeto_del_proceso, objeto_a_contratar, numero_de_proceso, url_contrato, fecha_de_firma_del_contrato
function isBogotaRelated(row) {
  const text = [
    row.nombre_de_la_entidad,
    row.departamento_entidad,
    row.municipio_entidad,
    row.objeto_del_proceso,
    row.objeto_a_contratar,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return BOGOTA_MARKERS.some((m) => text.includes(m.toLowerCase()));
}

function isTrafficStudyRelated(row) {
  const text = [row.objeto_del_proceso, row.objeto_a_contratar].filter(Boolean).join(' ').toLowerCase();
  const k = KEYWORDS.map((q) => q.toLowerCase());
  return k.some((kw) => text.includes(kw));
}

function normalizeEntry(row) {
  const url = row.url_contrato;
  return {
    id_proceso: row.numero_de_proceso || row.numero_del_contrato || '',
    referencia_proceso: row.numero_del_contrato || row.numero_de_proceso || '',
    objeto: (row.objeto_del_proceso || row.objeto_a_contratar || '').slice(0, 500),
    nombre_procedimiento: (row.objeto_del_proceso || '').slice(0, 200),
    entidad: row.nombre_de_la_entidad || '',
    fecha_publicacion: row.fecha_de_firma_del_contrato || '',
    url_proceso: typeof url === 'string' ? url : '',
    anexos: [], // Se rellena con SECOP_FETCH_ANEXOS=1 si se desea extraer de la página
  };
}

/** Objeto suena a estudio de tránsito / caracterización sistema vial (para sugerir revisión manual). */
function objetoSuenaAEstudioTransito(objeto) {
  if (!objeto) return false;
  const t = String(objeto).toLowerCase();
  return (
    t.includes('estudio de tránsito') ||
    t.includes('estudio de transito') ||
    t.includes('caracterización del sistema vial') ||
    t.includes('caracterizacion del sistema vial') ||
    t.includes('sistema vial y de transporte') ||
    t.includes('aforo') ||
    t.includes('conteo vehicular') ||
    t.includes('pmt') ||
    t.includes('plan de manejo de tránsito')
  );
}

async function fetchPage(q, offset) {
  const params = new URLSearchParams({
    $limit: String(LIMIT),
    $offset: String(offset),
    $q: q,
  });
  const url = `${BASE_URL}?${params.toString()}`;
  const res = await axios.get(url, {
    timeout: 45000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Aforos-Bogota/1.0)',
    },
  });
  if (res.status < 200 || res.status >= 400) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.data;
}

async function main() {
  loadEnv();

  const seen = new Map();
  let all = [];

  console.log('[secop-catalogo] Fuente: API oficial datos.gov.co (Socrata), dataset SECOP Integrado (rpmr-utcd).');
  console.log('[secop-catalogo] Búsquedas por palabras clave (estudios tránsito, aforos, caracterización sistema vial, etc.)...');

  // Fase 1: con filtro Bogotá/entidad
  for (const keyword of KEYWORDS) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      try {
        const rows = await fetchPage(keyword, offset);
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const row of rows) {
          if (!isBogotaRelated(row)) continue;
          if (!isTrafficStudyRelated(row)) continue;
          const id = row.numero_de_proceso || row.numero_del_contrato;
          if (seen.has(id)) continue;
          seen.set(id, true);
          all.push(normalizeEntry(row));
        }
        if (rows.length < LIMIT) hasMore = false;
        else offset += LIMIT;
        await sleep(DELAY_MS);
      } catch (err) {
        console.warn('[secop-catalogo] Error en búsqueda:', keyword, offset, err.message);
        hasMore = false;
      }
    }
  }

  // Fase 2: si pocos resultados, segunda pasada sin restricción de entidad (solo keywords en objeto)
  if (all.length < MIN_PROCESSOS_PARA_SEGUNDA_PASA) {
    console.log('[secop-catalogo] Pocos procesos con filtro Bogotá (' + all.length + '). Segunda pasada sin filtro entidad...');
    for (const keyword of KEYWORDS) {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        try {
          const rows = await fetchPage(keyword, offset);
          if (!Array.isArray(rows) || rows.length === 0) break;
          for (const row of rows) {
            if (!isTrafficStudyRelated(row)) continue;
            const id = row.numero_de_proceso || row.numero_del_contrato;
            if (seen.has(id)) continue;
            seen.set(id, true);
            all.push(normalizeEntry(row));
          }
          if (rows.length < LIMIT) hasMore = false;
          else offset += LIMIT;
          await sleep(DELAY_MS);
        } catch (err) {
          console.warn('[secop-catalogo] Error en búsqueda (fase 2):', keyword, offset, err.message);
          hasMore = false;
        }
      }
    }
  }

  const sorted = [...all].sort(
    (a, b) => (b.fecha_publicacion || '').localeCompare(a.fecha_publicacion || '')
  );

  const debug = process.env.SECOP_DEBUG === '1' || process.env.DEBUG === '1' || process.env.SECOP_DEBUG === 'true';
  if (debug) {
    console.log('[secop-catalogo] DEBUG: primeros', DEBUG_N_PROCESOS, 'procesos aceptados:');
    sorted.slice(0, DEBUG_N_PROCESOS).forEach((p, i) => {
      console.log('  ', i + 1, '| id_proceso:', p.id_proceso);
      console.log('      objeto:', (p.objeto || '').slice(0, 120) + (p.objeto && p.objeto.length > 120 ? '...' : ''));
      console.log('      entidad:', p.entidad);
      console.log('      url_proceso:', p.url_proceso || '(vacío)');
    });
  }

  const fetchAnexos = process.env.SECOP_FETCH_ANEXOS === '1' || process.env.SECOP_FETCH_ANEXOS === 'true';
  const fetchLimit = Math.max(1, parseInt(process.env.SECOP_FETCH_LIMIT || String(FETCH_ANEXOS_DEFAULT_LIMIT), 10) || FETCH_ANEXOS_DEFAULT_LIMIT);

  if (fetchAnexos) {
    console.log('[secop-catalogo] SECOP_FETCH_ANEXOS=1: extrayendo anexos con Playwright headless (límite', fetchLimit, 'procesos)...');
    const toFetch = sorted.slice(0, fetchLimit);
    // Ficha SECOP II: community.secop.gov.co/Public/Tendering/ContractNoticeManagement/Index?noticeUID=<id_proceso>
    const SECOP_FICHA_BASE = 'https://community.secop.gov.co/Public/Tendering/ContractNoticeManagement/Index';
    const urlsConProceso = [];
    const idProcesosByUrl = {};
    for (const p of toFetch) {
      const urlFicha = p.id_proceso
        ? `${SECOP_FICHA_BASE}?noticeUID=${encodeURIComponent(p.id_proceso)}`
        : p.url_proceso;
      if (urlFicha) {
        urlsConProceso.push(urlFicha);
        idProcesosByUrl[urlFicha] = p.id_proceso || null;
      }
    }
    let anexosPorUrl = {};
    try {
      const { fetchAnexosBatch } = await import('./secop_fetch_anexos_playwright.js');
      anexosPorUrl = await fetchAnexosBatch(urlsConProceso, {
        concurrency: 3,
        delayMs: FETCH_ANEXOS_DELAY_MS,
        idProcesosByUrl,
      });
    } catch (err) {
      console.warn('[secop-catalogo] Playwright falló, anexos vacíos:', err.message);
    }
    for (const p of toFetch) {
      const urlFicha = p.id_proceso ? `${SECOP_FICHA_BASE}?noticeUID=${encodeURIComponent(p.id_proceso)}` : p.url_proceso;
      p.anexos = (urlFicha && anexosPorUrl[urlFicha]) ? anexosPorUrl[urlFicha] : [];
      if (p.anexos.length) {
        console.log('[secop-catalogo] ', p.id_proceso, '→', p.anexos.length, 'anexos');
      } else if (objetoSuenaAEstudioTransito(p.objeto)) {
        console.log('[secop-catalogo] TODO: revisar manualmente id_proceso', p.id_proceso, '- objeto suena a estudio de tránsito pero no se encontraron anexos.');
      }
    }
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 2), 'utf8');

  console.log('[secop-catalogo] Procesos en catálogo:', sorted.length);
  if (fetchAnexos) {
    const conAnexos = sorted.filter((p) => (p.anexos || []).length > 0).length;
    console.log('[secop-catalogo] Procesos con anexos extraídos (en este run):', conAnexos);
  }
  console.log('[secop-catalogo] Guardado:', OUT_PATH);
  if (!fetchAnexos) {
    console.log('[secop-catalogo] Para extraer anexos desde las páginas Colombia Compra, ejecuta: SECOP_FETCH_ANEXOS=1 npm run secop:catalogo');
  }
}

main().catch((err) => {
  console.error('[secop-catalogo] Error:', err.message);
  process.exit(1);
});
