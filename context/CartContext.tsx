'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { applyStorefrontProductFilter } from '@/lib/product-visibility';

export type CartItem = {
    id: string;
    name: string;
    price: number;
    image: string;
    quantity: number;
    variant?: string;
    /** product_variants.id when a variant was chosen — stored on order_items for fulfillment */
    variantId?: string;
    slug: string;
    maxStock: number;
    moq?: number; // Minimum Order Quantity
};

/** One thing that changed when the bag was checked against the live catalogue. */
export type CartChange = {
    id: string;
    variantId?: string;
    kind: 'removed' | 'price' | 'quantity';
    message: string;
};

/** Large cap used when stock is not tracked or the shop keeps selling at zero. */
const UNLIMITED_STOCK = 999;

type CartContextType = {
    cart: CartItem[];
    addToCart: (item: CartItem) => void;
    removeFromCart: (itemId: string, variant?: string, variantId?: string) => void;
    updateQuantity: (itemId: string, quantity: number, variant?: string, variantId?: string) => void;
    clearCart: () => void;
    cartCount: number;
    subtotal: number;
    isCartOpen: boolean;
    setIsCartOpen: (isOpen: boolean) => void;
    /** True once the saved bag has been read from this browser. */
    ready: boolean;
    /**
     * Re-read current prices and stock for everything in the bag and update it.
     * Resolves to the list of changes, or null if the catalogue could not be
     * reached (the bag is then left as it was).
     */
    refreshCart: () => Promise<CartChange[] | null>;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const sameCartLine = (item: CartItem, other: CartItem) => {
    // Prefer stable variant id when available; fall back to variant label for legacy items.
    if (item.id !== other.id) return false;
    if (item.variantId || other.variantId) return item.variantId === other.variantId;
    return item.variant === other.variant;
};

export function CartProvider({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Load cart from localStorage on mount, with migration for legacy items
    useEffect(() => {
        const savedCart = localStorage.getItem('cart');
        if (savedCart) {
            try {
                const parsed: CartItem[] = JSON.parse(savedCart);
                // Migrate legacy cart items: if `id` is not a UUID, it's likely a slug
                const isValidUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
                const migratedCart = parsed.filter(item => {
                    if (!item.id || !item.name || !item.price) return false; // Remove corrupted items
                    if (!isValidUUID(item.id)) {
                        // Legacy item with slug as id - ensure slug is set, then clear
                        // These items will be resolved at checkout via the slug fallback
                        // But best to remove them so users re-add with correct UUIDs
                        console.warn(`Removing legacy cart item with non-UUID id: ${item.id}`);
                        return false;
                    }
                    // Ensure slug field exists
                    if (!item.slug) {
                        item.slug = item.id;
                    }
                    return true;
                });
                setCart(migratedCart);
                // If items were removed, update localStorage immediately
                if (migratedCart.length !== parsed.length) {
                    localStorage.setItem('cart', JSON.stringify(migratedCart));
                }
            } catch (e) {
                console.error('Failed to parse cart:', e);
                localStorage.removeItem('cart');
            }
        }
        setIsInitialized(true);
    }, []);

    // Save cart to localStorage whenever it changes
    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem('cart', JSON.stringify(cart));
            window.dispatchEvent(new Event('cartUpdated')); // Keep compatibility with legacy listeners if any
        }
    }, [cart, isInitialized]);

    const addToCart = (newItem: CartItem) => {
        setCart((prevCart) => {
            const existingItemIndex = prevCart.findIndex(
                (item) => sameCartLine(item, newItem)
            );

            if (existingItemIndex > -1) {
                const newCart = [...prevCart];
                const existingItem = newCart[existingItemIndex];
                // Ensure we don't exceed max stock
                const newQuantity = Math.min(
                    existingItem.quantity + newItem.quantity,
                    existingItem.maxStock
                );
                newCart[existingItemIndex] = { ...existingItem, quantity: newQuantity };
                return newCart;
            } else {
                return [...prevCart, newItem];
            }
        });

        setIsCartOpen(true); // Open cart when item is added
    };

    const removeFromCart = (itemId: string, variant?: string, variantId?: string) => {
        setCart((prevCart) =>
            prevCart.filter((item) => {
                const sameProduct = item.id === itemId;
                const sameVariant = variantId ? item.variantId === variantId : item.variant === variant;
                return !(sameProduct && sameVariant);
            })
        );
    };

    const updateQuantity = (itemId: string, quantity: number, variant?: string, variantId?: string) => {
        setCart((prevCart) => {
            const item = prevCart.find(i => i.id === itemId && (variantId ? i.variantId === variantId : i.variant === variant));
            if (!item) return prevCart;

            const minQty = item.moq || 1;
            
            // If trying to reduce below MOQ, remove the item
            if (quantity < minQty) {
                return prevCart.filter(i => !(i.id === itemId && (variantId ? i.variantId === variantId : i.variant === variant)));
            }

            // Clamp quantity between MOQ and maxStock
            const clampedQty = Math.min(Math.max(quantity, minQty), item.maxStock);

            return prevCart.map((i) =>
                i.id === itemId && (variantId ? i.variantId === variantId : i.variant === variant)
                    ? { ...i, quantity: clampedQty }
                    : i
            );
        });
    };

    const clearCart = () => {
        setCart([]);
    };

    const cartRef = useRef<CartItem[]>(cart);
    cartRef.current = cart;

    const refreshCart = useCallback(async (): Promise<CartChange[] | null> => {
        const current = cartRef.current;
        if (current.length === 0) return [];
        const ids = Array.from(new Set(current.map((i) => i.id)));
        let rows: any[] | null = null;
        try {
            const { data, error } = await applyStorefrontProductFilter(
                supabase
                    .from('products')
                    .select('id, name, price, quantity, track_quantity, continue_selling, moq, product_variants(id, name, price, quantity)')
            ).in('id', ids);
            if (error) return null;
            rows = data || [];
        } catch {
            return null;
        }

        const byId = new Map<string, any>((rows || []).map((p: any) => [p.id, p]));
        const changes: CartChange[] = [];
        const fmt = (n: number) => `GH₵${n.toFixed(2)}`;
        const next: CartItem[] = [];

        for (const item of current) {
            const label = item.variant ? `${item.name} (${item.variant})` : item.name;
            const product = byId.get(item.id);
            const variant = item.variantId
                ? (product?.product_variants || []).find((v: any) => v.id === item.variantId)
                : null;
            if (!product || (item.variantId && !variant)) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'removed', message: `${label} is no longer available and was removed.` });
                continue;
            }
            const unlimited = product.track_quantity === false || product.continue_selling === true;
            const rawStock = Number((variant ? variant.quantity : product.quantity) ?? 0) || 0;
            const stock = unlimited ? UNLIMITED_STOCK : Math.max(0, rawStock);
            const moq = Math.max(1, Number(product.moq) || 1);
            const price = Number(variant ? (variant.price ?? product.price) : product.price);

            if (stock < moq) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'removed', message: `${label} has sold out and was removed.` });
                continue;
            }
            let quantity = Math.max(item.quantity, moq);
            if (quantity > stock) {
                quantity = stock;
                changes.push({ id: item.id, variantId: item.variantId, kind: 'quantity', message: `Only ${stock} of ${label} left, so we changed the quantity to ${stock}.` });
            }
            if (Number.isFinite(price) && Math.abs(price - item.price) > 0.001) {
                changes.push({ id: item.id, variantId: item.variantId, kind: 'price', message: `The price of ${label} changed from ${fmt(item.price)} to ${fmt(price)}.` });
            }
            next.push({
                ...item,
                price: Number.isFinite(price) ? price : item.price,
                quantity,
                maxStock: stock,
                moq,
            });
        }

        const changedAnything =
            next.length !== current.length ||
            next.some((n, i) => n !== current[i] && (n.price !== current[i]?.price || n.quantity !== current[i]?.quantity || n.maxStock !== current[i]?.maxStock || n.moq !== current[i]?.moq));
        if (changedAnything) {
            // Apply against the latest bag so lines added meanwhile are kept.
            setCart((prev) =>
                prev
                    .map((line) => {
                        const fresh = next.find((n) => sameCartLine(n, line));
                        if (fresh) return { ...line, price: fresh.price, quantity: Math.min(Math.max(line.quantity, fresh.moq || 1), fresh.maxStock), maxStock: fresh.maxStock, moq: fresh.moq };
                        const removed = changes.some((c) => c.kind === 'removed' && c.id === line.id && c.variantId === line.variantId);
                        return removed ? null : line;
                    })
                    .filter((l): l is CartItem => l !== null)
            );
        }
        return changes;
    }, []);

    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return (
        <CartContext.Provider value={{
            cart,
            addToCart,
            removeFromCart,
            updateQuantity,
            clearCart,
            cartCount,
            subtotal,
            isCartOpen,
            setIsCartOpen,
            ready: isInitialized,
            refreshCart,
        }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}
