-- OPTIONAL hardening (column + RLS + search RPC).
-- App currently stores visibility in products.metadata.visibility so the
-- feature works without this migration. Apply this when Supabase DDL access
-- is available to enforce POS-only hiding at the database / RLS layer too.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_visibility') THEN
    CREATE TYPE public.product_visibility AS ENUM ('global', 'pos_only');
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS visibility public.product_visibility NOT NULL DEFAULT 'global';

-- Backfill from metadata if staff already set POS-only there.
UPDATE public.products
SET visibility = 'pos_only'::public.product_visibility
WHERE coalesce(metadata->>'visibility', '') IN ('pos_only', 'pos-only', 'pos')
  AND visibility IS DISTINCT FROM 'pos_only'::public.product_visibility;

CREATE INDEX IF NOT EXISTS idx_products_storefront_visible
  ON public.products (status, visibility)
  WHERE status = 'active' AND visibility = 'global';

DROP POLICY IF EXISTS "Allow public read" ON public.products;
DROP POLICY IF EXISTS "Allow public read products" ON public.products;
DROP POLICY IF EXISTS "Public view active products" ON public.products;
CREATE POLICY "Public view active products" ON public.products
  FOR SELECT
  USING (
    (status = 'active'::public.product_status AND visibility = 'global'::public.product_visibility)
    OR public.is_admin_or_staff()
  );

-- Keep search_products in sync with column-based visibility.
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
       SELECT t from unnest(regexp_split_to_array(lower(btrim(p_query)), '\s+')) AS t
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
    AND p.visibility = 'global'::public.product_visibility
    AND coalesce(p.metadata->>'visibility', 'global') <> 'pos_only'
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

GRANT EXECUTE ON FUNCTION public.search_products(text, integer) TO anon, authenticated;

COMMENT ON COLUMN public.products.visibility IS
  'global = website + POS; pos_only = walk-in / POS only (hidden from storefront)';
