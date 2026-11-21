import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { readObject } from '@/lib/db/storage';
import { ProductDetailsError, writeProductDetails } from '@/lib/ai-product-details';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Photos larger than this are not sent to the writer (they are shrunk in the browser first). */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const PUBLIC_PREFIX = '/storage/v1/object/public/products/';

/**
 * POST { imageUrl } → { name, description }
 *
 * Staff who manage products send the address of a photo they have just
 * uploaded to the products bucket; the server reads that file from its own
 * storage and asks the writer (lib/ai-product-details.ts) for a name and
 * description. Only photos in this store's products bucket are accepted.
 */
export async function POST(request: Request) {
  const auth = await verifyAuth(request, { requireRole: ['admin', 'staff'] });
  if (!auth.authenticated || !auth.user?.id) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.role ? 403 : 401 });
  }

  const rl = checkRateLimit(`product-describe:${auth.user.id}`, { maxRequests: 20, windowSeconds: 60 });
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
  }

  const body: any = await request.json().catch(() => null);
  const raw = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  let objectPath = '';
  try {
    const url = new URL(raw, 'https://placeholder.invalid');
    const at = url.pathname.indexOf(PUBLIC_PREFIX);
    if (at !== -1) objectPath = decodeURIComponent(url.pathname.slice(at + PUBLIC_PREFIX.length));
  } catch {
    objectPath = '';
  }
  if (!objectPath || objectPath.includes('..')) {
    return NextResponse.json({ error: 'Upload the photo first, then try again.' }, { status: 400 });
  }

  const image = await readObject('products', objectPath);
  if (!image) {
    return NextResponse.json({ error: 'That photo could not be found. Upload it again.' }, { status: 404 });
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(image.contentType)) {
    return NextResponse.json({ error: 'Use a JPG, PNG or WebP photo.' }, { status: 415 });
  }
  if (image.bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'The photo is too large to read. Use a smaller photo.' }, { status: 413 });
  }

  try {
    const details = await writeProductDetails(image);
    if (!details.name && !details.description) {
      return NextResponse.json(
        { error: 'The writer could not tell what this item is. Try a clearer photo, or type the details.' },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { name: details.name, description: details.description },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof ProductDetailsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[products/describe] failed:', (err as any)?.message);
    return NextResponse.json({ error: 'The writer is not answering. Try again in a moment.' }, { status: 502 });
  }
}
