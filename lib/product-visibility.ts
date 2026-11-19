/**
 * Product catalog channel visibility.
 * - global: shown on the website storefront and in POS
 * - pos_only: walk-in / POS only — hidden from shop, search, sitemap, etc.
 *
 * The source of truth is `products.metadata.visibility`: row-level security
 * and the storefront filter (applyStorefrontProductFilter) both read it.
 * The `products.visibility` column exists but is NOT NULL default 'global'
 * and nothing writes it, so it is only a fallback when metadata has no value.
 */
export type ProductVisibility = 'global' | 'pos_only';

export const DEFAULT_PRODUCT_VISIBILITY: ProductVisibility = 'global';

export function normalizeProductVisibility(value?: string | null): ProductVisibility {
  const normalized = (value || '').toLowerCase().trim();
  if (normalized === 'pos_only' || normalized === 'pos-only' || normalized === 'pos') {
    return 'pos_only';
  }
  return 'global';
}

/** Resolve visibility: metadata.visibility first (what RLS and the shop use), then the column. */
export function getProductVisibility(product: {
  visibility?: string | null;
  metadata?: { visibility?: string | null } | null;
}): ProductVisibility {
  const fromMeta = product.metadata?.visibility;
  if (fromMeta != null && String(fromMeta).trim() !== '') {
    return normalizeProductVisibility(fromMeta);
  }
  return normalizeProductVisibility(product.visibility);
}

export function isStorefrontVisible(product: {
  status?: string | null;
  visibility?: string | null;
  metadata?: { visibility?: string | null } | null;
}): boolean {
  return (
    (product.status || '').toLowerCase() === 'active' &&
    getProductVisibility(product) === 'global'
  );
}

/**
 * Apply storefront catalog filters.
 * Uses metadata.visibility (works without a DB column). Null/missing = global.
 */
export function applyStorefrontProductFilter<T>(query: T): T {
  const q = query as any;
  return q
    .eq('status', 'active')
    .or('metadata->>visibility.is.null,metadata->>visibility.eq.global') as T;
}
