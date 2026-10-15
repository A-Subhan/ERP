/* ===========================================================================
 * SQL Server connection pool (singleton)
 * ==========================================================================*/
import sql from 'mssql';
import { config } from '../config';

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool) return pool;
  pool = await new sql.ConnectionPool({
    server: config.db.server,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    options: {
      encrypt: config.db.encrypt,
      trustServerCertificate: config.db.trustServerCertificate,
      requestTimeout: config.db.requestTimeout,
    },
    pool: {
      max: config.db.poolMax,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  }).connect();
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { sql };

// Helper: build a transaction and a request bound to it
export async function beginTx(): Promise<{
  tx: sql.Transaction;
  req: () => sql.Request;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}> {
  const p = await getPool();
  const tx = new sql.Transaction(p);
  await tx.begin();
  return {
    tx,
    req: () => new sql.Request(tx),
    commit: async () => { await tx.commit(); },
    rollback: async () => {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
    },
  };
}
