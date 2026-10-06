'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { getPosCodeFromMetadata } from '@/lib/posCode';

const BarcodeScanner = dynamic(() => import('@/components/admin/BarcodeScanner'), { ssr: false });

// TEMPORARY: record offline sales from the outage (Sat 3 Oct 2026 through today).
// Delete this block and the checkout UI that uses it once those orders are entered.
const OFFLINE_CATCHUP_FROM = '2026-10-03';

function accraTodayYmd() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Accra',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function offlineCatchupDates(todayYmd: string) {
    if (todayYmd < OFFLINE_CATCHUP_FROM) return [];
    const [year, month, day] = OFFLINE_CATCHUP_FROM.split('-').map(Number);
    let cursor = new Date(Date.UTC(year, month - 1, day));
    const dates: { ymd: string; label: string }[] = [];
    while (true) {
        const ymd = cursor.toISOString().slice(0, 10);
        if (ymd > todayYmd) break;
        dates.push({
            ymd,
            label: cursor.toLocaleDateString('en-GH', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
            }),
        });
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return dates;
}

interface Product {
    id: string;
    name: string;
    price: number;
    quantity: number;
    category: string;
    image: string;
    sku: string;
    barcode: string | null;
    posCode: string;
    variants: ProductVariant[];
}

interface ProductVariant {
    id: string;
    name: string;
    option1: string | null;
    option2: string | null;
    sku: string | null;
    barcode: string | null;
    price: number;
    quantity: number;
    image_url: string | null;
}

interface CartItem extends Product {
    cartKey: string;
    productId: string;
    variantId?: string;
    variantName?: string;
    cartQuantity: number;
}

interface Customer {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
}

export default function POSPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [activeCategory, setActiveCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [scanFeedback, setScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [mobileCategoryIndex, setMobileCategoryIndex] = useState(0);
    const [variantPickerProduct, setVariantPickerProduct] = useState<Product | null>(null);

    // Checkout State
    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [amountTendered, setAmountTendered] = useState<string>('');
    const [processing, setProcessing] = useState(false);
    const [completedOrder, setCompletedOrder] = useState<any>(null);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [backdateSale, setBackdateSale] = useState(false);
    const [backdateYmd, setBackdateYmd] = useState(OFFLINE_CATCHUP_FROM);
    const catchupDates = useMemo(() => offlineCatchupDates(accraTodayYmd()), []);
    const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'doorstep'>('pickup');
    const [guestDetails, setGuestDetails] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        region: ''
    });

    const ghanaRegions = [
        'Greater Accra', 'Ashanti', 'Western', 'Central', 'Eastern',
        'Northern', 'Volta', 'Upper East', 'Upper West', 'Brong-Ahafo',
        'Ahafo', 'Bono', 'Bono East', 'North East', 'Savannah', 'Oti', 'Western North'
    ];

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (!categories.length) return;
        const currentIdx = categories.indexOf(activeCategory);
        setMobileCategoryIndex(currentIdx >= 0 ? currentIdx : 0);
    }, [categories, activeCategory]);

    const fetchData = async () => {
        try {
            setLoading(true);
            // Fetch Products
            const { data: prodData } = await supabase
                .from('products')
                .select(`
          id, name, price, quantity, sku, barcode, metadata,
          categories(name),
          product_images(url, position, variant_id),
          product_variants(id, name, option1, option2, sku, barcode, price, quantity, image_url)
        `)
                .order('name');

            if (prodData) {
                const formatted: Product[] = prodData.map((p: any) => {
                    const imgs = ((p.product_images || []) as { url: string; position?: number; variant_id?: string | null }[])
                        .slice()
                        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                    const firstVariantImageById = new Map<string, string>();
                    for (const img of imgs) {
                        if (img.variant_id && !firstVariantImageById.has(img.variant_id)) {
                            firstVariantImageById.set(img.variant_id, img.url);
                        }
                    }
                    const productLevelUrl =
                        imgs.find((i) => !i.variant_id)?.url || imgs[0]?.url || 'https://via.placeholder.com/150';

                    return {
                        id: p.id,
                        name: p.name,
                        price: p.price,
                        quantity: p.quantity,
                        category: p.categories?.name || 'Uncategorized',
                        image: productLevelUrl,
                        sku: p.sku,
                        barcode: p.barcode || null,
                        posCode: getPosCodeFromMetadata(p.metadata),
                        variants: (p.product_variants || []).map((v: any) => ({
                            id: v.id,
                            name: v.name || '',
                            option1: v.option1 || null,
                            option2: v.option2 || null,
                            sku: v.sku || null,
                            barcode: v.barcode || null,
                            price: Number(v.price ?? p.price ?? 0),
                            quantity: Number(v.quantity ?? 0),
                            image_url: firstVariantImageById.get(v.id) || v.image_url || null
                        }))
                    };
                });
                setProducts(formatted);

                // Extract Categories
                const cats = Array.from(new Set(formatted.map(p => p.category))).sort();
                setCategories(['All', ...cats]);
            }

            // Fetch Customers from customers table (not profiles)
            const { data: custData } = await supabase
                .from('customers')
                .select('id, full_name, email, phone')
                .order('full_name')
                .limit(200);

            if (custData) setCustomers(custData);

        } catch (error) {
            console.error('Error fetching POS data:', error);
        } finally {
            setLoading(false);
        }
    };

    const getVariantLabel = (variant: ProductVariant) => {
        const left = variant.option2?.trim();
        const right = variant.option1?.trim() || variant.name?.trim();
        if (left && right) return `${left} / ${right}`;
        return left || right || variant.name || 'Variant';
    };

    // Cart Functions
    const addToCart = (product: Product, variant?: ProductVariant) => {
        const cartKey = variant ? `${product.id}:${variant.id}` : product.id;
        const availableStock = variant ? variant.quantity : product.quantity;
        if (availableStock <= 0) return;

        setCart(prev => {
            const existing = prev.find(item => item.cartKey === cartKey);
            if (existing) {
                return prev.map(item =>
                    item.cartKey === cartKey
                        ? { ...item, cartQuantity: Math.min(item.cartQuantity + 1, availableStock) }
                        : item
                );
            }
            return [...prev, {
                ...product,
                cartKey,
                productId: product.id,
                variantId: variant?.id,
                variantName: variant ? getVariantLabel(variant) : undefined,
                price: variant?.price ?? product.price,
                quantity: availableStock,
                sku: variant?.sku || product.sku,
                barcode: variant?.barcode || product.barcode,
                image: variant?.image_url || product.image,
                cartQuantity: 1
            }];
        });
    };

    const removeFromCart = (cartKey: string) => {
        setCart(prev => prev.filter(item => item.cartKey !== cartKey));
    };

    const updateQuantity = (cartKey: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.cartKey === cartKey) {
                const newQty = item.cartQuantity + delta;
                if (newQty <= 0) return item;
                return { ...item, cartQuantity: Math.min(newQty, item.quantity) };
            }
            return item;
        }));
    };

    const emptyCart = () => setCart([]);

    const showPreviousCategory = () => {
        if (!categories.length) return;
        const nextIndex = (mobileCategoryIndex - 1 + categories.length) % categories.length;
        setMobileCategoryIndex(nextIndex);
        setActiveCategory(categories[nextIndex]);
    };

    const showNextCategory = () => {
        if (!categories.length) return;
        const nextIndex = (mobileCategoryIndex + 1) % categories.length;
        setMobileCategoryIndex(nextIndex);
        setActiveCategory(categories[nextIndex]);
    };

    const handleBarcodeScan = useCallback((barcode: string) => {
        const code = barcode.trim();
        const productWithMatchedVariant = products.find((p) =>
            p.variants.some((v) => v.barcode === code || v.sku === code)
        );

        if (productWithMatchedVariant) {
            const matchedVariant = productWithMatchedVariant.variants.find(
                (v) => v.barcode === code || v.sku === code
            );
            if (matchedVariant) {
                addToCart(productWithMatchedVariant, matchedVariant);
                setScanFeedback({
                    message: `Added: ${productWithMatchedVariant.name} (${getVariantLabel(matchedVariant)})`,
                    type: 'success'
                });
            }
            setTimeout(() => setScanFeedback(null), 3000);
            return;
        }

        const match = products.find(p =>
            p.barcode === code || p.sku === code || p.posCode === code
        );
        if (match) {
            if (match.variants.length > 0) {
                setVariantPickerProduct(match);
                setScanFeedback({ message: `Select a variant for: ${match.name}`, type: 'success' });
            } else {
                addToCart(match);
                setScanFeedback({ message: `Added: ${match.name}`, type: 'success' });
            }
        } else {
            setScanFeedback({ message: `No product found for: ${barcode}`, type: 'error' });
        }
        setTimeout(() => setScanFeedback(null), 3000);
    }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleProductClick = (product: Product) => {
        if (product.variants.length > 0) {
            setVariantPickerProduct(product);
            return;
        }
        addToCart(product);
    };

    // Computed
    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const q = searchQuery.toLowerCase();
            const matchesSearch = p.name.toLowerCase().includes(q) ||
                p.sku?.toLowerCase().includes(q) ||
                p.barcode?.includes(searchQuery) ||
                p.posCode?.includes(searchQuery);
            const matchesCat = activeCategory === 'All' || p.category === activeCategory;
            return matchesSearch && matchesCat;
        });
    }, [products, searchQuery, activeCategory]);

    // Filter customers by search
    const filteredCustomers = useMemo(() => {
        if (!customerSearch.trim()) return customers;
        const q = customerSearch.toLowerCase();
        return customers.filter(c =>
            c.full_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.phone?.includes(q)
        );
    }, [customers, customerSearch]);

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
    const tax = cartTotal * 0.0;
    const grandTotal = cartTotal + tax;
    const changeDue = amountTendered ? (parseFloat(amountTendered) - grandTotal) : 0;

    // Get the customer email and phone for the order
    const getOrderEmail = () => {
        if (selectedCustomer) return selectedCustomer.email;
        return guestDetails.email || 'pos-walkin@store.local';
    };

    /** Typed phone wins (guest field is shown for SMS even when a saved customer is selected). */
    const getOrderPhone = () => {
        const typed = guestDetails.phone?.trim() || '';
        if (typed) return typed;
        return (selectedCustomer?.phone?.trim() || '');
    };

    const getCustomerFullName = () => {
        if (selectedCustomer) return selectedCustomer.full_name || '';
        return `${guestDetails.firstName} ${guestDetails.lastName}`.trim();
    };

    // Validate before checkout
    const validateCheckout = (): string | null => {
        if (cart.length === 0) return 'Cart is empty';

        if (paymentMethod === 'momo') {
            const phone = getOrderPhone();
            if (!phone) return 'Phone number is required for Mobile Money payment';
        }

        if (paymentMethod === 'cash') {
            const tendered = parseFloat(amountTendered || '0');
            if (tendered < grandTotal) return 'Insufficient amount tendered';
        }

        if (backdateSale) {
            if (paymentMethod === 'momo') return 'Offline catch-up sales must be Cash or Card. They are recorded as already paid.';
            if (!catchupDates.some((day) => day.ymd === backdateYmd)) {
                return 'Pick a sale date between Saturday and today.';
            }
        }

        // Require address for doorstep delivery
        if (deliveryMethod === 'doorstep') {
            if (!guestDetails.address.trim()) return 'Delivery address is required';
            if (!guestDetails.city.trim()) return 'City is required for delivery';
            if (!guestDetails.region) return 'Region is required for delivery';
        }

        return null;
    };

    // Checkout Logic
    const handleCheckout = async () => {
        const validationError = validateCheckout();
        if (validationError) {
            setCheckoutError(validationError);
            return;
        }

        setProcessing(true);
        setCheckoutError(null);

        try {
            const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const customerName = getCustomerFullName();
            const customerEmail = getOrderEmail();
            const customerPhone = getOrderPhone();

            const isCashOrCard = paymentMethod === 'cash' || paymentMethod === 'card';
            const saleCreatedAt = backdateSale ? `${backdateYmd}T12:00:00.000Z` : null;

            // Build shipping/billing address
            const addressData = selectedCustomer ? {
                firstName: selectedCustomer.full_name?.split(' ')[0] || '',
                lastName: selectedCustomer.full_name?.split(' ').slice(1).join(' ') || '',
                email: selectedCustomer.email,
                phone: customerPhone,
                address: guestDetails.address,
                city: guestDetails.city,
                region: guestDetails.region,
                pos_sale: true
            } : {
                firstName: guestDetails.firstName,
                lastName: guestDetails.lastName,
                email: guestDetails.email,
                phone: guestDetails.phone,
                address: guestDetails.address,
                city: guestDetails.city,
                region: guestDetails.region,
                pos_sale: true
            };

            // 1. Create Order
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert([{
                    order_number: orderNumber,
                    user_id: null,
                    email: customerEmail,
                    phone: customerPhone,
                    status: isCashOrCard ? 'completed' : 'pending',
                    payment_status: isCashOrCard ? 'paid' : 'pending',
                    currency: 'GHS',
                    subtotal: cartTotal,
                    tax_total: tax,
                    shipping_total: 0,
                    discount_total: 0,
                    total: grandTotal,
                    shipping_method: deliveryMethod,
                    payment_method: paymentMethod === 'momo' ? 'moolre' : paymentMethod,
                    shipping_address: addressData,
                    billing_address: addressData,
                    ...(saleCreatedAt ? { created_at: saleCreatedAt } : {}),
                    metadata: {
                        pos_sale: true,
                        first_name: addressData.firstName,
                        last_name: addressData.lastName,
                        phone: customerPhone,
                        ...(saleCreatedAt ? { offline_catchup: true, sale_date: backdateYmd } : {}),
                    }
                }])
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Create Order Items (with product_name, unit_price, total_price)
            const orderItems = cart.map(item => ({
                order_id: order.id,
                product_id: item.productId,
                variant_id: item.variantId || null,
                product_name: item.name,
                variant_name: item.variantName || null,
                sku: item.sku || null,
                quantity: item.cartQuantity,
                unit_price: item.price,
                total_price: item.price * item.cartQuantity,
                metadata: { image: item.image, pos_sale: true }
            }));

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(orderItems);

            if (itemsError) throw itemsError;

            // For paid POS checkouts (cash/card), reduce inventory immediately
            // through the authenticated admin route.  The mark_order_paid RPC
            // is locked down (no public EXECUTE) so we can only reach it with
            // a staff access token.
            if (isCashOrCard) {
                const { data: { session } } = await supabase.auth.getSession();
                const res = await fetch('/api/admin/orders/mark-paid', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session?.access_token ?? ''}`,
                    },
                    body: JSON.stringify({
                        orderNumber,
                        reference: `pos-${paymentMethod}-${Date.now()}`,
                    }),
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body?.error || 'Stock update failed');
                }
            }

            // 3. Upsert Customer Record (email is required in customers table)
            const hasRealEmail = customerEmail && customerEmail !== 'pos-walkin@store.local';
            const guestHasIdentityDetails = !selectedCustomer && (
                !!guestDetails.firstName.trim() ||
                !!guestDetails.lastName.trim() ||
                !!guestDetails.email.trim()
            );
            const upsertEmail = hasRealEmail
                ? customerEmail
                : guestHasIdentityDetails && customerPhone
                    ? `${customerPhone.replace(/[^0-9]/g, '')}@pos.local`
                    : null;

            if (upsertEmail) {
                try {
                    await supabase.rpc('upsert_customer_from_order', {
                        p_email: upsertEmail,
                        p_phone: customerPhone || null,
                        p_full_name: customerName || null,
                        p_first_name: addressData.firstName || null,
                        p_last_name: addressData.lastName || null,
                        p_user_id: null,
                        p_address: addressData
                    });
                    // Refresh customer list silently
                    supabase.from('customers').select('id, full_name, email, phone').order('full_name').limit(200)
                        .then(({ data }) => { if (data) setCustomers(data); });
                } catch (custErr) {
                    console.error('Customer upsert error (non-fatal):', custErr);
                }
            }

            // 4. Cash/card already marked as paid above (stock already reduced).
            //    The RPC is idempotent via metadata.stock_reduced so this
            //    previous double-call is no longer needed.
            if (isCashOrCard) {
                setCart([]);

                // Receipt SMS for every POS sale when a customer phone is present
                let receiptSmsNote: string | null = null;
                if (customerPhone?.trim() && !saleCreatedAt) {
                    try {
                        const { data: { session: smsSession } } = await supabase.auth.getSession();
                        const smsRes = await fetch('/api/notifications', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${smsSession?.access_token ?? ''}`,
                            },
                            body: JSON.stringify({
                                type: 'pos_receipt_sms',
                                payload: { order_number: orderNumber }
                            })
                        });
                        const smsJson = await smsRes.json().catch(() => ({}));
                        if (!smsRes.ok) {
                            console.error('[POS] Receipt SMS failed:', smsRes.status, smsJson);
                            receiptSmsNote =
                                (smsJson as { error?: string }).error ||
                                `Receipt SMS failed (${smsRes.status}). Check SMS settings or resend from Admin → Orders.`;
                        }
                    } catch (err) {
                        console.error('[POS] Receipt SMS error:', err);
                        receiptSmsNote = 'Could not send receipt SMS (network error).';
                    }
                }

                setCompletedOrder({
                    id: order.id,
                    orderNumber,
                    total: grandTotal,
                    items: cart,
                    receiptSmsWarning: receiptSmsNote || undefined
                });

                // Send notification
                if (!saleCreatedAt && customerEmail && customerEmail !== 'pos-walkin@store.local') {
                    const { data: { session } } = await supabase.auth.getSession();
                    fetch('/api/notifications', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(session?.access_token && { 'Authorization': `Bearer ${session.access_token}` })
                        },
                        body: JSON.stringify({
                            type: 'order_created',
                            payload: {
                                ...order,
                                order_number: orderNumber,
                                email: customerEmail,
                                shipping_address: addressData
                            }
                        })
                    }).catch(err => console.error('POS Notification error:', err));
                }
            }

            // 5. If Momo — initiate Hubtel payment
            if (paymentMethod === 'momo') {
                const paymentRes = await fetch('/api/payment/hubtel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId: orderNumber,
                        amount: grandTotal,
                        customerEmail: customerEmail
                    })
                });

                const paymentResult = await paymentRes.json();

                if (!paymentResult.success) {
                    throw new Error(paymentResult.message || 'Failed to initiate Mobile Money payment');
                }

                // Show completed with payment link
                setCompletedOrder({
                    id: order.id,
                    orderNumber,
                    total: grandTotal,
                    items: cart,
                    paymentUrl: paymentResult.url,
                    paymentPending: true
                });
                setCart([]);
            }

        } catch (error: any) {
            console.error('Checkout failed:', error);
            setCheckoutError(error.message || 'Checkout failed. Please try again.');
        } finally {
            setProcessing(false);
        }
    };

    const resetCheckout = () => {
        setShowCheckoutModal(false);
        setCompletedOrder(null);
        setAmountTendered('');
        setSelectedCustomer(null);
        setCustomerSearch('');
        setCheckoutError(null);
        setPaymentMethod('cash');
        setDeliveryMethod('pickup');
        setGuestDetails({
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            address: '',
            city: '',
            region: ''
        });
    };

    return (
        <div className="flex flex-col lg:flex-row h-[calc(100vh-90px)] -m-4 lg:-m-6 overflow-hidden bg-gray-100 relative">

            {/* LEFT: Product Grid */}
            <div className={`flex-1 flex flex-col h-full min-w-0 ${isMobileCartOpen ? 'hidden lg:flex' : 'flex'}`}>
                {/* Header / Search */}
                <div className="bg-white p-4 border-b border-gray-200 flex flex-col gap-3 shrink-0">
                    <div className="relative w-full max-w-lg flex gap-2">
                        <div className="relative flex-1">
                            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            <input
                                type="text"
                                placeholder="Search by name, SKU, barcode, or POS code..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key !== 'Enter') return;
                                    const code = searchQuery.trim();
                                    if (!code) return;

                                    const productWithMatchedVariant = products.find((p) =>
                                        p.variants.some((v) => v.barcode === code || v.sku === code)
                                    );
                                    if (productWithMatchedVariant) {
                                        const matchedVariant = productWithMatchedVariant.variants.find(
                                            (v) => v.barcode === code || v.sku === code
                                        );
                                        if (matchedVariant) {
                                            addToCart(productWithMatchedVariant, matchedVariant);
                                            setScanFeedback({
                                                message: `Added: ${productWithMatchedVariant.name} (${getVariantLabel(matchedVariant)})`,
                                                type: 'success'
                                            });
                                        }
                                        setSearchQuery('');
                                        setTimeout(() => setScanFeedback(null), 2500);
                                        return;
                                    }

                                    const exactMatch = products.find(p =>
                                        p.posCode === code || p.barcode === code || p.sku === code
                                    );
                                    if (exactMatch) {
                                        if (exactMatch.variants.length > 0) {
                                            setVariantPickerProduct(exactMatch);
                                            setScanFeedback({ message: `Select a variant for: ${exactMatch.name}`, type: 'success' });
                                        } else {
                                            addToCart(exactMatch);
                                            setScanFeedback({ message: `Added: ${exactMatch.name}`, type: 'success' });
                                        }
                                        setSearchQuery('');
                                        setTimeout(() => setScanFeedback(null), 2500);
                                    }
                                }}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                                autoFocus
                            />
                            <p className="hidden sm:block mt-1 text-xs text-gray-500">
                                Tip: Type barcode, SKU, or POS code then press Enter.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowScanner(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold text-sm transition-colors whitespace-nowrap"
                            title="Scan barcode"
                        >
                            <i className="ri-barcode-line text-lg"></i>
                            <span className="hidden sm:inline">Scan</span>
                        </button>
                    </div>

                    <div className="flex md:hidden items-center gap-2">
                        <button
                            onClick={showPreviousCategory}
                            className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                            title="Previous category"
                        >
                            <i className="ri-arrow-left-s-line text-lg"></i>
                        </button>
                        <button
                            onClick={() => setActiveCategory(categories[mobileCategoryIndex] || 'All')}
                            className="flex-1 px-4 py-2 rounded-full text-sm font-semibold bg-blue-700 text-white shadow-md text-center truncate"
                            title={categories[mobileCategoryIndex] || 'All'}
                        >
                            {categories[mobileCategoryIndex] || 'All'}
                        </button>
                        <button
                            onClick={showNextCategory}
                            className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                            title="Next category"
                        >
                            <i className="ri-arrow-right-s-line text-lg"></i>
                        </button>
                    </div>

                    <div className="hidden md:flex items-center space-x-2 overflow-x-auto no-scrollbar">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${activeCategory === cat
                                    ? 'bg-blue-700 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Grid Area */}
                <div className="flex-1 overflow-y-auto p-4 content-start">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-gray-500">Loading products...</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <i className="ri-inbox-line text-4xl mb-2"></i>
                            <p>No products found</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-20 lg:pb-4">
                            {filteredProducts.map(product => (
                                <div
                                    key={product.id}
                                    onClick={() => handleProductClick(product)}
                                    className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden border border-gray-100 group flex flex-col h-full"
                                >
                                    <div className="aspect-square relative bg-gray-50 shrink-0">
                                        <img
                                            src={product.image}
                                            alt={product.name}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        />
                                        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm">
                                            Qty: {product.quantity}
                                        </div>
                                        {product.variants.length > 0 && (
                                            <div className="absolute top-2 left-2 bg-blue-700/90 text-white text-[11px] px-2 py-1 rounded-full backdrop-blur-sm">
                                                {product.variants.length} variants
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-3 flex flex-col flex-1">
                                        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-auto">{product.name}</h3>
                                        <div className="flex items-center justify-between mt-2 pt-2">
                                            <span className="text-blue-700 font-bold">GH₵{product.price.toFixed(2)}</span>
                                            <button className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center group-hover:bg-blue-700 group-hover:text-white transition-colors">
                                                <i className="ri-add-line"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Mobile Bottom Cart Bar */}
                {cart.length > 0 && (
                    <div className="lg:hidden p-4 border-t border-gray-200 bg-white fixed bottom-0 left-0 right-0 z-30 shadow-2xl safe-area-bottom">
                        <button
                            onClick={() => setIsMobileCartOpen(true)}
                            className="w-full py-3 bg-blue-700 text-white rounded-xl font-bold flex justify-between px-6 shadow-lg active:scale-95 transition-transform"
                        >
                            <span className="flex items-center text-sm">
                                <span className="bg-white/20 px-2 py-0.5 rounded mr-2">{cart.reduce((a, b) => a + b.cartQuantity, 0)}</span>
                                Items
                            </span>
                            <span>View Cart</span>
                            <span>GH₵{grandTotal.toFixed(2)}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* RIGHT: Cart Panel */}
            <div className={`w-full lg:w-96 bg-white border-l border-gray-200 flex flex-col h-full shadow-lg z-20 absolute inset-0 lg:relative ${isMobileCartOpen ? 'flex' : 'hidden lg:flex'}`}>
                <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50 shrink-0">
                    <div className="flex items-center">
                        <button onClick={() => setIsMobileCartOpen(false)} className="lg:hidden mr-3 p-2 -ml-2 text-gray-600 hover:bg-gray-200 rounded-full transition-colors">
                            <i className="ri-arrow-left-line text-xl"></i>
                        </button>
                        <h2 className="text-lg font-bold text-gray-900 flex items-center">
                            <i className="ri-shopping-basket-2-line mr-2"></i>
                            Current Order
                        </h2>
                    </div>
                    <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded-full">
                        {cart.reduce((a, b) => a + b.cartQuantity, 0)} Items
                    </span>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <i className="ri-shopping-cart-line text-5xl opacity-20"></i>
                            <p className="text-sm">Cart is empty</p>
                            <button onClick={() => setIsMobileCartOpen(false)} className="lg:hidden text-blue-600 font-medium hover:underline">
                                Start Adding Products
                            </button>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.cartKey} className="flex gap-3 p-3 bg-gray-50 rounded-lg group hover:bg-gray-100 transition-colors">
                                <div className="w-16 h-16 bg-white rounded-md overflow-hidden flex-shrink-0 border border-gray-200">
                                    <img src={item.image} className="w-full h-full object-cover" alt="" />
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div className="flex justify-between items-start">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 line-clamp-1">{item.name}</p>
                                            {item.variantName && (
                                                <p className="text-xs text-gray-500 mt-0.5">{item.variantName}</p>
                                            )}
                                        </div>
                                        <button onClick={() => removeFromCart(item.cartKey)} className="text-gray-400 hover:text-red-500">
                                            <i className="ri-delete-bin-line"></i>
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center space-x-2 bg-white rounded border border-gray-200 px-1 py-0.5">
                                            <button onClick={() => updateQuantity(item.cartKey, -1)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded">
                                                <i className="ri-subtract-line text-xs"></i>
                                            </button>
                                            <span className="text-sm font-semibold w-6 text-center">{item.cartQuantity}</span>
                                            <button onClick={() => updateQuantity(item.cartKey, 1)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded">
                                                <i className="ri-add-line text-xs"></i>
                                            </button>
                                        </div>
                                        <p className="text-sm font-bold text-gray-900">GH₵{(item.price * item.cartQuantity).toFixed(2)}</p>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Cart Footer */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-4 shrink-0 safe-area-bottom">
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between text-gray-600">
                            <span>Subtotal</span>
                            <span>GH₵{cartTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                            <span>Tax (0%)</span>
                            <span>GH₵0.00</span>
                        </div>
                        <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                            <span>Total</span>
                            <span>GH₵{grandTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={emptyCart}
                            disabled={cart.length === 0}
                            className="px-4 py-3 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => { setShowCheckoutModal(true); setCheckoutError(null); }}
                            disabled={cart.length === 0}
                            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Charge GH₵{grandTotal.toFixed(2)}
                        </button>
                    </div>
                </div>
            </div>

            {/* Barcode Scanner Modal */}
            {showScanner && (
                <BarcodeScanner
                    onScan={handleBarcodeScan}
                    onClose={() => setShowScanner(false)}
                />
            )}

            {/* Scan Feedback Toast */}
            {scanFeedback && (
                <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-lg font-semibold text-sm flex items-center gap-2 animate-[slideDown_0.3s_ease-out] ${
                    scanFeedback.type === 'success'
                        ? 'bg-green-600 text-white'
                        : 'bg-red-600 text-white'
                }`}>
                    <i className={scanFeedback.type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}></i>
                    {scanFeedback.message}
                </div>
            )}

            {/* Variant Picker Modal */}
            {variantPickerProduct && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Select Variant</h3>
                                <p className="text-sm text-gray-500">{variantPickerProduct.name}</p>
                            </div>
                            <button
                                onClick={() => setVariantPickerProduct(null)}
                                className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500"
                            >
                                <i className="ri-close-line text-lg"></i>
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto space-y-2">
                            {variantPickerProduct.variants.length === 0 ? (
                                <div className="text-sm text-gray-500 p-4">No variants available.</div>
                            ) : (
                                variantPickerProduct.variants.map((variant) => {
                                    const stock = variant.quantity || 0;
                                    const disabled = stock <= 0;
                                    return (
                                        <button
                                            key={variant.id}
                                            onClick={() => {
                                                addToCart(variantPickerProduct, variant);
                                                setVariantPickerProduct(null);
                                            }}
                                            disabled={disabled}
                                            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                                                disabled
                                                    ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                                                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                                            }`}
                                        >
                                            <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center">
                                                {(variant.image_url || variantPickerProduct.image) ? (
                                                    <img
                                                        src={variant.image_url || variantPickerProduct.image}
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <i className="ri-image-line text-2xl text-gray-300" aria-hidden />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold text-gray-900">{getVariantLabel(variant)}</p>
                                                <p className="text-xs text-gray-500">
                                                    {variant.sku ? `SKU: ${variant.sku} • ` : ''}Stock: {stock}
                                                </p>
                                            </div>
                                            <span className="text-sm font-bold text-blue-700 shrink-0">GH₵{variant.price.toFixed(2)}</span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Checkout Modal */}
            {showCheckoutModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {completedOrder ? (
                            // SUCCESS STATE
                            <div className="p-8 text-center flex flex-col items-center justify-center space-y-6 overflow-y-auto">
                                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${completedOrder.paymentPending ? 'bg-amber-100' : 'bg-blue-100'}`}>
                                    <i className={`text-5xl ${completedOrder.paymentPending ? 'ri-time-line text-amber-600' : 'ri-checkbox-circle-fill text-blue-600'}`}></i>
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900">
                                        {completedOrder.paymentPending ? 'Payment Link Generated!' : 'Payment Successful!'}
                                    </h2>
                                    <p className="text-gray-500 mt-1">Order #{completedOrder.orderNumber}</p>
                                    {backdateSale && (
                                        <p className="mt-2 text-sm font-medium text-amber-800">
                                            Dated {catchupDates.find((day) => day.ymd === backdateYmd)?.label || backdateYmd}. No receipt was sent.
                                        </p>
                                    )}

                                    {!completedOrder.paymentPending && paymentMethod === 'cash' && changeDue > 0 && (
                                        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <p className="text-sm text-blue-700">Change Due</p>
                                            <p className="text-2xl font-bold text-blue-800">GH₵{changeDue.toFixed(2)}</p>
                                        </div>
                                    )}

                                    {completedOrder.receiptSmsWarning && (
                                        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-left text-sm text-amber-900">
                                            <p className="font-semibold flex items-center gap-2">
                                                <i className="ri-error-warning-line" />
                                                Receipt SMS not sent
                                            </p>
                                            <p className="mt-1">{completedOrder.receiptSmsWarning}</p>
                                        </div>
                                    )}

                                    {completedOrder.paymentPending && completedOrder.paymentUrl && (
                                        <div className="mt-4 space-y-3">
                                            <p className="text-sm text-gray-600">
                                                Customer can pay using this link:
                                            </p>
                                            <a
                                                href={completedOrder.paymentUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center px-6 py-3 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 transition-colors"
                                            >
                                                <i className="ri-external-link-line mr-2"></i>
                                                Open Payment Page
                                            </a>
                                            <div className="mt-2">
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(completedOrder.paymentUrl);
                                                        alert('Payment link copied!');
                                                    }}
                                                    className="text-sm text-blue-700 hover:text-blue-800 font-medium underline"
                                                >
                                                    <i className="ri-file-copy-line mr-1"></i>
                                                    Copy Link
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4 w-full mt-4">
                                    <button onClick={() => window.print()} className="py-3 px-4 border border-gray-300 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                                        <i className="ri-printer-line mr-2"></i>
                                        Print Receipt
                                    </button>
                                    <button onClick={resetCheckout} className="py-3 px-4 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors">
                                        New Order
                                    </button>
                                </div>
                            </div>
                        ) : (
                            // CHECKOUT FORM
                            <>
                                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                                    <h3 className="text-xl font-bold text-gray-900">Finalize Payment</h3>
                                    <button onClick={() => setShowCheckoutModal(false)} className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500">
                                        <i className="ri-close-line text-xl"></i>
                                    </button>
                                </div>

                                <div className="p-6 space-y-6 overflow-y-auto">
                                    {/* Error Display */}
                                    {checkoutError && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
                                            <i className="ri-error-warning-line text-red-500 mt-0.5"></i>
                                            <p className="text-sm text-red-700">{checkoutError}</p>
                                        </div>
                                    )}

                                    {/* Total Display */}
                                    <div className="text-center py-4 bg-blue-50 rounded-xl border border-blue-100">
                                        <p className="text-sm text-blue-800 uppercase tracking-wide font-semibold">Amount to Pay</p>
                                        <p className="text-4xl font-extrabold text-blue-700 mt-1">GH₵{grandTotal.toFixed(2)}</p>
                                    </div>

                                    {catchupDates.length > 0 && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                            <label className="flex items-start gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={backdateSale}
                                                    onChange={(e) => setBackdateSale(e.target.checked)}
                                                    className="mt-1 h-4 w-4 rounded border-amber-400 text-amber-700 focus:ring-amber-500"
                                                />
                                                <span>
                                                    <span className="block text-sm font-semibold text-amber-950">Record an offline sale</span>
                                                    <span className="mt-1 block text-xs leading-relaxed text-amber-800">
                                                        Temporary. Puts this POS sale on a day the website was down, from Saturday through today. No receipt SMS or email is sent. Stock is still reduced.
                                                    </span>
                                                </span>
                                            </label>
                                            {backdateSale && (
                                                <label className="mt-3 block">
                                                    <span className="mb-1 block text-xs font-semibold text-amber-900">Sale date</span>
                                                    <select
                                                        value={backdateYmd}
                                                        onChange={(e) => setBackdateYmd(e.target.value)}
                                                        className="w-full rounded-lg border border-amber-300 bg-white p-3 text-sm font-medium text-gray-900 outline-none focus:ring-2 focus:ring-amber-500"
                                                    >
                                                        {catchupDates.map((day) => (
                                                            <option key={day.ymd} value={day.ymd}>{day.label}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                            )}
                                        </div>
                                    )}

                                    {/* Customer Select */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Customer</label>

                                        {/* Customer search input */}
                                        <div className="relative mb-2">
                                            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                                            <input
                                                type="text"
                                                placeholder="Search customers by name, email, or phone..."
                                                value={customerSearch}
                                                onChange={(e) => setCustomerSearch(e.target.value)}
                                                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                            />
                                        </div>

                                        <select
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mb-2"
                                            onChange={(e) => {
                                                setSelectedCustomer(customers.find(c => c.id === e.target.value) || null);
                                            }}
                                            value={selectedCustomer?.id || ''}
                                        >
                                            <option value="">Walk-in Customer / New Guest</option>
                                            {filteredCustomers.map(c => (
                                                <option key={c.id} value={c.id}>
                                                    {c.full_name || 'No Name'} — {c.phone || c.email}
                                                </option>
                                            ))}
                                        </select>

                                        {selectedCustomer && (
                                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2 flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-gray-900 text-sm">{selectedCustomer.full_name}</p>
                                                    <p className="text-xs text-gray-600">{selectedCustomer.email} {selectedCustomer.phone && `| ${selectedCustomer.phone}`}</p>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedCustomer(null)}
                                                    className="text-gray-400 hover:text-red-500 text-sm"
                                                >
                                                    <i className="ri-close-line"></i>
                                                </button>
                                            </div>
                                        )}

                                        <div className="mt-2">
                                            <label className="block text-xs font-semibold text-gray-600 mb-1">
                                                Phone for SMS receipt
                                                {paymentMethod === 'momo' && !getOrderPhone() && (
                                                    <span className="text-amber-600 ml-1">(required for MoMo)</span>
                                                )}
                                            </label>
                                            <input
                                                type="tel"
                                                placeholder={selectedCustomer ? 'Override or add number for this sale…' : '+233…'}
                                                value={guestDetails.phone}
                                                onChange={e => setGuestDetails({ ...guestDetails, phone: e.target.value })}
                                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm ${
                                                    paymentMethod === 'momo' && !getOrderPhone()
                                                        ? 'border-amber-400 bg-amber-50'
                                                        : 'border-gray-300'
                                                }`}
                                            />
                                            {selectedCustomer && (
                                                <p className="text-xs text-gray-500 mt-1">
                                                    If the profile has no phone, enter it here. What you type is used for this order and the receipt text.
                                                </p>
                                            )}
                                        </div>

                                        {!selectedCustomer && (
                                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mt-2 space-y-3">
                                                <h4 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2 mb-2">
                                                    New Customer Details
                                                    <span className="text-xs font-normal text-gray-500 ml-2">(optional)</span>
                                                </h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        type="text"
                                                        placeholder="First Name"
                                                        value={guestDetails.firstName}
                                                        onChange={e => setGuestDetails({ ...guestDetails, firstName: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Last Name"
                                                        value={guestDetails.lastName}
                                                        onChange={e => setGuestDetails({ ...guestDetails, lastName: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    />
                                                </div>
                                                <input
                                                    type="email"
                                                    placeholder="Email"
                                                    value={guestDetails.email}
                                                    onChange={e => setGuestDetails({ ...guestDetails, email: e.target.value })}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Delivery Method */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Delivery Method</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => setDeliveryMethod('pickup')}
                                                className={`p-3 rounded-lg border transition-all flex items-center space-x-3 ${deliveryMethod === 'pickup'
                                                    ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                                                    : 'border-gray-200 hover:border-gray-300'
                                                    }`}
                                            >
                                                <i className={`ri-store-2-line text-xl ${deliveryMethod === 'pickup' ? 'text-blue-700' : 'text-gray-400'}`}></i>
                                                <div className="text-left">
                                                    <p className={`text-sm font-semibold ${deliveryMethod === 'pickup' ? 'text-blue-800' : 'text-gray-700'}`}>Store Pickup</p>
                                                    <p className="text-xs text-gray-500">Customer picks up</p>
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => setDeliveryMethod('doorstep')}
                                                className={`p-3 rounded-lg border transition-all flex items-center space-x-3 ${deliveryMethod === 'doorstep'
                                                    ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                                                    : 'border-gray-200 hover:border-gray-300'
                                                    }`}
                                            >
                                                <i className={`ri-truck-line text-xl ${deliveryMethod === 'doorstep' ? 'text-blue-700' : 'text-gray-400'}`}></i>
                                                <div className="text-left">
                                                    <p className={`text-sm font-semibold ${deliveryMethod === 'doorstep' ? 'text-blue-800' : 'text-gray-700'}`}>Doorstep Delivery</p>
                                                    <p className="text-xs text-gray-500">Deliver to address</p>
                                                </div>
                                            </button>
                                        </div>

                                        {/* Delivery Address (shown for doorstep delivery) */}
                                        {deliveryMethod === 'doorstep' && (
                                            <div className="mt-3 bg-blue-50 p-4 rounded-lg border border-blue-200 space-y-3">
                                                <h4 className="text-sm font-bold text-gray-900 flex items-center">
                                                    <i className="ri-map-pin-line mr-2 text-blue-600"></i>
                                                    Delivery Address
                                                </h4>
                                                <input
                                                    type="text"
                                                    placeholder="Street Address / Location *"
                                                    value={guestDetails.address}
                                                    onChange={e => setGuestDetails({ ...guestDetails, address: e.target.value })}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        type="text"
                                                        placeholder="City / Town *"
                                                        value={guestDetails.city}
                                                        onChange={e => setGuestDetails({ ...guestDetails, city: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    />
                                                    <select
                                                        value={guestDetails.region}
                                                        onChange={e => setGuestDetails({ ...guestDetails, region: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    >
                                                        <option value="">Select Region *</option>
                                                        {ghanaRegions.map(r => (
                                                            <option key={r} value={r}>{r}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Payment Method */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                                        <div className="grid grid-cols-3 gap-3">
                                            {[
                                                { key: 'cash', label: 'Cash', icon: 'ri-money-cny-circle-line' },
                                                { key: 'card', label: 'Card', icon: 'ri-bank-card-line' },
                                                { key: 'momo', label: 'MoMo', icon: 'ri-smartphone-line' }
                                            ].map(method => (
                                                <button
                                                    key={method.key}
                                                    onClick={() => setPaymentMethod(method.key)}
                                                    className={`py-3 rounded-lg font-medium border transition-all flex flex-col items-center space-y-1 ${paymentMethod === method.key
                                                        ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600'
                                                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                                        }`}
                                                >
                                                    <i className={`${method.icon} text-xl`}></i>
                                                    <span className="text-sm">{method.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Cash Tendered */}
                                    {paymentMethod === 'cash' && (
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Amount Tendered</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">GH₵</span>
                                                <input
                                                    type="number"
                                                    value={amountTendered}
                                                    onChange={(e) => setAmountTendered(e.target.value)}
                                                    className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-lg"
                                                    placeholder="0.00"
                                                    autoFocus
                                                />
                                            </div>
                                            {changeDue > 0 && (
                                                <p className="text-right text-blue-600 font-bold mt-2">Change: GH₵{changeDue.toFixed(2)}</p>
                                            )}
                                            {changeDue < 0 && amountTendered && (
                                                <p className="text-right text-red-500 font-medium mt-2">Insufficient amount</p>
                                            )}
                                            {/* Quick amount buttons */}
                                            <div className="flex flex-wrap gap-2 mt-3">
                                                {[grandTotal, Math.ceil(grandTotal / 10) * 10, Math.ceil(grandTotal / 50) * 50, Math.ceil(grandTotal / 100) * 100].filter((v, i, a) => a.indexOf(v) === i).map(amount => (
                                                    <button
                                                        key={amount}
                                                        onClick={() => setAmountTendered(amount.toString())}
                                                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                                                    >
                                                        GH₵{amount.toFixed(2)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* MoMo info */}
                                    {paymentMethod === 'momo' && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                            <div className="flex items-start space-x-2">
                                                <i className="ri-information-line text-amber-600 mt-0.5"></i>
                                                <div className="text-sm text-amber-800">
                                                    <p className="font-semibold">Mobile Money Payment</p>
                                                    <p className="mt-1">A Moolre payment link will be generated. The customer can pay via their phone, or you can open the link on your device.</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Card info */}
                                    {paymentMethod === 'card' && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <div className="flex items-start space-x-2">
                                                <i className="ri-bank-card-line text-blue-600 mt-0.5"></i>
                                                <div className="text-sm text-blue-800">
                                                    <p className="font-semibold">Card Payment</p>
                                                    <p className="mt-1">Process the card payment on your POS terminal, then tap &quot;Complete Payment&quot; to confirm.</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="p-6 border-t border-gray-100 bg-gray-50 shrink-0">
                                    <button
                                        onClick={handleCheckout}
                                        disabled={processing}
                                        className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2"
                                    >
                                        {processing ? (
                                            <>
                                                <i className="ri-loader-4-line animate-spin"></i>
                                                <span>Processing...</span>
                                            </>
                                        ) : paymentMethod === 'momo' ? (
                                            <>
                                                <i className="ri-smartphone-line"></i>
                                                <span>Generate Payment Link</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ri-secure-payment-line"></i>
                                                <span>Complete Payment</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
