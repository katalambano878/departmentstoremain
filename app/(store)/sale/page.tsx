'use client';

import { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { usePageTitle } from '@/hooks/usePageTitle';
import ProductCard, { type ColorVariant, getColorHex } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import { supabase } from '@/lib/supabase';
import { cachedQuery } from '@/lib/query-cache';
import { rememberShopListingPath } from '@/lib/shopListingReturn';
import PageHero from '@/components/PageHero';
import { applyStorefrontProductFilter } from '@/lib/product-visibility';
import { isRangeNotSatisfiable } from '@/lib/supabase-paginate';

function coverImage(images: { url?: string; position?: number }[] | null | undefined) {
    const sorted = [...(images || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return sorted[0]?.url || PLACEHOLDER_IMAGE;
}

const PLACEHOLDER_IMAGE =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'><rect width='800' height='800' fill='%23f3f4f6'/><path d='M260 520l120-150 90 105 70-85 120 130z' fill='%23d1d5db'/><circle cx='320' cy='300' r='45' fill='%23d1d5db'/></svg>";

function sellable(stock: number, p: { track_quantity?: boolean | null; continue_selling?: boolean | null }) {
    if (p.track_quantity === false || p.continue_selling === true) return 999;
    return Math.max(0, Number(stock) || 0);
}

const PRODUCTS_PER_PAGE = 12;

function SaleContent() {
    usePageTitle('Sale');
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const [products, setProducts] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [totalProducts, setTotalProducts] = useState(0);
    // null = still checking; controls whether the whole campaign is live.
    const [salesActive, setSalesActive] = useState<boolean | null>(null);

    const selectedCategory = searchParams.get('category') || 'all';
    const sortBy = searchParams.get('sort') || 'newest';

    const page = useMemo(() => {
        const p = parseInt(searchParams.get('page') || '1', 10);
        return Number.isFinite(p) && p >= 1 ? p : 1;
    }, [searchParams]);

    const setParam = useCallback(
        (updates: Record<string, string | null>, scroll = true) => {
            const params = new URLSearchParams(searchParams.toString());
            for (const [k, v] of Object.entries(updates)) {
                if (v === null || v === '' || v === 'all') params.delete(k);
                else params.set(k, v);
            }
            const qs = params.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll });
        },
        [pathname, router, searchParams],
    );

    useEffect(() => {
        const qs = searchParams.toString();
        rememberShopListingPath(qs ? `${pathname}?${qs}` : pathname);
    }, [pathname, searchParams]);

    useEffect(() => {
        async function fetchCategories() {
            try {
                const res = await fetch('/api/storefront/categories');
                if (res.ok) setCategories(await res.json());
            } catch {
                /* non-fatal */
            }
        }
        // Each sale has its own on/off switch, so the page lists every live
        // sale (switched-off sales have no compare-at price) instead of
        // following the all-sales switch.
        function fetchSalesActive() {
            setSalesActive(true);
        }
        fetchCategories();
        fetchSalesActive();
    }, []);

    useEffect(() => {
        // Wait until we know the campaign state; show nothing while paused.
        if (salesActive === null) return;
        if (salesActive === false) {
            setProducts([]);
            setTotalProducts(0);
            setLoading(false);
            return;
        }
        async function fetchProducts() {
            setLoading(true);
            setLoadError(false);
            try {
                const cacheKey = `sale:${selectedCategory}:${sortBy}:${page}`;
                const { data, count, error } = await cachedQuery<{ data: any; count: any; error: any }>(
                    cacheKey,
                    async () => {
                        let query = applyStorefrontProductFilter(
                            supabase
                                .from('products')
                                .select(
                                    `id, name, slug, price, compare_at_price, quantity, track_quantity, continue_selling, moq, rating_avg, review_count, created_at, categories!inner(name, slug), product_images!product_id(url, position), product_variants(id, name, price, quantity, option1, option2, image_url)`,
                                    { count: 'exact' },
                                )
                        )
                            .eq('on_sale', true)
                            .not('compare_at_price', 'is', null);

                        if (selectedCategory !== 'all') {
                            query = query.eq('categories.slug', selectedCategory);
                        }

                        if (sortBy === 'price-low') query = query.order('price', { ascending: true });
                        else if (sortBy === 'price-high') query = query.order('price', { ascending: false });
                        else query = query.order('created_at', { ascending: false });

                        const from = (page - 1) * PRODUCTS_PER_PAGE;
                        const result = await query.range(from, from + PRODUCTS_PER_PAGE - 1);
                        if (isRangeNotSatisfiable(result.error)) {
                            return { data: [], count: result.count ?? 0, error: null };
                        }
                        return result;
                    },
                );
                if (error) throw error;

                const formatted = (data || []).map((p: any) => {
                    const variants = p.product_variants || [];
                    const hasVariants = variants.length > 0;
                    const minVariantPrice = hasVariants
                        ? Math.min(...variants.map((v: any) => v.price || p.price))
                        : undefined;
                    const totalVariantStock = hasVariants
                        ? variants.reduce((sum: number, v: any) => sum + (v.quantity || 0), 0)
                        : 0;
                    const effectiveStock = sellable(hasVariants ? totalVariantStock : p.quantity, p);

                    const colorVariants: ColorVariant[] = [];
                    const seen = new Set<string>();
                    for (const v of variants) {
                        const colorName = v.option2;
                        if (colorName && !seen.has(colorName.toLowerCase().trim())) {
                            const hex = getColorHex(colorName);
                            if (hex) {
                                seen.add(colorName.toLowerCase().trim());
                                colorVariants.push({ name: colorName.trim(), hex });
                            }
                        }
                    }

                    return {
                        id: p.id,
                        slug: p.slug,
                        name: p.name,
                        price: p.price,
                        originalPrice: p.compare_at_price,
                        image: coverImage(p.product_images),
                        rating: p.rating_avg || 0,
                        reviewCount: p.review_count || 0,
                        inStock: effectiveStock > 0,
                        maxStock: effectiveStock,
                        moq: p.moq || 1,
                        categoryName: p.categories?.name || undefined,
                        hasVariants,
                        minVariantPrice,
                        colorVariants,
                    };
                });

                if (page > 1 && formatted.length === 0) {
                    setParam({ page: null }, false);
                    return;
                }
                setProducts(formatted);
                setTotalProducts(count || 0);
            } catch (err) {
                console.error('Error fetching sale products:', err);
                setLoadError(true);
                setProducts([]);
                setTotalProducts(0);
            } finally {
                setLoading(false);
            }
        }
        fetchProducts();
    }, [selectedCategory, sortBy, page, salesActive, setParam, reloadKey]);

    const totalPages = Math.ceil(totalProducts / PRODUCTS_PER_PAGE);

    useEffect(() => {
        if (loading || loadError || salesActive !== true || page <= 1) return;
        if (totalPages >= 1 && page <= totalPages) return;
        setParam({ page: totalPages > 1 ? String(totalPages) : null }, false);
    }, [loading, loadError, salesActive, totalPages, page, setParam]);

    return (
        <main className="min-h-screen bg-white">
            <PageHero
                title="Sale"
                subtitle="Our promotional and discounted items — grab them while they last"
            />

            <section className="py-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    {/* Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                        <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            <button
                                type="button"
                                aria-pressed={selectedCategory === 'all'}
                                onClick={() => setParam({ category: null, page: null }, false)}
                                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                                    selectedCategory === 'all'
                                        ? 'bg-gray-900 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                All
                            </button>
                            {categories
                                .filter((c: any) => c.slug)
                                .map((c: any) => (
                                    <button
                                        key={c.id || c.slug}
                                        type="button"
                                        aria-pressed={selectedCategory === c.slug}
                                        onClick={() => setParam({ category: c.slug, page: null }, false)}
                                        className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                                            selectedCategory === c.slug
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        {c.name}
                                    </button>
                                ))}
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-sm text-gray-500 whitespace-nowrap">{totalProducts} items</span>
                            <label htmlFor="sale-sort" className="sr-only">Sort sale items</label>
                            <select
                                id="sale-sort"
                                value={sortBy}
                                onChange={(e) => setParam({ sort: e.target.value, page: null }, false)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="newest">Newest</option>
                                <option value="price-low">Price: Low to High</option>
                                <option value="price-high">Price: High to Low</option>
                            </select>
                        </div>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <ProductCardSkeleton key={i} />
                            ))}
                        </div>
                    ) : loadError ? (
                        <div className="text-center py-20" role="alert">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gray-50 rounded-full flex items-center justify-center">
                                <i className="ri-wifi-off-line text-4xl text-gray-300" aria-hidden="true"></i>
                            </div>
                            <h2 className="text-xl font-semibold text-gray-900 mb-2">Couldn&apos;t load sale items</h2>
                            <p className="text-gray-500 mb-6">Check your connection and try again.</p>
                            <button
                                type="button"
                                onClick={() => setReloadKey((k) => k + 1)}
                                className="inline-flex items-center bg-gray-900 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                            >
                                Try again
                            </button>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gray-50 rounded-full flex items-center justify-center">
                                <i className="ri-price-tag-3-line text-4xl text-gray-300"></i>
                            </div>
                            <h2 className="text-xl font-semibold text-gray-900 mb-2">No sale items right now</h2>
                            <p className="text-gray-500">Check back soon — we add new deals regularly.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                            {products.map((p) => (
                                <ProductCard key={p.id} {...p} badge="Sale" />
                            ))}
                        </div>
                    )}

                    {/* Pagination */}
                    {!loading && !loadError && totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-12">
                            <button
                                type="button"
                                onClick={() => setParam({ page: String(page - 1) })}
                                disabled={page <= 1}
                                aria-label="Previous page"
                                className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className="ri-arrow-left-s-line text-xl text-gray-700"></i>
                            </button>
                            <span className="px-4 font-medium text-gray-700">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                type="button"
                                onClick={() => setParam({ page: String(page + 1) })}
                                disabled={page >= totalPages}
                                aria-label="Next page"
                                className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className="ri-arrow-right-s-line text-xl text-gray-700"></i>
                            </button>
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}

export default function SalePage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center">
                    <div className="w-12 h-12 border-4 border-emerald-700 border-t-transparent rounded-full animate-spin"></div>
                </div>
            }
        >
            <SaleContent />
        </Suspense>
    );
}
