/**
 * Cliente PostgreSQL con pool de conexiones.
 * Uso: DATABASE_URL en env, o PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD.
 * Compatible con PgBouncer en producción.
 */

import pg from 'pg';

const { Pool } = pg;

function getConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'aforos',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

let pool = null;

/**
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!pool) {
    pool = new Pool(getConfig());
    pool.on('error', (err) => console.error('[db] Pool error:', err.message));
  }
  return pool;
}

/**
 * Ejecuta una consulta usando el pool.
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * Cierra el pool (útil para tests o shutdown).
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Comprueba que la BD responde y PostGIS está disponible.
 */
export async function healthCheck() {
  const res = await query('SELECT PostGIS_Version()');
  return res.rows[0]?.postgis_version ?? null;
}

export default { getPool, query, closePool, healthCheck };
