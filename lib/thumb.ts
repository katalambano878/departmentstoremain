/**
 * The address of a small copy of one of this store's photos, `width` pixels
 * wide (served by app/storage/v1/render/image/public). Use it wherever a list
 * shows a photo smaller than the original: loading hundreds of full-size
 * photos made phones close the page.
 *
 * Addresses that are not in the store's public storage (other sites, data
 * URLs, blobs) are returned unchanged. On a sharp phone screen a picture
 * shown 48px wide needs about 96px, so pass roughly twice the shown width.
 */
export function thumb(src: string | null | undefined, width: number): string {
  if (!src || typeof src !== 'string') return src || '';
  const marker = '/storage/v1/object/public/';
  const at = src.indexOf(marker);
  if (at === -1 || src.startsWith('data:') || src.startsWith('blob:')) return src;
  const rest = src.slice(at + marker.length).split(/[?#]/)[0];
  return `${src.slice(0, at)}/storage/v1/render/image/public/${rest}?width=${Math.round(width)}`;
}
