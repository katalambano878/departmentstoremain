'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { generateNextPosCode, getPosCodeFromMetadata } from '@/lib/posCode';
import {
    normalizeProductVisibility,
    type ProductVisibility,
} from '@/lib/product-visibility';
import { slugify } from '@/lib/slug';

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
        if (!hasVariantRows) {
            if (md.paused_sale_price != null) {
                // Campaign paused: price already holds the regular price.
                return { price: rawPrice, compare: rawCompare, sale: String(md.paused_sale_price) };
            }
            if (initialData?.on_sale && Number(rawCompare) > Number(rawPrice)) {
                // Active sale: unswap so "Price" shows the regular price.
                return { price: rawCompare, compare: '', sale: String(rawPrice) };
            }
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
    const [sku, setSku] = useState(initialData?.sku || '');
    const [barcode, setBarcode] = useState(initialData?.barcode || '');
    const [posCode, setPosCode] = useState(getPosCodeFromMetadata(initialData?.metadata));
    const [stock, setStock] = useState(initialData?.quantity || '');
    const [moq, setMoq] = useState(initialData?.moq || '1');
    const [lowStockThreshold, setLowStockThreshold] = useState(initialData?.metadata?.low_stock_threshold || '5');
    const [description, setDescription] = useState(initialData?.description || '');
    const [status, setStatus] = useState<'active' | 'draft' | 'archived'>(
        normalizeProductStatus(initialData?.status)
    );
    const [visibility, setVisibility] = useState<ProductVisibility>(
        normalizeProductVisibility(initialData?.visibility ?? initialData?.metadata?.visibility)
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
            const file = e.target.files[0];
            const fileName = `variants/${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`;
            const { error } = await supabase.storage.from('products').upload(fileName, file);
            if (error) throw error;
            const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(fileName);
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

    // SEO
    const [seoTitle, setSeoTitle] = useState(initialData?.seo_title || '');
    const [metaDescription, setMetaDescription] = useState(initialData?.seo_description || '');
    const [urlSlug, setUrlSlug] = useState(initialData?.slug || '');
    const [keywords, setKeywords] = useState(initialData?.tags?.join(', ') || '');

    const tabs = [
        { id: 'general', label: 'General', icon: 'ri-information-line' },
        { id: 'pricing', label: 'Pricing & Inventory', icon: 'ri-price-tag-3-line' },
        { id: 'variants', label: 'Variants', icon: 'ri-layout-grid-line' },
        { id: 'images', label: 'Images', icon: 'ri-image-line' },
        { id: 'seo', label: 'SEO', icon: 'ri-search-line' }
    ];

    useEffect(() => {
        async function fetchCategories() {
            const { data } = await supabase.from('categories').select('id, name').eq('status', 'active');
            if (data) {
                setCategories(data);
                if (data.length > 0 && !categoryId) setCategoryId(data[0].id);
            }
        }
        fetchCategories();
    }, [categoryId]);

    useEffect(() => {
        if (!isEditMode && productName && !urlSlug) {
            setUrlSlug(slugify(productName));
        }
    }, [productName, isEditMode, urlSlug]);

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
        try {
            if (!e.target.files || e.target.files.length === 0) return;
            setUploading(true);
            const files = Array.from(e.target.files);
            const uploaded: { url: string; position: number }[] = [];
            for (const file of files) {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Math.random().toString(36).slice(2)}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('products').upload(fileName, file);
                if (uploadError) throw uploadError;
                const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(fileName);
                uploaded.push({ url: publicUrl, position: images.length + uploaded.length });
            }
            setImages(prev => [...prev, ...uploaded]);
        } catch (error: any) {
            alert('Error uploading image: ' + error.message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setImages(images.filter((_, idx) => idx !== indexToRemove));
    };

    const handleSubmit = async () => {
        try {
            setLoading(true);
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
                ...(initialData?.metadata || {}),
                pos_code: ensuredPosCode || null,
                low_stock_threshold: parseInt(lowStockThreshold) || 5,
                preorder_shipping: preorderShipping.trim() || null,
                visibility,
            };

            let pricingFields: Record<string, any>;
            if (hasVariants && anyVariantSale && salesActive) {
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
            } else if (hasSale && salesActive) {
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

            const productData = {
                name: productName,
                slug: slugify(urlSlug) || slugify(productName) || `product-${Date.now()}`,
                description,
                category_id: categoryId || null,
                ...pricingFields,
                sku: sku || generateSku(),
                barcode: barcode || generateBarcode(),
                quantity: hasVariants ? variantStockTotal : (parseInt(stock) || 0),
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
                const { data: newProduct, error: insertError } = await supabase.from('products').insert([productData]).select('id, price').single();
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
                            if (hasRowSale && !salesActive) {
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
                                    price: hasRowSale && salesActive ? rowSale : rowRegular,
                                    compare_at_price: hasRowSale && salesActive ? rowRegular : null,
                                    quantity: parseInt(sizeRow.stock) || 0,
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

                    if (updateRows.length > 0) {
                        const { error: upsertVariantsError } = await supabase
                            .from('product_variants')
                            .upsert(updateRows.map(r => r.payload), { onConflict: 'id' });
                        if (upsertVariantsError) throw upsertVariantsError;
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
            alert(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link
                        href="/admin/products"
                        className="w-10 h-10 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
                    >
                        <i className="ri-arrow-left-line text-xl text-gray-700"></i>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            {isEditMode ? 'Edit Product' : 'Add New Product'}
                        </h1>
                        <p className="text-gray-600 mt-1">
                            {isEditMode ? 'Update product information and settings' : 'Create a new product for your catalog'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    {isEditMode && (
                        <Link
                            href={`/product/${initialData?.id}`}
                            target="_blank"
                            className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-semibold whitespace-nowrap cursor-pointer flex items-center"
                        >
                            <i className="ri-eye-line mr-2"></i>
                            Preview
                        </Link>
                    )}
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className={`px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
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
                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-2">Product Name *</label>
                                <input
                                    type="text"
                                    value={productName}
                                    onChange={(e) => setProductName(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Enter product name"
                                />
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
                                        {categories.length === 0 && <option value="">Loading categories...</option>}
                                        {categories.length > 0 && <option value="">Select a category</option>}
                                        {categories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
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
                                            onChange={(e) => setPrice(e.target.value)}
                                            className="w-full pl-16 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            step="0.01" placeholder="0.00"
                                        />
                                    </div>
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
                                            salesActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                        }`}
                                    >
                                        Sales mode {salesActive ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-500 mb-4">
                                    Set a sale price for this product. It only shows to customers while sales mode is ON
                                    (Admin → Sales). When sales mode is OFF, the product sells at its regular price and
                                    this sale price is saved for the next campaign.
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
                                                    {salesActive
                                                        ? 'Goes live as soon as you save.'
                                                        : 'Saved — will go live when you turn sales mode on.'}
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
                                                                                    <img src={group.imageUrl} alt="variant" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
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
                                            <img src={img.url} alt={`Product ${index + 1}`} className="w-full h-full object-cover" />
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
                                    <span className="text-sm font-semibold text-center px-2">{uploading ? 'Uploading...' : 'Upload Images'}</span>
                                    <span className="text-xs text-gray-400">Tap to select multiple</span>
                                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={handleImageUpload} disabled={uploading} />
                                </label>
                            </div>

                            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                                <p className="text-sm text-gray-700">
                                    <strong>Image Guidelines:</strong> Use high-quality images (min 1000x1000px), white or neutral backgrounds work best. Supported formats: JPG, PNG, WebP (max 5MB each).
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
                                        onChange={(e) => setUrlSlug(e.target.value)}
                                        onBlur={() => setUrlSlug(slugify(urlSlug))}
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
