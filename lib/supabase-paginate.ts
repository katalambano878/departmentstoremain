/**
 * Page through a Supabase table that may have more rows than PostgREST's
 * `max-rows` cap (Supabase's default is 1000).  A bare
 *
 *     supabase.from('orders').select('*')
 *
 * silently truncates at 1000 rows — the dashboard ends up reporting
 * "1000 orders" and the orders list never shows order #1001.  Bumping
 * `.range(0, 1999)` does NOT help because the server still applies its
 * own row cap, so you only ever get the first 1000 rows of the range
 * you ask for.
 *
 * This helper requests the table in 1000-row chunks until either
 * (a) a chunk comes back smaller than the page size, or
 * (b) we hit the safety cap (50,000 by default — far above what any
 *     admin dashboard should fan out into the browser).
 *
 * Usage:
 *
 *     const orders = await fetchAllPaged<Order>(() =>
 *       supabase
 *         .from('orders')
 *         .select('id, total, payment_status, created_at')
 *         .order('created_at', { ascending: false })
 *     );
 *
 * The factory must build a fresh PostgrestFilterBuilder on every call
 * because each call needs its own `.range()`.
 */
export async function fetchAllPaged<T>(
    queryFactory: () => any,
    options: { pageSize?: number; hardCap?: number } = {}
): Promise<T[]> {
    const pageSize = options.pageSize ?? 1000;
    const hardCap = options.hardCap ?? 50_000;

    const all: T[] = [];
    let from = 0;

    while (from < hardCap) {
        const to = from + pageSize - 1;
        const { data, error } = await queryFactory().range(from, to);
        if (error) {
            const message = String(error.message || '');
            const rangeExhausted =
                error.code === 'PGRST103' ||
                /range not satisfiable/i.test(message) ||
                /requested range not satisfiable/i.test(message);
            if (rangeExhausted) break;
            throw error;
        }
        const rows = (data ?? []) as T[];
        if (rows.length === 0) break;
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
    }

    return all;
}
