// Who is calling the public /rest/v1, /rpc and /storage shims.
//
// Access itself is decided by the database: the shims run each request inside
// `withRequestRole`, so the store's existing row-level security policies (the
// same ones hosted Supabase enforced) filter every read and check every write.
// This module only turns the bearer token into JWT claims, and keeps a short
// list of RPCs the browser may call at all.

import { query, withRequestRole } from "./pool";
import { verifyAccessToken } from "./auth";

export interface Requester {
  userId: string | null;
  email: string | null;
  isStaff: boolean;
}

export class PolicyError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** Identify the caller from `Authorization: Bearer <access token>`. */
export async function resolveRequester(authHeader: string | null): Promise<Requester> {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { userId: null, email: null, isStaff: false };
  const verified = await verifyAccessToken(token);
  if (!verified) return { userId: null, email: null, isStaff: false };
  const { rows } = await query<{ role: string | null }>(
    `SELECT role::text AS role FROM profiles WHERE id = $1 LIMIT 1`,
    [verified.userId]
  );
  const role = rows[0]?.role ? String(rows[0].role) : "";
  return {
    userId: verified.userId,
    email: typeof verified.payload.email === "string" ? verified.payload.email : null,
    isStaff: role === "admin" || role === "staff",
  };
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
 * RPCs the browser may call: exactly the functions hosted Supabase granted
 * to anon/authenticated (the database grants enforce the same list).
 * Everything else (mark_order_paid, sales, customer stats, bulk email/phone
 * lists) is server-only and runs through supabaseAdmin.
 */
const BROWSER_RPCS = new Set([
  "can_view_audit_logs",
  "fuzzy_product_search",
  "get_order_for_tracking",
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
