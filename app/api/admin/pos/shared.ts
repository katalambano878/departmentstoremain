/** Helpers shared by the till checkout route and the manual mark-paid route. */

/** Placeholder address used when a walk-in buyer gives no email. */
export const POS_WALKIN_EMAIL = 'pos-walkin@store.local';

export function isPosSale(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>).pos_sale === true;
}

/**
 * The customers.email the sale should be counted against in update_customer_stats.
 * The till stores it in metadata.customer_email (it can be a phone@pos.local key);
 * older sales fall back to the order email when it is not the walk-in placeholder.
 */
export function posCustomerStatsEmail(order: { email?: string | null; metadata?: any }): string | null {
  const fromMeta = order?.metadata?.customer_email;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const email = typeof order?.email === 'string' ? order.email.trim() : '';
  if (!email || email === POS_WALKIN_EMAIL) return null;
  return email;
}

/** Money in pesewas (integer) so 12.10 x 3 is exactly 36.30. */
export function toPesewas(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function fromPesewas(p: number): number {
  return Math.round(p) / 100;
}
