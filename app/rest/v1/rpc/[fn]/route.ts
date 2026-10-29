import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase-compat";
import { isPlainPostgres } from "@/lib/db/mode";
import { PolicyError, asRequester, assertRpcAllowed, resolveRequester } from "@/lib/db/rest-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PG_IDENT = /^[a-z_][a-z0-9_]*$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, x-client-info",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ fn: string }> }
) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ message: "DATABASE_URL not set" }, { status: 503, headers: CORS });
  }
  const { fn } = await ctx.params;
  if (!PG_IDENT.test(fn)) {
    return NextResponse.json({ message: "Invalid function name" }, { status: 400, headers: CORS });
  }
  try {
    assertRpcAllowed(fn);
  } catch (e) {
    const status = e instanceof PolicyError ? e.status : 403;
    return NextResponse.json({ message: "Function not allowed", code: "42501" }, { status, headers: CORS });
  }

  const body = await req.json().catch(() => ({}));
  const args = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, any>;
  const who = await resolveRequester(req.headers.get("authorization"));
  // Same database roles and RLS context as the table shim; the function's own
  // SECURITY DEFINER setting decides whether it runs with owner rights.
  const { data, error } = await asRequester(who, () => createClient().rpc(fn, args));
  if (error) {
    return NextResponse.json(
      { message: error.message, code: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null },
      { status: error.code === "42501" ? (who.userId ? 403 : 401) : 400, headers: CORS }
    );
  }
  return NextResponse.json(data, { headers: CORS });
}
