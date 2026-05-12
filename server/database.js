import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { openDb } from './db.js';

pg.types.setTypeParser(pg.types.builtins.INT8, (val) => {
  const n = parseInt(val, 10);
  return Number.isSafeInteger(n) ? n : val;
});

export const USE_PG = Boolean(process.env.DATABASE_URL?.trim());

let sqliteDb = null;
/** @type {pg.Pool | null} */
let pool = null;

function toPgText(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export function getSqliteDb() {
  if (USE_PG || !sqliteDb) throw new Error('sqlite_db_not_available');
  return sqliteDb;
}

export async function initDatabase() {
  if (USE_PG) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
    const schemaPath = path.join(process.cwd(), 'server', 'schema-pg.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
  } else {
    sqliteDb = openDb();
  }
}

function assertReady() {
  if (USE_PG && !pool) throw new Error('database_not_initialized');
  if (!USE_PG && !sqliteDb) throw new Error('database_not_initialized');
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
export async function qGet(sql, params = []) {
  assertReady();
  if (USE_PG) {
    const r = await pool.query(toPgText(sql), params);
    return r.rows[0] ?? null;
  }
  return sqliteDb.prepare(sql).get(...params);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
export async function qAll(sql, params = []) {
  assertReady();
  if (USE_PG) {
    const r = await pool.query(toPgText(sql), params);
    return r.rows;
  }
  return sqliteDb.prepare(sql).all(...params);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<{ changes: number, lastInsertRowid?: number | string, rows?: unknown[] }>}
 */
export async function qRun(sql, params = []) {
  assertReady();
  if (USE_PG) {
    const r = await pool.query(toPgText(sql), params);
    const row = r.rows[0];
    const id = row && typeof row === 'object' && 'id' in row ? row.id : undefined;
    return { changes: r.rowCount ?? 0, lastInsertRowid: id, rows: r.rows };
  }
  if (/\bRETURNING\b/i.test(sql)) {
    const row = sqliteDb.prepare(sql).get(...params);
    if (!row) return { changes: 0, lastInsertRowid: undefined, rows: [] };
    return { changes: 1, lastInsertRowid: row.id, rows: [row] };
  }
  const info = sqliteDb.prepare(sql).run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid, rows: [] };
}

/**
 * @param {(client: import('pg').PoolClient) => Promise<void>} fn
 */
export async function withPgTransaction(fn) {
  if (!USE_PG || !pool) throw new Error('pg_transaction_unavailable');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = async (sql, p = []) => client.query(toPgText(sql), p);
    await fn({ run, query: run });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function poolEnd() {
  if (pool) await pool.end();
}
