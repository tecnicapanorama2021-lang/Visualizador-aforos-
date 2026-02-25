/**
 * Conexión Redis reutilizable para BullMQ.
 * Usa REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (opcional).
 */

import IORedis from 'ioredis';

const host = process.env.REDIS_HOST || '127.0.0.1';
const port = parseInt(process.env.REDIS_PORT || '6379', 10);
const password = process.env.REDIS_PASSWORD || undefined;

/**
 * Opciones de conexión para BullMQ (Queue, Worker).
 * Reusar el mismo objeto en todas las colas/workers.
 */
export const redisConnection = {
  host,
  port,
  password: password || undefined,
  maxRetriesPerRequest: null,
};

/**
 * Crea una instancia IORedis (para usar como connection en BullMQ).
 * @returns {IORedis}
 */
export function createRedisConnection() {
  return new IORedis({
    ...redisConnection,
  });
}

export default redisConnection;
