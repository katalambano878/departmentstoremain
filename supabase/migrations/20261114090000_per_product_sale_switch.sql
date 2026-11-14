-- Per-product sale on/off switch.
--
-- pause_all_sales / resume_all_sales switch every sale at once. These two do
-- the same for chosen products only, using the same storage: a paused sale
-- keeps its discounted price in metadata.paused_sale_price while `price`
-- holds the regular price and compare_at_price is cleared, so the storefront
-- and checkout charge the regular price.

CREATE OR REPLACE FUNCTION public.pause_product_sales(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_products int := 0; v_variants int := 0;
begin
  update product_variants v
  set metadata = coalesce(v.metadata, '{}'::jsonb) || jsonb_build_object('paused_sale_price', v.price),
      price = v.compare_at_price,
      compare_at_price = null,
      updated_at = now()
  from products p
  where v.product_id = p.id
    and p.id = any(p_ids)
    and p.on_sale = true
    and v.compare_at_price is not null
    and v.compare_at_price > v.price;
  get diagnostics v_variants = row_count;

  update products p
  set metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('paused_sale_price', p.price),
      price = p.compare_at_price,
      compare_at_price = null,
      updated_at = now()
  where p.id = any(p_ids)
    and p.on_sale = true
    and p.compare_at_price is not null
    and p.compare_at_price > p.price;
  get diagnostics v_products = row_count;

  return jsonb_build_object('products_paused', v_products, 'variants_paused', v_variants);
end; $function$;

CREATE OR REPLACE FUNCTION public.resume_product_sales(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_products int := 0; v_variants int := 0;
begin
  update product_variants v
  set compare_at_price = v.price,
      price = (v.metadata->>'paused_sale_price')::numeric,
      metadata = v.metadata - 'paused_sale_price',
      updated_at = now()
  where v.product_id = any(p_ids)
    and v.metadata ? 'paused_sale_price';
  get diagnostics v_variants = row_count;

  update products p
  set compare_at_price = p.price,
      price = (p.metadata->>'paused_sale_price')::numeric,
      metadata = p.metadata - 'paused_sale_price',
      updated_at = now()
  where p.id = any(p_ids)
    and p.on_sale = true
    and p.metadata ? 'paused_sale_price';
  get diagnostics v_products = row_count;

  return jsonb_build_object('products_resumed', v_products, 'variants_resumed', v_variants);
end; $function$;

-- Server-only, like the other sale functions.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('pause_product_sales', 'resume_product_sales')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;
  END LOOP;
END $$;
