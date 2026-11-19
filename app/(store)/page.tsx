'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import ProductCard, { type ColorVariant, getColorHex } from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/skeletons/ProductCardSkeleton';
import AnimatedSection, { AnimatedGrid } from '@/components/AnimatedSection';
import NewsletterSection from '@/components/NewsletterSection';
import HeroModern from '@/components/home/HeroModern';
import HeroClassic from '@/components/home/HeroClassic';
import { USE_NEW_DESIGN } from '@/lib/uiFlags';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { applyStorefrontProductFilter } from '@/lib/product-visibility';

// Explicit columns only: never select cost fields for the storefront.
const HOME_PRODUCT_COLUMNS =
  'id, name, slug, price, compare_at_price, quantity, track_quantity, continue_selling, featured, moq, rating_avg, review_count, created_at, ' +
  'product_variants(id, name, price, compare_at_price, quantity, option1, option2, image_url), ' +
  'product_images(id, url, alt_text, position, variant_id), categories(name)';

export default function Home() {
  usePageTitle('');
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch featured products directly from Supabase
        const { data: productsData, error: productsError } = await applyStorefrontProductFilter(
          supabase
            .from('products')
            .select(HOME_PRODUCT_COLUMNS)
        )
          .eq('featured', true)
          .order('created_at', { ascending: false })
          .limit(8);

        if (productsError) throw productsError;
        // Fallback: if no featured rows are configured, show latest active products.
        if (!productsData || productsData.length === 0) {
          const { data: fallbackProducts, error: fallbackError } = await applyStorefrontProductFilter(
            supabase
              .from('products')
              .select(HOME_PRODUCT_COLUMNS)
          )
            .order('created_at', { ascending: false })
            .limit(8);
          if (fallbackError) throw fallbackError;
          setFeaturedProducts(fallbackProducts || []);
        } else {
          setFeaturedProducts(productsData);
        }

        // Fetch featured categories (featured is stored in metadata JSONB)
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('id, name, slug, image_url, metadata')
          .eq('status', 'active')
          .order('name');

        if (categoriesError) throw categoriesError;

        // Filter by metadata.featured = true on client side
        const featuredCategories = (categoriesData || []).filter(
          (cat: any) => cat.metadata?.featured === true
        );
        setCategories(featuredCategories);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return (
    <main className="flex-col items-center justify-between min-h-screen">
      {USE_NEW_DESIGN ? <HeroModern /> : <HeroClassic />}

      {/* Categories Section */}
      <section className="py-12 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <AnimatedSection className="flex items-end justify-between mb-12">
            <div>
              <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl text-gray-900 mb-4">Shop by Category</h2>
              <p className="text-gray-600 text-lg max-w-md">From dresses to electronics, bags to shoes</p>
            </div>
            <Link href="/categories" className="hidden md:flex items-center text-emerald-800 font-medium hover:text-emerald-900 transition-colors">
              View All <i className="ri-arrow-right-line ml-2"></i>
            </Link>
          </AnimatedSection>

          <AnimatedGrid className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {categories.map((category) => {
              const categoryImage = category.image || category.image_url || '';
              return (
              <Link href={`/shop?category=${category.slug}`} key={category.id} className="group block cursor-pointer">
                <div className="relative aspect-[3/4] overflow-hidden rounded-[1.25rem] shadow-md ring-1 ring-black/5 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_-18px_rgba(4,120,87,0.4)] group-hover:ring-emerald-200/70">
                  {categoryImage ? (
                    <Image
                      src={getOptimizedImageUrl(categoryImage, { width: 640, quality: 70, format: 'webp' })}
                      alt={category.name}
                      fill
                      unoptimized
                      className="object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.08]"
                      sizes="(max-width: 768px) 50vw, 25vw"
                      quality={75}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100">
                      <i className="ri-image-line text-4xl text-emerald-300"></i>
                    </div>
                  )}

                  {/* Emerald-tinted scrim */}
                  <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/85 via-emerald-950/25 to-transparent transition-all duration-300 group-hover:from-emerald-950/90"></div>

                  {/* Hover arrow badge */}
                  <div className="absolute right-3 top-3 flex size-9 scale-90 items-center justify-center rounded-full bg-white/95 text-emerald-700 opacity-0 shadow-md backdrop-blur-sm transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
                    <i className="ri-arrow-right-up-line text-lg"></i>
                  </div>

                  {/* Content */}
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <h3 className="font-serif text-lg font-semibold leading-snug text-white drop-shadow-sm md:text-xl">{category.name}</h3>
                    <span className="mt-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                      <span className="h-px w-5 bg-emerald-300/80 transition-all duration-300 group-hover:w-9"></span>
                      Shop Now
                    </span>
                  </div>
                </div>
              </Link>
              );
            })}
          </AnimatedGrid>

          <div className="mt-8 text-center md:hidden">
            <Link href="/categories" className="inline-flex items-center text-emerald-800 font-medium hover:text-emerald-900 transition-colors">
              View All <i className="ri-arrow-right-line ml-2"></i>
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-16 md:py-24 bg-stone-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl text-gray-900 mb-4">Featured Products</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Top picks from our latest arrivals</p>
          </AnimatedSection>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 md:gap-8">
              {[...Array(8)].map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <AnimatedGrid className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 lg:gap-8">
              {featuredProducts.map((product) => {
                const variants = product.product_variants || [];
                const hasVariants = variants.length > 0;
                const minVariantPrice = hasVariants ? Math.min(...variants.map((v: any) => v.price || product.price)) : undefined;
                const totalVariantStock = hasVariants ? variants.reduce((sum: number, v: any) => sum + (v.quantity || 0), 0) : 0;
                const unlimitedStock = product.track_quantity === false || product.continue_selling === true;
                const effectiveStock = unlimitedStock ? 999 : (hasVariants ? totalVariantStock : product.quantity);

                // Extract unique colors from option2
                const colorVariants: ColorVariant[] = [];
                const seenColors = new Set<string>();
                for (const v of variants) {
                  const colorName = (v as any).option2;
                  if (colorName && !seenColors.has(colorName.toLowerCase().trim())) {
                    const hex = getColorHex(colorName);
                    if (hex) {
                      seenColors.add(colorName.toLowerCase().trim());
                      colorVariants.push({ name: colorName.trim(), hex });
                    }
                  }
                }

                return (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    slug={product.slug}
                    name={product.name}
                    price={product.price}
                    originalPrice={product.compare_at_price}
                    image={product.product_images?.[0]?.url || ''}
                    rating={product.rating_avg || 0}
                    reviewCount={product.review_count || 0}
                    badge={product.featured ? 'Featured' : undefined}
                    categoryName={product.categories?.name || undefined}
                    inStock={effectiveStock > 0}
                    maxStock={effectiveStock}
                    moq={product.moq || 1}
                    hasVariants={hasVariants}
                    minVariantPrice={minVariantPrice}
                    colorVariants={colorVariants}
                  />
                );
              })}
            </AnimatedGrid>
          )}

          <div className="text-center mt-16">
            <Link
              href="/shop"
              className="inline-flex items-center justify-center bg-gray-900 text-white px-10 py-4 rounded-full font-medium hover:bg-emerald-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 btn-animate"
            >
              View All Products
            </Link>
          </div>
        </div>
      </section>

      {/* Newsletter - Homepage Only */}
      <NewsletterSection />

    </main>
  );
}
