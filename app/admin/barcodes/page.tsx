'use client';

import Link from 'next/link';
import { thumb } from '@/lib/thumb';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';
import JsBarcode from 'jsbarcode';
import { generateNextPosCode, getPosCodeFromMetadata } from '@/lib/posCode';

function generateBarcode(): string {
    const prefix = '200';
    const body = prefix + Date.now().toString().slice(-9);
    const digits = body.split('').map(Number);
    let sum = 0;
    digits.forEach((d, i) => { sum += d * (i % 2 === 0 ? 1 : 3); });
    const check = (10 - (sum % 10)) % 10;
    return body + check;
}

interface Product {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    pos_code: string;
    price: number;
    quantity: number;
    status: string;
    category_name?: string;
    image_url?: string;
    barcode_printed_at?: string | null;
}

function BarcodeImage({ value, width = 1.5, height = 50 }: { value: string; width?: number; height?: number }) {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (svgRef.current && value) {
            try {
                JsBarcode(svgRef.current, value, {
                    format: 'EAN13', width, height,
                    displayValue: true, fontSize: 12, margin: 5, background: '#ffffff',
                });
            } catch {
                try {
                    JsBarcode(svgRef.current, value, {
                        format: 'CODE128', width, height,
                        displayValue: true, fontSize: 12, margin: 5, background: '#ffffff',
                    });
                } catch { /* fallback */ }
            }
        }
    }, [value, width, height]);

    if (!value) return <span className="text-gray-400 text-sm italic">No barcode</span>;
    return <svg ref={svgRef} />;
}

type PrintEntry = {
    name: string;
    barcode: string;
    price: number;
    quantity: number;
    sku: string;
    image: string;
    /** Current stock on hand — shown in the print header so staff can match label counts to stock. */
    stock?: number;
    /** When present, render one distinct label per cell (e.g. one per variant) instead of `quantity` identical copies. */
    cells?: { caption: string; barcode: string; price: number }[];
};

// Static stylesheet for the print window. No product data is ever placed in
// HTML strings: every name, SKU and price is set with textContent below, and
// barcodes are drawn with the bundled JsBarcode (no CDN script to fail).
const PRINT_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; background: #fff; }
@media print {
    @page { margin: 5mm; size: A4; }
    .no-print { display: none !important; }
    .product-section { break-before: page; }
    .product-section:first-of-type { break-before: auto; }
}
.toolbar { padding: 12px; text-align: center; background: #f5f5f5; border-bottom: 1px solid #ddd; position: sticky; top: 0; z-index: 10; }
.toolbar button { padding: 10px 24px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; margin: 0 4px; }
.toolbar button:hover { background: #1d4ed8; }
.toolbar .warn { margin-top: 8px; color: #b91c1c; font-size: 13px; font-weight: 600; }
.store-header { padding: 16px; text-align: center; border-bottom: 2px solid #333; margin-bottom: 8px; }
.store-header h1 { font-size: 18px; margin-bottom: 2px; }
.store-header p { font-size: 11px; color: #666; }
.product-section { border: 2px solid #e5e7eb; border-radius: 12px; margin: 12px; overflow: hidden; }
.product-header { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; }
.product-img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; flex-shrink: 0; }
.product-img-placeholder { width: 64px; height: 64px; border-radius: 8px; background: #f3f4f6; flex-shrink: 0; }
.product-info h2 { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
.product-info .meta { font-size: 11px; color: #6b7280; }
.product-info .meta span { margin-right: 10px; }
.product-info .price-tag { font-size: 16px; font-weight: 800; color: #1d4ed8; margin-top: 2px; }
.qty-badge { display: inline-block; background: #dbeafe; color: #1e40af; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; }
.stock-badge { display: inline-block; background: #dcfce7; color: #166534; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; margin-left: 4px; }
.barcode-grid, .code-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; padding: 6px; }
.barcode-cell { border: 1px solid #e5e7eb; border-radius: 4px; padding: 4px 3px; text-align: center; }
.barcode-cell .lbl-name, .code-cell .lbl-name { font-size: 7px; font-weight: 700; line-height: 1.1; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.barcode-cell .lbl-variant { font-size: 6px; font-weight: 600; color: #4b5563; line-height: 1.1; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.barcode-cell svg { max-width: 100%; height: auto; }
.barcode-cell .lbl-fallback { font-size: 10px; font-family: monospace; padding: 8px 0; color: #b91c1c; }
.barcode-cell .lbl-price { font-size: 9px; font-weight: 800; margin-top: 1px; }
.code-cell { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 4px; text-align: center; }
.code-cell .lbl-name { font-size: 8px; }
.code-cell .lbl-code { font-size: 24px; line-height: 1; font-weight: 900; letter-spacing: 1px; color: #111827; }
.code-cell .lbl-price { font-size: 10px; font-weight: 800; margin-top: 2px; }
`;

const money = (n: unknown) => `GH₵ ${Number(n || 0).toFixed(2)}`;

function safeImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch {
        return '';
    }
}

/**
 * Open an empty same-origin window and set up the shell (toolbar, header).
 * Returns null when the browser blocked the popup.
 */
function openLabelWindow(title: string, printLabel: string, summary: string) {
    const w = window.open('', '_blank');
    if (!w) return null;
    const d = w.document;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
    d.close();
    d.title = title;
    const style = d.createElement('style');
    style.textContent = PRINT_CSS;
    d.head.appendChild(style);

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
        const node = d.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const toolbar = el('div', 'no-print toolbar');
    const printBtn = el('button', undefined, printLabel);
    printBtn.addEventListener('click', () => w.print());
    const closeBtn = el('button', undefined, 'Close');
    closeBtn.addEventListener('click', () => w.close());
    toolbar.append(printBtn, closeBtn);
    d.body.appendChild(toolbar);

    const header = el('div', 'store-header');
    header.append(el('h1', undefined, 'Discount Discovery Zone'), el('p', undefined, summary));
    d.body.appendChild(header);

    const container = el('div');
    d.body.appendChild(container);
    return { w, d, el, toolbar, container };
}

function productHeader(
    ui: NonNullable<ReturnType<typeof openLabelWindow>>,
    p: { name: string; sku: string; image: string; price: number; stock?: number },
    codeLabel: string,
    codeValue: string,
    badgeText: string,
) {
    const { el } = ui;
    const h = el('div', 'product-header');
    const src = safeImageUrl(p.image);
    if (src) {
        const img = el('img', 'product-img');
        img.src = src;
        img.alt = '';
        h.appendChild(img);
    } else {
        h.appendChild(el('div', 'product-img-placeholder'));
    }
    const info = el('div', 'product-info');
    info.appendChild(el('h2', undefined, p.name));
    const meta = el('div', 'meta');
    meta.append(el('span', undefined, `SKU: ${p.sku || '—'}`), el('span', undefined, `${codeLabel}: ${codeValue}`));
    info.appendChild(meta);
    info.appendChild(el('div', 'price-tag', money(p.price)));
    const badges = el('div');
    badges.style.marginTop = '3px';
    badges.appendChild(el('span', 'qty-badge', badgeText));
    if (p.stock !== undefined && p.stock !== null) badges.appendChild(el('span', 'stock-badge', `In stock: ${p.stock}`));
    info.appendChild(badges);
    h.appendChild(info);
    return h;
}

/** Draw a barcode into an SVG in this document, then copy it into the print window. */
function renderBarcodeSvg(targetDoc: Document, value: string): SVGSVGElement | null {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const opts = { width: 1.2, height: 30, displayValue: true, fontSize: 9, margin: 1, background: '#fff' };
    try {
        JsBarcode(svg, value, { ...opts, format: 'EAN13' });
    } catch {
        try {
            JsBarcode(svg, value, { ...opts, format: 'CODE128' });
        } catch {
            return null;
        }
    }
    return targetDoc.importNode(svg, true);
}

/** Returns false when the popup was blocked (nothing was printed). */
function openPrintWindow(productsToPrint: PrintEntry[]): boolean {
    const totalLabels = productsToPrint.reduce((sum, p) => sum + (p.cells && p.cells.length ? p.cells.length : p.quantity), 0);
    const ui = openLabelWindow(
        'Barcode Labels - Discount Discovery Zone',
        'Print Barcodes',
        `${productsToPrint.length} product${productsToPrint.length !== 1 ? 's' : ''} · ${totalLabels} total labels · ${new Date().toLocaleDateString()}`,
    );
    if (!ui) return false;
    const { d, el, container, toolbar } = ui;
    let failed = 0;

    const makeCell = (name: string, caption: string, barcode: string, price: number) => {
        const cell = el('div', 'barcode-cell');
        cell.appendChild(el('div', 'lbl-name', name));
        if (caption) cell.appendChild(el('div', 'lbl-variant', caption));
        const svg = renderBarcodeSvg(d, barcode);
        if (svg) cell.appendChild(svg);
        else { failed++; cell.appendChild(el('div', 'lbl-fallback', barcode)); }
        cell.appendChild(el('div', 'lbl-price', money(price)));
        return cell;
    };

    for (const p of productsToPrint) {
        const hasCells = !!(p.cells && p.cells.length);
        const count = hasCells ? p.cells!.length : p.quantity;
        const badge = hasCells ? `${count} variant label${count !== 1 ? 's' : ''}` : `${count} label${count !== 1 ? 's' : ''}`;
        const section = el('div', 'product-section');
        section.appendChild(productHeader(ui, p, 'Barcode', p.barcode, badge));
        const grid = el('div', 'barcode-grid');
        if (hasCells) {
            for (const c of p.cells!) grid.appendChild(makeCell(p.name, c.caption, c.barcode, Number(c.price)));
        } else {
            for (let i = 0; i < p.quantity; i++) grid.appendChild(makeCell(p.name, '', p.barcode, Number(p.price)));
        }
        section.appendChild(grid);
        container.appendChild(section);
    }

    if (failed > 0) {
        toolbar.appendChild(el('p', 'warn', `${failed} label${failed !== 1 ? 's' : ''} could not be drawn as a barcode (the number is shown in red instead). Check those barcodes before printing.`));
    }
    return true;
}

/** Returns false when the popup was blocked (nothing was printed). */
function openPosCodePrintWindow(productsToPrint: { name: string; posCode: string; price: number; quantity: number; sku: string; image: string; stock?: number }[]): boolean {
    const totalLabels = productsToPrint.reduce((sum, p) => sum + p.quantity, 0);
    const ui = openLabelWindow(
        'POS Code Labels - Discount Discovery Zone',
        'Print POS Codes',
        `${productsToPrint.length} product${productsToPrint.length !== 1 ? 's' : ''} · ${totalLabels} total labels · ${new Date().toLocaleDateString()}`,
    );
    if (!ui) return false;
    const { el, container } = ui;
    for (const p of productsToPrint) {
        const section = el('div', 'product-section');
        section.appendChild(productHeader(ui, p, 'POS Code', p.posCode, `${p.quantity} labels`));
        const grid = el('div', 'code-grid');
        for (let i = 0; i < p.quantity; i++) {
            const cell = el('div', 'code-cell');
            cell.append(el('div', 'lbl-name', p.name), el('div', 'lbl-code', p.posCode), el('div', 'lbl-price', money(p.price)));
            grid.appendChild(cell);
        }
        section.appendChild(grid);
        container.appendChild(section);
    }
    return true;
}

const POPUP_BLOCKED = 'The print window was blocked by the browser. Allow pop-ups for this site and try again. Nothing was marked as printed.';

/** Postgres unique_violation, as returned through the API layer. */
function isUniqueViolation(error: any): boolean {
    return error?.code === '23505' || /duplicate key|unique/i.test(error?.message || '');
}

export default function BarcodesPage() {
    const ITEMS_PER_PAGE = 25;
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'with' | 'without' | 'printed' | 'not_printed'>('all');
    const [statusFilter, setStatusFilter] = useState<'active' | 'draft' | 'all'>('active');
    const [labelCounts, setLabelCounts] = useState<Record<string, number>>({});
    const [currentPage, setCurrentPage] = useState(1);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        // Load both active and draft products so staff can print labels for
        // drafts (e.g. new stock not yet published).  We page through rows
        // because PostgREST caps a bare select at 1000.
        try {
            const data = await fetchAllPaged<any>(() =>
                supabase
                    .from('products')
                    .select('id, name, sku, barcode, price, quantity, status, metadata, categories(name), product_images(url, position)')
                    .in('status', ['active', 'draft'])
                    .order('name')
            );

            const mapped = data.map((p: any) => ({
                id: p.id,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode,
                pos_code: getPosCodeFromMetadata(p.metadata),
                price: p.price,
                quantity: p.quantity,
                status: p.status || 'active',
                category_name: p.categories?.name || '',
                image_url: p.product_images?.sort((a: any, b: any) => a.position - b.position)?.[0]?.url || '',
                barcode_printed_at: p.metadata?.barcode_printed_at || null,
            }));
            setProducts(mapped);
            // Default to a single label per product (a barcode identifies the
            // product, not each unit of stock). Staff can raise it per row.
            const counts: Record<string, number> = {};
            mapped.forEach(p => { counts[p.id] = 1; });
            setLabelCounts(counts);
        } catch (error) {
            console.error('Failed to load products for barcodes:', error);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    const markAsPrinted = async (productIds: string[]) => {
        const now = new Date().toISOString();
        const done: string[] = [];
        let failures = 0;
        for (const id of productIds) {
            const { data, error } = await supabase.from('products').select('metadata').eq('id', id).single();
            if (error) { failures++; continue; }
            const existing = data?.metadata || {};
            const { error: upErr } = await supabase.from('products').update({
                metadata: { ...existing, barcode_printed_at: now }
            }).eq('id', id);
            if (upErr) failures++; else done.push(id);
        }
        setProducts(prev => prev.map(p =>
            done.includes(p.id) ? { ...p, barcode_printed_at: now } : p
        ));
        if (failures > 0) {
            setNotice({ kind: 'error', text: `Labels opened, but ${failures} product${failures !== 1 ? 's' : ''} could not be marked as printed.` });
        }
    };

    /** Save a value, retrying with a fresh code when it collides with the unique index. */
    const saveUniqueCode = async (
        productId: string,
        kind: 'barcode' | 'pos_code',
        used: Set<string>,
        nextCode: () => string,
    ): Promise<string | null> => {
        for (let attempt = 0; attempt < 25; attempt++) {
            const code = nextCode();
            used.add(code);
            let error: any;
            if (kind === 'barcode') {
                ({ error } = await supabase.from('products').update({ barcode: code }).eq('id', productId));
            } else {
                const { data, error: readErr } = await supabase.from('products').select('metadata').eq('id', productId).single();
                if (readErr) throw readErr;
                ({ error } = await supabase.from('products').update({
                    metadata: { ...(data?.metadata || {}), pos_code: code }
                }).eq('id', productId));
            }
            if (!error) return code;
            if (!isUniqueViolation(error)) throw error;
            // Taken by a product not in our list (or saved by someone else just now): try the next one.
            if (kind === 'barcode') await new Promise(r => setTimeout(r, 5));
        }
        return null;
    };

    const reportGeneration = (label: string, total: number, failed: string[]) => {
        if (failed.length === 0) {
            setNotice({ kind: 'ok', text: `${label} created for ${total} product${total !== 1 ? 's' : ''}.` });
        } else {
            setNotice({
                kind: 'error',
                text: `${label} created for ${total - failed.length} of ${total}. Failed: ${failed.slice(0, 10).join('; ')}${failed.length > 10 ? ` and ${failed.length - 10} more` : ''}.`,
            });
        }
    };

    const generateForAll = async () => {
        const missing = products.filter(p => !p.barcode);
        if (missing.length === 0) return;
        setGenerating(true);
        setNotice(null);
        const used = new Set(products.filter(p => p.barcode).map(p => p.barcode!));
        const failed: string[] = [];
        for (const product of missing) {
            try {
                const code = await saveUniqueCode(product.id, 'barcode', used, () => {
                    let c: string;
                    do { c = generateBarcode(); } while (used.has(c));
                    return c;
                });
                if (!code) failed.push(`${product.name}: no free barcode found`);
            } catch (err: any) {
                failed.push(`${product.name}: ${err?.message || 'failed'}`);
            }
            await new Promise(r => setTimeout(r, 20));
        }
        await fetchProducts();
        setGenerating(false);
        reportGeneration('Barcodes', missing.length, failed);
    };

    const generatePosCodesForAll = async () => {
        const missing = products.filter(p => !p.pos_code);
        if (missing.length === 0) return;
        setGenerating(true);
        setNotice(null);
        const used = new Set(products.filter(p => p.pos_code).map(p => p.pos_code));
        const failed: string[] = [];
        for (const product of missing) {
            try {
                const code = await saveUniqueCode(product.id, 'pos_code', used, () => generateNextPosCode(used));
                if (!code) failed.push(`${product.name}: no free POS code found`);
            } catch (err: any) {
                failed.push(`${product.name}: ${err?.message || 'failed'}`);
            }
        }
        await fetchProducts();
        setGenerating(false);
        reportGeneration('POS codes', missing.length, failed);
    };

    const generateForOne = async (productId: string) => {
        const product = products.find(p => p.id === productId);
        const used = new Set(products.filter(p => p.barcode).map(p => p.barcode!));
        setNotice(null);
        try {
            const code = await saveUniqueCode(productId, 'barcode', used, () => {
                let c: string;
                do { c = generateBarcode(); } while (used.has(c));
                return c;
            });
            if (!code) setNotice({ kind: 'error', text: `Could not find a free barcode for ${product?.name || 'this product'}.` });
        } catch (err: any) {
            setNotice({ kind: 'error', text: `Barcode not saved: ${err?.message || 'unknown error'}` });
        }
        await fetchProducts();
    };

    const generatePosCodeForOne = async (productId: string) => {
        const product = products.find(p => p.id === productId);
        const used = new Set(products.filter(p => p.pos_code).map(p => p.pos_code));
        setNotice(null);
        try {
            const code = await saveUniqueCode(productId, 'pos_code', used, () => generateNextPosCode(used));
            if (!code) setNotice({ kind: 'error', text: `Could not find a free POS code for ${product?.name || 'this product'}.` });
        } catch (err: any) {
            setNotice({ kind: 'error', text: `POS code not saved: ${err?.message || 'unknown error'}` });
        }
        await fetchProducts();
    };

    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const filtered = products.filter(p => {
        const matchesSearch = !searchQuery ||
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.barcode?.includes(searchQuery) ||
            p.pos_code?.includes(searchQuery);
        const matchesFilter =
            filter === 'all' ? true :
            filter === 'with' ? !!p.barcode :
            filter === 'without' ? !p.barcode :
            filter === 'printed' ? !!p.barcode_printed_at :
            filter === 'not_printed' ? (!!p.barcode && !p.barcode_printed_at) :
            true;
        const matchesStatus =
            statusFilter === 'all' ? true :
            statusFilter === 'active' ? p.status === 'active' :
            statusFilter === 'draft' ? p.status === 'draft' :
            true;
        return matchesSearch && matchesFilter && matchesStatus;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    const pageStart = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageEnd = pageStart + ITEMS_PER_PAGE;
    const paginatedProducts = filtered.slice(pageStart, pageEnd);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, filter, statusFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const selectAll = () => {
        const currentPageIds = paginatedProducts.map(p => p.id);
        const isAllCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every(id => selected.has(id));

        setSelected(prev => {
            const next = new Set(prev);
            if (isAllCurrentPageSelected) {
                currentPageIds.forEach(id => next.delete(id));
            } else {
                currentPageIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const updateLabelCount = (id: string, value: number) => {
        setLabelCounts(prev => ({ ...prev, [id]: Math.max(1, value) }));
    };

    const printSingleProduct = async (product: Product) => {
        if (!product.barcode) return;
        // How many copies of each label to print (defaults to 1).
        const copies = Math.max(1, labelCounts[product.id] || 1);

        // If this is a variant product, print one label per variant so the
        // shelf shows one of each option instead of N copies for the stock.
        const { data: variants, error: variantsError } = await supabase
            .from('product_variants')
            .select('id, name, option1, option2, option3, price, barcode')
            .eq('product_id', product.id)
            .order('created_at', { ascending: true });
        if (variantsError) {
            setNotice({ kind: 'error', text: `Could not load variants: ${variantsError.message}` });
            return;
        }

        if (variants && variants.length > 0) {
            const cells = variants
                .map((v: any) => {
                    const caption = [v.option1, v.option2, v.option3]
                        .filter(Boolean)
                        .join(' / ') || v.name || '';
                    const barcode = v.barcode || product.barcode!;
                    const price = (v.price !== null && v.price !== undefined) ? v.price : product.price;
                    return { caption, barcode, price };
                })
                .filter(c => !!c.barcode)
                // Repeat each variant `copies` times if more than one copy requested.
                .flatMap(c => Array.from({ length: copies }, () => c));

            const opened = openPrintWindow([{
                name: product.name,
                barcode: product.barcode,
                price: product.price,
                quantity: 1,
                sku: product.sku,
                image: product.image_url || '',
                stock: product.quantity,
                cells,
            }]);
            if (!opened) { setNotice({ kind: 'error', text: POPUP_BLOCKED }); return; }
            await markAsPrinted([product.id]);
            return;
        }

        const opened = openPrintWindow([{
            name: product.name,
            barcode: product.barcode,
            price: product.price,
            quantity: copies,
            sku: product.sku,
            image: product.image_url || '',
            stock: product.quantity,
        }]);
        if (!opened) { setNotice({ kind: 'error', text: POPUP_BLOCKED }); return; }
        await markAsPrinted([product.id]);
    };

    const handlePrintSelected = async () => {
        const toPrint = selected.size > 0
            ? products.filter(p => selected.has(p.id) && p.barcode)
            : filtered.filter(p => p.barcode);

        if (toPrint.length === 0) {
            alert('No products with barcodes to print. Generate barcodes first.');
            return;
        }

        const opened = openPrintWindow(toPrint.map(p => ({
            name: p.name,
            barcode: p.barcode!,
            price: p.price,
            quantity: labelCounts[p.id] || Math.min(Math.max(p.quantity, 1), 50),
            sku: p.sku,
            image: p.image_url || '',
            stock: p.quantity,
        })));
        if (!opened) { setNotice({ kind: 'error', text: POPUP_BLOCKED }); return; }
        await markAsPrinted(toPrint.map(p => p.id));
    };

    const printSinglePosCode = (product: Product) => {
        if (!product.pos_code) return;
        const qty = labelCounts[product.id] || Math.min(Math.max(product.quantity, 1), 50);
        const opened = openPosCodePrintWindow([{
            name: product.name,
            posCode: product.pos_code,
            price: product.price,
            quantity: qty,
            sku: product.sku,
            image: product.image_url || '',
            stock: product.quantity,
        }]);
        if (!opened) setNotice({ kind: 'error', text: POPUP_BLOCKED.replace(' Nothing was marked as printed.', '') });
    };

    const handlePrintPosCodes = () => {
        const toPrint = selected.size > 0
            ? products.filter(p => selected.has(p.id) && p.pos_code)
            : paginatedProducts.filter(p => p.pos_code);

        if (toPrint.length === 0) {
            alert('No products with POS codes to print. Generate POS codes first.');
            return;
        }

        const opened = openPosCodePrintWindow(toPrint.map(p => ({
            name: p.name,
            posCode: p.pos_code,
            price: p.price,
            quantity: labelCounts[p.id] || Math.min(Math.max(p.quantity, 1), 50),
            sku: p.sku,
            image: p.image_url || '',
            stock: p.quantity,
        })));
        if (!opened) setNotice({ kind: 'error', text: POPUP_BLOCKED.replace(' Nothing was marked as printed.', '') });
    };

    const missingCount = products.filter(p => !p.barcode).length;
    const missingPosCodeCount = products.filter(p => !p.pos_code).length;
    const draftCount = products.filter(p => p.status === 'draft').length;
    const activeCount = products.filter(p => p.status === 'active').length;
    // Stat cards reflect the currently selected status so the numbers match
    // what's being shown in the table below.
    const statusScoped = statusFilter === 'all'
        ? products
        : products.filter(p => p.status === statusFilter);
    const totalSelectedLabels = (selected.size > 0
        ? products.filter(p => selected.has(p.id) && p.barcode)
        : filtered.filter(p => p.barcode)
    ).reduce((sum, p) => sum + (labelCounts[p.id] || Math.min(Math.max(p.quantity, 1), 50)), 0);

    return (
        <div className="space-y-6">
            {notice && (
                <div className={`flex items-start gap-2 px-4 py-3 rounded-lg border ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`} role="status">
                    <i className={`${notice.kind === 'ok' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} mt-0.5`}></i>
                    <span className="min-w-0 flex-1 break-words">{notice.text}</span>
                    <button onClick={() => setNotice(null)} aria-label="Dismiss" className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center opacity-70 hover:opacity-100 sm:m-0 sm:block sm:h-auto sm:w-auto"><i className="ri-close-line"></i></button>
                </div>
            )}
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <Link href="/admin/products" className="w-11 h-11 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400 transition-colors">
                        <i className="ri-arrow-left-line text-xl text-gray-700"></i>
                    </Link>
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Barcode Manager</h1>
                        <p className="text-gray-600 mt-1">Generate, view and print barcodes for your products</p>
                    </div>
                </div>
                <div className="flex w-full sm:w-auto items-center gap-2 flex-wrap">
                    {missingCount > 0 && (
                        <button
                            onClick={generateForAll}
                            disabled={generating}
                            className="flex flex-auto sm:flex-none justify-center sm:justify-start min-h-[44px] sm:min-h-0 items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {generating ? (
                                <><i className="ri-loader-4-line animate-spin"></i> Generating...</>
                            ) : (
                                <><i className="ri-barcode-line"></i> Generate All Missing ({missingCount})</>
                            )}
                        </button>
                    )}
                    {missingPosCodeCount > 0 && (
                        <button
                            onClick={generatePosCodesForAll}
                            disabled={generating}
                            className="flex flex-auto sm:flex-none justify-center sm:justify-start min-h-[44px] sm:min-h-0 items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {generating ? (
                                <><i className="ri-loader-4-line animate-spin"></i> Generating...</>
                            ) : (
                                <><i className="ri-hashtag"></i> Generate Missing POS Codes ({missingPosCodeCount})</>
                            )}
                        </button>
                    )}
                    <button
                        onClick={handlePrintSelected}
                        className="flex flex-auto sm:flex-none justify-center sm:justify-start min-h-[44px] sm:min-h-0 items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                    >
                        <i className="ri-printer-line"></i>
                        Print {selected.size > 0 ? `Selected (${selected.size})` : 'All'} ({totalSelectedLabels} labels)
                    </button>
                    <button
                        onClick={handlePrintPosCodes}
                        className="flex flex-auto sm:flex-none justify-center sm:justify-start min-h-[44px] sm:min-h-0 items-center gap-2 px-4 py-2.5 bg-violet-700 hover:bg-violet-800 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                    >
                        <i className="ri-price-tag-3-line"></i>
                        Print POS Codes
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 sm:gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">{statusFilter === 'all' ? 'Total Products' : statusFilter === 'draft' ? 'Draft Products' : 'Active Products'}</p>
                    <p className="text-xl sm:text-2xl font-bold text-gray-900">{statusScoped.length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">With Barcode</p>
                    <p className="text-xl sm:text-2xl font-bold text-green-600">{statusScoped.filter(p => p.barcode).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Missing Barcode</p>
                    <p className="text-xl sm:text-2xl font-bold text-amber-600">{statusScoped.filter(p => !p.barcode).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Missing POS Code</p>
                    <p className="text-xl sm:text-2xl font-bold text-purple-600">{statusScoped.filter(p => !p.pos_code).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Printed</p>
                    <p className="text-xl sm:text-2xl font-bold text-green-700">{statusScoped.filter(p => p.barcode_printed_at).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Selected</p>
                    <p className="text-xl sm:text-2xl font-bold text-blue-600">{selected.size}</p>
                </div>
            </div>

            {/* Tip */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <i className="ri-lightbulb-line text-blue-600 text-lg mt-0.5"></i>
                <div className="text-sm text-blue-800">
                    <strong>Tip:</strong> <strong>Print Barcode</strong> prints a single label per product — and for variant products, one label for each variant. Increase the <strong>Labels</strong> count if you want extra copies of each.
                </div>
            </div>

            {/* Search & Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="min-w-0 flex-1 relative">
                        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name, SKU, barcode, or POS code..."
                            className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="flex rounded-lg border border-gray-200 overflow-x-auto sm:overflow-hidden sm:flex-wrap">
                        {([
                            { key: 'all', label: 'All' },
                            { key: 'with', label: 'Has Barcode' },
                            { key: 'without', label: 'No Barcode' },
                            { key: 'printed', label: 'Printed' },
                            { key: 'not_printed', label: 'Not Printed' },
                        ] as const).map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={`shrink-0 whitespace-nowrap min-h-[44px] sm:min-h-0 px-3 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${filter === f.key ? 'bg-blue-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Status filter — print labels for Active or Draft products */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Product status:</span>
                    {([
                        { key: 'active', label: 'Active', count: activeCount },
                        { key: 'draft', label: 'Draft', count: draftCount },
                        { key: 'all', label: 'All', count: products.length },
                    ] as const).map(s => (
                        <button
                            key={s.key}
                            onClick={() => setStatusFilter(s.key)}
                            className={`min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold border transition-colors cursor-pointer ${statusFilter === s.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                        >
                            {s.label} <span className={statusFilter === s.key ? 'text-gray-300' : 'text-gray-400'}>({s.count})</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Products Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center">
                        <i className="ri-loader-4-line animate-spin text-3xl text-blue-600"></i>
                        <p className="text-gray-500 mt-3">Loading products...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <i className="ri-barcode-line text-5xl text-gray-300"></i>
                        <p className="text-gray-600 mt-3 font-semibold">No products found</p>
                    </div>
                ) : (
                    <>
                        <div className="px-4 sm:px-5 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                            <p className="text-gray-600">
                                Showing <strong>{pageStart + 1}</strong>-<strong>{Math.min(pageEnd, filtered.length)}</strong> of <strong>{filtered.length}</strong> products
                            </p>
                            <p className="text-gray-500">Page {currentPage} of {totalPages}</p>
                        </div>

                        {/* Table Header */}
                        <div className="hidden lg:grid grid-cols-[40px_1fr_1fr_100px_100px_100px] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase">
                            <div>
                                <input
                                    type="checkbox"
                                    checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selected.has(p.id))}
                                    onChange={selectAll}
                                    className="w-4 h-4 cursor-pointer"
                                />
                            </div>
                            <div>Product</div>
                            <div>Barcode / POS Code</div>
                            <div>Price</div>
                            <div>Labels</div>
                            <div>Actions</div>
                        </div>

                        {/* Rows */}
                        <div className="divide-y divide-gray-100">
                            {paginatedProducts.map(product => (
                                <div key={product.id} className="grid grid-cols-1 lg:grid-cols-[40px_1fr_1fr_100px_100px_100px] gap-3 px-4 sm:px-5 py-3 items-center hover:bg-gray-50 transition-colors">
                                    <div>
                                        <input
                                            type="checkbox"
                                            checked={selected.has(product.id)}
                                            onChange={() => toggleSelect(product.id)}
                                            className="w-5 h-5 sm:w-4 sm:h-4 cursor-pointer"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 min-w-0">
                                        {product.image_url ? (
                                            <img src={thumb(product.image_url, 96)} alt={product.name} loading="lazy" decoding="async" className="w-10 h-10 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                                                <i className="ri-image-line text-gray-400"></i>
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-gray-900 truncate text-sm">{product.name}</p>
                                                {product.status === 'draft' && (
                                                    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                                                        <i className="ri-draft-line text-[10px]"></i>
                                                        Draft
                                                    </span>
                                                )}
                                                {product.barcode_printed_at && (
                                                    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
                                                        <i className="ri-printer-fill text-[10px]"></i>
                                                        Printed
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                {product.category_name && <span>{product.category_name} · </span>}
                                                <span className="font-mono">{product.sku || '—'}</span>
                                                <span className="ml-2 text-purple-700 font-mono">POS: {product.pos_code || '—'}</span>
                                                <span className="ml-2 text-gray-400">Stock: {product.quantity}</span>
                                                {product.barcode_printed_at && (
                                                    <span className="ml-2 text-green-600">· Printed {new Date(product.barcode_printed_at).toLocaleDateString()}</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="min-w-0">
                                        <div className="space-y-2 overflow-x-auto">
                                            {product.barcode ? (
                                                <BarcodeImage value={product.barcode} width={1.1} height={30} />
                                            ) : (
                                                <button
                                                    onClick={() => generateForOne(product.id)}
                                                    className="flex min-h-[44px] lg:min-h-0 items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                                                >
                                                    <i className="ri-add-line"></i> Generate Barcode
                                                </button>
                                            )}
                                            {product.pos_code ? (
                                                <p className="text-xs font-bold text-purple-700 font-mono">POS: {product.pos_code}</p>
                                            ) : (
                                                <button
                                                    onClick={() => generatePosCodeForOne(product.id)}
                                                    className="flex min-h-[44px] lg:min-h-0 items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors cursor-pointer"
                                                >
                                                    <i className="ri-hashtag"></i> Generate POS Code
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <span className="font-semibold text-gray-900 text-sm">GH₵ {Number(product.price).toFixed(2)}</span>
                                    </div>

                                    <div>
                                        <input
                                            type="number"
                                            min="1"
                                            value={labelCounts[product.id] || 1}
                                            onChange={(e) => updateLabelCount(product.id, parseInt(e.target.value) || 1)}
                                            className="w-full min-h-[44px] sm:min-h-0 px-2 py-1.5 border border-gray-200 rounded-lg text-base sm:text-sm text-center font-semibold focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                            title="Number of barcode labels to print"
                                        />
                                    </div>

                                    <div>
                                        <div className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-1.5">
                                            {product.barcode && (
                                                <button
                                                    onClick={() => printSingleProduct(product)}
                                                    className="flex min-h-[44px] lg:min-h-0 items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
                                                >
                                                    <i className="ri-printer-line"></i> Print Barcode
                                                </button>
                                            )}
                                            {product.pos_code && (
                                                <button
                                                    onClick={() => printSinglePosCode(product)}
                                                    className="flex min-h-[44px] lg:min-h-0 items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors cursor-pointer"
                                                >
                                                    <i className="ri-price-tag-3-line"></i> Print POS Code
                                                </button>
                                            )}
                                            {!product.barcode && !product.pos_code && (
                                                <Link
                                                    href={`/admin/products/${product.id}`}
                                                    className="inline-flex min-h-[44px] items-center lg:min-h-0 text-blue-600 hover:text-blue-800 text-xs font-medium"
                                                >
                                                    Edit
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="px-4 sm:px-5 py-4 border-t border-gray-200 bg-white flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className="ri-arrow-left-s-line"></i>
                                Previous
                            </button>

                            <div className="order-last sm:order-none w-full sm:w-auto flex items-center gap-1 flex-wrap justify-center">
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                    .filter(page =>
                                        page === 1 ||
                                        page === totalPages ||
                                        Math.abs(page - currentPage) <= 1
                                    )
                                    .map((page, idx, arr) => {
                                        const prev = arr[idx - 1];
                                        const showEllipsis = prev && page - prev > 1;
                                        return (
                                            <div key={page} className="flex items-center gap-1">
                                                {showEllipsis && <span className="px-1 text-gray-400">...</span>}
                                                <button
                                                    onClick={() => setCurrentPage(page)}
                                                    className={`w-11 h-11 sm:w-9 sm:h-9 rounded-lg text-sm font-semibold transition-colors ${
                                                        currentPage === page
                                                            ? 'bg-blue-700 text-white'
                                                            : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    {page}
                                                </button>
                                            </div>
                                        );
                                    })}
                            </div>

                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                                <i className="ri-arrow-right-s-line"></i>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
