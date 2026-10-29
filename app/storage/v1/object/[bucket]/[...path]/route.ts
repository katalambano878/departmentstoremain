import { NextRequest, NextResponse } from "next/server";
import { createStorageClient, objectExists } from "@/lib/db/storage";
import { isPlainPostgres } from "@/lib/db/mode";
import { resolveRequester } from "@/lib/db/rest-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Uploads and deletes go through the admin API; only staff may use the raw shim. */
async function requireStaff(req: NextRequest): Promise<NextResponse | null> {
  const who = await resolveRequester(req.headers.get("authorization"));
  if (who.isStaff) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: who.userId ? 403 : 401 });
}

/**
 * Supabase Storage upload:
 *   POST /storage/v1/object/{bucket}/{path}
 *   body = raw file bytes
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> }
) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 503 });
  }
  const denied = await requireStaff(req);
  if (denied) return denied;

  const { bucket, path } = await ctx.params;
  const objectPath = path.map(decodeURIComponent).join("/");
  const upsert = (req.headers.get("x-upsert") || "").toLowerCase() === "true";
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  // supabase-js sends a File/Blob as multipart form data (a `cacheControl`
  // field plus the file under an empty name) and raw bytes otherwise.
  let contentType = req.headers.get("content-type") || "application/octet-stream";
  let buf: Buffer;
  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = Array.from(form.values()).find((v): v is File => typeof v !== "string");
    if (!file) return NextResponse.json({ error: "No file in upload" }, { status: 400 });
    buf = Buffer.from(await file.arrayBuffer());
    contentType = file.type || "application/octet-stream";
  } else {
    buf = Buffer.from(await req.arrayBuffer());
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }
  const storage = createStorageClient();
  if (!upsert && (await objectExists(bucket, objectPath))) {
    return NextResponse.json(
      { statusCode: "409", error: "Duplicate", message: "The resource already exists" },
      { status: 409 }
    );
  }
  const { data, error } = await storage.from(bucket).upload(objectPath, buf, {
    contentType,
    upsert,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: pub } = storage.from(bucket).getPublicUrl(objectPath);
  return NextResponse.json({
    Key: `${bucket}/${objectPath}`,
    Id: data?.path,
    ...data,
    publicUrl: pub.publicUrl,
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> }
) {
  if (!isPlainPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 503 });
  }
  const denied = await requireStaff(req);
  if (denied) return denied;

  const { bucket, path } = await ctx.params;
  const objectPath = path.map(decodeURIComponent).join("/");
  const storage = createStorageClient();
  const { error } = await storage.from(bucket).remove([objectPath]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({});
}

/** supabase-js `.update()` replaces an existing object with PUT. */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const headers = new Headers(req.headers);
  headers.set("x-upsert", "true");
  return POST(new NextRequest(req.url, { method: "POST", headers, body: req.body, duplex: "half" } as any), ctx);
}
