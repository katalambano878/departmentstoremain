// Shared Postgres connection pool for the app's in-process backend.
//
// Replaces the Supabase/PostgREST data plane. Server code (service role) runs
// straight on the pool as the database owner. Browser requests that arrive
// through the /rest/v1 and /rpc shims run inside `withRequestRole`, which does
// what PostgREST did: one transaction, `SET LOCAL ROLE` to the anon or
// authenticated role, and the JWT claims in `request.jwt.claims`, so the
// existing row-level security policies decide what the caller can see.

import { AsyncLocalStorage } from "async_hooks";
import { Pool, types, type PoolClient } from "pg";

// --- PostgREST-faithful type parsing ---------------------------------------
// Supabase (PostgREST) serializes these as JSON strings/numbers; node-postgres
// defaults to JS Date objects and strings, which breaks code that compares
// `due_date === "2026-06-17"` or does arithmetic on numeric columns.
types.setTypeParser(1082, (v: string) => v); // date -> "YYYY-MM-DD"
types.setTypeParser(1114, (v: string) => (v ? v.replace(" ", "T") : v)); // timestamp
types.setTypeParser(1184, (v: string) => {
  // timestamptz "2026-06-17 12:34:56.789+00" -> "2026-06-17T12:34:56.789+00:00"
  if (!v) return v;
  let s = v.replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00");
  return s;
});
types.setTypeParser(1700, (v: string | null) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v: string | null) => (v === null ? null : parseInt(v, 10))); // int8

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    "";
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set, so the Postgres backend cannot start."
    );
  }
  _pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Cap runaway queries; override per-query if a batch job needs longer.
    options: "-c statement_timeout=30000",
    // Self-hosted Postgres on the same host / private network: TLS optional.
    ssl:
      process.env.PGSSL === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  });
  // An idle connection the server drops (restart, maintenance) must not take
  // the process down; the pool replaces it on the next query.
  _pool.on("error", (e) => console.error("[db] idle connection error:", e.message));
  // Server code acts as Supabase's service role. Database functions that
  // check `auth.role() = 'service_role'` (e.g. upsert_customer_from_order)
  // keep working; `withRequestRole` overrides these per transaction.
  _pool.on("connect", (client) => {
    client
      .query(
        `SELECT set_config('request.jwt.claim.role', 'service_role', false),
                set_config('request.jwt.claims', '{"role":"service_role"}', false)`
      )
      .catch((e) => console.error("[db] could not set service role claims:", e.message));
  });
  return _pool;
}

export type Queryable = Pick<Pool, "query">;

const requestScope = new AsyncLocalStorage<PoolClient>();

/** True while running inside a `withRequestRole` / `withAuditActor` transaction. */
export function inRequestScope(): boolean {
  return !!requestScope.getStore();
}

/** The connection to run on: the caller's RLS transaction if any, else the pool. */
export function getExecutor(): Queryable {
  return requestScope.getStore() ?? getPool();
}

export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getExecutor().query(text, params as any[]);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

/**
 * Run service-role writes with the acting staff member's id in
 * `request.headers`, where the audit triggers read `x-audit-actor` (the same
 * header supabase-js sent to hosted Supabase). Commits when `fn` resolves and
 * rolls back when it throws. Nested calls reuse the outer transaction.
 */
export async function withAuditActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
  if (requestScope.getStore()) return fn();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.headers', $1, true)`, [
      JSON.stringify({ "x-audit-actor": actorId }),
    ]);
    const result = await requestScope.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export type DbRole = "anon" | "authenticated";

/** Database roles the browser shims switch into. Per-store so grants never leak across databases. */
export function dbRoleName(role: DbRole): string {
  const name =
    role === "anon" ? process.env.DB_ANON_ROLE || "anon" : process.env.DB_AUTHENTICATED_ROLE || "authenticated";
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid database role: ${name}`);
  return name;
}

/**
 * Run `fn` as an anonymous or signed-in caller, with row-level security on.
 * Commits when `fn` resolves and rolls back when it throws. Nested calls reuse
 * the outer transaction.
 */
export async function withRequestRole<T>(
  claims: { role: DbRole; sub?: string | null; email?: string | null },
  fn: () => Promise<T>
): Promise<T> {
  if (requestScope.getStore()) return fn();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${dbRoleName(claims.role)}`);
    const jwtClaims = JSON.stringify({
      role: claims.role,
      sub: claims.sub ?? undefined,
      email: claims.email ?? undefined,
    });
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('request.jwt.claim.role', $3, true),
              set_config('request.jwt.claim.email', $4, true)`,
      [jwtClaims, claims.sub ?? "", claims.role, claims.email ?? ""]
    );
    const result = await requestScope.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
