// ============================================================
// Database Client
// Uses native pg with pgvector support
// ============================================================

import pg from 'pg';
import pgvector from 'pgvector/pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    // Register pgvector type parser on a connected client
    const client = await pool.connect();
    try {
      await pgvector.registerTypes(client);
    } finally {
      client.release();
    }
  }
  return pool;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const p = await getPool();
  return p.query<T>(text, params);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
