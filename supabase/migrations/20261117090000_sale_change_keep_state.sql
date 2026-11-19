-- One atomic call for every sale change from Admin → Sales, keeping each
-- product's own on/off state (needs 20261114090000_per_product_sale_switch).
--
--   p_action 'percentage' | 'fixed'  (p_ids, p_value)
--            'remove'                (p_ids)
--            'variant_prices'        (p_items: [{variant_id, price}])
--
-- Switched-off sales are switched on for the change and off again afterwards.
-- A product that had no sale is switched off afterwards when all sales are
-- off (site_settings.sales_active), so a new sale follows the all-sales switch.
-- Everything runs in one transaction: if any step fails, nothing changes.

CREATE OR REPLACE FUNCTION public.sale_change_keep_state(
  p_action text,
  p_ids uuid[] DEFAULT NULL,
  p_value numeric DEFAULT NULL,
  p_items jsonb DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[];
  v_paused uuid[];
  v_no_sale uuid[];
  v_pause_after uuid[] := '{}';
  v_all_on boolean;
  v_result jsonb;
begin
  if p_action = 'variant_prices' then
    select coalesce(array_agg(distinct v.product_id), '{}') into v_ids
    from product_variants v
    where v.id in (select (e->>'variant_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e);
  else
    v_ids := coalesce(p_ids, '{}');
  end if;

  select coalesce(array_agg(id), '{}') into v_paused
  from products where id = any(v_ids) and on_sale and metadata ? 'paused_sale_price';
  select coalesce(array_agg(id), '{}') into v_no_sale
  from products where id = any(v_ids) and not coalesce(on_sale, false);

  select coalesce(bool_or(value in ('true'::jsonb, '"true"'::jsonb)), true) into v_all_on
  from site_settings where key = 'sales_active';

  if cardinality(v_paused) > 0 then
    perform resume_product_sales(v_paused);
  end if;

  if p_action = 'percentage' then
    v_result := apply_sale_percentage(v_ids, p_value);
  elsif p_action = 'fixed' then
    v_result := apply_sale_fixed(v_ids, p_value);
  elsif p_action = 'remove' then
    v_result := remove_sale(v_ids);
  elsif p_action = 'variant_prices' then
    v_result := apply_sale_variant_prices(p_items);
  else
    raise exception 'Unknown sale action: %', p_action;
  end if;

  if p_action <> 'remove' then
    v_pause_after := v_paused || (case when v_all_on then '{}'::uuid[] else v_no_sale end);
    if cardinality(v_pause_after) > 0 then
      perform pause_product_sales(v_pause_after);
    end if;
  end if;

  return v_result || jsonb_build_object(
    'product_ids', to_jsonb(v_ids),
    'paused', cardinality(v_pause_after)
  );
end; $function$;

-- Server-only, like the other sale functions.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sale_change_keep_state'
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
