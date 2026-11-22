import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PUBLIC_BUCKETS, STORAGE_ROOT, readObject } from '@/lib/db/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A small copy of a public photo: GET /storage/v1/render/image/public/{bucket}/{path}?width=160
 * (the same address shape as Supabase's image transform).
 *
 * Lists in the dashboard used to load every product's original photo (often
 * 3 MB and 4000px); on a phone a list of hundreds of them used more memory
 * than Safari allows and the page was closed ("A problem repeatedly
 * occurred"). Lists now ask for a thumbnail of the width they show.
 *
 * Each size is made once with sharp, saved under STORAGE_ROOT/.render/ and
 * served from there afterwards. The width snaps to a few fixed sizes so the
 * cache stays small. If a photo cannot be resized it redirects to the original.
 */

const WIDTHS = [64, 96, 160, 240, 320, 480, 640, 960];
const QUALITY = 72;
const MAX_JOBS = 3;

let running = 0;
const waiting: Array<() => void> = [];

/** At most MAX_JOBS photos are resized at once; the rest wait their turn. */
async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_JOBS) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await job();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function snapWidth(raw: string | null): number {
  const asked = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(asked) || asked <= 0) return 320;
  return WIDTHS.find((w) => w >= asked) ?? WIDTHS[WIDTHS.length - 1];
}

/** Send the browser to the original photo (a relative address: behind the proxy req.url has the inner host). */
function toOriginal(bucket: string, objectPath: string): Response {
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  return new Response(null, {
    status: 302,
    headers: { Location: `/storage/v1/object/public/${encodeURIComponent(bucket)}/${encoded}`, 'Cache-Control': 'no-store' },
  });
}

const HEADERS = {
  'Content-Type': 'image/webp',
  'Cache-Control': 'public, max-age=2592000, immutable',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ bucket: string; path: string[] }> }
): Promise<Response> {
  const { bucket, path: parts } = await ctx.params;
  const objectPath = parts.map(decodeURIComponent).join('/');
  const notFound = () =>
    new Response(JSON.stringify({ error: 'Object not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!PUBLIC_BUCKETS.has(bucket) || !objectPath || objectPath.includes('..') || objectPath.endsWith('.meta.json')) {
    return notFound();
  }

  const width = snapWidth(new URL(req.url).searchParams.get('width'));
  const cacheBase = path.resolve(STORAGE_ROOT, '.render', bucket, `w${width}`);
  const cacheFile = path.resolve(cacheBase, `${objectPath}.webp`);
  if (!cacheFile.startsWith(cacheBase + path.sep)) return notFound();

  try {
    const cached = await fs.readFile(cacheFile);
    return new Response(new Uint8Array(cached), { status: 200, headers: HEADERS });
  } catch {
    // Not made yet.
  }

  const original = await readObject(bucket, objectPath);
  if (!original) return notFound();
  if (!/^image\/(jpe?g|png|webp|gif|avif|tiff)$/i.test(original.contentType)) {
    // SVG and anything else: send the original.
    return toOriginal(bucket, objectPath);
  }

  try {
    const small = await withSlot(() =>
      sharp(original.bytes, { failOn: 'none', animated: false })
        .rotate() // follow the camera's orientation
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer()
    );
    try {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      const temp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temp, small);
      await fs.rename(temp, cacheFile);
    } catch (err: any) {
      console.warn('[render/image] could not cache', objectPath, err?.message);
    }
    return new Response(new Uint8Array(small), { status: 200, headers: HEADERS });
  } catch (err: any) {
    console.warn('[render/image] could not resize', objectPath, err?.message);
    return toOriginal(bucket, objectPath);
  }
}
