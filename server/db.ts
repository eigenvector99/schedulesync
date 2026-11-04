/**
 * Database access.
 *
 *  - DATABASE_URL set  -> PostgreSQL through `pg` (production)
 *  - otherwise         -> embedded PostgreSQL (PGlite) stored under DATA_DIR/pgdata. Same SQL and the same
 *                         transactional guarantees, zero setup; fine for development and for a small
 *                         single-instance deployment, but it cannot be shared between several instances.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction; commits when it resolves and rolls back when it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'embedded';
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// pg returns `date`/`timestamptz` as Date objects and `int8` as strings; we only use timestamptz, text and
// int4, and map timestamps explicitly in mappers.ts.
function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  return {
    kind: 'postgres',
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          async query(sql, params) {
            const r = await client.query(sql, params as any[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createEmbeddedDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(dataDir, 'pgdata');
  fs.mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir);
  await lite.waitReady;
  return {
    kind: 'embedded',
    async query(sql, params) {
      const r = await lite.query(sql, params as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    },
    async tx(fn) {
      return lite.transaction(async (t) =>
        fn({
          async query(sql, params) {
            const r = await t.query(sql, params as any[]);
            return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
          },
        })
      );
    },
    close: () => lite.close(),
  };
}

export async function openDb(dataDir: string): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return createPgDb(url);
  return createEmbeddedDb(dataDir);
}

/** Applies pending `NNN_*.sql` files in order, each in its own transaction. */
export async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await db.tx(async (q) => {
      // PGlite's query() takes a single statement, so split on the statement terminator we control.
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`[db] migration applied: ${file}`);
  }
}

/** Splits a migration into statements; understands `$$ ... $$` function bodies and `--` comments. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inDollar = false;
  for (const line of sql.split('\n')) {
    if (!inDollar && line.trim().startsWith('--')) continue;
    cur += line + '\n';
    if ((line.match(/\$\$/g) || []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trimEnd().endsWith(';')) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
