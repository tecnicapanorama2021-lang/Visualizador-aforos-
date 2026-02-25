/**
 * Worker BullMQ: procesa jobs de la cola "ingest".
 * Uso: npm run worker
 * Requiere: REDIS_HOST, REDIS_PORT (y opcional REDIS_PASSWORD). Migraciones aplicadas para ingest_runs y landing_items.
 */

import 'dotenv/config';
import { Worker } from 'bullmq';
import path from 'path';
import { fileURLToPath } from 'url';
import { redisConnection } from '../queue/connection.js';
import { processNewsRssFetch } from './jobs/newsRssFetch.js';
import { processNewsManifestationsExtract } from './jobs/newsManifestationsExtract.js';
import { processObrasArcgis } from './jobs/obrasArcgis.js';
import { processEventosIncidentes } from './jobs/eventosIncidentes.js';
import { processArcgisDomainsSync } from './jobs/syncDomains.js';
import { processNewsManifestationsGeocode } from './jobs/newsManifestationsGeocode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const QUEUE_NAME = 'ingest';

const processors = {
  'news:rss:fetch': processNewsRssFetch,
  'news:manifestations:extract': processNewsManifestationsExtract,
  'news:manifestations:geocode': processNewsManifestationsGeocode,
  'obras:arcgis': processObrasArcgis,
  'eventos:incidentes': processEventosIncidentes,
  'arcgis:domains:sync': processArcgisDomainsSync,
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const fn = processors[job.name];
    if (!fn) {
      console.warn('[worker] Unknown job name:', job.name);
      return { skipped: true, reason: 'unknown job' };
    }
    console.log('[worker] Processing', job.name, job.id);
    const result = await fn(job.data);
    console.log('[worker] Done', job.name, result);
    return result;
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on('completed', (job) => {
  console.log('[worker] Job completed:', job.name, job.id);
});

worker.on('failed', (job, err) => {
  console.error('[worker] Job failed:', job?.name, job?.id, err.message);
});

worker.on('error', (err) => {
  console.error('[worker] Worker error:', err.message);
});

console.log('[worker] Started. Queue:', QUEUE_NAME);
console.log('[worker] Register repeatables with: npm run jobs:seed');
