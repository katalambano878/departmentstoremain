import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  applyPostgrestParams,
  describeSelect,
  type SelectTree,
} from "@/lib/db/supabase-compat";
import { isPlainPostgres } from "@/lib/db/mode";
import {
  PolicyError,
  asRequester,
  assertNoCostFilters,
  isAllowedTableName,
  publicError,
  resolveRequester,
  stripCostColumns,
  treeHasCostTable,
  type Requester,
} from "@/lib/db/rest-policy";

// PostgREST replacement for the browser's supabase-js client. Every request
// runs as the anon or authenticated database role, so row-level security
// decides what the caller may read and write, exactly as on hosted Supabase.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PostgREST's `max-rows` on hosted Supabase: no read returns more rows than this. */
const MAX_ROWS = 1000;

const ANONYMOUS: Requester = { userId: null, email: null, isStaff: false, isStaffOrPos: false, role: null };

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  };
}

function preferSingle(req: NextRequest): boolean {
  const accept = req.headers.get("accept") || "";
  return accept.includes("application/vnd.pgrst.object+json");
}

function preferReturn(req: NextRequest): boolean {
  const prefer = req.headers.get("prefer") || "";
  return prefer.includes("return=representation");
}

function preferCount(req: NextRequest): boolean {
  const prefer = req.headers.get("prefer") || "";
  return prefer.includes("count=exact") || prefer.includes("count=planned") || prefer.includes("count=estimated");
}

function preferUpsert(req: NextRequest): "merge" | "ignore" | null {
  const prefer = req.headers.get("prefer") || "";
  if (prefer.includes("resolution=merge-duplicates")) return "merge";
  if (prefer.includes("resolution=ignore-duplicates")) return "ignore";
  return null;
}

/** Status codes PostgREST uses for the errors the app can hit. */
function statusFor(code: string | null | undefined, who: Requester): number {
  switch (code) {
    case "42501":
      return who.userId ? 403 : 401;
    case "PGRST116":
    case "PGRST114":
      return 406;
    case "23505":
    case "23503":
      return 409;
    case "42P01":
    case "42883":
      return 404;
    default:
      return 400;
  }
}

function jsonError(
  err: { message?: string; code?: string | null; details?: string | null; hint?: string | null },
  status: number,
  who: Pick<Requester, "isStaffOrPos"> = ANONYMOUS
) {
  return NextResponse.json(publicError(err, who), { status, headers: corsHeaders() });
}

/**
 * A failed query leaves the RLS transaction aborted; throwing makes
 * `withRequestRole` roll it back (PostgREST is all-or-nothing per request).
 */
class QueryFailed extends Error {
  constructor(public readonly body: any, public readonly status: number, public readonly who: Requester = ANONYMOUS) {
    super(body?.message || "Query failed");
  }
}

async function runOrThrow(qb: PromiseLike<{ data: any; error: any; count: number | null }>, who: Requester) {
  const result = await qb;
  if (result.error) throw new QueryFailed(result.error, statusFor(result.error.code, who), who);
  return result;
}

/** What a request reads: the select string's tables, and whether cost prices must be hidden. */
interface ReadScope {
  tree: SelectTree;
  /** Not staff, and the response includes a cost table: strip cost columns. */
  hideCost: boolean;
}

/** Shared guard: mode check, table name check, caller identity and RLS scope. */
async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> },
  run: (table: string, who: Requester, scope: ReadScope) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!isPlainPostgres()) {
    return jsonError({ message: "Plain Postgres mode is not enabled (DATABASE_URL missing)" }, 503);
  }
  const { table } = await ctx.params;
  if (!isAllowedTableName(table)) {
    return jsonError({ message: "Invalid table", code: "42P01" }, 404);
  }
  let who: Requester = ANONYMOUS;
  try {
    // Embedded tables obey the same rule as the top-level one (no system
    // catalogs pulled in through `select=...,pg_x(*)`).
    const tree = describeSelect(table, req.nextUrl.searchParams.get("select") || "*");
    const badEmbed = findDisallowedTable(tree);
    if (badEmbed !== null) {
      return jsonError({ message: "Invalid embedded table", code: "PGRST200" }, 400);
    }
    who = await resolveRequester(req.headers.get("authorization"));
    const hideCost = !who.isStaffOrPos && treeHasCostTable(tree);
    if (hideCost) assertNoCostFilters(req.nextUrl.searchParams);
    return await asRequester(who, () => run(table, who, { tree, hideCost }));
  } catch (e: any) {
    if (e instanceof QueryFailed) throw e;
    if (e instanceof PolicyError) {
      return jsonError({ message: e.message, code: e.code }, e.code === "42501" ? statusFor("42501", who) : e.status, who);
    }
    return jsonError({ message: e?.message, code: e?.code }, statusFor(e?.code, who), who);
  }
}

function findDisallowedTable(tree: SelectTree): string | null {
  for (const e of tree.embeds) {
    if (!isAllowedTableName(e.node.table)) return e.node.table;
    const nested = findDisallowedTable(e.node);
    if (nested !== null) return nested;
  }
  return null;
}

/** Response rows with cost prices removed for non-staff callers. */
function visibleRows(data: any, scope: ReadScope): any {
  if (scope.hideCost && data != null) stripCostColumns(data, scope.tree);
  return data;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function contentRange(data: any, count: number | null, offset: number): string {
  const n = Array.isArray(data) ? data.length : data == null ? 0 : 1;
  const range = n > 0 ? `${offset}-${offset + n - 1}` : "*";
  return `${range}/${count ?? "*"}`;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ table: string }> }) {
  return handleQuery(req, ctx, async (table, who, scope) => {
    const client = createClient();
    const qb = client.from(table);
    const select = req.nextUrl.searchParams.get("select") || "*";
    const prefer = req.headers.get("prefer") || "";
    if (preferCount(req)) {
      qb.select(select, { count: "exact", head: req.method === "HEAD" || prefer.includes("head=true") });
    } else {
      qb.select(select);
    }
    const params = new URLSearchParams(req.nextUrl.searchParams);
    params.delete("select");
    applyPostgrestParams(qb, params, { preferSingle: preferSingle(req) });
    // Hosted PostgREST never returned more than 1000 rows per request; the
    // app pages past that with .range() (lib/supabase-paginate.ts).
    qb.capRows(MAX_ROWS);

    const result = await runOrThrow(qb, who);
    visibleRows(result.data, scope);
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", "application/json");
    headers.set(
      "Content-Range",
      contentRange(result.data, result.count, Number(req.nextUrl.searchParams.get("offset") || 0))
    );
    if (preferSingle(req)) return NextResponse.json(result.data, { status: 200, headers });
    return NextResponse.json(result.data ?? [], { status: 200, headers });
  });
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ table: string }> }) {
  return GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ table: string }> }) {
  return handleQuery(req, ctx, async (table, who, scope) => {
    const body = await req.json().catch(() => null);
    if (body == null || typeof body !== "object") {
      throw new QueryFailed({ message: "Invalid JSON body", code: "PGRST102" }, 400);
    }
    const client = createClient();
    const upsert = preferUpsert(req);
    const onConflict = req.nextUrl.searchParams.get("on_conflict") || undefined;
    let qb = upsert
      ? client.from(table).upsert(body, { onConflict, ignoreDuplicates: upsert === "ignore" })
      : client.from(table).insert(body);
    const wantRows = preferReturn(req) || preferSingle(req);
    if (wantRows) qb = qb.select(req.nextUrl.searchParams.get("select") || "*");
    if (preferSingle(req)) qb = qb.single();

    const result = await runOrThrow(qb, who);
    visibleRows(result.data, scope);
    return wantRows
      ? NextResponse.json(result.data, { status: 201, headers: corsHeaders() })
      : new NextResponse(null, { status: 201, headers: corsHeaders() });
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ table: string }> }) {
  return handleQuery(req, ctx, async (table, who, scope) => {
    const body = await req.json().catch(() => null);
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      throw new QueryFailed({ message: "Invalid JSON body", code: "PGRST102" }, 400);
    }
    const client = createClient();
    let qb = client.from(table).update(body);
    applyPostgrestParams(qb, withoutOptions(req.nextUrl.searchParams));
    const wantRows = preferReturn(req) || preferSingle(req);
    if (wantRows) qb = qb.select(req.nextUrl.searchParams.get("select") || "*");
    if (preferSingle(req)) qb = qb.single();

    const result = await runOrThrow(qb, who);
    visibleRows(result.data, scope);
    return wantRows
      ? NextResponse.json(result.data, { status: 200, headers: corsHeaders() })
      : new NextResponse(null, { status: 204, headers: corsHeaders() });
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ table: string }> }) {
  return handleQuery(req, ctx, async (table, who, scope) => {
    const client = createClient();
    let qb = client.from(table).delete();
    applyPostgrestParams(qb, withoutOptions(req.nextUrl.searchParams));
    const wantRows = preferReturn(req) || preferSingle(req);
    if (wantRows) qb = qb.select(req.nextUrl.searchParams.get("select") || "*");
    if (preferSingle(req)) qb = qb.single();

    const result = await runOrThrow(qb, who);
    visibleRows(result.data, scope);
    return wantRows
      ? NextResponse.json(result.data, { status: 200, headers: corsHeaders() })
      : new NextResponse(null, { status: 204, headers: corsHeaders() });
  });
}

/** Run a handler in the caller's RLS scope and turn query failures into PostgREST errors. */
async function handleQuery(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> },
  run: (table: string, who: Requester, scope: ReadScope) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handle(req, ctx, run);
  } catch (e) {
    if (e instanceof QueryFailed) return jsonError(e.body, e.status, e.who);
    throw e;
  }
}

/** Mutations carry `select`/`on_conflict`/`columns` as options, not filters. */
function withoutOptions(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(params);
  out.delete("select");
  out.delete("on_conflict");
  out.delete("columns");
  return out;
}
