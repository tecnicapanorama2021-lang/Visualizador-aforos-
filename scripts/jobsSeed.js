/**
 * Registra jobs repetibles en la cola ingest (BullMQ).
 * Uso: npm run jobs:seed
 * Requiere: Redis corriendo y REDIS_HOST/REDIS_PORT en .env.
 */

import 'dotenv/config';
import { registerRepeatables, ingestQueue } from '../server/queue/queues.js';

async function main() {
  try {
    await registerRepeatables();
    await ingestQueue.close();
    console.log('[jobs:seed] Repeatables registered. Exit 0.');
    process.exit(0);
  } catch (err) {
    console.error('[jobs:seed]', err.message);
    process.exit(1);
  }
}

main();
