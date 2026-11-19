// Who is calling the public /rest/v1, /rpc and /storage shims.
//
// Access itself is decided by the database: the shims run each request inside
// `withRequestRole`, so the store's existing row-level security policies (the
// same ones hosted Supabase enforced) filter every read and check every write.
// This module only turns the bearer token into JWT claims, and keeps a short
// list of RPCs the browser may call at all.

import { query, withRequestRole } from "./pool";
import { verifyAccessToken } from "./auth";
import type { SelectTree } from "./supabase-compat";

export interface Requester {
  userId: string | null;
  email: string | null;
  /** admin or staff (full dashboard staff). */
  isStaff: boolean;
  /** admin, staff or staff_pos: may see cost prices and raw database errors. */
  isStaffOrPos: boolean;
  /** profiles.role, or null for anonymous callers. */
  role: string | null;
}

export class PolicyError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status = 403, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ANONYMOUS: Requester = { userId: null, email: null, isStaff: false, isStaffOrPos: false, role: null };

/**
 * Identify the caller from `Authorization: Bearer <access token>`. One query
 * reads the account and its role together: a deleted or banned account, or a
 * token from before a sign-out-everywhere / password change (older `sv`
 * claim; tokens without one count as 0), is treated as anonymous, so a ban
 * cuts data access at once instead of when the access token expires.
 */
export async function resolveRequester(authHeader: string | null): Promise<Requester> {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return ANONYMOUS;
  const verified = await verifyAccessToken(token);
  if (!verified) return ANONYMOUS;
  const { rows } = await query<{ role: string | null; session_version: number | null; banned: boolean }>(
    `SELECT p.role::text AS role,
            u.session_version,
            coalesce(u.banned_until > now(), false) AS banned
       FROM auth.users u
       LEFT JOIN profiles p ON p.id = u.id
      WHERE u.id = $1 AND u.deleted_at IS NULL
      LIMIT 1`,
    [verified.userId]
  );
  const account = rows[0];
  if (!account || account.banned) return ANONYMOUS;
  const tokenSv = Number(verified.payload.sv ?? 0) || 0;
  if (tokenSv < (Number(account.session_version ?? 0) || 0)) return ANONYMOUS;
  const role = account.role ? String(account.role) : "";
  return {
    userId: verified.userId,
    email: typeof verified.payload.email === "string" ? verified.payload.email : null,
    isStaff: role === "admin" || role === "staff",
    isStaffOrPos: role === "admin" || role === "staff" || role === "staff_pos",
    role: role || null,
  };
}

// ---- tables the browser may name ------------------------------------------

const PG_IDENT = /^[a-z_][a-z0-9_]*$/i;

/** A table (top-level or embedded) the data API may touch: a plain name, never a system catalog. */
export function isAllowedTableName(table: string): boolean {
  return PG_IDENT.test(table) && !table.toLowerCase().startsWith("pg_");
}

// ---- cost prices -----------------------------------------------------------

/**
 * Tables whose rows carry cost prices (products.cost_per_item,
 * product_variants.cost_per_item and their dated backups). Only staff may
 * see, filter or sort on those columns through the browser data API.
 */
export function isCostTable(table: string): boolean {
  return (
    table === "products" ||
    table === "product_variants" ||
    /^_backup_products_/.test(table) ||
    /^_backup_product_variants_/.test(table)
  );
}

/** A cost column name (cost_per_item, or any future cost_* column). */
export function isCostColumn(col: string): boolean {
  return /^cost(_|$)/i.test(col);
}

/** The column a filter key or order term names: `alias.col->>key` → `col`. */
function baseColumn(ref: string): string {
  const noPath = ref.split("->")[0];
  const parts = noPath.split(".");
  return (parts[parts.length - 1] || "").trim();
}

const OPTION_KEYS = new Set(["select", "limit", "offset", "on_conflict", "columns"]);

/**
 * Throws when request parameters filter or sort on a cost column. Used for
 * non-staff callers whose request touches a cost table, so cost prices cannot
 * be worked out by probing (`cost_per_item=lt.50`, `order=cost_per_item`).
 */
export function assertNoCostFilters(params: URLSearchParams): void {
  const reject = () => {
    throw new PolicyError("permission denied for column cost_per_item", 403, "42501");
  };
  for (const [key, raw] of params.entries()) {
    const last = key.split(".").pop() || key;
    if (OPTION_KEYS.has(last)) continue;
    if (last === "order") {
      for (const part of raw.split(",")) if (isCostColumn(baseColumn(part.trim().split(".")[0] || ""))) reject();
      continue;
    }
    if (last === "or" || last === "and") {
      // Column names open each term: `(`/`,` then `col.op.value`. Values
      // (e.g. a search for "cost") come after an operator and are not matched.
      if (/(?:^|[,(])\s*cost(?:_[a-z0-9_]*)?(?:->>?[a-z0-9_]+)*\./i.test(raw)) reject();
      continue;
    }
    if (isCostColumn(baseColumn(key))) reject();
  }
}

/** Remove cost columns from every row of a cost table in `data`, embedded rows included. */
export function stripCostColumns(data: unknown, tree: SelectTree): void {
  const visit = (value: unknown, node: SelectTree) => {
    if (value == null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, node);
      return;
    }
    const row = value as Record<string, unknown>;
    if (isCostTable(node.table)) {
      for (const k of Object.keys(row)) if (isCostColumn(k)) delete row[k];
    }
    for (const e of node.embeds) visit(row[e.alias], e.node);
  };
  visit(data, tree);
}

/** True when any table in the select tree carries cost prices. */
export function treeHasCostTable(tree: SelectTree): boolean {
  return isCostTable(tree.table) || tree.embeds.some((e) => treeHasCostTable(e.node));
}

// ---- error messages --------------------------------------------------------

/**
 * Postgres error codes whose message pages show to shoppers: permission and
 * row-level-security denials, constraint violations, and messages raised on
 * purpose by the store's own functions and triggers (RAISE EXCEPTION).
 */
const PUBLIC_ERROR_CODES = new Set(["42501", "23505", "23503", "23502", "23514", "23P01", "P0001"]);

/**
 * PostgREST-shaped error body for the browser. Staff get the database's own
 * message; everyone else gets it only for the codes above (and for this
 * layer's own PGRST* / code-less validation messages). Anything else (syntax,
 * type, missing column, internal errors) becomes a generic message, so table
 * internals do not leak. `code` is always kept.
 */
export function publicError(
  err: { message?: string | null; code?: string | null; details?: string | null; hint?: string | null },
  who: Pick<Requester, "isStaffOrPos">
): { message: string; code: string | null; details: string | null; hint: string | null } {
  const code = err.code ?? null;
  const message = err.message || "Request failed";
  if (who.isStaffOrPos) return { message, code, details: err.details ?? null, hint: err.hint ?? null };
  if (!code || code.startsWith("PGRST")) return { message, code, details: null, hint: null };
  if (PUBLIC_ERROR_CODES.has(code)) {
    // Keep RAISE details (written for users); drop key values from
    // constraint details ("Key (email)=(...) already exists").
    return { message, code, details: code === "P0001" ? err.details ?? null : null, hint: null };
  }
  return { message: "The request could not be completed.", code, details: null, hint: null };
}

/** Run `fn` with row-level security applied for this caller. */
export function asRequester<T>(who: Requester, fn: () => Promise<T>): Promise<T> {
  return withRequestRole(
    who.userId
      ? { role: "authenticated", sub: who.userId, email: who.email }
      : { role: "anon" },
    fn
  );
}

/**
 * RPCs the browser may call: the functions hosted Supabase granted to
 * anon/authenticated that the app actually calls from the browser.
 * (get_order_for_tracking is granted in the database but no page calls it,
 * so it is not exposed here.)
 * Everything else (mark_order_paid, sales, customer stats, bulk email/phone
 * lists) is server-only and runs through supabaseAdmin.
 */
const BROWSER_RPCS = new Set([
  "can_view_audit_logs",
  "fuzzy_product_search",
  "is_admin_or_staff",
  "is_admin_staff_or_pos",
  "is_staff_pos",
  "log_activity",
  "search_products",
  "upsert_customer_from_order",
]);

export function assertRpcAllowed(fn: string): void {
  if (!BROWSER_RPCS.has(fn)) throw new PolicyError("Function not allowed");
}
