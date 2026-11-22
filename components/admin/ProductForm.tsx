'use client';

import Link from 'next/link';
import { thumb } from '@/lib/thumb';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { generateNextPosCode, getPosCodeFromMetadata } from '@/lib/posCode';
import {
    getProductVisibility,
    type ProductVisibility,
} from '@/lib/product-visibility';
import { nextFreeSlug, slugify } from '@/lib/slug';
import { uploadProductPhoto } from '@/lib/product-photo';
import { reportStuck } from '@/lib/client-diagnostics';
import PhotoFirstDetails from '@/components/admin/PhotoFirstDetails';

interface ProductFormProps {
    initialData?: any;
    isEditMode?: boolean;
}

interface VariantSizeRow {
    tempId: string;
    size: string;
    price: string;
    /** Predefined sale price; empty = no sale for this variant. */
    salePrice: string;
    stock: string;
    sku: string;
}

interface VariantGroup {
    tempId: string;
    name: string;
    appearanceType: 'color' | 'image';
    colorName: string;
    colorHex: string;
    imageUrl: string;
    sizes: VariantSizeRow[];
}

function normalizeProductStatus(value?: string): 'active' | 'draft' | 'archived' {
    const normalized = (value || '').toLowerCase();
    if (normalized === 'draft' || normalized === 'archived') return normalized;
    return 'active';
}

export default function ProductForm({ initialData, isEditMode = false }: ProductFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState<any[]>([]);
    const [categoriesState, setCategoriesState] = useState<'loading' | 'ready' | 'failed'>('loading');

    // ── Sale-aware pricing initialisation ─────────────────────────────────
    // DB model: while a product is ON SALE, `price` holds the discounted
    // (charged) price and `compare_at_price` holds the regular price. While
    // the campaign is PAUSED (sales mode off), `price` is back to regular and
    // the sale price is stashed in metadata.paused_sale_price.
    // The form always presents: Price = regular price, Sale price = discount.
    const initialPricing = (() => {
        const md = initialData?.metadata || {};
        const hasVariantRows = (initialData?.product_variants || []).length > 0;
        const rawPrice = initialData?.price ?? '';
        const rawCompare = initialData?.compare_at_price ?? '';
        // Variant products use the same swap at product level (price = cheapest
        // charged price, compare_at = regular), so unswap them too or a re-save
        // would store the sale price as the regular price. Their sale prices
        // live on the variant rows, so the product-level sale field stays empty.
        if (md.paused_sale_price != null) {
            // Campaign paused: price already holds the regular price.
            return { price: rawPrice, compare: rawCompare, sale: hasVariantRows ? '' : String(md.paused_sale_price) };
        }
        if (initialData?.on_sale && Number(rawCompare) > Number(rawPrice)) {
            // Active sale: unswap so "Price" shows the regular price.
            return { price: rawCompare, compare: '', sale: hasVariantRows ? '' : String(rawPrice) };
        }
        return { price: rawPrice, compare: rawCompare, sale: '' };
    })();

    const [productName, setProductName] = useState(initialData?.name || '');
    const [categoryId, setCategoryId] = useState(initialData?.category_id || '');
    const [price, setPrice] = useState(initialPricing.price);
    const [comparePrice, setComparePrice] = useState(initialPricing.compare);
    const [salePrice, setSalePrice] = useState(initialPricing.sale);
    // Master campaign switch (site_settings.sales_active); defaults to ON.
    const [salesActive, setSalesActive] = useState(true);
    // Each sale has its own on/off switch (Admin → Sales, Live column). Saving
    // keeps a saved sale's state; a new sale follows the all-sales switch.
    const savedSaleState: 'on' | 'off' | null = initialData?.on_sale
        ? initialData?.metadata?.paused_sale_price != null ? 'off' : 'on'
        : null;
    const saleOn = savedSaleState ? savedSaleState === 'on' : salesActive;
    const [sku, setSku] = useState(initialData?.sku || '');
    const [barcode, setBarcode] = useState(initialData?.barcode || '');
    const [posCode, setPosCode] = useState(getPosCodeFromMetadata(initialData?.metadata));
    const [stock, setStock] = useState(initialData?.quantity || '');
    // Stock as it was when the form opened. A save only writes quantity when the
    // admin changed it here, so a till sale made meanwhile is not undone.
    const [initialStockValue] = useState(String(initialData?.quantity || ''));
    const [initialVariantStock] = useState<Record<string, string>>(() =>
        Object.fromEntries(
            (initialData?.product_variants || [])
                .filter((v: any) => v?.id)
                .map((v: any) => [v.id, (v.stock ?? v.quantity ?? 0).toString()])
        )
    );
    const [formErrors, setFormErrors] = useState<{ name?: string; price?: string; variants?: string }>({});
    const [moq, setMoq] = useState(initialData?.moq || '1');
    const [lowStockThreshold, setLowStockThreshold] = useState(initialData?.metadata?.low_stock_threshold || '5');
    const [description, setDescription] = useState(initialData?.description || '');
    const [status, setStatus] = useState<'active' | 'draft' | 'archived'>(
        normalizeProductStatus(initialData?.status)
    );
    const [visibility, setVisibility] = useState<ProductVisibility>(
        // metadata.visibility is what row-level security and the shop read; the
        // column is NOT NULL default 'global' and never written, so it must not win.
        getProductVisibility(initialData || {})
    );
    const [featured, setFeatured] = useState(initialData?.featured || false);
    const [preorderShipping, setPreorderShipping] = useState(initialData?.metadata?.preorder_shipping || '');
    const [activeTab, setActiveTab] = useState('general');

    const generateSku = () => {
        const prefix = 'DDZ';
        const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${prefix}-${timestamp}-${random}`;
    };

    const generateBarcode = () => {
        const prefix = '200';
        const body = prefix + Date.now().toString().slice(-9);
        const digits = body.split('').map(Number);
        let sum = 0;
        digits.forEach((d, i) => { sum += d * (i % 2 === 0 ? 1 : 3); });
        const check = (10 - (sum % 10)) % 10;
        return body + check;
    };

    const generatePosCode = useCallback(async () => {
        const { data } = await supabase.from('products').select('id, metadata');
        const existingCodes = new Set<string>();
        (data || []).forEach((p: any) => {
            const code = getPosCodeFromMetadata(p.metadata);
            if (code) existingCodes.add(code);
        });
        const nextCode = generateNextPosCode(existingCodes);
        setPosCode(nextCode);
        return nextCode;
    }, []);

    // --- Variant System (group + sizes) ---
    const makeEmptySizeRow = (defaultSize = ''): VariantSizeRow => ({
        tempId: Math.random().toString(36).slice(2),
        size: defaultSize,
        price: '',
        salePrice: '',
        stock: '0',
        sku: ''
    });

    const makeEmptyGroup = (): VariantGroup => ({
        tempId: Math.random().toString(36).slice(2),
        name: '',
        appearanceType: 'color',
        colorName: '',
        colorHex: '#888888',
        imageUrl: '',
        sizes: [makeEmptySizeRow('Default')]
    });

    const [variantGroups, setVariantGroups] = useState<VariantGroup[]>(() => {
        const existingVariants = initialData?.product_variants || [];
        const allImages = initialData?.product_images || [];
        if (existingVariants.length === 0) return [];

        const groupsByKey = new Map<string, VariantGroup>();
        existingVariants.forEach((v: any) => {
            const variantImg = allImages.find((img: any) => img.variant_id === v.id);
            const imgUrl = v.image_url || variantImg?.url || '';
            const colorName = (v.option2 || '').trim();
            const hasLegacyGroupOnlyName = !colorName && !v.option1 && !!v.name;
            const groupName = colorName || (hasLegacyGroupOnlyName ? (v.name || '').trim() : 'Default');

            // Use image URL as secondary grouping key when option2 is empty,
            // so variants with different images stay in separate groups
            const groupKey = colorName
                ? colorName
                : (imgUrl ? `img:${imgUrl}` : (groupName || 'Default'));

            if (!groupsByKey.has(groupKey)) {
                groupsByKey.set(groupKey, {
                    tempId: Math.random().toString(36).slice(2),
                    name: groupName === 'Default' ? '' : groupName,
                    appearanceType: imgUrl ? 'image' : 'color',
                    colorName: colorName || '',
                    colorHex: v.metadata?.color_hex || '#888888',
                    imageUrl: imgUrl,
                    sizes: []
                });
            }

            const group = groupsByKey.get(groupKey)!;
            if (!group.imageUrl && imgUrl) {
                group.imageUrl = imgUrl;
                group.appearanceType = 'image';
            }

            const sizeLabel = (v.option1 || '').trim() || (colorName ? (v.name || '').trim() : 'Default') || 'Default';
            // Sale-aware unswap (same model as the product-level pricing):
            // active sale → price col holds the sale price, compare_at the
            // regular; paused → price is regular, sale stashed in metadata.
            let rowRegular = v.price;
            let rowSale = '';
            const vMeta = v.metadata || {};
            if (vMeta.paused_sale_price != null) {
                rowSale = String(vMeta.paused_sale_price);
            } else if (v.compare_at_price != null && Number(v.compare_at_price) > Number(v.price)) {
                rowRegular = v.compare_at_price;
                rowSale = String(v.price);
            }
            group.sizes.push({
                tempId: v.id || Math.random().toString(36).slice(2),
                size: sizeLabel,
                price: rowRegular?.toString() || '',
                salePrice: rowSale,
                stock: (v.stock ?? v.quantity ?? 0).toString(),
                sku: v.sku || ''
            });
        });

        return Array.from(groupsByKey.values()).map((group) => ({
            ...group,
            sizes: group.sizes.length > 0 ? group.sizes : [makeEmptySizeRow('Default')]
        }));
    });

    const [uploadingVariantId, setUploadingVariantId] = useState<string | null>(null);

    const updateGroup = (tempId: string, field: keyof Omit<VariantGroup, 'tempId' | 'sizes'>, value: string) => {
        setVariantGroups(prev => prev.map(g => g.tempId === tempId ? { ...g, [field]: value } : g));
    };

    const updateSize = (
        groupId: string,
        sizeId: string,
        field: keyof VariantSizeRow,
        value: string
    ) => {
        if (field === 'price') setFormErrors(prev => (prev.variants ? { ...prev, variants: undefined } : prev));
        setVariantGroups(prev => prev.map(g => {
            if (g.tempId !== groupId) return g;
            return {
                ...g,
                sizes: g.sizes.map(s => s.tempId === sizeId ? { ...s, [field]: value } : s)
            };
        }));
    };

    const addVariantGroup = () => setVariantGroups(prev => [...prev, makeEmptyGroup()]);

    const removeVariantGroup = (tempId: string) => {
        setVariantGroups(prev => prev.filter(g => g.tempId !== tempId));
    };

    const addSizeRow = (groupId: string) => {
        setVariantGroups(prev => prev.map(g => (
            g.tempId === groupId
                ? { ...g, sizes: [...g.sizes, makeEmptySizeRow('')] }
                : g
        )));
    };

    const removeSizeRow = (groupId: string, sizeId: string) => {
        setVariantGroups(prev => prev.map(g => {
            if (g.tempId !== groupId) return g;
            const nextSizes = g.sizes.filter(s => s.tempId !== sizeId);
            return {
                ...g,
                sizes: nextSizes.length > 0 ? nextSizes : [makeEmptySizeRow('Default')]
            };
        }));
    };

    const bulkSetVariantField = (field: 'price' | 'stock' | 'salePrice', value: string) => {
        setVariantGroups(prev => prev.map(g => ({
            ...g,
            sizes: g.sizes.map(s => ({ ...s, [field]: value }))
        })));
    };

    const handleVariantImageUpload = async (tempId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        setUploadingVariantId(tempId);
        try {
            const publicUrl = await uploadProductPhoto(e.target.files[0], { folder: 'variants' });
            updateGroup(tempId, 'imageUrl', publicUrl);
        } catch (err: any) {
            alert('Upload failed: ' + err.message);
        } finally {
            setUploadingVariantId(null);
        }
    };

    // Product-level images (not linked to any variant)
    const [images, setImages] = useState<any[]>(
        (initialData?.product_images || []).filter((img: any) => !img.variant_id)
    );
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
    const [uploadProblem, setUploadProblem] = useState<string | null>(null);

    // SEO
    const [seoTitle, setSeoTitle] = useState(initialData?.seo_title || '');
    const [metaDescription, setMetaDescription] = useState(initialData?.seo_description || '');
    const [urlSlug, setUrlSlug] = useState(initialData?.slug || '');
    // A new product's web address follows its name until someone types their
    // own on the SEO tab.
    const [slugEdited, setSlugEdited] = useState(false);
    const [keywords, setKeywords] = useState(initialData?.tags?.join(', ') || '');

    const tabs = [
        { id: 'general', label: 'General', icon: 'ri-information-line' },
        { id: 'pricing', label: 'Pricing & Inventory', icon: 'ri-price-tag-3-line' },
        { id: 'variants', label: 'Variants', icon: 'ri-layout-grid-line' },
        { id: 'images', label: 'Images', icon: 'ri-image-line' },
        { id: 'seo', label: 'SEO', icon: 'ri-search-line' }
    ];

    // Load the category list, trying three times before giving up. (One failed
    // request used to leave "Loading categories..." on screen for good.)
    const loadCategories = useCallback(async () => {
        setCategoriesState('loading');
        let settled = false;
        // Categories are public. If the usual route has not answered within 8
        // seconds, fetch them directly (no sign-in step involved) and send a
        // report of what the page was waiting on, so a phone-only stall can be
        // traced from the server log.
        const watchdog = setTimeout(async () => {
            if (settled) return;
            const started = Date.now();
            let direct: string;
            try {
                const res = await fetch('/rest/v1/categories?select=id,name&status=eq.active', {
                    headers: { apikey: 'public-anon-key', Accept: 'application/json' },
                    cache: 'no-store',
                    signal: AbortSignal.timeout(12_000),
                });
                const rows = res.ok ? await res.json() : null;
                direct = `HTTP ${res.status} in ${Date.now() - started} ms, ${Array.isArray(rows) ? rows.length : 0} rows`;
                if (!settled && Array.isArray(rows) && rows.length > 0) {
                    settled = true;
                    setCategories(rows);
                    setCategoriesState('ready');
                }
            } catch (err: any) {
                direct = `failed after ${Date.now() - started} ms: ${err?.name || 'Error'}`;
            }
            reportStuck('product-form-categories', { directFetch: direct });
        }, 8_000);
        const finish = (state: 'ready' | 'failed', rows?: any[]) => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            if (rows) setCategories(rows);
            setCategoriesState(state);
        };
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                // A short limit of its own: a short list, and the form cannot be saved without it.
                const { data, error } = await supabase
                    .from('categories')
                    .select('id, name')
                    .eq('status', 'active')
                    .abortSignal(AbortSignal.timeout(12_000));
                if (!error && data) {
                    finish('ready', data);
                    return;
                }
            } catch {
                // A dropped connection: try again below.
            }
            if (settled) return;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
        finish('failed');
    }, []);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    // Once the connection is back, load the list without being asked.
    useEffect(() => {
        if (categoriesState !== 'failed') return;
        window.addEventListener('online', loadCategories);
        return () => window.removeEventListener('online', loadCategories);
    }, [categoriesState, loadCategories]);

    // A product always has a category: start on the first one.
    useEffect(() => {
        if (!categoryId && categories.length > 0) setCategoryId(categories[0].id);
    }, [categoryId, categories]);

    // Rebuild the address from the whole name on every change. (It used to be
    // set once, from the first letter typed, so "Towel" became "t" and the
    // save failed when a product already had that address.)
    useEffect(() => {
        if (!isEditMode && !slugEdited) {
            setUrlSlug(slugify(productName));
        }
    }, [productName, isEditMode, slugEdited]);

    useEffect(() => {
        if (!isEditMode && !sku) setSku(generateSku());
        if (!isEditMode && !barcode) setBarcode(generateBarcode());
        if (!isEditMode && !posCode) {
            void generatePosCode();
        }
    }, [isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        async function fetchSalesActive() {
            const { data } = await supabase
                .from('site_settings')
                .select('value')
                .eq('key', 'sales_active')
                .maybeSingle();
            if (data) setSalesActive(data.value === true || data.value === 'true');
        }
        fetchSalesActive();
    }, []);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const files = Array.from(input.files || []);
        if (files.length === 0) return;
        setUploading(true);
        setUploadProblem(null);
        setUploadProgress({ done: 0, total: files.length });
        let failed = 0;
        let reason = '';
        for (let i = 0; i < files.length; i++) {
            try {
                const url = await uploadProductPhoto(files[i]);
                // Show each photo as soon as it is saved, so a later failure does not lose it.
                setImages(prev => [...prev, { url, position: prev.length }]);
            } catch (err: any) {
                failed += 1;
                reason = err?.message || '';
            }
            setUploadProgress({ done: i + 1, total: files.length });
        }
        if (failed > 0) {
            const what = files.length === 1
                ? 'The photo did not upload.'
                : failed === files.length
                    ? 'None of the photos uploaded.'
                    : `${failed} of ${files.length} photos did not upload.`;
            setUploadProblem(`${what} ${reason}`.trim());
        }
        setUploading(false);
        setUploadProgress(null);
        input.value = '';
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setImages(images.filter((_, idx) => idx !== indexToRemove));
    };

    /** Required fields. Returns false (and shows inline messages) when the form can't be saved. */
    const validateForm = (): boolean => {
        const errors: { name?: string; price?: string; variants?: string } = {};
        if (!productName.trim()) errors.name = 'Enter a product name.';
        const base = parseFloat(price);
        const basePriced = Number.isFinite(base) && base > 0;
        if (variantGroups.length > 0) {
            const unpriced = variantGroups.flatMap(g => g.sizes.map(s => ({ g, s }))).filter(({ s }) => {
                const own = parseFloat(s.price);
                return !(Number.isFinite(own) && own > 0) && !basePriced;
            });
            if (unpriced.length > 0) {
                const first = unpriced[0];
                errors.variants = `${unpriced.length} variant${unpriced.length === 1 ? ' has' : 's have'} no price (e.g. "${first.g.name || first.g.colorName || 'Default'} / ${first.s.size || 'Default'}"). Give every variant a price above 0, or set the product price.`;
            }
        } else if (!basePriced) {
            errors.price = 'Enter a price above GH₵0.';
        }
        setFormErrors(errors);
        if (errors.name) setActiveTab('general');
        else if (errors.price) setActiveTab('pricing');
        else if (errors.variants) setActiveTab('variants');
        return !errors.name && !errors.price && !errors.variants;
    };

    const handleSubmit = async () => {
        if (loading) return;
        if (!validateForm()) return;
        // A save still running after 20 seconds sends a report of what the page waits on.
        const saveWatch = setTimeout(() => {
            reportStuck('product-form-save', { editing: isEditMode, photos: images.length });
        }, 20_000);
        try {
            setLoading(true);

            // Re-read the saved sale state and metadata right before saving: the
            // Sales page (or the till) may have changed them since the form opened.
            let currentMetadata: Record<string, any> = initialData?.metadata || {};
            let saleOnNow = saleOn;
            if (isEditMode && initialData?.id) {
                const { data: fresh, error: freshError } = await supabase
                    .from('products')
                    .select('on_sale, price, compare_at_price, metadata')
                    .eq('id', initialData.id)
                    .maybeSingle();
                if (freshError) throw freshError;
                if (!fresh) throw new Error('This product no longer exists or you cannot edit it.');
                currentMetadata = fresh.metadata || {};
                const currentSaleState: 'on' | 'off' | null = fresh.on_sale
                    ? currentMetadata.paused_sale_price != null ? 'off' : 'on'
                    : null;
                saleOnNow = currentSaleState ? currentSaleState === 'on' : salesActive;
                if (currentSaleState !== savedSaleState) {
                    const describe = (st: 'on' | 'off' | null) => st === 'on' ? 'running' : st === 'off' ? 'paused' : 'not on sale';
                    const ok = window.confirm(
                        `This product's sale was changed elsewhere while this form was open (it was ${describe(savedSaleState)}, it is now ${describe(currentSaleState)}).\n\n` +
                        `Saving will keep the sale ${currentSaleState === 'on' ? 'running' : currentSaleState === 'off' ? 'paused' : 'state set by the prices in this form'} and write the prices shown in this form. Continue?`
                    );
                    if (!ok) {
                        setLoading(false);
                        return;
                    }
                }
            }

            const ensuredPosCode = (posCode || '').trim() || await generatePosCode();

            const hasVariants = variantGroups.length > 0;
            const variantStockTotal = hasVariants
                ? variantGroups.reduce(
                    (sum, group) => sum + group.sizes.reduce((groupSum, size) => groupSum + (parseInt(size.stock) || 0), 0),
                    0
                )
                : parseInt(stock) || 0;

            // ── Sale-aware pricing ────────────────────────────────────────
            // The form's "Price" field is always the REGULAR price. If a sale
            // price is set (variant-free products only — variant products are
            // discounted via Admin → Sales % tool, since checkout charges the
            // variant price):
            //   * sales mode ON  → store sale price in `price` (charged) and
            //     the regular price in `compare_at_price` (struck through).
            //   * sales mode OFF → store the regular price in `price` and
            //     stash the sale price in metadata.paused_sale_price; the
            //     master switch swaps it in when sales are turned on.
            const regularP = parseFloat(price) || 0;
            const saleP = salePrice ? parseFloat(salePrice) : NaN;
            const hasSale = !hasVariants && Number.isFinite(saleP) && saleP > 0;

            if (hasSale && saleP >= regularP) {
                alert('Sale price must be lower than the regular price.');
                setLoading(false);
                return;
            }
            if (!hasVariants && salePrice && !hasSale) {
                alert('Sale price is invalid. Leave it empty for no sale.');
                setLoading(false);
                return;
            }

            // Per-variant sale parsing. A row's regular price falls back to
            // the product's base price, same as the charged-price fallback.
            const parseRowSale = (row: VariantSizeRow) => {
                const reg = parseFloat(row.price) || regularP || 0;
                const sp = row.salePrice ? parseFloat(row.salePrice) : NaN;
                const hasRowSale = Number.isFinite(sp) && sp > 0 && sp < reg;
                return { reg, sp, hasRowSale, invalid: !!row.salePrice.trim() && !hasRowSale };
            };

            if (hasVariants) {
                const badRow = variantGroups.flatMap(g => g.sizes.map(s => ({ g, s }))).find(({ s }) => parseRowSale(s).invalid);
                if (badRow) {
                    alert(`Variant "${badRow.g.name || badRow.g.colorName || 'Default'} / ${badRow.s.size || 'Default'}" has an invalid sale price. It must be lower than that variant's regular price (leave empty for no sale).`);
                    setLoading(false);
                    return;
                }
            }
            const allRowSales = hasVariants
                ? variantGroups.flatMap(g => g.sizes).map(parseRowSale)
                : [];
            const anyVariantSale = allRowSales.some(r => r.hasRowSale);
            // The product row mirrors the cheapest charged price so storefront
            // "From GH₵X" and the -% badge stay correct for variant products.
            const minCharged = anyVariantSale
                ? Math.min(...allRowSales.map(r => (r.hasRowSale ? r.sp : r.reg)))
                : null;

            const metadata: Record<string, any> = {
                ...currentMetadata,
                pos_code: ensuredPosCode || null,
                low_stock_threshold: parseInt(lowStockThreshold) || 5,
                preorder_shipping: preorderShipping.trim() || null,
                visibility,
            };

            let pricingFields: Record<string, any>;
            if (hasVariants && anyVariantSale && saleOnNow) {
                delete metadata.paused_sale_price;
                pricingFields = { price: minCharged, compare_at_price: regularP, on_sale: true };
            } else if (hasVariants && anyVariantSale) {
                metadata.paused_sale_price = minCharged;
                pricingFields = {
                    price: regularP,
                    compare_at_price: comparePrice ? parseFloat(comparePrice) : null,
                    on_sale: true,
                };
            } else if (hasVariants) {
                delete metadata.paused_sale_price;
                pricingFields = {
                    price: regularP,
                    compare_at_price: comparePrice ? parseFloat(comparePrice) : null,
                    on_sale: false,
                };
            } else if (hasSale && saleOnNow) {
                delete metadata.paused_sale_price;
                pricingFields = { price: saleP, compare_at_price: regularP, on_sale: true };
            } else if (hasSale) {
                metadata.paused_sale_price = saleP;
                pricingFields = {
                    price: regularP,
                    compare_at_price: comparePrice ? parseFloat(comparePrice) : null,
                    on_sale: true,
                };
            } else {
                delete metadata.paused_sale_price;
                pricingFields = {
                    price: regularP,
                    compare_at_price: comparePrice ? parseFloat(comparePrice) : null,
                    on_sale: false,
                };
            }

            // Web address: keep a saved one that was not changed; otherwise use
            // the wanted one, with -2, -3… added when another product has it.
            const wantedSlug = slugify(urlSlug) || slugify(productName) || `product-${Date.now()}`;
            let finalSlug = wantedSlug;
            if (!(isEditMode && initialData?.slug === wantedSlug)) {
                const { data: sameSlug, error: slugError } = await supabase
                    .from('products')
                    .select('id, slug')
                    .or(`slug.eq.${wantedSlug},slug.like.${wantedSlug}-%`);
                if (slugError) throw slugError;
                finalSlug = nextFreeSlug(
                    wantedSlug,
                    (sameSlug || []).filter((row: any) => row.id !== initialData?.id).map((row: any) => row.slug)
                );
            }

            const productData = {
                name: productName.trim(),
                slug: finalSlug,
                description,
                category_id: categoryId || null,
                ...pricingFields,
                sku: sku || generateSku(),
                barcode: barcode || generateBarcode(),
                // Edit mode: write stock only when changed in this form. Variant
                // products get their total re-summed from the variants after sync.
                ...(!isEditMode
                    ? { quantity: hasVariants ? variantStockTotal : (parseInt(stock) || 0) }
                    : !hasVariants && String(stock) !== initialStockValue
                        ? { quantity: parseInt(stock) || 0 }
                        : {}),
                moq: parseInt(moq) || 1,
                status,
                featured,
                seo_title: seoTitle,
                seo_description: metaDescription,
                tags: (keywords as string).split(',').map((k: string) => k.trim()).filter(Boolean),
                metadata
            };

            let productId = initialData?.id;
            let error;

            const chargedPrice = Number(pricingFields.price);
            if (isEditMode && productId) {
                const { data: saved, error: updateError } = await supabase
                    .from('products')
                    .update(productData)
                    .eq('id', productId)
                    .select('id, price')
                    .maybeSingle();
                error = updateError;
                if (!updateError && !saved) {
                    throw new Error('The price was not saved. Sign in with an admin account and try again.');
                }
                if (saved && Math.abs(Number(saved.price) - chargedPrice) >= 0.001) {
                    throw new Error(`The price saved as GH₵${Number(saved.price).toFixed(2)}, not GH₵${chargedPrice.toFixed(2)}.`);
                }
            } else {
                let { data: newProduct, error: insertError } = await supabase.from('products').insert([productData]).select('id, price').single();
                if (insertError && /products_slug_key/.test(insertError.message || '')) {
                    // The address was taken between the check and the save (or by a
                    // product this account cannot see): add a short ending and save once more.
                    productData.slug = `${wantedSlug.slice(0, 68)}-${Date.now().toString(36)}`;
                    ({ data: newProduct, error: insertError } = await supabase.from('products').insert([productData]).select('id, price').single());
                }
                if (newProduct) productId = newProduct.id;
                error = insertError;
                if (newProduct && Math.abs(Number(newProduct.price) - chargedPrice) >= 0.001) {
                    throw new Error(`The price saved as GH₵${Number(newProduct.price).toFixed(2)}, not GH₵${chargedPrice.toFixed(2)}.`);
                }
            }

            if (error) throw error;

            if (productId) {
                const isUuid = (value: string) =>
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

                // 1. Sync variant rows (update existing, insert new, delete removed)
                const imageInserts: any[] = [];
                let existingVariantIds: string[] = [];
                let existingVariantLabels: Record<string, string> = {};

                let existingVariantMetadata: Record<string, any> = {};
                if (isEditMode) {
                    const { data: existingVariants, error: existingVariantsError } = await supabase
                        .from('product_variants')
                        .select('id, name, option1, option2, metadata')
                        .eq('product_id', productId);
                    if (existingVariantsError) throw existingVariantsError;
                    existingVariantIds = (existingVariants || []).map((v: any) => v.id).filter(Boolean);
                    existingVariantLabels = Object.fromEntries(
                        (existingVariants || []).map((v: any) => [
                            v.id,
                            `${v.option1 ?? v.name ?? 'Variant'}${v.option2 ? ` / ${v.option2}` : ''}`
                        ])
                    );
                    existingVariantMetadata = Object.fromEntries(
                        (existingVariants || []).map((v: any) => [v.id, v.metadata || {}])
                    );
                }

                if (hasVariants) {
                    const desiredRows = variantGroups.flatMap(group => {
                        const groupName = group.name.trim();
                        const colorName = group.colorName.trim();
                        const option2Value = colorName || groupName || null;

                        return group.sizes.map(sizeRow => {
                            const sizeLabel = sizeRow.size.trim() || 'Default';
                            const existingId = isUuid(sizeRow.tempId) ? sizeRow.tempId : null;

                            // Sale-aware variant pricing: while sales mode is ON
                            // the variant charges the sale price (regular kept in
                            // compare_at_price); while OFF the sale price is
                            // stashed in metadata.paused_sale_price for the
                            // master switch to activate later.
                            const { reg: rowRegular, sp: rowSale, hasRowSale } = parseRowSale(sizeRow);
                            const variantMetadata: Record<string, any> = {
                                // Merge with the variant's existing metadata so flags
                                // owned by other tools survive a form save.
                                ...(existingId ? existingVariantMetadata[existingId] || {} : {}),
                                ...(group.colorHex && group.appearanceType === 'color'
                                    ? { color_hex: group.colorHex }
                                    : {})
                            };
                            if (hasRowSale && !saleOnNow) {
                                variantMetadata.paused_sale_price = rowSale;
                            } else {
                                delete variantMetadata.paused_sale_price;
                            }

                            return {
                                existingId,
                                imageUrl: group.imageUrl,
                                label: `${option2Value || 'Variant'} / ${sizeLabel}`,
                                payload: {
                                    ...(existingId ? { id: existingId } : {}),
                                    product_id: productId,
                                    name: sizeLabel,
                                    sku: sizeRow.sku || null,
                                    price: hasRowSale && saleOnNow ? rowSale : rowRegular,
                                    compare_at_price: hasRowSale && saleOnNow ? rowRegular : null,
                                    // Only write stock the admin changed here (new rows always).
                                    ...(!existingId || sizeRow.stock !== initialVariantStock[existingId]
                                        ? { quantity: parseInt(sizeRow.stock) || 0 }
                                        : {}),
                                    option1: sizeLabel,
                                    option2: option2Value,
                                    image_url: group.imageUrl || null,
                                    metadata: variantMetadata
                                }
                            };
                        });
                    });

                    // Delete only variants that were removed from the form
                    if (isEditMode && existingVariantIds.length > 0) {
                        const keepIds = new Set(
                            desiredRows.map(r => r.existingId).filter((id): id is string => !!id)
                        );
                        const removedIds = existingVariantIds.filter(id => !keepIds.has(id));
                        if (removedIds.length > 0) {
                            // Safety gate: if removing these variants would wipe out every
                            // existing variant, or if the form is about to delete more than
                            // 2 at once, ask the admin to confirm first. This prevents a
                            // stale form state from silently nuking a product's variants.
                            const wouldDeleteAll = desiredRows.length === 0 || removedIds.length === existingVariantIds.length;
                            const wouldDeleteMany = removedIds.length > 2;
                            if (wouldDeleteAll || wouldDeleteMany) {
                                const names = removedIds
                                    .map((id) => existingVariantLabels[id] || id.slice(0, 8))
                                    .join('\n• ');
                                const ok = window.confirm(
                                    `You are about to permanently remove ${removedIds.length} variant${removedIds.length === 1 ? '' : 's'} from "${productName}":\n\n• ${names}\n\nPast orders that used these variants will keep their name for shipping, but the variants themselves will be gone. Continue?`
                                );
                                if (!ok) {
                                    setLoading(false);
                                    return;
                                }
                            }

                            const { error: clearOrderItemVariantRefsError } = await supabase
                                .from('order_items')
                                .update({ variant_id: null })
                                .in('variant_id', removedIds);
                            if (clearOrderItemVariantRefsError) throw clearOrderItemVariantRefsError;

                            const { error: deleteRemovedVariantsError } = await supabase
                                .from('product_variants')
                                .delete()
                                .in('id', removedIds);
                            if (deleteRemovedVariantsError) throw deleteRemovedVariantsError;
                        }
                    }

                    const updateRows = desiredRows.filter(r => !!r.existingId);
                    const insertRows = desiredRows.filter(r => !r.existingId);

                    // Update existing variants one by one: rows may carry different
                    // columns (quantity only when changed), which a bulk upsert would null out.
                    for (const r of updateRows) {
                        const { id: _id, ...fields } = r.payload as Record<string, any>;
                        const { error: updateVariantError } = await supabase
                            .from('product_variants')
                            .update(fields)
                            .eq('id', r.existingId as string);
                        if (updateVariantError) throw updateVariantError;
                    }

                    let insertedIds: string[] = [];
                    if (insertRows.length > 0) {
                        const { data: insertedVariants, error: insertVariantsError } = await supabase
                            .from('product_variants')
                            .insert(insertRows.map(r => r.payload))
                            .select('id');
                        if (insertVariantsError) throw insertVariantsError;
                        insertedIds = (insertedVariants || []).map((v: any) => v.id);
                    }

                    // Link each variant row to its image (if provided)
                    const imageRows = [
                        ...updateRows.map(r => ({ id: r.existingId as string, imageUrl: r.imageUrl, label: r.label })),
                        ...insertRows.map((r, idx) => ({ id: insertedIds[idx], imageUrl: r.imageUrl, label: r.label }))
                    ];
                    imageRows.forEach((row) => {
                        if (row?.id && row?.imageUrl) {
                            imageInserts.push({
                                product_id: productId,
                                url: row.imageUrl,
                                position: 0,
                                alt_text: `${productName} - ${row.label}`,
                                variant_id: row.id
                            });
                        }
                    });
                } else if (isEditMode && existingVariantIds.length > 0) {
                    // Variants removed completely from product — always confirm this one.
                    const names = existingVariantIds
                        .map((id) => existingVariantLabels[id] || id.slice(0, 8))
                        .join('\n• ');
                    const ok = window.confirm(
                        `This will permanently remove ALL ${existingVariantIds.length} variant${existingVariantIds.length === 1 ? '' : 's'} from "${productName}":\n\n• ${names}\n\nPast orders that used these variants will keep their name for shipping, but the variants themselves will be gone. Continue?`
                    );
                    if (!ok) {
                        setLoading(false);
                        return;
                    }

                    const { error: clearOrderItemVariantRefsError } = await supabase
                        .from('order_items')
                        .update({ variant_id: null })
                        .in('variant_id', existingVariantIds);
                    if (clearOrderItemVariantRefsError) throw clearOrderItemVariantRefsError;

                    const { error: deleteAllVariantsError } = await supabase
                        .from('product_variants')
                        .delete()
                        .eq('product_id', productId);
                    if (deleteAllVariantsError) throw deleteAllVariantsError;
                }

                // Product stock for a variant product = sum of its variants as they
                // are now in the database (includes till sales made meanwhile).
                if (hasVariants && isEditMode) {
                    const { data: liveVariants, error: liveVariantsError } = await supabase
                        .from('product_variants')
                        .select('quantity')
                        .eq('product_id', productId);
                    if (liveVariantsError) throw liveVariantsError;
                    const total = (liveVariants || []).reduce((sum: number, v: any) => sum + (Number(v.quantity) || 0), 0);
                    const { error: totalError } = await supabase
                        .from('products')
                        .update({ quantity: total })
                        .eq('id', productId);
                    if (totalError) throw totalError;
                }

                // 2. Product-level images
                images.forEach((img, idx) => {
                    imageInserts.push({
                        product_id: productId,
                        url: img.url,
                        position: idx,
                        alt_text: productName,
                        variant_id: null
                    });
                });

                // SAFE IMAGE SYNC: diff against existing rows instead of the
                // old "delete-all-then-insert" pattern, which would wipe a
                // product's images entirely if the insert failed midway.
                //
                //   - keepKey = `${variant_id ?? 'null'}::${url}`
                //   - existing rows with a matching key stay put (and their
                //     position/alt_text is refreshed in-place).
                //   - existing rows whose key is no longer desired are removed.
                //   - new desired rows that don't exist yet are inserted.
                const keyOf = (v: string | null | undefined, u: string) => `${v ?? 'null'}::${u}`;
                const desiredKeys = new Set(imageInserts.map(i => keyOf(i.variant_id, i.url)));

                if (isEditMode) {
                    const { data: existingImgs } = await supabase
                        .from('product_images')
                        .select('id, url, variant_id')
                        .eq('product_id', productId);

                    const existingByKey = new Map<string, { id: string }>();
                    for (const img of existingImgs ?? []) {
                        existingByKey.set(keyOf(img.variant_id, img.url), { id: img.id });
                    }

                    const toDelete = (existingImgs ?? [])
                        .filter(img => !desiredKeys.has(keyOf(img.variant_id, img.url)))
                        .map(img => img.id);

                    const toInsert = imageInserts.filter(i => !existingByKey.has(keyOf(i.variant_id, i.url)));
                    const toUpdate = imageInserts
                        .filter(i => existingByKey.has(keyOf(i.variant_id, i.url)))
                        .map(i => ({
                            id: existingByKey.get(keyOf(i.variant_id, i.url))!.id,
                            position: i.position,
                            alt_text: i.alt_text,
                        }));

                    if (toInsert.length > 0) {
                        const { error: insErr } = await supabase.from('product_images').insert(toInsert);
                        if (insErr) throw insErr;
                    }
                    for (const row of toUpdate) {
                        const { error: updErr } = await supabase
                            .from('product_images')
                            .update({ position: row.position, alt_text: row.alt_text })
                            .eq('id', row.id);
                        if (updErr) throw updErr;
                    }
                    if (toDelete.length > 0) {
                        const { error: delErr } = await supabase
                            .from('product_images')
                            .delete()
                            .in('id', toDelete);
                        if (delErr) throw delErr;
                    }
                } else if (imageInserts.length > 0) {
                    const { error: imgError } = await supabase.from('product_images').insert(imageInserts);
                    if (imgError) throw imgError;
                }
            }

            alert(isEditMode ? 'Product updated successfully!' : 'Product created successfully!');
            router.push('/admin/products', { scroll: false });

        } catch (err: any) {
            console.error('Error saving product:', err);
            const message = /products_slug_key/.test(err?.message || '')
                ? 'Another product already uses this web address. Open the SEO tab, change the URL Slug, then save again.'
                : /failed to fetch|networkerror|load failed|network request failed/i.test(err?.message || '')
                    ? 'The connection dropped before the product was saved. Check your internet connection, then save again.'
                    : err.message;
            alert(`Error: ${message}`);
        } finally {
            clearTimeout(saveWatch);
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 pb-28 sm:pb-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <Link
                        href="/admin/products"
                        aria-label="Back to products"
                        className="w-11 h-11 shrink-0 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
                    >
                        <i className="ri-arrow-left-line text-xl text-gray-700"></i>
                    </Link>
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                            {isEditMode ? 'Edit Product' : 'Add New Product'}
                        </h1>
                        <p className="text-gray-600 mt-1">
                            {isEditMode ? 'Update product information and settings' : 'Create a new product for your catalog'}
                        </p>
                    </div>
                </div>

                {/* Phones: a save bar fixed to the bottom of the screen, reachable from every tab. */}
                <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:static sm:z-auto sm:flex-nowrap sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                    {(formErrors.name || formErrors.price || formErrors.variants) && (
                        <p className="w-full sm:w-auto text-sm text-red-600 font-medium" role="alert">
                            Fix the highlighted fields to save.
                        </p>
                    )}
                    {isEditMode && (
                        <Link
                            href={`/product/${initialData?.id}`}
                            target="_blank"
                            className="px-4 sm:px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-semibold whitespace-nowrap cursor-pointer flex items-center justify-center"
                        >
                            <i className="ri-eye-line mr-2"></i>
                            Preview
                        </Link>
                    )}
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className={`flex-1 sm:flex-none justify-center px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        {loading ? (
                            <><i className="ri-loader-4-line animate-spin mr-2"></i>Saving...</>
                        ) : (
                            <><i className="ri-save-line mr-2"></i>{isEditMode ? 'Save Changes' : 'Create Product'}</>
                        )}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="border-b border-gray-200 overflow-x-auto">
                    <div className="flex">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-2 px-6 py-4 font-semibold whitespace-nowrap transition-colors border-b-2 cursor-pointer ${activeTab === tab.id
                                    ? 'border-blue-700 text-blue-700 bg-blue-50'
                                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                            >
                                <i className={`${tab.icon} text-xl`}></i>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-8">
                    {/* ── GENERAL TAB ── */}
                    {activeTab === 'general' && (
                        <div className="space-y-6 max-w-3xl">
                            <PhotoFirstDetails
                                images={images}
                                onPhotosAdded={(urls) =>
                                    setImages(prev => [...prev, ...urls.map((url, i) => ({ url, position: prev.length + i }))])
                                }
                                name={productName}
                                description={description}
                                onNameChange={(value) => {
                                    setProductName(value);
                                    if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined }));
                                }}
                                onDescriptionChange={setDescription}
                            />

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Product Name *</label>
                                <input
                                    type="text"
                                    value={productName}
                                    onChange={(e) => {
                                        setProductName(e.target.value);
                                        if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined }));
                                    }}
                                    aria-invalid={!!formErrors.name}
                                    className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.name ? 'border-red-500' : 'border-gray-300'}`}
                                    placeholder="Enter product name"
                                />
                                {formErrors.name && (
                                    <p className="text-sm text-red-600 mt-1" role="alert">{formErrors.name}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Description</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={6}
                                    maxLength={500}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                                    placeholder="Describe your product..."
                                />
                                <p className="text-sm text-gray-500 mt-2">{description.length}/500 characters</p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">Category *</label>
                                    <select
                                        value={categoryId}
                                        onChange={(e) => setCategoryId(e.target.value)}
                                        className="w-full px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                                    >
                                        {categories.length === 0 && (
                                            <option value="">
                                                {categoriesState === 'loading'
                                                    ? 'Loading categories...'
                                                    : categoriesState === 'failed'
                                                        ? 'Categories did not load'
                                                        : 'No categories yet'}
                                            </option>
                                        )}
                                        {categories.length > 0 && <option value="">Select a category</option>}
                                        {categories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                    {categoriesState === 'failed' && categories.length === 0 && (
                                        <p role="alert" className="mt-2 text-sm text-red-700">
                                            The category list did not load. Check your internet connection.{' '}
                                            <button
                                                type="button"
                                                onClick={loadCategories}
                                                className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2 hover:text-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                                            >
                                                Try again
                                            </button>
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">Status</label>
                                    <select
                                        value={status}
                                        onChange={(e) => setStatus(normalizeProductStatus(e.target.value))}
                                        className="w-full px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                                    >
                                        <option value="active">Active</option>
                                        <option value="draft">Draft</option>
                                        <option value="archived">Archived</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">
                                    Product Visibility
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setVisibility('global')}
                                        className={`text-left rounded-xl border-2 p-4 transition-colors cursor-pointer ${
                                            visibility === 'global'
                                                ? 'border-blue-600 bg-blue-50'
                                                : 'border-gray-200 hover:border-gray-300 bg-white'
                                        }`}
                                    >
                                        <p className="font-semibold text-gray-900">Global</p>
                                        <p className="text-xs text-gray-600 mt-1">
                                            Visible on the website and in POS (default).
                                        </p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisibility('pos_only')}
                                        className={`text-left rounded-xl border-2 p-4 transition-colors cursor-pointer ${
                                            visibility === 'pos_only'
                                                ? 'border-violet-600 bg-violet-50'
                                                : 'border-gray-200 hover:border-gray-300 bg-white'
                                        }`}
                                    >
                                        <p className="font-semibold text-gray-900">POS only</p>
                                        <p className="text-xs text-gray-600 mt-1">
                                            Walk-in sales only — hidden from website product pages.
                                        </p>
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center space-x-3">
                                <input
                                    type="checkbox"
                                    checked={featured}
                                    onChange={(e) => setFeatured(e.target.checked)}
                                    className="w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                />
                                <label className="text-gray-900 font-medium">Feature this product on homepage</label>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Pre-order / Estimated Shipping</label>
                                <input
                                    type="text"
                                    value={preorderShipping}
                                    onChange={(e) => setPreorderShipping(e.target.value)}
                                    placeholder="e.g., Ships in 14 days, Available March 15"
                                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                                <p className="text-xs text-gray-500 mt-1">Leave empty if product ships immediately.</p>
                            </div>
                        </div>
                    )}

                    {/* ── PRICING TAB ── */}
                    {activeTab === 'pricing' && (
                        <div className="space-y-6 max-w-3xl">
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">Price (GH₵) *</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                        <input
                                            type="number"
                                            value={price}
                                            onChange={(e) => {
                                                setPrice(e.target.value);
                                                if (formErrors.price || formErrors.variants) setFormErrors(prev => ({ ...prev, price: undefined, variants: undefined }));
                                            }}
                                            aria-invalid={!!formErrors.price}
                                            className={`w-full pl-16 pr-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.price ? 'border-red-500' : 'border-gray-300'}`}
                                            step="0.01" min="0" placeholder="0.00"
                                        />
                                    </div>
                                    {formErrors.price && (
                                        <p className="text-sm text-red-600 mt-1" role="alert">{formErrors.price}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-2">Compare at Price (GH₵)</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                        <input
                                            type="number"
                                            value={comparePrice}
                                            onChange={(e) => setComparePrice(e.target.value)}
                                            className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            step="0.01" placeholder="0.00"
                                        />
                                    </div>
                                    <p className="text-sm text-gray-500 mt-2">Show original price for comparison</p>
                                </div>
                            </div>

                            {price && comparePrice && parseFloat(comparePrice) > parseFloat(price) && (
                                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                    <p className="text-blue-900 font-semibold mb-1">Discount Calculation</p>
                                    <p className="text-blue-800">
                                        Savings: GH₵ {(parseFloat(comparePrice) - parseFloat(price)).toFixed(2)}
                                        <span className="ml-2">({(((parseFloat(comparePrice) - parseFloat(price)) / parseFloat(comparePrice)) * 100).toFixed(0)}% off)</span>
                                    </p>
                                </div>
                            )}

                            {/* ── SALE ── */}
                            <div className="pt-6 border-t border-gray-200">
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-lg font-bold text-gray-900">Sale</h3>
                                    <span
                                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                            saleOn ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                        }`}
                                    >
                                        Sale switch {saleOn ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-500 mb-4">
                                    Set a sale price for this product. Customers see it while this product&apos;s sale
                                    switch is ON. Switch it on or off in the Live column on Admin → Sales. While it is OFF,
                                    the product sells at its regular price and this sale price is kept.
                                </p>

                                {variantGroups.length > 0 ? (
                                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 flex items-start gap-2">
                                        <i className="ri-information-line text-gray-400 text-lg mt-0.5"></i>
                                        <span>
                                            This product has variants, and customers are charged the variant price.
                                            Set each variant&apos;s sale price in the <strong>Variants</strong> tab
                                            (there&apos;s a Sale price column next to each price), or apply a
                                            percentage to everything from the <strong>Admin → Sales</strong> page.
                                        </span>
                                    </div>
                                ) : (
                                    <div className="grid md:grid-cols-2 gap-6 items-start">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-900 mb-2">Sale Price (GH₵)</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                                <input
                                                    type="number"
                                                    value={salePrice}
                                                    onChange={(e) => setSalePrice(e.target.value)}
                                                    className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-400 focus:border-red-400"
                                                    step="0.01" placeholder="No sale"
                                                />
                                            </div>
                                            <p className="text-sm text-gray-500 mt-2">Leave empty for no sale.</p>
                                        </div>
                                        {salePrice && price && parseFloat(salePrice) > 0 && parseFloat(salePrice) < parseFloat(price) && (
                                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                                                <p className="text-red-900 font-semibold mb-1">
                                                    Sale: GH₵ {parseFloat(salePrice).toFixed(2)}
                                                    <span className="ml-2 text-xs font-bold bg-red-100 px-2 py-0.5 rounded">
                                                        -{Math.round((1 - parseFloat(salePrice) / parseFloat(price)) * 100)}%
                                                    </span>
                                                </p>
                                                <p className="text-red-800 text-sm">
                                                    {saleOn
                                                        ? 'Goes live as soon as you save.'
                                                        : 'Saved, but switched off. Turn it on in Admin → Sales.'}
                                                </p>
                                            </div>
                                        )}
                                        {salePrice && price && parseFloat(salePrice) >= parseFloat(price) && (
                                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                                                Sale price must be lower than the regular price (GH₵ {parseFloat(price).toFixed(2)}).
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="pt-6 border-t border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 mb-4">Inventory</h3>
                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">SKU (Auto-generated)</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={sku}
                                                onChange={(e) => setSku(e.target.value)}
                                                className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono bg-gray-50"
                                                readOnly
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setSku(generateSku())}
                                                className="px-4 py-3 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
                                            >
                                                <i className="ri-refresh-line text-lg"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">Barcode (EAN-13)</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={barcode}
                                                onChange={(e) => setBarcode(e.target.value)}
                                                className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono bg-gray-50"
                                                readOnly
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setBarcode(generateBarcode())}
                                                className="px-4 py-3 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
                                                title="Generate new barcode"
                                            >
                                                <i className="ri-refresh-line text-lg"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6 mt-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">POS Code (Short Code)</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={posCode}
                                                className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono bg-gray-50"
                                                readOnly
                                            />
                                            <button
                                                type="button"
                                                onClick={() => { void generatePosCode(); }}
                                                className="px-4 py-3 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
                                                title="Generate new POS code"
                                            >
                                                <i className="ri-refresh-line text-lg"></i>
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Auto-generated as 3 digits, expands to 4+ if all 3-digit codes are used.</p>
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6 mt-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">Stock Quantity *</label>
                                        {variantGroups.length > 0 ? (
                                            <div>
                                                <input
                                                    type="number"
                                                    value={variantGroups.reduce(
                                                        (sum, group) => sum + group.sizes.reduce((groupSum, size) => groupSum + (parseInt(size.stock) || 0), 0),
                                                        0
                                                    )}
                                                    readOnly
                                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                                                />
                                                <p className="text-sm text-amber-600 mt-1 flex items-center">
                                                    <i className="ri-information-line mr-1"></i>
                                                    Stock is managed per variant in the Variants tab.
                                                </p>
                                            </div>
                                        ) : (
                                            <input
                                                type="number"
                                                value={stock}
                                                onChange={(e) => setStock(e.target.value)}
                                                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                placeholder="0"
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6 mt-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">Minimum Order Quantity (MOQ)</label>
                                        <input
                                            type="number"
                                            value={moq}
                                            onChange={(e) => setMoq(e.target.value)}
                                            min="1"
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900 mb-2">Low Stock Threshold</label>
                                        <input
                                            type="number"
                                            value={lowStockThreshold}
                                            onChange={(e) => setLowStockThreshold(e.target.value)}
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── VARIANTS TAB ── */}
                    {activeTab === 'variants' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900">Product Variants</h3>
                                    <p className="text-gray-600 mt-1 text-sm">Create a variant (color/style), then add sizes with different stock and price.</p>
                                    {formErrors.variants && (
                                        <p className="text-sm text-red-600 mt-2" role="alert">{formErrors.variants}</p>
                                    )}
                                </div>
                                <button
                                    onClick={addVariantGroup}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                                >
                                    <i className="ri-add-line text-lg"></i>
                                    Add Variant
                                </button>
                            </div>

                            {variantGroups.length === 0 ? (
                                <div className="p-12 text-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                                    <i className="ri-layout-grid-line text-5xl text-gray-300 mb-3 block"></i>
                                    <p className="font-semibold text-gray-600 text-lg">No variants yet</p>
                                    <p className="text-sm text-gray-500 mt-1 mb-4">Example: Variant = Red, Sizes = S, M, L with separate stock.</p>
                                    <button
                                        onClick={addVariantGroup}
                                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                                    >
                                        <i className="ri-add-line"></i>
                                        Add First Variant
                                    </button>
                                </div>
                            ) : (
                                <div className="border border-gray-200 rounded-xl overflow-hidden">
                                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3 flex-wrap">
                                        <span className="text-sm font-semibold text-gray-700">
                                            {variantGroups.length} variant{variantGroups.length !== 1 ? 's' : ''} • {variantGroups.reduce((sum, g) => sum + g.sizes.length, 0)} size row{variantGroups.reduce((sum, g) => sum + g.sizes.length, 0) !== 1 ? 's' : ''}
                                        </span>
                                        <div className="flex gap-2 ml-auto">
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set price for ALL sizes in all variants:', price?.toString() || '0');
                                                    if (val !== null) bulkSetVariantField('price', val);
                                                }}
                                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                                            >
                                                Bulk Set Price
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set stock for ALL sizes in all variants:', '0');
                                                    if (val !== null) bulkSetVariantField('stock', val);
                                                }}
                                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                                            >
                                                Bulk Set Stock
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set SALE price for ALL sizes in all variants (leave empty to clear all sales):', '');
                                                    if (val !== null) bulkSetVariantField('salePrice', val.trim());
                                                }}
                                                className="px-3 py-1.5 bg-white border border-red-300 text-red-700 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors cursor-pointer"
                                            >
                                                Bulk Set Sale Price
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-4 space-y-4">
                                        {variantGroups.map((group) => (
                                            <div key={group.tempId} className="border border-gray-200 rounded-xl overflow-hidden">
                                                <div className="p-4 bg-white border-b border-gray-100 space-y-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 grid md:grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Variant (Color/Style)</label>
                                                                <input
                                                                    type="text"
                                                                    value={group.name}
                                                                    onChange={(e) => updateGroup(group.tempId, 'name', e.target.value)}
                                                                    placeholder="e.g. Red, Floral, Leather..."
                                                                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-lg text-base md:text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Appearance</label>
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                                                                        <button
                                                                            onClick={() => updateGroup(group.tempId, 'appearanceType', 'color')}
                                                                            className={`flex items-center gap-1.5 px-3.5 py-2 text-sm md:text-xs font-semibold transition-colors cursor-pointer ${group.appearanceType === 'color' ? 'bg-blue-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                                                        >
                                                                            <i className="ri-palette-line"></i> Color
                                                                        </button>
                                                                        <button
                                                                            onClick={() => updateGroup(group.tempId, 'appearanceType', 'image')}
                                                                            className={`flex items-center gap-1.5 px-3.5 py-2 text-sm md:text-xs font-semibold transition-colors cursor-pointer ${group.appearanceType === 'image' ? 'bg-blue-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                                                        >
                                                                            <i className="ri-image-line"></i> Image
                                                                        </button>
                                                                    </div>

                                                                    {group.appearanceType === 'color' && (
                                                                        <>
                                                                            <input
                                                                                type="color"
                                                                                value={group.colorHex}
                                                                                onChange={(e) => updateGroup(group.tempId, 'colorHex', e.target.value)}
                                                                                className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                                                                            />
                                                                            <input
                                                                                type="text"
                                                                                value={group.colorName}
                                                                                onChange={(e) => updateGroup(group.tempId, 'colorName', e.target.value)}
                                                                                placeholder="Color name (optional)"
                                                                                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm min-w-[170px]"
                                                                            />
                                                                        </>
                                                                    )}

                                                                    {group.appearanceType === 'image' && (
                                                                        <div className="flex items-center gap-2">
                                                                            {group.imageUrl ? (
                                                                                <div className="relative w-12 h-12 flex-shrink-0">
                                                                                    <img src={thumb(group.imageUrl, 96)} alt="variant" loading="lazy" decoding="async" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                                                                                    <button
                                                                                        onClick={() => updateGroup(group.tempId, 'imageUrl', '')}
                                                                                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer hover:bg-red-600"
                                                                                    >
                                                                                        <i className="ri-close-line"></i>
                                                                                    </button>
                                                                                </div>
                                                                            ) : null}
                                                                            <label className={`flex items-center gap-1.5 px-3 py-1.5 border-2 border-dashed border-gray-300 rounded-lg text-xs font-medium text-gray-500 hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer ${uploadingVariantId === group.tempId ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                                                {uploadingVariantId === group.tempId ? (
                                                                                    <><i className="ri-loader-4-line animate-spin"></i> Uploading...</>
                                                                                ) : (
                                                                                    <><i className="ri-upload-2-line"></i> {group.imageUrl ? 'Change' : 'Upload'}</>
                                                                                )}
                                                                                <input
                                                                                    type="file"
                                                                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                                                                    className="hidden"
                                                                                    disabled={uploadingVariantId !== null}
                                                                                    onChange={(e) => handleVariantImageUpload(group.tempId, e)}
                                                                                />
                                                                            </label>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={() => removeVariantGroup(group.tempId)}
                                                            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                                            title="Remove variant"
                                                        >
                                                            <i className="ri-delete-bin-line text-lg"></i>
                                                        </button>
                                                    </div>

                                                    {/* Mobile/Tablet: stacked size cards */}
                                                    <div className="lg:hidden space-y-3">
                                                        {group.sizes.map((sizeRow, index) => (
                                                            <div key={sizeRow.tempId} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                                                                <div className="flex items-center justify-between mb-3">
                                                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Size Row {index + 1}</p>
                                                                    <button
                                                                        onClick={() => removeSizeRow(group.tempId, sizeRow.tempId)}
                                                                        className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                                                        title="Remove size"
                                                                    >
                                                                        <i className="ri-close-line"></i>
                                                                    </button>
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <div>
                                                                        <label className="block text-xs font-semibold text-gray-500 mb-1">Size</label>
                                                                        <input
                                                                            type="text"
                                                                            value={sizeRow.size}
                                                                            onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'size', e.target.value)}
                                                                            placeholder="e.g. S, M, L, 42, 128GB"
                                                                            className="w-full px-3 py-3 border border-gray-200 rounded-lg text-base font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                        />
                                                                    </div>

                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        <div>
                                                                            <label className="block text-xs font-semibold text-gray-500 mb-1">Price (GH₵)</label>
                                                                            <input
                                                                                type="number"
                                                                                value={sizeRow.price}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'price', e.target.value)}
                                                                                step="0.01"
                                                                                placeholder={price?.toString() || '0.00'}
                                                                                className="w-full px-3 py-3 border border-gray-200 rounded-lg text-base font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-xs font-semibold text-red-500 mb-1">Sale price (GH₵)</label>
                                                                            <input
                                                                                type="number"
                                                                                value={sizeRow.salePrice}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'salePrice', e.target.value)}
                                                                                step="0.01"
                                                                                placeholder="No sale"
                                                                                className="w-full px-3 py-3 border border-red-200 rounded-lg text-base font-medium focus:ring-1 focus:ring-red-500 focus:border-red-500"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-xs font-semibold text-gray-500 mb-1">Stock</label>
                                                                            <input
                                                                                type="number"
                                                                                value={sizeRow.stock}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'stock', e.target.value)}
                                                                                placeholder="0"
                                                                                className="w-full px-3 py-3 border border-gray-200 rounded-lg text-base font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    <div>
                                                                        <label className="block text-xs font-semibold text-gray-500 mb-1">SKU</label>
                                                                        <input
                                                                            type="text"
                                                                            value={sizeRow.sku}
                                                                            onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'sku', e.target.value)}
                                                                            placeholder="Optional"
                                                                            className="w-full px-3 py-3 border border-gray-200 rounded-lg text-base font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Desktop: table layout */}
                                                    <div className="hidden lg:block overflow-x-auto">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                                                                    <th className="py-2 pr-3 font-semibold">Size</th>
                                                                    <th className="py-2 px-3 font-semibold">Price (GH₵)</th>
                                                                    <th className="py-2 px-3 font-semibold text-red-500">Sale price</th>
                                                                    <th className="py-2 px-3 font-semibold">Stock</th>
                                                                    <th className="py-2 px-3 font-semibold">SKU</th>
                                                                    <th className="py-2 pl-3 pr-0"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {group.sizes.map((sizeRow) => (
                                                                    <tr key={sizeRow.tempId} className="border-b border-gray-50 last:border-b-0">
                                                                        <td className="py-2 pr-3">
                                                                            <input
                                                                                type="text"
                                                                                value={sizeRow.size}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'size', e.target.value)}
                                                                                placeholder="e.g. S, M, L, 42, 128GB"
                                                                                className="w-full min-w-[110px] px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </td>
                                                                        <td className="py-2 px-3">
                                                                            <input
                                                                                type="number"
                                                                                value={sizeRow.price}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'price', e.target.value)}
                                                                                step="0.01"
                                                                                placeholder={price?.toString() || '0.00'}
                                                                                className="w-full min-w-[90px] px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </td>
                                                                        <td className="py-2 px-3">
                                                                            <input
                                                                                type="number"
                                                                                value={sizeRow.salePrice}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'salePrice', e.target.value)}
                                                                                step="0.01"
                                                                                placeholder="No sale"
                                                                                className="w-full min-w-[90px] px-3 py-2.5 border border-red-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-red-500 focus:border-red-500"
                                                                            />
                                                                        </td>
                                                                        <td className="py-2 px-3">
                                                                            <input
                                                                                type="number"
                                                                                value={sizeRow.stock}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'stock', e.target.value)}
                                                                                placeholder="0"
                                                                                className="w-full min-w-[90px] px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </td>
                                                                        <td className="py-2 px-3">
                                                                            <input
                                                                                type="text"
                                                                                value={sizeRow.sku}
                                                                                onChange={(e) => updateSize(group.tempId, sizeRow.tempId, 'sku', e.target.value)}
                                                                                placeholder="Optional"
                                                                                className="w-full min-w-[90px] px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </td>
                                                                        <td className="py-2 pl-3 pr-0 text-right">
                                                                            <button
                                                                                onClick={() => removeSizeRow(group.tempId, sizeRow.tempId)}
                                                                                className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                                                                title="Remove size"
                                                                            >
                                                                                <i className="ri-close-line"></i>
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>

                                                    <div className="pt-3">
                                                        <button
                                                            onClick={() => addSizeRow(group.tempId)}
                                                            className="inline-flex items-center gap-1.5 text-sm md:text-xs font-semibold text-green-700 hover:text-green-800 cursor-pointer py-1"
                                                        >
                                                            <i className="ri-add-line"></i> Add size
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="px-4 py-3 bg-blue-50 border-t border-blue-100 flex items-center justify-between">
                                        <p className="text-xs text-blue-800 flex items-center">
                                            <i className="ri-information-line mr-1.5"></i>
                                            Total stock: <strong className="ml-1">{
                                                variantGroups.reduce(
                                                    (sum, group) => sum + group.sizes.reduce((groupSum, size) => groupSum + (parseInt(size.stock) || 0), 0),
                                                    0
                                                )
                                            }</strong>
                                        </p>
                                        <button
                                            onClick={addVariantGroup}
                                            className="flex items-center gap-1.5 text-xs font-semibold text-green-700 hover:text-green-800 cursor-pointer"
                                        >
                                            <i className="ri-add-line"></i> Add another variant
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                <p className="text-sm text-amber-800">
                                    <i className="ri-lightbulb-line mr-1.5"></i>
                                    <strong>Tip:</strong> Keep one image per variant (e.g., Red). All its sizes will use the same image for cleaner management.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── IMAGES TAB ── */}
                    {activeTab === 'images' && (
                        <div className="space-y-8">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Product Images</h3>
                                <p className="text-gray-600">General product images shown by default. To add images per variant, use the Variants tab.</p>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {images.map((img: any, index: number) => (
                                    <div key={index} className="relative group">
                                        <div className="aspect-square bg-gray-100 rounded-xl overflow-hidden border-2 border-gray-200">
                                            <img src={thumb(img.url, 480)} alt={`Product ${index + 1}`} decoding="async" className="w-full h-full object-cover" />
                                        </div>
                                        {index === 0 && (
                                            <span className="absolute top-2 left-2 bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold">Primary</span>
                                        )}
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rounded-xl">
                                            <a href={img.url} target="_blank" rel="noreferrer" className="w-9 h-9 flex items-center justify-center bg-white text-gray-900 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                                                <i className="ri-eye-line"></i>
                                            </a>
                                            <button
                                                onClick={() => handleRemoveImage(index)}
                                                className="w-9 h-9 flex items-center justify-center bg-white text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                            >
                                                <i className="ri-delete-bin-line"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                <label className={`aspect-square border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-700 transition-colors flex flex-col items-center justify-center space-y-2 text-gray-600 hover:text-blue-700 cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {uploading ? <i className="ri-loader-4-line animate-spin text-3xl"></i> : <i className="ri-upload-2-line text-3xl"></i>}
                                    <span className="text-sm font-semibold text-center px-2" aria-live="polite">
                                        {!uploading
                                            ? 'Upload Images'
                                            : uploadProgress && uploadProgress.total > 1
                                                ? `Uploading ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${uploadProgress.total}...`
                                                : 'Uploading...'}
                                    </span>
                                    <span className="text-xs text-gray-400">Tap to select multiple</span>
                                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={handleImageUpload} disabled={uploading} />
                                </label>
                            </div>

                            {uploadProblem && (
                                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                                    {uploadProblem}
                                </p>
                            )}

                            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                                <p className="text-sm text-gray-700">
                                    <strong>Image Guidelines:</strong> Use high-quality images (min 1000x1000px), white or neutral backgrounds work best. Supported formats: JPG, PNG, WebP. Large photos are made smaller before they are sent, so they upload faster.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── SEO TAB ── */}
                    {activeTab === 'seo' && (
                        <div className="space-y-6 max-w-3xl">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Search Engine Optimization</h3>
                                <p className="text-gray-600">Optimize how this product appears in search results</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Page Title</label>
                                <input
                                    type="text"
                                    value={seoTitle}
                                    onChange={(e) => setSeoTitle(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="SEO friendly title"
                                />
                                <p className="text-sm text-gray-500 mt-2">60 characters recommended</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Meta Description</label>
                                <textarea
                                    rows={3}
                                    maxLength={500}
                                    value={metaDescription}
                                    onChange={(e) => setMetaDescription(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                                    placeholder="SEO friendly description"
                                />
                                <p className="text-sm text-gray-500 mt-2">160 characters recommended</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">URL Slug</label>
                                <div className="flex items-center">
                                    <span className="text-gray-600 bg-gray-100 px-4 py-3 border-2 border-r-0 border-gray-300 rounded-l-lg">store.com/product/</span>
                                    <input
                                        type="text"
                                        value={urlSlug}
                                        onChange={(e) => {
                                            setSlugEdited(true);
                                            setUrlSlug(e.target.value);
                                        }}
                                        onBlur={() => {
                                            const cleaned = slugify(urlSlug);
                                            setUrlSlug(cleaned);
                                            // Emptied: go back to following the product name.
                                            if (!cleaned) setSlugEdited(false);
                                        }}
                                        className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="product-slug"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Keywords</label>
                                <input
                                    type="text"
                                    value={keywords}
                                    onChange={(e) => setKeywords(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="keyword1, keyword2"
                                />
                                <p className="text-sm text-gray-500 mt-2">Separate keywords with commas</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
