import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { getExecutor, withAuditActor } from '@/lib/db/pool';
import { checkRateLimit } from '@/lib/rate-limit';
import { POS_WALKIN_EMAIL, fromPesewas, toPesewas } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Till checkout. Prices every line from the database, then creates the
 * customer, order and items (and, for cash/card, marks it paid and takes the
 * stock) in ONE transaction. A repeated idempotency key returns the order
 * that key already created, so a retry never sells twice.
 *
 * Body: { idempotencyKey, items: [{ productId, variantId?, quantity }],
 *         customer: { name?, firstName?, lastName?, phone?, email? },
 *         paymentMethod: 'cash' | 'card' | 'momo', amountTendered?, saleDate?, note?,
 *         delivery?: { method: 'pickup' | 'doorstep', address?, city?, region? },
 *         expectedTotal? }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 200;
const MAX_QTY = 10_000;
/** How far back an offline sale may be dated. */
const MAX_BACKDATE_DAYS = 60;
const CHECKOUT_LIMIT = { maxRequests: 30, windowSeconds: 60 };

class CheckoutError extends Error {
  constructor(message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function accraTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function variantLabel(v: { name?: string | null; option1?: string | null; option2?: string | null }) {
  const left = v.option2?.trim();
  const right = v.option1?.trim() || v.name?.trim();
  if (left && right) return `${left} / ${right}`;
  return left || right || v.name || 'Variant';
}

function must<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message || res.error}`);
  return res.data;
}

async function loadOrderWithItems(orderId: string) {
  const order = must(
    await supabaseAdmin.from('orders').select('*').eq('id', orderId).single(),
    'Load order'
  );
  const items = must(
    await supabaseAdmin
      .from('order_items')
      .select('id, product_id, variant_id, product_name, variant_name, sku, quantity, unit_price, total_price, metadata')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
    'Load order items'
  );
  return { order, items: items || [] };
}

export async function POST(request: Request) {
  const auth = await verifyAuth(request, { requireRole: ['admin', 'staff', 'staff_pos'] });
  if (!auth.authenticated || !auth.user?.id) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.role ? 403 : 401 });
  }
  const actorId: string = auth.user.id;
  const role = auth.role;

  const rl = checkRateLimit(`pos-checkout:${actorId}`, CHECKOUT_LIMIT);
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many checkouts in a minute. Wait a moment and try again.' }, { status: 429 });
  }

  const body: any = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ---- validate the request ------------------------------------------------
  const idempotencyKey = str(body.idempotencyKey, 80);
  if (!KEY_RE.test(idempotencyKey)) {
    return NextResponse.json({ error: 'Missing or invalid idempotencyKey' }, { status: 400 });
  }

  const paymentMethod = str(body.paymentMethod, 10);
  if (!['cash', 'card', 'momo'].includes(paymentMethod)) {
    return NextResponse.json({ error: 'Payment method must be cash, card or momo' }, { status: 400 });
  }
  const isCashOrCard = paymentMethod !== 'momo';

  const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }
  if (rawItems.length > MAX_LINES) {
    return NextResponse.json({ error: `At most ${MAX_LINES} lines per sale` }, { status: 400 });
  }

  // Merge repeated lines for the same product/variant.
  const wanted = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  for (const raw of rawItems) {
    const productId = str(raw?.productId, 40);
    const variantId = raw?.variantId ? str(raw.variantId, 40) : null;
    const quantity = Number(raw?.quantity);
    if (!UUID_RE.test(productId) || (variantId !== null && !UUID_RE.test(variantId))) {
      return NextResponse.json({ error: 'Invalid product in cart' }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return NextResponse.json({ error: 'Each quantity must be a whole number of at least 1' }, { status: 400 });
    }
    const key = `${productId}:${variantId || ''}`;
    const prev = wanted.get(key);
    if (prev) prev.quantity += quantity;
    else wanted.set(key, { productId, variantId, quantity });
  }

  const customerIn = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const customerEmailIn = str(customerIn.email, 254).toLowerCase();
  if (customerEmailIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmailIn)) {
    return NextResponse.json({ error: 'Customer email is not valid' }, { status: 400 });
  }
  const customerPhone = str(customerIn.phone, 30);
  const fullNameIn = str(customerIn.name, 120);
  const firstName = str(customerIn.firstName, 60) || fullNameIn.split(' ')[0] || '';
  const lastName = str(customerIn.lastName, 60) || fullNameIn.split(' ').slice(1).join(' ') || '';
  const customerName = fullNameIn || `${firstName} ${lastName}`.trim();
  const existingCustomer = customerIn.existing === true;

  if (paymentMethod === 'momo' && !customerPhone) {
    return NextResponse.json({ error: 'Phone number is required for Mobile Money payment' }, { status: 400 });
  }

  const deliveryIn = body.delivery && typeof body.delivery === 'object' ? body.delivery : {};
  const deliveryMethod = deliveryIn.method === 'doorstep' ? 'doorstep' : 'pickup';
  const address = str(deliveryIn.address, 300);
  const city = str(deliveryIn.city, 100);
  const region = str(deliveryIn.region, 60);
  if (deliveryMethod === 'doorstep' && (!address || !city || !region)) {
    return NextResponse.json({ error: 'Address, city and region are required for delivery' }, { status: 400 });
  }

  const note = str(body.note, 1000);

  let saleDate: string | null = null;
  if (body.saleDate !== undefined && body.saleDate !== null && body.saleDate !== '') {
    if (role !== 'admin' && role !== 'staff') {
      return NextResponse.json({ error: 'Only a manager can record a sale on an earlier date' }, { status: 403 });
    }
    saleDate = str(body.saleDate, 10);
    const today = accraTodayYmd();
    const oldest = new Date(Date.now() - MAX_BACKDATE_DAYS * 86_400_000).toISOString().slice(0, 10);
    if (!YMD_RE.test(saleDate) || Number.isNaN(Date.parse(`${saleDate}T00:00:00Z`)) || saleDate > today || saleDate < oldest) {
      return NextResponse.json({ error: `Sale date must be within the last ${MAX_BACKDATE_DAYS} days` }, { status: 400 });
    }
    if (!isCashOrCard) {
      return NextResponse.json({ error: 'Offline catch-up sales must be Cash or Card. They are recorded as already paid.' }, { status: 400 });
    }
  }

  const tenderedP =
    body.amountTendered === undefined || body.amountTendered === null || body.amountTendered === ''
      ? null
      : toPesewas(body.amountTendered);
  if (tenderedP !== null && (!Number.isFinite(tenderedP) || tenderedP < 0)) {
    return NextResponse.json({ error: 'Amount tendered is not valid' }, { status: 400 });
  }
  const expectedTotalP =
    body.expectedTotal === undefined || body.expectedTotal === null ? null : toPesewas(body.expectedTotal);

  try {
    const result = await withAuditActor(actorId, async () => {
      // Serialise requests with the same key so two clicks cannot both create a sale.
      await getExecutor().query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-checkout:${idempotencyKey}`]);

      const prior = must(
        await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('metadata->>idempotency_key', idempotencyKey)
          .limit(1),
        'Look up earlier attempt'
      ) as { id: string }[] | null;
      if (prior && prior[0]) {
        return { ...(await loadOrderWithItems(prior[0].id)), replayed: true };
      }

      // ---- price every line from the database ------------------------------
      const productIds = [...new Set([...wanted.values()].map((w) => w.productId))];
      const products = must(
        await supabaseAdmin
          .from('products')
          .select('id, name, price, sku, status, product_images(url, position, variant_id), product_variants(id, name, option1, option2, sku, price, image_url)')
          .in('id', productIds),
        'Load products'
      ) as any[] | null;
      const byId = new Map((products || []).map((p) => [p.id, p]));

      let subtotalP = 0;
      const lines = [...wanted.values()].map((w) => {
        const product = byId.get(w.productId);
        if (!product) throw new CheckoutError('A product in the cart no longer exists. Remove it and try again.');
        if (product.status === 'archived') {
          throw new CheckoutError(`"${product.name}" is archived and cannot be sold. Remove it from the cart.`);
        }
        const variants: any[] = product.product_variants || [];
        let variant: any = null;
        if (w.variantId) {
          variant = variants.find((v) => v.id === w.variantId);
          if (!variant) throw new CheckoutError(`A variant of "${product.name}" no longer exists. Remove it and add it again.`);
        } else if (variants.length > 0) {
          throw new CheckoutError(`Pick a variant for "${product.name}".`);
        }
        const unitP = toPesewas(variant ? variant.price ?? product.price : product.price);
        if (!Number.isFinite(unitP) || unitP <= 0) {
          throw new CheckoutError(`"${product.name}" has no price (GH₵0). Save a price for it first.`);
        }
        const lineP = unitP * w.quantity;
        subtotalP += lineP;

        const imgs = ((product.product_images || []) as { url: string; position?: number; variant_id?: string | null }[])
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const image =
          (variant && (imgs.find((i) => i.variant_id === variant.id)?.url || variant.image_url)) ||
          imgs.find((i) => !i.variant_id)?.url ||
          imgs[0]?.url ||
          null;

        return {
          product_id: product.id,
          variant_id: variant?.id || null,
          product_name: product.name,
          variant_name: variant ? variantLabel(variant) : null,
          sku: variant?.sku || product.sku || null,
          quantity: w.quantity,
          unitP,
          lineP,
          image,
        };
      });

      const taxP = 0;
      const totalP = subtotalP + taxP;

      if (expectedTotalP !== null && Number.isFinite(expectedTotalP) && expectedTotalP !== totalP) {
        throw new CheckoutError(
          'A product price was updated. The total has been refreshed. Check it, then complete the sale again.',
          409,
          {
            code: 'price_changed',
            total: fromPesewas(totalP),
            prices: lines.map((l) => ({ productId: l.product_id, variantId: l.variant_id, unitPrice: fromPesewas(l.unitP) })),
          }
        );
      }
      if (paymentMethod === 'cash') {
        if (tenderedP === null || tenderedP < totalP) throw new CheckoutError('Insufficient amount tendered');
      }

      // ---- customer --------------------------------------------------------
      const orderEmail = customerEmailIn || POS_WALKIN_EMAIL;
      const guestHasIdentity = !existingCustomer && (!!firstName || !!lastName || !!customerEmailIn);
      const upsertEmail = customerEmailIn
        ? customerEmailIn
        : (existingCustomer || guestHasIdentity) && customerPhone
          ? `${customerPhone.replace(/[^0-9]/g, '')}@pos.local`
          : null;

      const addressData = {
        firstName,
        lastName,
        email: customerEmailIn,
        phone: customerPhone,
        address,
        city,
        region,
        pos_sale: true,
      };

      // Saving the customer must never cost a sale: it runs inside a savepoint,
      // so if it fails the sale carries on without the customer record.
      let customerEmailForStats: string | null = null;
      if (upsertEmail) {
        await getExecutor().query('SAVEPOINT pos_customer');
        try {
          const customerId = must(
            await supabaseAdmin.rpc('upsert_customer_from_order', {
              p_email: upsertEmail,
              p_phone: customerPhone || null,
              p_full_name: customerName || null,
              p_first_name: firstName || null,
              p_last_name: lastName || null,
              p_user_id: null,
              p_address: addressData,
            }),
            'Save customer'
          ) as string | null;
          // The RPC may match an existing customer by phone; count the sale on that row.
          if (customerId) {
            const row = must(
              await supabaseAdmin.from('customers').select('email').eq('id', customerId).maybeSingle(),
              'Load customer'
            ) as { email: string } | null;
            customerEmailForStats = row?.email || upsertEmail;
          }
          await getExecutor().query('RELEASE SAVEPOINT pos_customer');
        } catch (custErr: any) {
          await getExecutor().query('ROLLBACK TO SAVEPOINT pos_customer');
          console.error('[POS checkout] customer save failed (sale continues):', custErr?.message || custErr);
          customerEmailForStats = null;
        }
      }

      // ---- order + items ---------------------------------------------------
      const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const saleCreatedAt = saleDate ? `${saleDate}T12:00:00.000Z` : null;

      const order = must(
        await supabaseAdmin
          .from('orders')
          .insert([
            {
              order_number: orderNumber,
              user_id: null,
              email: orderEmail,
              phone: customerPhone,
              // Cash/card: payment_status flips to paid in mark_order_paid below,
              // which also takes the stock. The status stays 'completed'.
              status: isCashOrCard ? 'completed' : 'pending',
              payment_status: 'pending',
              currency: 'GHS',
              subtotal: fromPesewas(subtotalP),
              tax_total: fromPesewas(taxP),
              shipping_total: 0,
              discount_total: 0,
              total: fromPesewas(totalP),
              shipping_method: deliveryMethod,
              // The till's Mobile Money link is a Hubtel checkout.
              payment_method: isCashOrCard ? paymentMethod : 'hubtel',
              notes: note || null,
              shipping_address: addressData,
              billing_address: addressData,
              ...(saleCreatedAt ? { created_at: saleCreatedAt } : {}),
              metadata: {
                pos_sale: true,
                first_name: firstName,
                last_name: lastName,
                phone: customerPhone,
                idempotency_key: idempotencyKey,
                pos_cashier_id: actorId,
                ...(customerEmailForStats ? { customer_email: customerEmailForStats } : {}),
                ...(paymentMethod === 'cash' && tenderedP !== null
                  ? { amount_tendered: fromPesewas(tenderedP), change_due: fromPesewas(tenderedP - totalP) }
                  : {}),
                ...(saleCreatedAt ? { offline_catchup: true, sale_date: saleDate } : {}),
              },
            },
          ])
          .select('id')
          .single(),
        'Create order'
      ) as { id: string };

      must(
        await supabaseAdmin.from('order_items').insert(
          lines.map((l) => ({
            order_id: order.id,
            product_id: l.product_id,
            variant_id: l.variant_id,
            product_name: l.product_name,
            variant_name: l.variant_name,
            sku: l.sku,
            quantity: l.quantity,
            unit_price: fromPesewas(l.unitP),
            total_price: fromPesewas(l.lineP),
            metadata: { image: l.image, pos_sale: true },
          }))
        ),
        'Create order items'
      );

      if (isCashOrCard) {
        const paid = must(
          await supabaseAdmin.rpc('mark_order_paid', {
            order_ref: orderNumber,
            moolre_ref: `pos-${paymentMethod}-${Date.now()}`,
          }),
          'Mark paid'
        ) as any;
        if (!paid) throw new Error('Mark paid: order not found');
        if (!paid.already_paid && customerEmailForStats) {
          must(
            await supabaseAdmin.rpc('update_customer_stats', {
              p_customer_email: customerEmailForStats,
              p_order_total: fromPesewas(totalP),
            }),
            'Update customer stats'
          );
        }
      }

      return { ...(await loadOrderWithItems(order.id)), replayed: false };
    });

    const order: any = result.order;
    const tendered = Number(order?.metadata?.amount_tendered);
    const changeDue = Number(order?.metadata?.change_due);
    return NextResponse.json({
      order,
      items: result.items,
      replayed: result.replayed,
      amountTendered: Number.isFinite(tendered) ? tendered : null,
      changeDue: Number.isFinite(changeDue) ? changeDue : 0,
    });
  } catch (err: any) {
    if (err instanceof CheckoutError) {
      return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    }
    console.error('[pos/checkout] failed:', err?.message);
    return NextResponse.json({ error: 'The sale was not saved and no stock was taken. Try again.' }, { status: 500 });
  }
}
