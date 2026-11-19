'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCart } from '@/context/CartContext';
import PageHero from '@/components/PageHero';
import { useWishlist, type WishlistItem } from '@/context/WishlistContext';
import ProductCard from '@/components/ProductCard';
import { usePageTitle } from '@/hooks/usePageTitle';
import { supabase } from '@/lib/supabase';
import { applyStorefrontProductFilter } from '@/lib/product-visibility';

/** Current catalogue data for a saved item. */
type LiveInfo = {
  price: number;
  compareAt?: number;
  stock: number;
  moq: number;
  hasVariants: boolean;
  minVariantPrice?: number;
};

const UNLIMITED_STOCK = 999;

async function loadLiveInfo(ids: string[]): Promise<Map<string, LiveInfo> | null> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await applyStorefrontProductFilter(
      supabase
        .from('products')
        .select('id, price, compare_at_price, quantity, track_quantity, continue_selling, moq, product_variants(id, price, quantity)')
    ).in('id', ids);
    if (error) return null;
    const map = new Map<string, LiveInfo>();
    for (const p of data || []) {
      const variants = (p as any).product_variants || [];
      const hasVariants = variants.length > 0;
      const unlimited = p.track_quantity === false || p.continue_selling === true;
      const raw = hasVariants
        ? variants.reduce((sum: number, v: any) => sum + (Number(v.quantity) || 0), 0)
        : Number(p.quantity) || 0;
      map.set(p.id, {
        price: Number(p.price),
        compareAt: p.compare_at_price != null ? Number(p.compare_at_price) : undefined,
        stock: unlimited ? UNLIMITED_STOCK : Math.max(0, raw),
        moq: Math.max(1, Number(p.moq) || 1),
        hasVariants,
        minVariantPrice: hasVariants
          ? Math.min(...variants.map((v: any) => Number(v.price ?? p.price)))
          : undefined,
      });
    }
    return map;
  } catch {
    return null;
  }
}

export default function WishlistPage() {
  usePageTitle('Wishlist');
  const { wishlist: wishlistItems, removeFromWishlist } = useWishlist();
  const { addToCart } = useCart();
  const [live, setLive] = useState<Map<string, LiveInfo> | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ added: number; needOptions: WishlistItem[]; unavailable: WishlistItem[] } | null>(null);

  const idsKey = wishlistItems.map((i) => i.id).sort().join(',');

  // Show current prices and stock, not the ones saved when the item was liked.
  useEffect(() => {
    let active = true;
    loadLiveInfo(wishlistItems.map((i) => i.id)).then((map) => {
      if (!active) return;
      setLive(map);
      setLiveFailed(map === null);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const addAllToCart = async () => {
    setAdding(true);
    setNotice(null);
    // Re-read right before adding so the bag gets today's price and stock.
    const fresh = await loadLiveInfo(wishlistItems.map((i) => i.id));
    setAdding(false);
    if (!fresh) {
      setLiveFailed(true);
      return;
    }
    setLive(fresh);
    setLiveFailed(false);

    let added = 0;
    const needOptions: WishlistItem[] = [];
    const unavailable: WishlistItem[] = [];
    for (const item of wishlistItems) {
      const info = fresh.get(item.id);
      if (!info || info.stock < info.moq) {
        unavailable.push(item);
        continue;
      }
      if (info.hasVariants) {
        // Size / colour must be chosen on the product page.
        needOptions.push(item);
        continue;
      }
      addToCart({
        id: item.id,
        name: item.name,
        price: info.price,
        image: item.image,
        quantity: info.moq,
        slug: item.slug || item.id,
        maxStock: info.stock,
        moq: info.moq,
      });
      added += 1;
    }
    setNotice({ added, needOptions, unavailable });
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero title="My Wishlist" />

      <section className="py-8 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <nav className="flex items-center space-x-2 text-sm mb-2" aria-label="Breadcrumb">
                <Link href="/" className="text-gray-600 hover:text-emerald-700 transition-colors">Home</Link>
                <i className="ri-arrow-right-s-line text-gray-400" aria-hidden="true"></i>
                <span className="text-gray-900 font-medium">Wishlist</span>
              </nav>
              <p className="text-gray-600">
                {wishlistItems.length} {wishlistItems.length === 1 ? 'item' : 'items'} saved
              </p>
            </div>
            {wishlistItems.length > 0 && (
              <button
                type="button"
                onClick={addAllToCart}
                disabled={adding}
                className="bg-gray-900 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-60"
              >
                {adding ? 'Checking stock…' : 'Add All to Cart'}
              </button>
            )}
          </div>

          {liveFailed && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              We couldn&apos;t check current prices and stock. Please try again in a moment.
            </p>
          )}

          {notice && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
              <p className="font-semibold">
                {notice.added > 0
                  ? `Added ${notice.added} ${notice.added === 1 ? 'item' : 'items'} to your bag.`
                  : 'Nothing was added to your bag.'}
              </p>
              {notice.needOptions.length > 0 && (
                <div className="mt-2">
                  <p>Choose a size or colour for these first:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {notice.needOptions.map((item) => (
                      <li key={item.id}>
                        <Link href={`/product/${item.slug || item.id}`} className="font-medium underline hover:text-emerald-700">
                          {item.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {notice.unavailable.length > 0 && (
                <p className="mt-2">
                  Out of stock or no longer sold: {notice.unavailable.map((i) => i.name).join(', ')}.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {wishlistItems.length === 0 ? (
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
            <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-gray-200 rounded-full">
              <i className="ri-heart-line text-5xl text-gray-400" aria-hidden="true"></i>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Your wishlist is empty</h2>
            <p className="text-gray-600 mb-8 text-lg">Save your favourite items here to easily find them later</p>
            <Link href="/shop" className="inline-block bg-gray-900 hover:bg-emerald-700 text-white px-8 py-4 rounded-lg font-semibold transition-colors whitespace-nowrap">
              Explore Products
            </Link>
          </div>
        </section>
      ) : (
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {wishlistItems.map((product) => {
                const info = live?.get(product.id);
                // Once the catalogue answered, a missing product is no longer sold.
                const gone = !!live && !info;
                return (
                  <div key={product.id} className="relative">
                    <ProductCard
                      id={product.id}
                      slug={product.slug || product.id}
                      name={product.name}
                      image={product.image}
                      rating={product.rating}
                      reviewCount={product.reviewCount}
                      badge={product.badge}
                      price={info?.price ?? product.price}
                      originalPrice={info ? info.compareAt : product.originalPrice}
                      inStock={info ? info.stock >= info.moq : gone ? false : product.inStock}
                      maxStock={info?.stock ?? 1}
                      moq={info?.moq ?? 1}
                      hasVariants={info?.hasVariants ?? product.hasVariants ?? false}
                      minVariantPrice={info?.minVariantPrice}
                    />
                    <button
                      type="button"
                      onClick={() => removeFromWishlist(product.id)}
                      aria-label={`Remove ${product.name} from wishlist`}
                      className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center bg-white rounded-full shadow-md hover:bg-red-50 transition-colors z-10"
                    >
                      <i className="ri-close-line text-gray-700 text-xl" aria-hidden="true"></i>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

    </main>
  );
}
