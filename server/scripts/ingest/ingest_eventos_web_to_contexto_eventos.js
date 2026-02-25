/**
 * Ingesta eventos desde fuentes web (bogota.gov.co agenda cultural, idartes agenda)
 * a contexto_eventos tipo EVENTO_CULTURAL, con geom desde venue_matcher cuando hay match.
 * [nuevo archivo]
 *
 * Uso:
 *   npm run ingest:eventos:web:dry
 *   npm run ingest:eventos:web:apply
 */

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { query, closePool } from '../../db/client.js';
import { matchVenueByName } from '../../utils/venue_matcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DIAS_FUTURO = parseInt(process.env.AGENDA_DIAS_FUTURO || '60', 10);
const BOGOTA_AGENDA_BASE = 'https://bogota.gov.co/que-hacer/agenda-cultural';
const IDARTES_AGENDA_BASE = 'https://www.idartes.gov.co/es/agenda';

const MESES_ES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/** Parsea texto tipo "viernes 21 de marzo de 2026, 8:00 p.m." -> Date o null. */
function parseSpanishDateTime(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.trim().toLowerCase();
  const match = s.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?))?/);
  if (!match) return null;
  const [, dia, mesStr, anio, h = '0', min = '0', ampm = ''] = match;
  const mes = MESES_ES[mesStr];
  if (mes === undefined) return null;
  let hour = parseInt(h, 10);
  const minute = parseInt(min, 10);
  if (ampm.includes('p')) hour = hour === 12 ? 12 : hour + 12;
  else if (ampm.includes('a') && hour === 12) hour = 0;
  try {
    const d = new Date(parseInt(anio, 10), mes, parseInt(dia, 10), hour, minute, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** Fetch con manejo de errores de red (no romper flujo). */
async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    const u = new URL(url);
    console.warn(`[ingest-eventos-web] Fetch falló: ${url} | host=${u.host} | ${err.code || err.name}: ${err.message}`);
    return null;
  }
}

/** Extrae eventos del HTML de bogota.gov.co/que-hacer/agenda-cultural (listado por página). */
function parseBogotaGovHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const events = [];
  const now = new Date();
  const limit = new Date(now.getTime() + DIAS_FUTURO * 86400000);

  $('[data-event], .event-item, .view-agenda .views-row, article.evento, .agenda-item').each((_, el) => {
    const $el = $(el);
    const titulo = $el.find('h2, h3, .title, .event-title, a[href*="/agenda"]').first().text().trim()
      || $el.find('a').first().text().trim();
    const lugar = $el.find('.lugar, .place, .venue, .field-name-field-lugar').text().trim()
      || $el.find('[class*="lugar"]').text().trim();
    const fechaTexto = $el.find('.fecha, .date, .field-name-field-fecha').text().trim()
      || $el.find('[class*="fecha"]').text().trim();
    const categoria = $el.find('.categoria, .category, .field-name-field-categoria').text().trim() || null;
    let url = $el.find('a[href*="/agenda"], a[href*="bogota.gov.co"]').attr('href');
    if (url && !url.startsWith('http')) url = new URL(url, baseUrl).href;

    if (!titulo) return;
    const startAt = parseSpanishDateTime(fechaTexto);
    if (startAt && (startAt < now || startAt > limit)) return;

    events.push({
      titulo: titulo.slice(0, 500),
      lugar: lugar || null,
      categoria: categoria ? categoria.slice(0, 100) : null,
      url: url || null,
      start_at: startAt,
      end_at: null,
    });
  });

  if (events.length === 0) {
    $('a[href*="/agenda"], a[href*="evento"]').each((_, el) => {
      const $el = $(el);
      const titulo = $el.text().trim();
      const href = $el.attr('href');
      if (titulo.length < 10 || titulo.length > 200) return;
      events.push({
        titulo: titulo.slice(0, 500),
        lugar: null,
        categoria: null,
        url: href ? new URL(href, baseUrl).href : null,
        start_at: null,
        end_at: null,
      });
    });
  }
  return events;
}

/** Extrae eventos del HTML de idartes (estructura similar o específica). */
function parseIdartesHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const events = [];
  $('.view-content .views-row, .agenda-item, article, [data-event]').each((_, el) => {
    const $el = $(el);
    const titulo = $el.find('h2, h3, .title, .field-name-title').first().text().trim() || $el.find('a').first().text().trim();
    const lugar = $el.find('.field-name-field-lugar, .lugar, .place').text().trim() || null;
    const fechaTexto = $el.find('.field-name-field-fecha, .fecha, .date').text().trim() || null;
    const categoria = $el.find('.field-name-field-categoria, .categoria').text().trim() || null;
    let url = $el.find('a[href]').attr('href');
    if (url && !url.startsWith('http')) url = new URL(url, baseUrl).href;
    if (!titulo) return;
    const startAt = parseSpanishDateTime(fechaTexto);
    events.push({
      titulo: titulo.slice(0, 500),
      lugar: lugar || null,
      categoria: categoria ? categoria.slice(0, 100) : null,
      url: url || null,
      start_at: startAt,
      end_at: null,
    });
  });
  return events;
}

/** Scrape bogota.gov.co con paginación ?page=0,1,... */
async function scrapeBogotaGov() {
  const events = [];
  let page = 0;
  const seen = new Set();
  for (;;) {
    const url = `${BOGOTA_AGENDA_BASE}?page=${page}`;
    const html = await safeFetch(url);
    if (!html) break;
    const pageEvents = parseBogotaGovHtml(html, BOGOTA_AGENDA_BASE);
    if (pageEvents.length === 0) break;
    for (const ev of pageEvents) {
      const key = `${ev.titulo}|${ev.start_at ? ev.start_at.toISOString() : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
    page++;
    if (page > 20) break;
  }
  return events;
}

/** Scrape idartes: intentar ?_format=json primero, si no HTML. */
async function scrapeIdartes() {
  const jsonUrl = `${IDARTES_AGENDA_BASE}?_format=json`;
  const jsonText = await safeFetch(jsonUrl);
  if (jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const list = Array.isArray(data) ? data : (data.items || data.node || []);
      if (Array.isArray(list) && list.length > 0) {
        return list.map((n) => ({
          titulo: (n.title || n.titulo || n.label || '').slice(0, 500),
          lugar: n.lugar || n.place || n.field_lugar || null,
          categoria: n.categoria || n.category || null,
          url: n.url || n.link || null,
          start_at: n.fecha ? new Date(n.fecha) : (n.start_at ? new Date(n.start_at) : null),
          end_at: n.end_at ? new Date(n.end_at) : null,
        })).filter((e) => e.titulo);
      }
    } catch (_) {}
  }
  const html = await safeFetch(IDARTES_AGENDA_BASE);
  if (!html) return [];
  return parseIdartesHtml(html, IDARTES_AGENDA_BASE);
}

/** Verifica si ya existe un evento similar (misma hora ±1h, mismo lugar 200m). Respetar AGENDA_MANUAL. */
async function existsSimilarEvent(startAt, lon, lat) {
  if (startAt == null || lon == null || lat == null) return false;
  const r = await query(
    `SELECT id FROM contexto_eventos
     WHERE fuente != 'AGENDA_MANUAL'
       AND fecha_inicio IS NOT NULL AND geom IS NOT NULL
       AND ABS(EXTRACT(EPOCH FROM (fecha_inicio - $1::timestamptz))) < 3600
       AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 200)
     LIMIT 1`,
    [new Date(startAt).toISOString(), lon, lat]
  );
  return (r.rows[0]?.id) != null;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const summary = { BOGOTA_GOV_AGENDA: { read: 0, withGeom: 0, withoutGeom: 0, skipped: 0, dedup: 0 }, IDARTES_AGENDA: { read: 0, withGeom: 0, withoutGeom: 0, skipped: 0, dedup: 0 } };

  const db = { query: (sql, params) => query(sql, params) };

  for (const { name, fuente, scrape } of [
    { name: 'bogota.gov.co agenda', fuente: 'BOGOTA_GOV_AGENDA', scrape: scrapeBogotaGov },
    { name: 'idartes agenda', fuente: 'IDARTES_AGENDA', scrape: scrapeIdartes },
  ]) {
    let events;
    try {
      events = await scrape();
    } catch (err) {
      console.warn(`[ingest-eventos-web] ${name}:`, err.message);
      continue;
    }
    summary[fuente].read = events.length;
    if (events.length === 0) continue;
    console.log(`[ingest-eventos-web] ${name}: ${events.length} eventos leídos`);

    if (!apply) {
      console.log('[ingest-eventos-web] Dry-run. Para aplicar: npm run ingest:eventos:web:apply');
      continue;
    }

    const hasTable = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contexto_eventos'`
    ).then((r) => r.rows[0]);
    if (!hasTable) {
      console.error('[ingest-eventos-web] No existe tabla contexto_eventos. Ejecuta npm run db:migrate.');
      await closePool();
      process.exit(1);
    }

    for (const ev of events) {
      const startAt = ev.start_at ? new Date(ev.start_at) : null;
      const endAt = ev.end_at ? new Date(ev.end_at) : null;
      const origenId = crypto.createHash('sha256').update(`${ev.titulo || ''}|${startAt ? startAt.toISOString() : ''}`).digest('hex').slice(0, 32);
      const raw = JSON.stringify({ titulo: ev.titulo, lugar: ev.lugar, categoria: ev.categoria, url: ev.url });
      let geom = null;
      if (ev.lugar) {
        const match = await matchVenueByName(ev.lugar, db);
        if (match?.geom) geom = match.geom;
      }
      if (geom) summary[fuente].withGeom++;
      else summary[fuente].withoutGeom++;

      if (geom && startAt) {
        const skip = await existsSimilarEvent(startAt, geom.lon, geom.lat);
        if (skip) {
          summary[fuente].dedup++;
          console.log(`[ingest-eventos-web] DEDUP_SKIP: ${ev.titulo?.slice(0, 40)}`);
          continue;
        }
      }

      const wkt = geom ? `POINT(${geom.lon} ${geom.lat})` : null;
      const descripcion = (ev.titulo || '').slice(0, 500) || null;
      try {
        if (wkt) {
          await query(
            `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota, datos_extra)
             VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_GeomFromText($5), 4326), $6, $7, $8::jsonb)
             ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
             DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, geom = EXCLUDED.geom, url_remota = EXCLUDED.url_remota, datos_extra = EXCLUDED.datos_extra`,
            [fuente, descripcion, startAt ? startAt.toISOString() : null, endAt ? endAt.toISOString() : null, wkt, origenId, ev.url || null, raw]
          );
        } else {
          await query(
            `INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, origen_id, url_remota, datos_extra)
             VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7::jsonb)
             ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
             DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, url_remota = EXCLUDED.url_remota, datos_extra = EXCLUDED.datos_extra`,
            [fuente, descripcion, startAt ? startAt.toISOString() : null, endAt ? endAt.toISOString() : null, origenId, ev.url || null, raw]
          );
        }
      } catch (err) {
        summary[fuente].skipped++;
        console.warn('[ingest-eventos-web] Error upsert:', err.message);
      }
    }
  }

  console.log('[ingest-eventos-web] Resumen por fuente:');
  for (const [fuente, s] of Object.entries(summary)) {
    if (s.read > 0) console.log(`  ${fuente}: leídos=${s.read} con_geom=${s.withGeom} sin_geom=${s.withoutGeom} skipped=${s.skipped} dedup_skip=${s.dedup}`);
  }
  await closePool();
}

main().catch((err) => {
  console.error('[ingest-eventos-web]', err.message);
  process.exit(1);
});
