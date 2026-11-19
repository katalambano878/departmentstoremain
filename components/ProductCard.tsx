'use client';

import Link from 'next/link';
import LazyImage from './LazyImage';
import { useCart } from '@/context/CartContext';
import { useAffiliate } from '@/context/AffiliateContext';
import { useWishlist } from '@/context/WishlistContext';

// Map common color names to hex values for swatches
const COLOR_MAP: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#EF4444', blue: '#3B82F6',
  navy: '#1E3A5F', green: '#22C55E', yellow: '#EAB308', orange: '#F97316',
  pink: '#EC4899', purple: '#A855F7', brown: '#92400E', beige: '#D4C5A9',
  grey: '#6B7280', gray: '#6B7280', cream: '#FFFDD0', teal: '#14B8A6',
  maroon: '#800000', coral: '#FF7F50', burgundy: '#800020', olive: '#808000',
  tan: '#D2B48C', khaki: '#C3B091', charcoal: '#36454F', ivory: '#FFFFF0',
  gold: '#FFD700', silver: '#C0C0C0', rose: '#FF007F', lavender: '#E6E6FA',
  mint: '#98FB98', peach: '#FFDAB9', wine: '#722F37', denim: '#1560BD',
  nude: '#E3BC9A', camel: '#C19A6B', sage: '#BCB88A', rust: '#B7410E',
  mustard: '#FFDB58', plum: '#8E4585', lilac: '#C8A2C8', stone: '#928E85',
  sand: '#C2B280', taupe: '#483C32', mauve: '#E0B0FF', sky: '#87CEEB',
  forest: '#228B22', cobalt: '#0047AB', emerald: '#50C878', scarlet: '#FF2400',
  aqua: '#00FFFF', turquoise: '#40E0D0', indigo: '#4B0082', crimson: '#DC143C',
  magenta: '#FF00FF', cyan: '#00FFFF', chocolate: '#7B3F00', coffee: '#6F4E37',
};

export function getColorHex(colorName: string): string | null {
  const lower = colorName.toLowerCase().trim();
  if (COLOR_MAP[lower]) return COLOR_MAP[lower];
  // Try partial match (e.g. "Light Blue" -> "blue")
  for (const [key, val] of Object.entries(COLOR_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

export interface ColorVariant {
  name: string;
  hex: string;
}

interface ProductCardProps {
  id: string;
  slug: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating?: number;
  reviewCount?: number;
  badge?: string;
  categoryName?: string;
  inStock?: boolean;
  maxStock?: number;
  moq?: number;
  hasVariants?: boolean;
  minVariantPrice?: number;
  colorVariants?: ColorVariant[];
}

export default function ProductCard({
  id,
  slug,
  name,
  price,
  originalPrice,
  image,
  rating = 5,
  reviewCount = 0,
  badge,
  categoryName,
  inStock = true,
  maxStock = 50,
  moq = 1,
  hasVariants = false,
  minVariantPrice,
  colorVariants = []
}: ProductCardProps) {
  const { addToCart } = useCart();
  const { mk } = useAffiliate();
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  const wished = isInWishlist(id);

  const displayPrice = hasVariants && minVariantPrice ? minVariantPrice : price;
  // Only treat it as a sale when the "was" price is really higher.
  const hasComparePrice = typeof originalPrice === 'number' && originalPrice > displayPrice;
  const discount = hasComparePrice ? Math.round((1 - displayPrice / (originalPrice as number)) * 100) : 0;
  const onSale = discount > 0;
  const MAX_SWATCHES = 5;

  // Affiliate markup is display-only; the cart always stores the base price so
  // the order is re-priced authoritatively server-side at checkout.
  const formatPrice = (val: number) => `GH\u20B5${mk(val, id).toFixed(2)}`;

  const toggleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (wished) {
      removeFromWishlist(id);
    } else {
      addToWishlist({ id, name, price: displayPrice, originalPrice, image, rating, reviewCount, badge, inStock, slug, hasVariants });
    }
  };

  const roundedRating = Math.max(0, Math.min(5, Math.round(rating)));

  return (
    <div className="group relative flex h-full flex-col transition-transform duration-300 ease-out will-change-transform hover:-translate-y-1">
      <Link href={`/product/${slug}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-[#ecfdf5] via-white to-[#d1fae5]/50 shadow-sm ring-1 ring-black/[0.04] transition-all duration-300 group-hover:shadow-[0_20px_40px_-18px_rgba(4,120,87,0.35)] group-hover:ring-emerald-200/70">
          <LazyImage
            src={image}
            alt={name}
            className="w-full h-full object-cover object-top transition-transform duration-[900ms] ease-out group-hover:scale-[1.07]"
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
            {onSale && (
              <span className="rounded-full bg-gradient-to-r from-red-500 to-red-600 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-wide text-white shadow-md shadow-red-600/25">
                -{discount}%
              </span>
            )}
            {badge && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-700 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-wide text-white shadow-md shadow-emerald-700/25">
                <i className="ri-sparkling-fill text-[0.7rem]" aria-hidden></i>
                {badge}
              </span>
            )}
          </div>

          {!inStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[2px]">
              <span className="rounded-full bg-[#0B1B3A]/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-lg">Out of Stock</span>
            </div>
          )}
        </div>
      </Link>

      <button
        onClick={toggleWishlist}
        className={`absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/95 shadow-md ring-1 ring-black/[0.04] backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:shadow-lg ${
          wished ? 'text-emerald-600' : 'text-[#0B1B3A] hover:text-emerald-600'
        }`}
        aria-label={wished ? `Remove ${name} from wishlist` : `Add ${name} to wishlist`}
        aria-pressed={wished}
      >
        <i className={`${wished ? 'ri-heart-fill' : 'ri-heart-line'} text-base transition-transform duration-200 group-hover:scale-105`} aria-hidden="true"></i>
      </button>

      <div className="mt-3.5 flex flex-1 flex-col px-0.5">
        <Link href={`/product/${slug}`} className="block">
          {categoryName && (
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-600/80">{categoryName}</p>
          )}
          <h3 className="mt-1 font-serif text-[15px] font-semibold leading-snug text-[#0B1B3A] transition-colors line-clamp-2 group-hover:text-emerald-700">
            {name}
          </h3>
        </Link>

        {reviewCount > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex items-center text-[13px] leading-none text-amber-400">
              {Array.from({ length: 5 }).map((_, i) => (
                <i key={i} className={i < roundedRating ? 'ri-star-fill' : 'ri-star-line text-gray-300'}></i>
              ))}
            </div>
            <span className="text-[11px] font-medium text-gray-400">({reviewCount})</span>
          </div>
        )}

        {colorVariants.length > 0 && (
          <Link
            href={`/product/${slug}`}
            className="mt-2 flex w-fit items-center gap-1.5 rounded-full"
            aria-label={`See ${name} in ${colorVariants.map((c) => c.name).join(', ')}`}
          >
            {colorVariants.slice(0, MAX_SWATCHES).map((color) => (
              <span
                key={color.name}
                title={color.name}
                aria-hidden="true"
                className={`h-[18px] w-[18px] rounded-full border flex-shrink-0 ${color.hex === '#FFFFFF' ? 'border-gray-300' : 'border-black/5'}`}
                style={{ backgroundColor: color.hex }}
              />
            ))}
            {colorVariants.length > MAX_SWATCHES && (
              <span className="text-xs text-gray-400 ml-0.5" aria-hidden="true">+{colorVariants.length - MAX_SWATCHES}</span>
            )}
          </Link>
        )}

        <div className="mt-2 flex items-baseline gap-2">
          {hasVariants && minVariantPrice ? (
            <span className="text-[17px] font-bold text-[#0B1B3A]">
              <span className="text-[11px] font-medium text-gray-400">From </span>
              {formatPrice(minVariantPrice)}
            </span>
          ) : (
            <span className={`text-[17px] font-bold ${onSale ? 'text-emerald-700' : 'text-[#0B1B3A]'}`}>{formatPrice(price)}</span>
          )}
          {hasComparePrice && (
            <span className="text-[13px] text-gray-400 line-through">
              <span className="sr-only">Was </span>
              {formatPrice(originalPrice as number)}
            </span>
          )}
        </div>

        <div className="mt-auto pt-3">
          {hasVariants ? (
            <Link
              href={`/product/${slug}`}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600/80 bg-white py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition-all duration-200 hover:bg-emerald-600 hover:text-white hover:shadow-md hover:shadow-emerald-600/20"
            >
              <i className="ri-list-check text-sm"></i>
              <span>Select Options</span>
            </Link>
          ) : (
            <button
              onClick={(e) => {
                e.preventDefault();
                addToCart({ id, name, price, image, quantity: moq, slug, maxStock, moq });
              }}
              disabled={!inStock}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600/80 bg-white py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition-all duration-200 hover:bg-emerald-600 hover:text-white hover:shadow-md hover:shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-emerald-700"
            >
              <i className="ri-shopping-bag-line text-sm"></i>
              <span>{moq > 1 ? `Add ${moq} to Bag` : 'Add to Bag'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
