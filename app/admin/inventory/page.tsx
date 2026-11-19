'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';
import { downloadCsv, csvMoney } from '@/lib/csv';

type Variant = { id: string; name: string; sku: string | null; quantity: number };

type InventoryProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  currentStock: number;
  threshold: number;
  price: number;
  status: 'good' | 'low' | 'out';
  variants: Variant[];
};

type ImportRow = {
  line: number;
  key: string;
  quantity: number | null;
  productId?: string;
  variantId?: string;
  label?: string;
  current?: number;
  next?: number;
  error?: string;
};

const DEFAULT_THRESHOLD = 5;

function stockStatus(stock: number, threshold: number): InventoryProduct['status'] {
  if (stock <= 0) return 'out';
  if (stock <= threshold) return 'low';
  return 'good';
}

/** Minimal CSV parser: quoted cells, doubled quotes, commas or semicolons. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

export default function InventoryManagementPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Bulk restock
  const [restockAmount, setRestockAmount] = useState('');
  const [restocking, setRestocking] = useState(false);

  // CSV import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'set' | 'add'>('set');
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      setLoadError('');
      // Page through every product: PostgREST caps a single response.
      const data = await fetchAllPaged<any>(() =>
        supabase
          .from('products')
          .select(`
            id,
            name,
            sku,
            price,
            quantity,
            metadata,
            categories(name),
            product_variants(id, name, sku, quantity)
          `)
          .order('name')
      );

      const mapped: InventoryProduct[] = (data || []).map((p: any) => {
        const stock = p.quantity || 0;
        const t = Number(p.metadata?.low_stock_threshold);
        const threshold = Number.isFinite(t) && t > 0 ? t : DEFAULT_THRESHOLD;
        // `categories` is a single embedded object (many-to-one), not an array.
        const cat = Array.isArray(p.categories) ? p.categories[0] : p.categories;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku || '',
          category: cat?.name || 'Uncategorized',
          currentStock: stock,
          threshold,
          price: Number(p.price) || 0,
          status: stockStatus(stock, threshold),
          variants: (p.product_variants || []).map((v: any) => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            quantity: v.quantity || 0,
          })),
        };
      });
      setProducts(mapped);
    } catch (error: any) {
      console.error('Error fetching inventory:', error);
      setLoadError(`Could not load inventory: ${error?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(product => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = product.name.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      product.variants.some(v => (v.sku || '').toLowerCase().includes(q));
    const matchesFilter = stockFilter === 'all' || product.status === stockFilter;
    return matchesSearch && matchesFilter;
  });

  const lowStockCount = products.filter(p => p.status === 'low').length;
  const outOfStockCount = products.filter(p => p.status === 'out').length;
  const totalValue = products.reduce((sum, p) => sum + (Math.max(p.currentStock, 0) * p.price), 0);

  const toggleProductSelection = (id: string) => {
    setSelectedProducts(prev =>
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    );
  };

  const toggleAllProducts = () => {
    if (selectedProducts.length === filteredProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filteredProducts.map(p => p.id));
    }
  };

  /** Re-sum a product's stock from its variants (variants are the source of truth). */
  const resumProduct = async (productId: string) => {
    const { data, error } = await supabase
      .from('product_variants')
      .select('quantity')
      .eq('product_id', productId);
    if (error) throw error;
    const total = (data || []).reduce((s: number, v: any) => s + (v.quantity || 0), 0);
    const { error: upErr } = await supabase.from('products').update({ quantity: total }).eq('id', productId);
    if (upErr) throw upErr;
  };

  const handleBulkRestock = async () => {
    const n = parseInt(restockAmount, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setNotice({ kind: 'error', text: 'Enter how many units to add (a whole number above 0).' });
      return;
    }
    const chosen = products.filter(p => selectedProducts.includes(p.id));
    const simple = chosen.filter(p => p.variants.length === 0);
    const withVariants = chosen.filter(p => p.variants.length > 0);
    if (simple.length === 0) {
      setNotice({ kind: 'error', text: 'All selected products have variants. Restock those per variant on the product page or with Import CSV.' });
      return;
    }
    if (!window.confirm(`Add ${n} to the stock of ${simple.length} product${simple.length > 1 ? 's' : ''}?`)) return;

    setRestocking(true);
    setNotice(null);
    const failed: string[] = [];
    for (const p of simple) {
      try {
        // Read the live value so a sale since the page loaded is not overwritten.
        const { data, error } = await supabase.from('products').select('quantity').eq('id', p.id).single();
        if (error) throw error;
        const { error: upErr } = await supabase
          .from('products')
          .update({ quantity: (data?.quantity || 0) + n })
          .eq('id', p.id);
        if (upErr) throw upErr;
      } catch (err: any) {
        failed.push(`${p.name}: ${err?.message || 'failed'}`);
      }
    }
    setRestocking(false);
    const done = simple.length - failed.length;
    const skipped = withVariants.length
      ? ` Skipped ${withVariants.length} with variants (restock those per variant).`
      : '';
    setNotice(failed.length
      ? { kind: 'error', text: `Restocked ${done}, ${failed.length} failed: ${failed.join('; ')}.${skipped}` }
      : { kind: 'ok', text: `Added ${n} to ${done} product${done > 1 ? 's' : ''}.${skipped}` });
    setSelectedProducts([]);
    setRestockAmount('');
    fetchInventory();
  };

  const handleExportCSV = () => {
    const rows: unknown[][] = [];
    for (const p of products) {
      rows.push([p.sku, p.name, '', p.category, p.currentStock, p.threshold, csvMoney(p.price), p.status]);
      for (const v of p.variants) {
        rows.push([v.sku || '', p.name, v.name, p.category, v.quantity, '', '', '']);
      }
    }
    downloadCsv(
      `inventory-${new Date().toISOString().split('T')[0]}.csv`,
      ['SKU', 'Product', 'Variant', 'Category', 'Stock', 'Low stock at', 'Price (GHS)', 'Status'],
      rows
    );
  };

  // ---------- CSV import ----------

  const buildPreview = (text: string, mode: 'set' | 'add'): ImportRow[] | string => {
    const rows = parseCsv(text);
    if (rows.length === 0) return 'The file is empty.';
    const header = rows[0].map(h => h.trim().toLowerCase());
    let keyCol = header.findIndex(h => h === 'sku');
    let nameCol = header.findIndex(h => ['name', 'product', 'product name'].includes(h));
    let qtyCol = header.findIndex(h => ['quantity', 'qty', 'stock'].includes(h));
    let body = rows.slice(1);
    if (qtyCol === -1 && keyCol === -1 && nameCol === -1) {
      // No header row: assume "identifier, quantity".
      keyCol = 0; nameCol = -1; qtyCol = 1; body = rows;
    }
    if (qtyCol === -1) return 'Could not find a quantity column. Use the headings: SKU (or Name), Quantity.';
    if (keyCol === -1 && nameCol === -1) return 'Could not find a SKU or Name column.';

    const variantBySku = new Map<string, { product: InventoryProduct; variant: Variant }[]>();
    const productBySku = new Map<string, InventoryProduct[]>();
    const productByName = new Map<string, InventoryProduct[]>();
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      if (!k) return;
      m.set(k, [...(m.get(k) || []), v]);
    };
    for (const p of products) {
      push(productBySku, p.sku.trim().toLowerCase(), p);
      push(productByName, p.name.trim().toLowerCase(), p);
      for (const v of p.variants) push(variantBySku, (v.sku || '').trim().toLowerCase(), { product: p, variant: v });
    }

    const seen = new Set<string>();
    return body.map((cells, i): ImportRow => {
      const line = i + (body === rows ? 1 : 2);
      const sku = keyCol >= 0 ? (cells[keyCol] || '').trim() : '';
      const name = nameCol >= 0 ? (cells[nameCol] || '').trim() : '';
      const key = sku || name;
      const rawQty = (cells[qtyCol] || '').trim();
      const qty = /^-?\d+$/.test(rawQty) ? parseInt(rawQty, 10) : null;
      const row: ImportRow = { line, key, quantity: qty };
      if (!key) return { ...row, error: 'No SKU or name' };
      if (qty === null) return { ...row, error: `Quantity "${rawQty}" is not a whole number` };
      if (mode === 'set' && qty < 0) return { ...row, error: 'Quantity cannot be negative' };

      const k = key.toLowerCase();
      const vMatches = sku ? variantBySku.get(sku.toLowerCase()) || [] : [];
      if (vMatches.length > 1) return { ...row, error: 'This SKU is on more than one variant' };
      if (vMatches.length === 1) {
        const { product, variant } = vMatches[0];
        if (seen.has(variant.id)) return { ...row, error: 'Listed twice in this file' };
        seen.add(variant.id);
        const next = mode === 'set' ? qty : variant.quantity + qty;
        if (next < 0) return { ...row, error: 'Stock would go below 0' };
        return { ...row, productId: product.id, variantId: variant.id, label: `${product.name} / ${variant.name}`, current: variant.quantity, next };
      }
      const pMatches = sku ? productBySku.get(k) || [] : productByName.get(k) || [];
      if (pMatches.length === 0 && sku && name) {
        // SKU did not match; fall back to the name column if present.
        const byName = productByName.get(name.toLowerCase()) || [];
        pMatches.push(...byName);
      }
      if (pMatches.length === 0) return { ...row, error: 'No product with this SKU or name' };
      if (pMatches.length > 1) return { ...row, error: `Matches ${pMatches.length} products; use the SKU` };
      const p = pMatches[0];
      if (p.variants.length > 0) return { ...row, label: p.name, error: 'This product has variants; use the variant SKU' };
      if (seen.has(p.id)) return { ...row, error: 'Listed twice in this file' };
      seen.add(p.id);
      const next = mode === 'set' ? qty : p.currentStock + qty;
      if (next < 0) return { ...row, error: 'Stock would go below 0' };
      return { ...row, productId: p.id, label: p.name, current: p.currentStock, next };
    });
  };

  const [importText, setImportText] = useState('');

  const handleImportFile = async (file: File) => {
    setImportError('');
    setImportFileName(file.name);
    const text = await file.text();
    setImportText(text);
    const result = buildPreview(text, importMode);
    if (typeof result === 'string') {
      setImportRows(null);
      setImportError(result);
    } else {
      setImportRows(result);
    }
  };

  const changeImportMode = (mode: 'set' | 'add') => {
    setImportMode(mode);
    if (importText) {
      const result = buildPreview(importText, mode);
      if (typeof result === 'string') { setImportRows(null); setImportError(result); }
      else { setImportRows(result); setImportError(''); }
    }
  };

  const closeImport = () => {
    setShowImportModal(false);
    setImportRows(null);
    setImportText('');
    setImportFileName('');
    setImportError('');
  };

  const applyImport = async () => {
    if (!importRows) return;
    const ok = importRows.filter(r => !r.error && r.next !== r.current);
    if (ok.length === 0) return;
    setImporting(true);
    setImportError('');
    const failed: string[] = [];
    const touchedProducts = new Set<string>();
    for (const r of ok) {
      try {
        if (r.variantId) {
          const { error } = await supabase.from('product_variants').update({ quantity: r.next }).eq('id', r.variantId);
          if (error) throw error;
          touchedProducts.add(r.productId!);
        } else {
          const { error } = await supabase.from('products').update({ quantity: r.next }).eq('id', r.productId!);
          if (error) throw error;
        }
      } catch (err: any) {
        failed.push(`line ${r.line} (${r.key}): ${err?.message || 'failed'}`);
      }
    }
    for (const pid of touchedProducts) {
      try {
        await resumProduct(pid);
      } catch (err: any) {
        const name = products.find(p => p.id === pid)?.name || pid;
        failed.push(`${name}: variant stock saved but product total not updated (${err?.message || 'failed'})`);
      }
    }
    setImporting(false);
    if (failed.length) {
      setImportError(`${ok.length - failed.length} updated, ${failed.length} failed: ${failed.join('; ')}`);
      fetchInventory();
      return;
    }
    closeImport();
    setNotice({ kind: 'ok', text: `Stock updated for ${ok.length} item${ok.length > 1 ? 's' : ''}.` });
    fetchInventory();
  };

  const importReady = importRows?.filter(r => !r.error && r.next !== r.current) || [];
  const importProblems = importRows?.filter(r => r.error) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Inventory</h1>
            <p className="text-gray-600 mt-1 md:mt-2 text-sm md:text-base">Stock levels for every product. Low stock uses each product&apos;s own threshold (default {DEFAULT_THRESHOLD}).</p>
          </div>
          <Link
            href="/admin"
            className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap text-center"
          >
            Back to Dashboard
          </Link>
        </div>

        {loadError && (
          <div className="mb-6 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
            <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
            <span>{loadError}</span>
          </div>
        )}

        {notice && (
          <div className={`mb-6 flex items-start gap-2 px-4 py-3 rounded-lg border ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`} role="status">
            <i className={`${notice.kind === 'ok' ? 'ri-checkbox-circle-line text-green-600' : 'ri-error-warning-line text-red-600'} mt-0.5`}></i>
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Products</p>
                <p className="text-3xl font-bold text-gray-900">{products.length}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-stack-line text-2xl text-blue-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Low Stock Items</p>
                <p className="text-3xl font-bold text-amber-600">{lowStockCount}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-amber-100 rounded-lg">
                <i className="ri-alert-line text-2xl text-amber-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Out of Stock</p>
                <p className="text-3xl font-bold text-red-600">{outOfStockCount}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-red-100 rounded-lg">
                <i className="ri-close-circle-line text-2xl text-red-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Retail Value</p>
                <p className="text-3xl font-bold text-blue-600">GH₵{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-money-dollar-circle-line text-2xl text-blue-600"></i>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl flex items-center justify-center"></i>
                <input
                  type="text"
                  placeholder="Search by product name or SKU..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setSelectedProducts([]); }}
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
                {['all', 'low', 'out', 'good'].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => { setStockFilter(filter); setSelectedProducts([]); }}
                    className={`px-4 py-2 rounded-md font-medium text-sm transition-colors whitespace-nowrap cursor-pointer ${stockFilter === filter
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    {filter === 'all' && 'All'}
                    {filter === 'low' && `Low (${lowStockCount})`}
                    {filter === 'out' && `Out (${outOfStockCount})`}
                    {filter === 'good' && 'In Stock'}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowImportModal(true)}
                disabled={loading}
                className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-3 rounded-lg font-semibold transition-colors flex items-center space-x-2 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-upload-line"></i>
                <span>Import CSV</span>
              </button>

              <button
                onClick={handleExportCSV}
                disabled={loading || products.length === 0}
                className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-3 rounded-lg font-semibold transition-colors flex items-center space-x-2 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <i className="ri-download-line"></i>
                <span>Export</span>
              </button>
            </div>
          </div>

          {selectedProducts.length > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800 font-medium">
                {selectedProducts.length} product{selectedProducts.length > 1 ? 's' : ''} selected
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-blue-900">
                  Add
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={restockAmount}
                    onChange={(e) => setRestockAmount(e.target.value)}
                    className="w-24 px-3 py-2 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0"
                  />
                  units to each
                </label>
                <button
                  onClick={handleBulkRestock}
                  disabled={restocking}
                  className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {restocking ? 'Restocking...' : 'Restock'}
                </button>
                <button
                  onClick={() => setSelectedProducts([])}
                  className="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                      onChange={toggleAllProducts}
                      aria-label="Select all"
                      className="w-5 h-5 text-blue-700 rounded cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Product</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">SKU</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Category</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Stock</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Retail Value</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-500">Loading inventory...</td></tr>
                ) : filteredProducts.length === 0 ? (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-500">No products found.</td></tr>
                ) : (
                  filteredProducts.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProducts.includes(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          aria-label={`Select ${product.name}`}
                          className="w-5 h-5 text-blue-700 rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-gray-900">{product.name}</p>
                        {product.variants.length > 0 && (
                          <p className="text-sm text-gray-500">{product.variants.length} variant{product.variants.length > 1 ? 's' : ''}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-700">{product.sku || <span className="text-gray-400">None</span>}</td>
                      <td className="px-6 py-4 text-gray-700">{product.category}</td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">{product.currentStock}</span>
                        <span className="block text-xs text-gray-500">Low at {product.threshold}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">
                          GH₵{(Math.max(product.currentStock, 0) * product.price).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {product.status === 'good' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700 whitespace-nowrap">
                            <i className="ri-checkbox-circle-fill mr-1"></i>
                            In Stock
                          </span>
                        )}
                        {product.status === 'low' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700 whitespace-nowrap">
                            <i className="ri-alert-fill mr-1"></i>
                            Low Stock
                          </span>
                        )}
                        {product.status === 'out' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 whitespace-nowrap">
                            <i className="ri-close-circle-fill mr-1"></i>
                            Out of Stock
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 transition-colors cursor-pointer"
                          title="Edit product"
                        >
                          <i className="ri-edit-line text-lg"></i>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Import stock from CSV</h2>
              <button onClick={closeImport} aria-label="Close" className="text-gray-500 hover:text-gray-800"><i className="ri-close-line text-xl"></i></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Columns: <strong>SKU</strong> (or <strong>Name</strong>) and <strong>Quantity</strong>. A variant SKU updates that variant and
              the product total is recalculated from its variants. Nothing changes until you press Apply.
            </p>

            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="import-mode" checked={importMode === 'set'} onChange={() => changeImportMode('set')} />
                Set stock to the quantity
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="import-mode" checked={importMode === 'add'} onChange={() => changeImportMode('add')} />
                Add the quantity to current stock
              </label>
            </div>

            <label className="block border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-4 cursor-pointer hover:border-blue-500 hover:bg-blue-50">
              <i className="ri-upload-cloud-line text-3xl text-gray-400"></i>
              <p className="text-sm text-gray-600 mt-1">{importFileName || 'Choose a .csv file'}</p>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
              />
            </label>

            {importError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm" role="alert">{importError}</div>
            )}

            {importRows && (
              <>
                <p className="text-sm text-gray-700 mb-2">
                  {importReady.length} change{importReady.length === 1 ? '' : 's'} ready
                  {importProblems.length > 0 && `, ${importProblems.length} row${importProblems.length === 1 ? '' : 's'} will be skipped`}.
                </p>
                <div className="border border-gray-200 rounded-lg overflow-x-auto max-h-80 mb-4">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Line</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">In file</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Matched</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importRows.map(r => (
                        <tr key={r.line} className={r.error ? 'bg-red-50/50' : ''}>
                          <td className="px-3 py-2 text-gray-500">{r.line}</td>
                          <td className="px-3 py-2 text-gray-900">{r.key || <span className="text-gray-400">empty</span>}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {r.label}
                            {r.error && <span className="block text-red-700">{r.error}</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {!r.error && (r.next === r.current
                              ? <span className="text-gray-500">{r.current} (no change)</span>
                              : <span>{r.current} <i className="ri-arrow-right-line text-gray-400"></i> <strong>{r.next}</strong></span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={closeImport} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-semibold">Cancel</button>
              <button
                onClick={applyImport}
                disabled={importing || importReady.length === 0}
                className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {importing ? 'Applying...' : `Apply ${importReady.length} change${importReady.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
