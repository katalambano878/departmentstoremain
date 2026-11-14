'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';

type ProductRow = {
    id: string;
    name: string;
    slug: string;
    price: number;
    compare_at_price: number | null;
    on_sale: boolean;
    status: string;
    category: string;
    image: string;
    variantsCount: number;
    pausedSalePrice: number | null;
};

type VariantRow = {
    id: string;
    label: string;
    regular: number;
    sale: number | null;
};

const PAGE_SIZE = 24;

const fmt = (v: number) => `GH\u20B5${Number(v || 0).toFixed(2)}`;

/**
 * Regular (pre-sale) price — mirrors the SQL the server uses.
 * When the campaign is paused, the discounted price is stashed in
 * metadata.paused_sale_price and `price` already holds the regular price.
 */
function regularPrice(p: ProductRow): number {
    if (p.pausedSalePrice != null) return p.price;
    if (p.on_sale && p.compare_at_price != null && p.compare_at_price > p.price) {
        return p.compare_at_price;
    }
    return p.price;
}

/** The effective sale price (active discount, or the paused/stashed one). */
function salePrice(p: ProductRow): number | null {
    if (p.pausedSalePrice != null) return p.pausedSalePrice;
    if (p.on_sale && p.compare_at_price != null && p.compare_at_price > p.price) {
        return p.price;
    }
    return null;
}

/** On sale and showing its discount right now (not paused). */
function isLive(p: ProductRow): boolean {
    return p.on_sale && p.pausedSalePrice == null;
}

/** On sale, but switched off: the shop shows the regular price. */
function isPaused(p: ProductRow): boolean {
    return p.on_sale && p.pausedSalePrice != null;
}

function discountPct(p: ProductRow): number {
    const reg = regularPrice(p);
    const sale = salePrice(p);
    if (sale == null || reg <= 0 || sale >= reg) return 0;
    return Math.round((1 - sale / reg) * 100);
}

export default function AdminSalesPage() {
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState<string[]>([]);

    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [saleFilter, setSaleFilter] = useState<'all' | 'on' | 'live' | 'paused' | 'off'>('all');
    const [page, setPage] = useState(1);

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkPercent, setBulkPercent] = useState('');
    const [bulkFixed, setBulkFixed] = useState('');
    const [rowPrice, setRowPrice] = useState<Record<string, string>>({});
    // Per-variant price editor (expandable row for variant products)
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [variantData, setVariantData] = useState<Record<string, VariantRow[]>>({});
    const [variantLoading, setVariantLoading] = useState(false);
    const [variantInputs, setVariantInputs] = useState<Record<string, string>>({});
    const [variantFillAll, setVariantFillAll] = useState('');
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
    const [salesActive, setSalesActive] = useState(true);
    const [togglingActive, setTogglingActive] = useState(false);
    // A row's switch while its request is running: shows the new position at once.
    const [switching, setSwitching] = useState<{ id: string; to: boolean } | null>(null);

    const fetchSalesActive = useCallback(async () => {
        const { data } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'sales_active')
            .maybeSingle();
        // Missing row defaults to ON. jsonb boolean comes back as a real boolean.
        if (!data) setSalesActive(true);
        else setSalesActive(data.value === true || data.value === 'true');
    }, []);

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchAllPaged<any>(() =>
                supabase
                    .from('products')
                    .select(`
                        id, name, slug, price, compare_at_price, on_sale, status, metadata,
                        categories(name),
                        product_variants(count),
                        product_images(url, position)
                    `)
                    .order('created_at', { ascending: false }),
            );
            const rows: ProductRow[] = (data || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                slug: p.slug,
                price: Number(p.price) || 0,
                compare_at_price: p.compare_at_price != null ? Number(p.compare_at_price) : null,
                on_sale: !!p.on_sale,
                status: p.status,
                category: p.categories?.name || 'Uncategorized',
                image:
                    p.product_images?.find((i: any) => i.position === 0)?.url ||
                    p.product_images?.[0]?.url ||
                    'https://via.placeholder.com/80?text=No+Image',
                variantsCount: p.product_variants?.[0]?.count || 0,
                pausedSalePrice:
                    p.metadata?.paused_sale_price != null ? Number(p.metadata.paused_sale_price) : null,
            }));
            setProducts(rows);
            setCategories(Array.from(new Set(rows.map((r) => r.category))).sort());
        } catch (err) {
            console.error('[admin/sales] load error:', err);
            setToast({ text: 'Failed to load products', ok: false });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSalesActive();
        fetchProducts();
    }, [fetchSalesActive, fetchProducts]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return products.filter((p) => {
            if (term && !p.name.toLowerCase().includes(term)) return false;
            if (categoryFilter && p.category !== categoryFilter) return false;
            if (saleFilter === 'on' && !p.on_sale) return false;
            if (saleFilter === 'live' && !isLive(p)) return false;
            if (saleFilter === 'paused' && !isPaused(p)) return false;
            if (saleFilter === 'off' && p.on_sale) return false;
            return true;
        });
    }, [products, search, categoryFilter, saleFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    useEffect(() => {
        setPage(1);
    }, [search, categoryFilter, saleFilter]);

    const onSaleCount = useMemo(() => products.filter((p) => p.on_sale).length, [products]);
    const liveCount = useMemo(() => products.filter(isLive).length, [products]);
    const pausedCount = onSaleCount - liveCount;

    const allFilteredSelected =
        filtered.length > 0 && filtered.every((p) => selected.has(p.id));

    const toggleSelectAllFiltered = () => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (allFilteredSelected) {
                filtered.forEach((p) => next.delete(p.id));
            } else {
                filtered.forEach((p) => next.add(p.id));
            }
            return next;
        });
    };

    const toggleOne = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const callApi = async (payload: Record<string, unknown>) => {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/admin/sales', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session?.access_token ?? ''}`,
            },
            body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
        return json;
    };

    const toggleSalesActive = async () => {
        const next = !salesActive;
        const question = next
            ? 'Turn ON all sales? Every paused sale goes live, including products you switched off one by one.'
            : 'Turn OFF all sales? Every product goes back to its normal price, including products you switched on one by one. Each sale price is kept and returns when you switch it on again.';
        if (!confirm(question)) return;
        setTogglingActive(true);
        try {
            await callApi({ action: 'set_active', active: next });
            setSalesActive(next);
            setVariantData({});
            setExpandedId(null);
            await fetchProducts();
            setToast({
                text: next
                    ? 'All sales are ON. Every sale price is live.'
                    : 'All sales are OFF. Every product is at its normal price.',
                ok: true,
            });
        } catch (err: any) {
            setToast({ text: err?.message || 'Failed to toggle sales', ok: false });
        } finally {
            setTogglingActive(false);
        }
    };

    /** Put the server's updated rows into the table. */
    const mergeRows = (rows: any[] | undefined) => {
        if (!rows?.length) return;
        const byId = new Map(rows.map((r) => [r.id, r]));
        setProducts((prev) =>
            prev.map((p) => {
                const r = byId.get(p.id);
                if (!r) return p;
                return {
                    ...p,
                    price: Number(r.price) || 0,
                    compare_at_price: r.compare_at_price != null ? Number(r.compare_at_price) : null,
                    on_sale: !!r.on_sale,
                    pausedSalePrice:
                        r.metadata?.paused_sale_price != null ? Number(r.metadata.paused_sale_price) : null,
                };
            }),
        );
    };

    /** Switch one product's sale on or off. */
    const toggleProductSale = async (p: ProductRow) => {
        if (switching) return;
        const next = !isLive(p);
        setSwitching({ id: p.id, to: next });
        try {
            const json = await callApi({ action: 'set_product_active', active: next, productIds: [p.id] });
            mergeRows(json?.products);
            setVariantData((prev) => {
                const copy = { ...prev };
                delete copy[p.id];
                return copy;
            });
            if (expandedId === p.id) setExpandedId(null);
            setToast({
                text: next ? `${p.name}: sale is on.` : `${p.name}: sale is off. It shows the normal price.`,
                ok: true,
            });
        } catch (err: any) {
            setToast({ text: err?.message || 'Could not switch the sale', ok: false });
        } finally {
            setSwitching(null);
        }
    };

    /** Switch the selected products' sales on or off. */
    const switchSelected = async (active: boolean) => {
        const ids = Array.from(selected);
        if (ids.length === 0) {
            setToast({ text: 'Select at least one product first', ok: false });
            return;
        }
        setBusy(true);
        try {
            const json = await callApi({ action: 'set_product_active', active, productIds: ids });
            mergeRows(json?.products);
            const changed = active
                ? json?.result?.products_resumed ?? 0
                : json?.result?.products_paused ?? 0;
            setToast({
                text: active
                    ? `Switched on ${changed} sale${changed === 1 ? '' : 's'}.`
                    : `Switched off ${changed} sale${changed === 1 ? '' : 's'}.`,
                ok: true,
            });
            setSelected(new Set());
            setVariantData({});
            setExpandedId(null);
        } catch (err: any) {
            setToast({ text: err?.message || 'Action failed', ok: false });
        } finally {
            setBusy(false);
        }
    };

    /** Extra toast text when a change left sales switched off. */
    const pausedNote = (json: any) => {
        const n = json?.paused ?? 0;
        if (!n) return '';
        return salesActive
            ? ' Sales that were switched off stay off.'
            : ' All sales are off, so new sale prices start switched off. Use the Live switch to turn one on.';
    };

    const runBulk = async (kind: 'percentage' | 'fixed' | 'remove') => {
        const ids = Array.from(selected);
        if (ids.length === 0) {
            setToast({ text: 'Select at least one product first', ok: false });
            return;
        }
        let payload: Record<string, unknown>;
        let value: number | undefined;
        if (kind === 'remove') {
            payload = { action: 'remove', productIds: ids };
        } else if (kind === 'percentage') {
            value = Number(bulkPercent);
            if (!Number.isFinite(value) || value <= 0 || value >= 100) {
                setToast({ text: 'Enter a discount between 1 and 99%', ok: false });
                return;
            }
            payload = { action: 'apply', mode: 'percentage', value, productIds: ids };
        } else {
            value = Number(bulkFixed);
            if (!Number.isFinite(value) || value <= 0) {
                setToast({ text: 'Enter a valid sale price', ok: false });
                return;
            }
            payload = { action: 'apply', mode: 'fixed', value, productIds: ids };
        }

        setBusy(true);
        try {
            const json = await callApi(payload);
            mergeRows(json?.products);
            const n = ids.length;
            if (kind === 'remove') {
                setToast({ text: `Removed ${n} product${n > 1 ? 's' : ''} from sale`, ok: true });
            } else if (kind === 'percentage') {
                setToast({ text: `Applied ${value}% off to ${n} product${n > 1 ? 's' : ''}.${pausedNote(json)}`, ok: true });
            } else {
                const skipped = json?.skipped ?? 0;
                setToast({
                    text: (skipped
                        ? `Set sale price on ${n - skipped} product${n - skipped !== 1 ? 's' : ''}. ${skipped} skipped (variant products / price not below regular).`
                        : `Set sale price on ${n} product${n > 1 ? 's' : ''}.`) + pausedNote(json),
                    ok: true,
                });
            }
            setSelected(new Set());
            setBulkPercent('');
            setBulkFixed('');
            // Variant prices may have changed server-side; refetch on next expand.
            setVariantData({});
            setExpandedId(null);
        } catch (err: any) {
            setToast({ text: err?.message || 'Action failed', ok: false });
        } finally {
            setBusy(false);
        }
    };

    const applyRowPrice = async (p: ProductRow) => {
        const value = Number(rowPrice[p.id]);
        if (!Number.isFinite(value) || value <= 0) {
            setToast({ text: 'Enter a valid sale price', ok: false });
            return;
        }
        if (value >= regularPrice(p)) {
            setToast({ text: 'Sale price must be below the regular price', ok: false });
            return;
        }
        setBusy(true);
        try {
            const json = await callApi({ action: 'apply', mode: 'fixed', value, productIds: [p.id] });
            mergeRows(json?.products);
            setRowPrice((prev) => ({ ...prev, [p.id]: '' }));
            setToast({ text: `${p.name} set to ${fmt(value)}.${pausedNote(json)}`, ok: true });
        } catch (err: any) {
            setToast({ text: err?.message || 'Action failed', ok: false });
        } finally {
            setBusy(false);
        }
    };

    const removeRow = async (p: ProductRow) => {
        setBusy(true);
        try {
            const json = await callApi({ action: 'remove', productIds: [p.id] });
            mergeRows(json?.products);
            // Variants were reverted server-side too — drop the cached rows.
            setVariantData((prev) => {
                const next = { ...prev };
                delete next[p.id];
                return next;
            });
            if (expandedId === p.id) setExpandedId(null);
            setToast({ text: `${p.name} removed from sale`, ok: true });
        } catch (err: any) {
            setToast({ text: err?.message || 'Action failed', ok: false });
        } finally {
            setBusy(false);
        }
    };

    /** Expand a variant product's row and lazily load its variants. */
    const toggleVariants = async (p: ProductRow) => {
        if (expandedId === p.id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(p.id);
        setVariantFillAll('');
        if (variantData[p.id]) return;
        setVariantLoading(true);
        try {
            const { data, error } = await supabase
                .from('product_variants')
                .select('id, name, option1, option2, price, compare_at_price, metadata')
                .eq('product_id', p.id)
                .order('option2', { ascending: true })
                .order('option1', { ascending: true });
            if (error) throw error;
            const rows: VariantRow[] = (data || []).map((v: any) => {
                const priceNum = Number(v.price) || 0;
                const compare = v.compare_at_price != null ? Number(v.compare_at_price) : null;
                const paused = v.metadata?.paused_sale_price != null ? Number(v.metadata.paused_sale_price) : null;
                // Same regular/sale derivation as the product-level helpers.
                let regular = priceNum;
                let sale: number | null = null;
                if (paused != null) {
                    sale = paused;
                } else if (compare != null && compare > priceNum) {
                    regular = compare;
                    sale = priceNum;
                }
                const label = [v.option2, v.option1 || v.name].filter(Boolean).join(' / ') || v.name || 'Variant';
                return { id: v.id, label, regular, sale };
            });
            setVariantData((prev) => ({ ...prev, [p.id]: rows }));
        } catch (err) {
            console.error('[admin/sales] variant load error:', err);
            setToast({ text: 'Failed to load variants', ok: false });
            setExpandedId(null);
        } finally {
            setVariantLoading(false);
        }
    };

    /** Apply the typed sale prices for one product's variants. */
    const applyVariantPrices = async (p: ProductRow) => {
        const rows = variantData[p.id] || [];
        const items: { variantId: string; price: number }[] = [];
        for (const v of rows) {
            const raw = variantInputs[v.id];
            if (raw == null || raw.trim() === '') continue;
            const value = Number(raw);
            if (!Number.isFinite(value) || value <= 0) {
                setToast({ text: `Invalid sale price for "${v.label}"`, ok: false });
                return;
            }
            if (value >= v.regular) {
                setToast({
                    text: `Sale price for "${v.label}" must be below its regular price (${fmt(v.regular)})`,
                    ok: false,
                });
                return;
            }
            items.push({ variantId: v.id, price: Math.round(value * 100) / 100 });
        }
        if (items.length === 0) {
            setToast({ text: 'Enter a sale price for at least one variant', ok: false });
            return;
        }
        setBusy(true);
        try {
            const json = await callApi({ action: 'variant_prices', items });
            mergeRows(json?.products);
            // Reload this product's variants next time it is opened.
            setVariantData((prev) => {
                const copy = { ...prev };
                delete copy[p.id];
                return copy;
            });
            setExpandedId(null);
            setVariantInputs((prev) => {
                const next = { ...prev };
                items.forEach((i) => delete next[i.variantId]);
                return next;
            });
            setToast({
                text: `Set sale price on ${items.length} variant${items.length > 1 ? 's' : ''} of ${p.name}.${pausedNote(json)}`,
                ok: true,
            });
        } catch (err: any) {
            setToast({ text: err?.message || 'Action failed', ok: false });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Sales</h1>
                    <p className="text-gray-600 mt-1">
                        Set a discount % or a sale price, then switch each sale on or off, or all of them at once.
                    </p>
                </div>
                <Link
                    href="/sale"
                    target="_blank"
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 text-sm font-medium"
                >
                    <i className="ri-external-link-line"></i>
                    View Sale page
                </Link>
            </div>

            {/* Master on/off switch */}
            <div
                className={`rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    salesActive ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                }`}
            >
                <div className="flex items-start gap-3">
                    <i
                        className={`text-2xl mt-0.5 ${
                            salesActive ? 'ri-flashlight-fill text-green-600' : 'ri-pause-circle-line text-amber-600'
                        }`}
                    ></i>
                    <div>
                        <p className="font-semibold text-gray-900">
                            All sales: {salesActive ? 'ON' : 'OFF'}
                            <span className="ml-2 text-sm font-normal text-gray-600">
                                {liveCount} live{pausedCount > 0 ? `, ${pausedCount} switched off` : ''}
                            </span>
                        </p>
                        <p className="text-sm text-gray-600 mt-0.5 max-w-xl">
                            {salesActive
                                ? 'This switch turns every sale on or off at once. To switch one product, use its Live switch in the table.'
                                : 'Every sale is off. You can still switch on single products with their Live switch in the table, or turn every sale back on here.'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={toggleSalesActive}
                    disabled={togglingActive || busy}
                    role="switch"
                    aria-checked={salesActive}
                    className={`relative inline-flex h-9 w-16 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        salesActive ? 'bg-green-600' : 'bg-gray-300'
                    }`}
                    aria-label="Toggle all sales"
                >
                    <span
                        className={`inline-block h-7 w-7 transform rounded-full bg-white shadow transition-transform ${
                            salesActive ? 'translate-x-8' : 'translate-x-1'
                        }`}
                    >
                        {togglingActive && (
                            <i className="ri-loader-4-line animate-spin text-gray-500 text-sm absolute inset-0 flex items-center justify-center"></i>
                        )}
                    </span>
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Total products</p>
                    <p className="text-2xl font-bold text-gray-900">{products.length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Sale live</p>
                    <p className="text-2xl font-bold text-red-600">{liveCount}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Sale switched off</p>
                    <p className="text-2xl font-bold text-amber-600">{pausedCount}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Not on sale</p>
                    <p className="text-2xl font-bold text-gray-900">{products.length - onSaleCount}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col md:flex-row gap-3 md:items-center">
                <div className="relative flex-1">
                    <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search products by name…"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    <option value="">All categories</option>
                    {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
                <select
                    value={saleFilter}
                    onChange={(e) => setSaleFilter(e.target.value as typeof saleFilter)}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    <option value="all">All products</option>
                    <option value="on">On sale</option>
                    <option value="live">Sale live</option>
                    <option value="paused">Sale switched off</option>
                    <option value="off">Not on sale</option>
                </select>
            </div>

            {/* Bulk action bar */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 sticky top-2 z-20">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <div className="flex items-center gap-2 lg:w-56">
                        <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAllFiltered}
                            className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">
                            {selected.size > 0
                                ? `${selected.size} selected`
                                : `Select all ${filtered.length} filtered`}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                min={1}
                                max={99}
                                value={bulkPercent}
                                onChange={(e) => setBulkPercent(e.target.value)}
                                placeholder="%"
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg"
                            />
                            <button
                                onClick={() => runBulk('percentage')}
                                disabled={busy || selected.size === 0}
                                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                            >
                                Apply % off
                            </button>
                        </div>

                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={bulkFixed}
                                onChange={(e) => setBulkFixed(e.target.value)}
                                placeholder="₵ price"
                                className="w-28 px-3 py-2 border border-gray-300 rounded-lg"
                            />
                            <button
                                onClick={() => runBulk('fixed')}
                                disabled={busy || selected.size === 0}
                                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                            >
                                Set price
                            </button>
                        </div>

                        <button
                            onClick={() => switchSelected(true)}
                            disabled={busy || selected.size === 0}
                            className="px-4 py-2 bg-white border border-green-300 text-green-800 hover:bg-green-50 rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                            Switch on
                        </button>
                        <button
                            onClick={() => switchSelected(false)}
                            disabled={busy || selected.size === 0}
                            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                            Switch off
                        </button>

                        <button
                            onClick={() => runBulk('remove')}
                            disabled={busy || selected.size === 0}
                            className="px-4 py-2 bg-white border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                            Remove from sale
                        </button>
                    </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    Fixed price applies only to products without variants and must be below the regular price.
                    For variant products use a percentage, or click &quot;Variant prices&quot; on the row to set
                    each variant&apos;s own sale price.
                </p>
            </div>

            {toast && (
                <div
                    className={`rounded-lg px-4 py-3 text-sm ${
                        toast.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
                    }`}
                >
                    {toast.text}
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-gray-500">
                        <i className="ri-loader-4-line text-3xl animate-spin block mb-2"></i>
                        Loading products…
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">No products match your filters.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 text-left border-b border-gray-200">
                                    <th className="p-3 w-10"></th>
                                    <th className="p-3 font-semibold">Product</th>
                                    <th className="p-3 font-semibold">Regular</th>
                                    <th className="p-3 font-semibold">Sale price</th>
                                    <th className="p-3 font-semibold">Off</th>
                                    <th className="p-3 font-semibold">Live</th>
                                    <th className="p-3 font-semibold">Set price</th>
                                    <th className="p-3 font-semibold"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.map((p) => {
                                    const reg = regularPrice(p);
                                    const sale = salePrice(p);
                                    const pct = discountPct(p);
                                    return (
                                        <Fragment key={p.id}>
                                        <tr className="border-b border-gray-100 hover:bg-gray-50/70">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(p.id)}
                                                    onChange={() => toggleOne(p.id)}
                                                    aria-label={`Select ${p.name}`}
                                                    className="w-4 h-4 rounded border-gray-300"
                                                />
                                            </td>
                                            <td className="p-3">
                                                <div className="flex items-center gap-3">
                                                    <img src={p.image} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-gray-900 truncate max-w-[260px]">{p.name}</div>
                                                        <div className="text-xs text-gray-500 flex items-center gap-2">
                                                            <span>{p.category}</span>
                                                            {p.variantsCount > 0 && (
                                                                <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                                                                    {p.variantsCount} variants
                                                                </span>
                                                            )}
                                                            {p.status !== 'active' && (
                                                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">{p.status}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 whitespace-nowrap text-gray-700">{fmt(reg)}</td>
                                            <td className="p-3 whitespace-nowrap">
                                                {sale != null ? (
                                                    <span className="font-semibold text-red-600">
                                                        {fmt(sale)}
                                                        {isPaused(p) && (
                                                            <span className="ml-1 text-xs font-normal text-amber-700">(off)</span>
                                                        )}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="p-3 whitespace-nowrap">
                                                {pct > 0 ? (
                                                    <span className="inline-block px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs font-bold">-{pct}%</span>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                {p.on_sale ? (() => {
                                                    const pending = switching?.id === p.id;
                                                    const on = pending ? switching!.to : isLive(p);
                                                    return (
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={on}
                                                        aria-busy={pending}
                                                        aria-label={`Sale for ${p.name}`}
                                                        onClick={() => toggleProductSale(p)}
                                                        disabled={busy || togglingActive || !!switching}
                                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 ${
                                                            on ? 'bg-green-600' : 'bg-gray-300'
                                                        } ${pending ? 'opacity-60' : !!switching || busy || togglingActive ? 'opacity-50' : ''}`}
                                                    >
                                                        <span
                                                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                                                on ? 'translate-x-[22px]' : 'translate-x-0.5'
                                                            }`}
                                                        />
                                                    </button>
                                                    );
                                                })() : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                {p.variantsCount > 0 ? (
                                                    <button
                                                        onClick={() => toggleVariants(p)}
                                                        disabled={busy}
                                                        className="px-2.5 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
                                                    >
                                                        <i className={expandedId === p.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></i>
                                                        {expandedId === p.id ? 'Hide variants' : 'Variant prices'}
                                                    </button>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step="0.01"
                                                            value={rowPrice[p.id] ?? ''}
                                                            onChange={(e) => setRowPrice((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                                            placeholder="₵"
                                                            className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg"
                                                        />
                                                        <button
                                                            onClick={() => applyRowPrice(p)}
                                                            disabled={busy}
                                                            className="px-2.5 py-1.5 bg-gray-900 hover:bg-black text-white rounded-lg text-xs font-medium disabled:opacity-50"
                                                        >
                                                            Set
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3 text-right">
                                                {p.on_sale && (
                                                    <button
                                                        onClick={() => removeRow(p)}
                                                        disabled={busy}
                                                        className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {expandedId === p.id && (
                                            <tr className="border-b border-gray-100 bg-blue-50/40">
                                                <td className="p-0"></td>
                                                <td colSpan={7} className="p-4">
                                                    {variantLoading && !variantData[p.id] ? (
                                                        <div className="text-sm text-gray-500 flex items-center gap-2">
                                                            <i className="ri-loader-4-line animate-spin"></i>
                                                            Loading variants…
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-3">
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                                <p className="text-xs text-gray-600">
                                                                    Set a custom sale price per variant. Leave a box empty to keep that
                                                                    variant unchanged.
                                                                </p>
                                                                <div className="flex items-center gap-1">
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        step="0.01"
                                                                        value={variantFillAll}
                                                                        onChange={(e) => setVariantFillAll(e.target.value)}
                                                                        placeholder="₵ same for all"
                                                                        className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                                                                    />
                                                                    <button
                                                                        onClick={() => {
                                                                            if (!variantFillAll.trim()) return;
                                                                            setVariantInputs((prev) => {
                                                                                const next = { ...prev };
                                                                                (variantData[p.id] || []).forEach((v) => {
                                                                                    next[v.id] = variantFillAll;
                                                                                });
                                                                                return next;
                                                                            });
                                                                        }}
                                                                        className="px-2.5 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-xs font-medium"
                                                                    >
                                                                        Fill all
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                                                {(variantData[p.id] || []).map((v) => (
                                                                    <div
                                                                        key={v.id}
                                                                        className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3"
                                                                    >
                                                                        <div className="min-w-0">
                                                                            <p className="text-sm font-medium text-gray-900 truncate">{v.label}</p>
                                                                            <p className="text-xs text-gray-500">
                                                                                Regular {fmt(v.regular)}
                                                                                {v.sale != null && (
                                                                                    <span className="text-red-600 font-semibold">
                                                                                        {' '}• Sale {fmt(v.sale)}
                                                                                    </span>
                                                                                )}
                                                                            </p>
                                                                        </div>
                                                                        <input
                                                                            type="number"
                                                                            min={0}
                                                                            step="0.01"
                                                                            value={variantInputs[v.id] ?? ''}
                                                                            onChange={(e) =>
                                                                                setVariantInputs((prev) => ({
                                                                                    ...prev,
                                                                                    [v.id]: e.target.value,
                                                                                }))
                                                                            }
                                                                            placeholder="₵ sale"
                                                                            className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-shrink-0"
                                                                        />
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            <div className="flex justify-end">
                                                                <button
                                                                    onClick={() => applyVariantPrices(p)}
                                                                    disabled={busy}
                                                                    className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                                                                >
                                                                    Apply variant prices
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {!loading && filtered.length > PAGE_SIZE && (
                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                        Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage <= 1}
                            className="px-3 py-2 border border-gray-300 rounded-lg disabled:opacity-50 text-sm"
                        >
                            Previous
                        </button>
                        <span className="text-sm text-gray-600">Page {currentPage} / {totalPages}</span>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                            className="px-3 py-2 border border-gray-300 rounded-lg disabled:opacity-50 text-sm"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
