import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAnon } from '@/lib/supabase-server';
import { slugify } from '@/lib/slug';
import { isStorefrontVisible } from '@/lib/product-visibility';
import ProductDetailClient from './ProductDetailClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only what the metadata and the visibility check need. Never cost fields.
const META_COLUMNS =
  'id, slug, name, description, short_description, seo_title, seo_description, status, metadata, product_images(url, position, variant_id)';

type MetaProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  short_description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: string | null;
  metadata: Record<string, any> | null;
  product_images?: { url: string; position: number | null; variant_id: string | null }[] | null;
};

/**
 * Server lookup shared by generateMetadata and the page (deduplicated per
 * request by React cache). Returns:
 *   - the product when it exists and is visible on the website
 *   - null when it does not exist or is hidden (draft / POS only)
 *   - 'error' when the database could not be reached, so the page can still
 *     render and let the browser retry instead of showing a false 404.
 */
const loadProduct = cache(async (rawSlug: string): Promise<MetaProduct | null | 'error'> => {
  let decoded = rawSlug;
  try {
    decoded = decodeURIComponent(rawSlug);
  } catch {
    decoded = rawSlug;
  }

  const load = async (value: string) => {
    let query = supabaseAnon.from('products').select(META_COLUMNS);
    if (UUID_RE.test(value)) query = query.or(`id.eq.${value},slug.eq.${value}`);
    else query = query.eq('slug', value);
    return query.maybeSingle();
  };

  try {
    let { data, error } = await load(decoded);
    if (error) return 'error';
    if (!data && !UUID_RE.test(decoded)) {
      const cleaned = slugify(decoded);
      if (cleaned && cleaned !== decoded) {
        const second = await load(cleaned);
        if (second.error) return 'error';
        data = second.data;
      }
    }
    if (!data) return null;
    const product = data as unknown as MetaProduct;
    return isStorefrontVisible(product) ? product : null;
  } catch {
    return 'error';
  }
});

function plainText(value: string | null | undefined, max = 160): string {
  const text = (value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product || product === 'error') {
    return { title: product === 'error' ? 'Product' : 'Product not found' };
  }

  const title = product.seo_title?.trim() || product.name;
  const description =
    plainText(product.seo_description) ||
    plainText(product.short_description) ||
    plainText(product.description) ||
    `Buy ${product.name} at Discount Discovery Zone, delivered across Ghana.`;
  const images = [...(product.product_images || [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .sort((a, b) => Number(!!a.variant_id) - Number(!!b.variant_id));
  const image = images[0]?.url;
  const path = `/product/${product.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      url: path,
      title,
      description,
      siteName: 'Discount Discovery Zone',
      images: image ? [{ url: image, alt: product.name }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (product === null) notFound();
  return <ProductDetailClient slug={slug} />;
}
