-- Self adhesive Wall single hook was still GH₵4 after a price edit that never stored.
UPDATE public.products
SET price = 5
WHERE id = '761eb131-ccd7-4bee-aa1a-6efb64f17552'
  AND name = 'Self adhesive Wall single hook';

-- POS staff could open a product and "save" a price that the database ignored.
DROP POLICY IF EXISTS "POS staff update products" ON public.products;
CREATE POLICY "POS staff update products" ON public.products
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin_staff_or_pos()))
  WITH CHECK ((SELECT public.is_admin_staff_or_pos()));

DROP POLICY IF EXISTS "POS staff update variants" ON public.product_variants;
CREATE POLICY "POS staff update variants" ON public.product_variants
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin_staff_or_pos()))
  WITH CHECK ((SELECT public.is_admin_staff_or_pos()));
