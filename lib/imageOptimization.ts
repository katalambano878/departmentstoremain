type ImageOptimizationOptions = {
  width?: number;
  quality?: number;
  format?: 'origin' | 'webp' | 'avif';
};

/**
 * Images are optimized through wsrv.nl (a.k.a. images.weserv.nl) — a free,
 * Cloudflare-backed image proxy that resizes and converts to WebP on the fly and
 * caches the result on its own CDN.
 *
 * Why not the built-in optimizers?
 *  - Supabase's render/transform API (`/render/image/`) requires a paid plan.
 *  - Vercel's image optimizer returns 402 (billing) once the free quota is hit,
 *    which is why `images.unoptimized` is enabled in next.config.
 *
 * wsrv.nl gives us free, on-the-fly resize + WebP + CDN caching. Local/relative
 * assets are returned untouched (Vercel already serves those efficiently).
 */
const IMAGE_PROXY_HOST = 'wsrv.nl';
const IMAGE_PROXY = `https://${IMAGE_PROXY_HOST}/`;

export function getOptimizedImageUrl(
  src: string,
  options: ImageOptimizationOptions = {}
): string {
  if (!src || typeof src !== 'string') return src;
  const trimmed = src.trim();

  // Only proxy absolute http(s) images; leave local/relative assets untouched.
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  // Never double-proxy an already-optimized URL.
  if (trimmed.includes(IMAGE_PROXY_HOST) || trimmed.includes('images.weserv.nl')) {
    return trimmed;
  }

  const { width, quality = 70, format = 'webp' } = options;

  try {
    // wsrv fetches https origins via the `ssl:` prefix (scheme is dropped).
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    const proxied = new URL(IMAGE_PROXY);
    proxied.searchParams.set('url', `ssl:${withoutScheme}`);
    if (width) proxied.searchParams.set('w', String(width));
    proxied.searchParams.set('q', String(quality));
    // Never upscale beyond the original resolution.
    proxied.searchParams.set('we', '');
    // Keep origin fetches rare — wsrv 429s were stampeding Supabase storage.
    proxied.searchParams.set('maxage', '2592000');
    if (format && format !== 'origin') {
      proxied.searchParams.set('output', format);
    }
    return proxied.toString();
  } catch {
    return trimmed;
  }
}
