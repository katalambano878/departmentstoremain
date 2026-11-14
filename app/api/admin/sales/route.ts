import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { withAuditActor } from '@/lib/db/pool';

/**
 * Admin Sales management endpoint.
 *
 * POST body (one of):
 *   { action: 'apply',  mode: 'percentage', value: <1-99>,  productIds: string[] }
 *   { action: 'apply',  mode: 'fixed',      value: <price>, productIds: string[] }
 *   { action: 'remove',                                     productIds: string[] }
 *   { action: 'variant_prices', items: [{ variantId, price }] }  // per-variant fixed sale prices
 *   { action: 'set_active', active: boolean }   // master on/off for ALL sales
 *   { action: 'set_product_active', active: boolean, productIds: string[] } // on/off for chosen products
 *
 * Each product's sale has its own on/off state. A paused sale keeps its
 * discounted price in metadata.paused_sale_price. Changing a sale keeps that
 * state: a paused sale stays paused, a new sale starts on when the all-sales
 * switch is on and paused when it is off. The all-sales switch turns every
 * sale on or off at once.
 *
 * All price math runs server-side in SQL functions (apply_sale_percentage /
 * apply_sale_fixed / remove_sale / pause_all_sales / resume_all_sales) so the
 * client can never set an arbitrary charged price, the "regular" price is
 * derived from authoritative DB values, and variant products are kept in sync
 * (checkout charges the variant price).
 */

const MAX_IDS = 2000;
const SALES_ACTIVE_KEY = 'sales_active';

function isUuid(v: unknown): v is string {
    return typeof v === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Reads the master sales switch. Defaults to ON if the row is missing. */
async function salesAreActive(): Promise<boolean> {
    const { data } = await supabaseAdmin
        .from('site_settings')
        .select('value')
        .eq('key', SALES_ACTIVE_KEY)
        .maybeSingle();
    if (!data) return true;
    // jsonb boolean comes back as a real boolean; tolerate string forms too.
    return data.value === true || data.value === 'true';
}

class ActionError extends Error {}

/** Throw a Supabase-style error so the surrounding transaction rolls back. */
function must<T>(res: { data: T; error: any }): T {
    if (res.error) throw new ActionError(res.error.message || 'Database error');
    return res.data;
}

type SaleState = { onSale: boolean; paused: boolean };

/** Current sale state of each product: on sale, and whether that sale is paused. */
async function saleStates(productIds: string[]): Promise<Map<string, SaleState>> {
    const rows = must(
        await supabaseAdmin.from('products').select('id, on_sale, metadata').in('id', productIds),
    ) as any[];
    const states = new Map<string, SaleState>();
    for (const r of rows || []) {
        states.set(r.id, {
            onSale: !!r.on_sale,
            paused: !!r.on_sale && r.metadata?.paused_sale_price != null,
        });
    }
    return states;
}

/**
 * Run a sale change on products, keeping each product's on/off state:
 * paused sales are switched on for the change and paused again afterwards; a
 * product that had no sale is paused afterwards when all sales are off.
 */
async function changeKeepingState(
    productIds: string[],
    change: () => Promise<any>,
    opts: { keepPaused: boolean },
) {
    const before = await saleStates(productIds);
    const pausedIds = productIds.filter((id) => before.get(id)?.paused);
    if (pausedIds.length) must(await supabaseAdmin.rpc('resume_product_sales', { p_ids: pausedIds }));
    const result = await change();
    let pausedAfter: string[] = [];
    if (opts.keepPaused) {
        const allOn = await salesAreActive();
        pausedAfter = productIds.filter((id) => {
            const s = before.get(id);
            return s?.paused || (!s?.onSale && !allOn);
        });
        if (pausedAfter.length) must(await supabaseAdmin.rpc('pause_product_sales', { p_ids: pausedAfter }));
    }
    return { result, pausedAfter };
}

/** Fresh rows for the dashboard after a change. */
async function productRows(productIds: string[]) {
    if (productIds.length === 0) return [];
    return must(
        await supabaseAdmin
            .from('products')
            .select('id, price, compare_at_price, on_sale, metadata')
            .in('id', productIds),
    );
}

export async function POST(request: Request) {
    const auth = await verifyAuth(request, { requireAdmin: true, requireFullStaff: true });
    if (!auth.authenticated) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const action = String(body?.action || '');

    // Master on/off switch for the whole campaign. Handled before the
    // productIds validation below since it operates on all sale products.
    if (action === 'set_active') {
        const active = body?.active === true;
        try {
            if (active) {
                const { data, error } = await supabaseAdmin.rpc('resume_all_sales');
                if (error) throw error;
                const { error: setErr } = await supabaseAdmin
                    .from('site_settings')
                    .upsert({ key: SALES_ACTIVE_KEY, value: true }, { onConflict: 'key' });
                if (setErr) throw setErr;
                return NextResponse.json({ success: true, action, active: true, result: data });
            } else {
                const { data, error } = await supabaseAdmin.rpc('pause_all_sales');
                if (error) throw error;
                const { error: setErr } = await supabaseAdmin
                    .from('site_settings')
                    .upsert({ key: SALES_ACTIVE_KEY, value: false }, { onConflict: 'key' });
                if (setErr) throw setErr;
                return NextResponse.json({ success: true, action, active: false, result: data });
            }
        } catch (err: any) {
            console.error('[admin/sales] set_active error:', err?.message || err);
            return NextResponse.json(
                { error: err?.message || 'Failed to toggle sales' },
                { status: 500 },
            );
        }
    }

    const actorId = auth.user?.id as string;
    const errorResponse = (err: any, fallback: string) => {
        console.error(`[admin/sales] ${action} error:`, err?.message || err);
        return NextResponse.json({ error: err?.message || fallback }, { status: 500 });
    };

    // Per-variant fixed sale prices (variant products). Validated here, price
    // math + regular-price derivation done in SQL (apply_sale_variant_prices)
    // so a sale price can never exceed the variant's authoritative regular price.
    if (action === 'variant_prices') {
        const rawItems: unknown = body?.items;
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
            return NextResponse.json({ error: 'No variant prices provided' }, { status: 400 });
        }
        if (rawItems.length > MAX_IDS) {
            return NextResponse.json(
                { error: `Too many variants in one request (max ${MAX_IDS}).` },
                { status: 400 },
            );
        }
        const items = rawItems
            .map((it: any) => ({
                variant_id: it?.variantId,
                price: Math.round(Number(it?.price) * 100) / 100,
            }))
            .filter((it) => isUuid(it.variant_id) && Number.isFinite(it.price) && it.price > 0);
        if (items.length === 0) {
            return NextResponse.json({ error: 'No valid variant prices' }, { status: 400 });
        }

        try {
            const out = await withAuditActor(actorId, async () => {
                const variants = must(
                    await supabaseAdmin
                        .from('product_variants')
                        .select('product_id')
                        .in('id', items.map((i) => i.variant_id)),
                ) as any[];
                const productIds = Array.from(new Set((variants || []).map((v) => v.product_id as string)));
                // Paused variants hold their regular price in `price`, so resuming
                // first makes the regular-price check below use the right value.
                const { result, pausedAfter } = await changeKeepingState(
                    productIds,
                    async () => must(await supabaseAdmin.rpc('apply_sale_variant_prices', { p_items: items })),
                    { keepPaused: true },
                );
                return { result, pausedAfter, products: await productRows(productIds) };
            });
            const updated = (out.result as any)?.variants_updated ?? 0;
            return NextResponse.json({
                success: true,
                action,
                result: out.result,
                products: out.products,
                paused: out.pausedAfter.length,
                skipped: items.length - updated,
                note:
                    updated < items.length
                        ? 'Some variants were skipped: a sale price must be lower than the variant\'s regular price.'
                        : undefined,
            });
        } catch (err: any) {
            return errorResponse(err, 'Failed to set variant sale prices');
        }
    }

    const rawIds: unknown = body?.productIds;

    if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return NextResponse.json({ error: 'No products selected' }, { status: 400 });
    }
    if (rawIds.length > MAX_IDS) {
        return NextResponse.json(
            { error: `Too many products in one request (max ${MAX_IDS}). Apply in smaller batches.` },
            { status: 400 },
        );
    }
    const productIds = Array.from(new Set(rawIds.filter(isUuid)));
    if (productIds.length === 0) {
        return NextResponse.json({ error: 'No valid product IDs' }, { status: 400 });
    }

    // Turn chosen products' sales on or off, whatever the all-sales switch says.
    if (action === 'set_product_active') {
        const active = body?.active === true;
        try {
            const out = await withAuditActor(actorId, async () => {
                const result = must(
                    await supabaseAdmin.rpc(active ? 'resume_product_sales' : 'pause_product_sales', {
                        p_ids: productIds,
                    }),
                );
                return { result, products: await productRows(productIds) };
            });
            return NextResponse.json({ success: true, action, active, ...out });
        } catch (err: any) {
            return errorResponse(err, 'Failed to switch the sale');
        }
    }

    if (action === 'remove') {
        try {
            const out = await withAuditActor(actorId, async () => {
                const { result } = await changeKeepingState(
                    productIds,
                    async () => must(await supabaseAdmin.rpc('remove_sale', { p_ids: productIds })),
                    { keepPaused: false },
                );
                return { result, products: await productRows(productIds) };
            });
            return NextResponse.json({ success: true, action, ...out });
        } catch (err: any) {
            return errorResponse(err, 'Failed to update sales');
        }
    }

    if (action !== 'apply') {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const mode = String(body?.mode || '');
    const value = Number(body?.value);
    if (!Number.isFinite(value)) {
        return NextResponse.json({ error: 'Invalid value' }, { status: 400 });
    }
    if (mode === 'percentage' && (value <= 0 || value >= 100)) {
        return NextResponse.json({ error: 'Discount percent must be between 1 and 99' }, { status: 400 });
    }
    if (mode === 'fixed' && value <= 0) {
        return NextResponse.json({ error: 'Sale price must be greater than 0' }, { status: 400 });
    }
    if (mode !== 'percentage' && mode !== 'fixed') {
        return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }

    try {
        const out = await withAuditActor(actorId, async () => {
            const { result, pausedAfter } = await changeKeepingState(
                productIds,
                async () =>
                    mode === 'percentage'
                        ? must(await supabaseAdmin.rpc('apply_sale_percentage', { p_ids: productIds, p_pct: value }))
                        : must(
                              await supabaseAdmin.rpc('apply_sale_fixed', {
                                  p_ids: productIds,
                                  p_price: Math.round(value * 100) / 100,
                              }),
                          ),
                { keepPaused: true },
            );
            return { result, pausedAfter, products: await productRows(productIds) };
        });
        const updated = (out.result as any)?.products_updated ?? 0;
        return NextResponse.json({
            success: true,
            action,
            mode,
            result: out.result,
            products: out.products,
            paused: out.pausedAfter.length,
            // Help the UI explain why a fixed price may have skipped some rows.
            skipped: mode === 'fixed' ? productIds.length - updated : 0,
            note:
                mode === 'fixed' && updated < productIds.length
                    ? 'Some products were skipped: a fixed sale price only applies to products without variants and must be lower than the regular price. Use a percentage for variant products.'
                    : undefined,
        });
    } catch (err: any) {
        return errorResponse(err, 'Failed to update sales');
    }
}
