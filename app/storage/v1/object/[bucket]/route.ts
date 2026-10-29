import { NextRequest, NextResponse } from "next/server";
import { createStorageClient } from "@/lib/db/storage";
import { isPlainPostgres } from "@/lib/db/mode";
import { resolveRequester } from "@/lib/db/rest-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * supabase-js `storage.from(bucket).remove(paths)`:
 *   DELETE /storage/v1/object/{bucket}   body = { prefixes: [...] }
 * Staff only, like uploads (the hosted bucket policies allowed admin/staff).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ bucket: string }> }) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 503 });
  }
  const who = await resolveRequester(req.headers.get("authorization"));
  if (!who.isStaff) {
    return NextResponse.json({ error: "Unauthorized" }, { status: who.userId ? 403 : 401 });
  }
  const { bucket } = await ctx.params;
  const body = await req.json().catch(() => null);
  const prefixes: string[] = Array.isArray(body?.prefixes)
    ? body.prefixes.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
    : [];
  if (prefixes.length === 0) {
    return NextResponse.json({ error: "No objects named" }, { status: 400 });
  }
  const { error } = await createStorageClient().from(bucket).remove(prefixes);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Supabase answers with the removed objects; supabase-js only checks for an error.
  return NextResponse.json(prefixes.map((name) => ({ bucket_id: bucket, name })));
}
