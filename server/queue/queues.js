/**
 * Colas BullMQ. Conexión centralizada.
 * Repeatables: se registran con registerRepeatables() (desde worker al arrancar o con npm run jobs:seed).
 */

import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

const QUEUE_NAME = 'ingest';

/** Cola única de ingesta (obras, eventos, noticias, sync domains, etc.) */
export const ingestQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

/**
 * Registra jobs repetibles con cron. JobIds estables para no duplicar.
 * Ver: https://docs.bullmq.io/guide/repeatable-jobs
 */
export async function registerRepeatables() {
  const repeatables = [
    { name: 'news:rss:fetch', pattern: '*/15 * * * *', jobId: 'repeat:news:rss:fetch' },
    { name: 'news:manifestations:extract', pattern: '*/30 * * * *', jobId: 'repeat:news:manifestations:extract' },
    { name: 'news:manifestations:geocode', pattern: '*/15 * * * *', jobId: 'repeat:news:manifestations:geocode' },
    { name: 'obras:arcgis', pattern: '0 6 * * *', jobId: 'repeat:obras:arcgis' },
    { name: 'eventos:incidentes', pattern: '0 */6 * * *', jobId: 'repeat:eventos:incidentes' },
    { name: 'arcgis:domains:sync', pattern: '0 5 * * *', jobId: 'repeat:arcgis:domains:sync' },
  ];

  for (const r of repeatables) {
    await ingestQueue.add(r.name, {}, {
      repeat: { pattern: r.pattern },
      jobId: r.jobId,
    });
    console.log('[queue] Repeatable registered:', r.name, r.pattern);
  }
}

export default ingestQueue;
