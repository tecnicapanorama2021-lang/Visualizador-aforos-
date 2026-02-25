/**
 * Job news:rss:fetch — Lee RSS y guarda items en landing_items (entity_type=NEWS).
 * Repeatable cada 15 min. Upsert por (source_system, source_id) con source_id = hash(url).
 */

import Parser from 'rss-parser';
import { query } from '../../db/client.js';
import { startRun, endRun } from '../../lib/ingestRuns.js';

const parser = new Parser({ timeout: 15000, customFields: { item: ['media:content', 'enclosure'] } });

const RSS_SOURCES = [
  { name: 'RSS_GOOGLE_NEWS', url: 'https://news.google.com/rss/search?q=tránsito+cierre+vía+obra+Bogotá+Colombia&hl=es&gl=CO&ceid=CO:es' },
  { name: 'RSS_EL_TIEMPO', url: 'https://www.eltiempo.com/rss/colombia/bogota.xml' },
  { name: 'RSS_EL_ESPECTADOR', url: 'https://www.elespectador.com/rss/bogota/' },
];

/** Hash simple para source_id estable a partir de url */
function hashUrl(url) {
  if (!url || typeof url !== 'string') return `nourl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h = h & h;
  }
  return `h-${Math.abs(h).toString(36)}`;
}

export async function processNewsRssFetch() {
  const runId = await startRun('news:rss:fetch');
  let itemsIn = 0;
  let itemsUpserted = 0;
  const errors = [];

  try {
    for (const source of RSS_SOURCES) {
      try {
        const feed = await parser.parseURL(source.url);
        const items = feed.items || [];
        for (const item of items) {
          const url = item.link || item.guid || '';
          const sourceId = hashUrl(url);
          const payload = {
            title: item.title || '',
            description: item.contentSnippet || item.content?.substring(0, 500) || item.description?.substring(0, 500) || '',
            pubDate: item.pubDate || null,
            source: item.source?.name || source.name,
          };
          itemsIn++;

          await query(
            `INSERT INTO landing_items (entity_type, source_system, source_id, url, fetched_at, payload, updated_at)
             VALUES ('NEWS', $1, $2, $3, now(), $4::jsonb, now())
             ON CONFLICT (source_system, source_id) DO UPDATE SET url = EXCLUDED.url, payload = EXCLUDED.payload, fetched_at = now(), updated_at = now()`,
            [source.name, sourceId, url || null, JSON.stringify(payload)]
          );
          itemsUpserted++;
        }
      } catch (err) {
        errors.push(`${source.name}: ${err.message}`);
      }
    }

    await endRun(runId, {
      status: errors.length === RSS_SOURCES.length ? 'failed' : 'ok',
      items_in: itemsIn,
      items_upserted: itemsUpserted,
      errors_count: errors.length,
      error_sample: errors[0] || null,
      meta: { errors },
    });
    return { itemsIn, itemsUpserted, errors };
  } catch (err) {
    await endRun(runId, { status: 'failed', error_sample: err.message });
    throw err;
  }
}
