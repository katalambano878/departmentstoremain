import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';

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

class ActionError extends Error {}

/** Turn a Supabase-style { data, error } result into data, or throw. */
function must<T>(res: { data: T; error: any }): T {
    if (res.error) throw new ActionError(res.error.message || 'Database error');
    return res.data;
}

/**
 * One atomic database call (sale_change_keep_state) that changes the sale and
 * keeps each product's on/off state: switched-off sales stay off, and a new
 * sale starts off while all sales are off.
 */
async function changeKeepingState(args: {
    p_action: 'percentage' | 'fixed' | 'remove' | 'variant_prices';
    p_ids?: string[];
    p_value?: number;
    p_items?: unknown;
}): Promise<{ result: any; productIds: string[]; paused: number }> {
    const result: any = must(await supabaseAdmin.rpc('sale_change_keep_state', args));
    return {
        result,
        productIds: Array.isArray(result?.product_ids) ? result.product_ids : args.p_ids || [],
        paused: Number(result?.paused) || 0,
    };
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
            const change = await changeKeepingState({ p_action: 'variant_prices', p_items: items });
            const out = { ...change, products: await productRows(change.productIds) };
            const updated = (out.result as any)?.variants_updated ?? 0;
            return NextResponse.json({
                success: true,
                action,
                result: out.result,
                products: out.products,
                paused: out.paused,
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
            const result = must(
                await supabaseAdmin.rpc(active ? 'resume_product_sales' : 'pause_product_sales', {
                    p_ids: productIds,
                }),
            );
            const out = { result, products: await productRows(productIds) };
            return NextResponse.json({ success: true, action, active, ...out });
        } catch (err: any) {
            return errorResponse(err, 'Failed to switch the sale');
        }
    }

    if (action === 'remove') {
        try {
            const { result } = await changeKeepingState({ p_action: 'remove', p_ids: productIds });
            const out = { result, products: await productRows(productIds) };
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
        const change = await changeKeepingState({
            p_action: mode === 'percentage' ? 'percentage' : 'fixed',
            p_ids: productIds,
            p_value: mode === 'percentage' ? value : Math.round(value * 100) / 100,
        });
        const out = { ...change, products: await productRows(productIds) };
        const updated = (out.result as any)?.products_updated ?? 0;
        return NextResponse.json({
            success: true,
            action,
            mode,
            result: out.result,
            products: out.products,
            paused: out.paused,
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
