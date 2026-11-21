import { supabase } from '@/lib/supabase';

/**
 * Sending product photos from the admin, built for a weak phone connection:
 * a phone photo is made smaller before it is sent (about 3 MB down to a few
 * hundred KB), and a send that drops is tried again.
 */

/** Longest side of a photo after shrinking. Enough for the zoom on the product page. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.82;
/** Files this small are sent as they are. */
const SMALL_ENOUGH_BYTES = 400 * 1024;
const UPLOAD_ATTEMPTS = 3;
/** Give up on one attempt after this long; a stalled connection never answers. */
const UPLOAD_TIMEOUT_MS = 120_000;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' turns the picture the way the camera held it.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to the <img> decoder.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * A smaller copy of a photo, or the file itself when it is already small, is
 * not a still photo, or cannot be made smaller in this browser.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SMALL_ENOUGH_BYTES) return file;
  let picture: Drawable | null = null;
  try {
    picture = await decode(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(picture.width, picture.height));
    const width = Math.max(1, Math.round(picture.width * scale));
    const height = Math.max(1, Math.round(picture.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // PNG and WebP keep their see-through areas; everything else becomes JPEG.
    const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(picture.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
    // A browser that cannot write the format answers with another one; keep the original then.
    if (!blob || blob.type !== type || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]*$/, '') || 'photo';
    return new File([blob], `${base}.${EXTENSION[type]}`, { type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    picture?.release();
  }
}

function statusOf(error: any): number {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isFinite(status) ? status : 0;
}

/** A dropped or stalled connection, or the server being briefly away: worth another try. */
function worthRetrying(error: any): boolean {
  const status = statusOf(error);
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function plainReason(error: any): string {
  const status = statusOf(error);
  if (status === 401 || status === 403) return 'You are signed out. Sign in again, then try again.';
  if (status === 413) return 'The photo is too large (15 MB at most).';
  if (worthRetrying(error)) return 'The connection dropped. Check your internet connection, then try again.';
  return String(error?.message || 'The photo could not be saved.');
}

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Shrink a photo, send it to the `products` bucket and return its public
 * address. A send that drops is tried up to three times. Throws an Error with
 * a plain message when the photo could not be saved.
 */
export async function uploadProductPhoto(original: File, options: { folder?: string } = {}): Promise<string> {
  const file = await shrinkPhoto(original);
  const extension = EXTENSION[file.type] || file.name.split('.').pop() || 'jpg';
  const folder = options.folder ? `${options.folder.replace(/\/+$/, '')}/` : '';
  let lastError: any = null;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    // A new name each time: an attempt that timed out here may still have landed.
    const name = `${folder}${Math.random().toString(36).slice(2)}.${extension}`;
    try {
      const { error } = await withTimeout(supabase.storage.from('products').upload(name, file), UPLOAD_TIMEOUT_MS);
      if (!error) return supabase.storage.from('products').getPublicUrl(name).data.publicUrl;
      lastError = error;
    } catch (err) {
      lastError = err;
    }
    if (!worthRetrying(lastError)) break;
    if (attempt < UPLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw new Error(plainReason(lastError));
}
