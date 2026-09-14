-- Lock down public SECURITY DEFINER RPCs, close unrestricted product reads,
-- hide POS-only items from storefront search, and add hot-path indexes.

-- ---------------------------------------------------------------------------
-- 1. Revoke public EXECUTE on privileged functions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  privileged text[] := ARRAY[
    'get_all_customer_emails',
    'get_all_customer_phones',
    'find_user_by_whatsapp_phone',
    'get_ai_memories',
    'mark_order_paid',
    'reduce_stock_on_order',
    'apply_sale_fixed',
    'apply_sale_percentage',
    'apply_sale_variant_prices',
    'pause_all_sales',
    'resume_all_sales',
    'remove_sale',
    'update_customer_stats',
    'upsert_customer_from_order',
    'handle_new_user',
    '_log_product_delete',
    '_log_product_variant_delete',
    '_profiles_block_role_escalation',
    'rls_auto_enable',
    'update_product_rating_stats'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (privileged)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    -- POS cashiers call this from the browser as authenticated staff_pos.
    IF r.proname = 'upsert_customer_from_order' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Guard POS/customer upsert (browser staff + service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(
  p_email text,
  p_phone text,
  p_full_name text,
  p_first_name text,
  p_last_name text,
  p_user_id uuid DEFAULT NULL,
  p_address jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id UUID;
  v_existing_email TEXT;
  v_existing_phone TEXT;
  v_existing_secondary_email TEXT;
  v_existing_secondary_phone TEXT;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin_staff_or_pos() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, email, phone, secondary_email, secondary_phone
  INTO v_customer_id, v_existing_email, v_existing_phone, v_existing_secondary_email, v_existing_secondary_phone
  FROM customers
  WHERE email = p_email OR secondary_email = p_email
  LIMIT 1;

  IF v_customer_id IS NULL AND p_phone IS NOT NULL AND p_phone != '' THEN
    SELECT id, email, phone, secondary_email, secondary_phone
    INTO v_customer_id, v_existing_email, v_existing_phone, v_existing_secondary_email, v_existing_secondary_phone
    FROM customers
    WHERE phone = p_phone OR secondary_phone = p_phone
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (email, phone, full_name, first_name, last_name, user_id, default_address)
    VALUES (p_email, p_phone, p_full_name, p_first_name, p_last_name, p_user_id, p_address)
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE customers SET
      secondary_email = CASE
        WHEN p_email IS NOT NULL
             AND p_email != ''
             AND p_email != v_existing_email
             AND (v_existing_secondary_email IS NULL OR v_existing_secondary_email = '' OR v_existing_secondary_email != p_email)
        THEN p_email
        ELSE secondary_email
      END,
      secondary_phone = CASE
        WHEN p_phone IS NOT NULL
             AND p_phone != ''
             AND p_phone != v_existing_phone
             AND (v_existing_secondary_phone IS NULL OR v_existing_secondary_phone = '' OR v_existing_secondary_phone != p_phone)
        THEN p_phone
        ELSE secondary_phone
      END,
      full_name = COALESCE(NULLIF(p_full_name, ''), full_name),
      first_name = COALESCE(NULLIF(p_first_name, ''), first_name),
      last_name = COALESCE(NULLIF(p_last_name, ''), last_name),
      user_id = COALESCE(p_user_id, user_id),
      default_address = COALESCE(p_address, default_address),
      updated_at = NOW()
    WHERE id = v_customer_id;
  END IF;

  RETURN v_customer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_customer_from_order(text, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_customer_from_order(text, text, text, text, text, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Product catalog RLS: no unrestricted public SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read" ON public.products;
DROP POLICY IF EXISTS "Allow public read products" ON public.products;
DROP POLICY IF EXISTS "Public view active products" ON public.products;
DROP POLICY IF EXISTS "POS staff view catalog" ON public.products;

CREATE POLICY "Public view active products" ON public.products
  FOR SELECT
  USING (
    status = 'active'::public.product_status
    AND coalesce(metadata->>'visibility', 'global') NOT IN ('pos_only', 'pos-only', 'pos')
  );

-- POS cashiers are not in is_admin_or_staff(); they still need the full catalog.
CREATE POLICY "POS staff view catalog" ON public.products
  FOR SELECT
  USING (public.is_admin_staff_or_pos());

-- ---------------------------------------------------------------------------
-- 4. search_products: hide POS-only + revoke PUBLIC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_products(
  p_query text,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
WITH q AS (
  SELECT
    lower(btrim(p_query)) AS ql,
    (SELECT array_agg(t) FROM (
       SELECT t FROM unnest(regexp_split_to_array(lower(btrim(p_query)), '\s+')) AS t
       WHERE length(t) >= 2 OR length(btrim(p_query)) < 2
     ) s) AS toks
),
scored AS (
  SELECT
    p.id,
    h.hay_core,
    h.hay_wide,
    q.ql,
    q.toks,
    coalesce(array_length(q.toks, 1), 0) AS ntoks,
    (SELECT count(*) FROM unnest(q.toks) t WHERE lower(p.name) LIKE '%' || t || '%') AS name_hits,
    (SELECT count(*) FROM unnest(q.toks) t WHERE h.hay_core LIKE '%' || t || '%') AS core_hits,
    (SELECT count(*) FROM unnest(q.toks) t WHERE h.hay_wide LIKE '%' || t || '%') AS wide_hits,
    p.featured,
    p.rating_avg,
    p.created_at,
    lower(p.name) AS lname,
    lower(coalesce(p.sku, ''))                    AS lsku,
    lower(coalesce(p.barcode, ''))                AS lbarcode,
    lower(coalesce(p.metadata->>'pos_code', ''))  AS lpos
  FROM public.products p
  CROSS JOIN q
  CROSS JOIN LATERAL (
    SELECT
      lower(
        coalesce(p.name, '') || ' ' ||
        replace(coalesce(p.slug, ''), '-', ' ') || ' ' ||
        coalesce(p.sku, '') || ' ' ||
        coalesce(p.barcode, '') || ' ' ||
        coalesce(p.metadata->>'pos_code', '') || ' ' ||
        coalesce(p.brand, '') || ' ' ||
        coalesce(p.vendor, '') || ' ' ||
        coalesce(array_to_string(p.tags, ' '), '') || ' ' ||
        coalesce((SELECT c.name FROM public.categories c WHERE c.id = p.category_id), '') || ' ' ||
        coalesce((
          SELECT string_agg(
                   coalesce(v.name,'') || ' ' || coalesce(v.option1,'') || ' ' ||
                   coalesce(v.option2,'') || ' ' || coalesce(v.option3,'') || ' ' ||
                   coalesce(v.sku,'') || ' ' || coalesce(v.barcode,''), ' ')
          FROM public.product_variants v WHERE v.product_id = p.id
        ), '')
      ) AS hay_core,
      lower(
        coalesce(p.name, '') || ' ' ||
        replace(coalesce(p.slug, ''), '-', ' ') || ' ' ||
        coalesce(p.sku, '') || ' ' ||
        coalesce(p.barcode, '') || ' ' ||
        coalesce(p.metadata->>'pos_code', '') || ' ' ||
        coalesce(p.brand, '') || ' ' ||
        coalesce(p.vendor, '') || ' ' ||
        coalesce(array_to_string(p.tags, ' '), '') || ' ' ||
        coalesce((SELECT c.name FROM public.categories c WHERE c.id = p.category_id), '') || ' ' ||
        coalesce((
          SELECT string_agg(
                   coalesce(v.name,'') || ' ' || coalesce(v.option1,'') || ' ' ||
                   coalesce(v.option2,'') || ' ' || coalesce(v.option3,'') || ' ' ||
                   coalesce(v.sku,'') || ' ' || coalesce(v.barcode,''), ' ')
          FROM public.product_variants v WHERE v.product_id = p.id
        ), '') || ' ' ||
        coalesce(p.short_description, '') || ' ' ||
        coalesce(p.description, '') || ' ' ||
        coalesce(p.seo_title, '') || ' ' ||
        coalesce(p.seo_description, '')
      ) AS hay_wide
  ) h
  WHERE p.status = 'active'
    AND coalesce(p.metadata->>'visibility', 'global') NOT IN ('pos_only', 'pos-only', 'pos')
)
SELECT s.id,
       (GREATEST(
          CASE WHEN s.lname = s.ql THEN 1000 ELSE 0 END,
          CASE WHEN s.ql <> '' AND s.ql IN (s.lsku, s.lbarcode, s.lpos) THEN 950 ELSE 0 END,
          CASE WHEN s.lname LIKE s.ql || '%' THEN 900 ELSE 0 END,
          CASE WHEN s.lname LIKE '%' || s.ql || '%' THEN 850 ELSE 0 END,
          CASE WHEN s.ql <> '' AND (s.lsku LIKE s.ql || '%' OR s.lbarcode LIKE s.ql || '%' OR s.lpos LIKE s.ql || '%') THEN 820 ELSE 0 END,
          CASE WHEN s.ntoks > 0 AND s.name_hits = s.ntoks THEN 700 + 50 * s.ntoks ELSE 0 END,
          CASE WHEN s.ntoks > 0 AND s.core_hits = s.ntoks THEN 600 ELSE 0 END,
          CASE WHEN s.ntoks > 0 AND s.wide_hits = s.ntoks THEN 500 ELSE 0 END,
          CASE WHEN s.ntoks > 0 AND s.wide_hits > 0
               THEN (300.0 * s.wide_hits / s.ntoks)
                    + CASE WHEN s.name_hits > 0 THEN 80 ELSE 0 END
               ELSE 0 END,
          (word_similarity(s.ql, s.lname) * 450)::real,
          (similarity(s.ql, s.lname) * 400)::real
        )
        + CASE WHEN s.featured THEN 12 ELSE 0 END
        + LEAST(coalesce(s.rating_avg, 0), 5) * 2
       )::real AS rank
FROM scored s
WHERE
  (
    s.lname LIKE '%' || s.ql || '%'
    OR (s.ql <> '' AND (s.lsku LIKE s.ql || '%' OR s.lbarcode LIKE s.ql || '%' OR s.lpos LIKE s.ql || '%'))
    OR s.wide_hits > 0
    OR word_similarity(s.ql, s.lname) >= 0.45
    OR similarity(s.ql, s.lname) >= 0.3
  )
ORDER BY rank DESC, s.featured DESC, s.rating_avg DESC NULLS LAST, s.created_at DESC
LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.search_products(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products(text, integer) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS initplan (auth.uid() once per query, not per row)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users view own orders" ON public.orders;
CREATE POLICY "Users view own orders" ON public.orders
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Authenticated users insert own orders" ON public.orders;
CREATE POLICY "Authenticated users insert own orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    (COALESCE(payment_status, 'pending'::payment_status) = 'pending'::payment_status)
    AND (user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Staff can manage customers" ON public.customers;
CREATE POLICY "Staff can manage customers" ON public.customers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['admin'::user_role, 'staff'::user_role, 'staff_pos'::user_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['admin'::user_role, 'staff'::user_role, 'staff_pos'::user_role])
    )
  );

DROP POLICY IF EXISTS "Staff can view all customers" ON public.customers;
CREATE POLICY "Staff can view all customers" ON public.customers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['admin'::user_role, 'staff'::user_role, 'staff_pos'::user_role])
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Hot-path FK indexes (timeouts / admin list pages)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON public.order_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON public.cart_items (product_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_variant_id ON public.cart_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON public.order_status_history (order_id);

-- ---------------------------------------------------------------------------
-- 7. Data cleanup
-- ---------------------------------------------------------------------------
UPDATE public.products
SET status = 'draft', updated_at = now()
WHERE status = 'active'
  AND coalesce(price, 0) = 0;

UPDATE public.order_items oi
SET variant_id = pv.id
FROM public.product_variants pv
WHERE oi.variant_id IS NULL
  AND oi.product_id IS NOT NULL
  AND coalesce(oi.variant_name, '') <> ''
  AND pv.product_id = oi.product_id
  AND btrim(oi.variant_name) = btrim(pv.name)
  AND (
    SELECT count(*) FROM public.product_variants x
    WHERE x.product_id = oi.product_id
      AND btrim(x.name) = btrim(oi.variant_name)
  ) = 1;

UPDATE public.order_items oi
SET variant_id = pv.id
FROM public.product_variants pv
WHERE oi.variant_id IS NULL
  AND oi.product_id IS NOT NULL
  AND pv.product_id = oi.product_id
  AND coalesce(oi.variant_name, '') <> ''
  AND (
    btrim(lower(oi.variant_name)) = btrim(lower(coalesce(pv.option1, '')))
    OR btrim(lower(oi.variant_name)) = btrim(lower(coalesce(pv.option2, '')))
  )
  AND (
    SELECT count(*) FROM public.product_variants x
    WHERE x.product_id = oi.product_id
      AND (
        btrim(lower(oi.variant_name)) = btrim(lower(coalesce(x.option1, '')))
        OR btrim(lower(oi.variant_name)) = btrim(lower(coalesce(x.option2, '')))
      )
  ) = 1;
