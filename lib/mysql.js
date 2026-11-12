import mysql from 'mysql2/promise';

const REQUIRED_ENV = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];

function createPool() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required MySQL env vars: ${missing.join(', ')}`);
  }

  return mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z', // treat/return TIMESTAMPs as UTC
    // DECIMAL columns (wallet balances, tariffs) are intentionally returned as
    // strings to avoid floating-point rounding on money. Parse at the edge.
  });
}

// Reuse one pool across Next.js dev hot-reloads to avoid exhausting connections.
const globalForMysql = globalThis;
export const pool = globalForMysql.__gridpulseMysqlPool ?? createPool();
if (process.env.NODE_ENV !== 'production') {
  globalForMysql.__gridpulseMysqlPool = pool;
}

/**
 * Run a parameterised query. Always pass user input via `params`, never by
 * string interpolation.
 * @returns {Promise<Array>} rows for SELECT; ResultSetHeader for writes.
 */
export async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error('[mysql] query failed:', err.code, err.sqlMessage || err.message);
    throw err;
  }
}

/**
 * Run `callback(connection)` inside a transaction; commits on success and
 * rolls back on any thrown error.
 */
export async function withTransaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mysql] rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Lightweight connectivity check (e.g. for a health endpoint). */
export async function pingMysql() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

export default pool;
