-- Security hardening after the November 2026 audit.
-- Safe to run twice. Run as the database owner (store_departmentstore).
--
-- Server code (the app's own API routes) connects as the owner with no
-- auth.uid(); the checks below apply to browser callers only.

-- ---------------------------------------------------------------------------
-- 0. Helper: the signed-in caller's role (NULL for server code / anonymous)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 1. Roles: only an admin may change a role, and never their own, from the
--    browser. (Staff could make themselves admin before.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._profiles_block_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_role text;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  -- Server-side code (no browser user) manages roles through the staff API.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT role::text INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can change a role';
  END IF;
  IF NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Affiliates: no self-created rows (registration goes through the server),
--    and affiliates cannot approve their own product markups.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS affiliates_insert_self ON public.affiliates;

CREATE OR REPLACE FUNCTION public._affiliate_markups_pin_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
  ELSIF NEW.markup_type IS DISTINCT FROM OLD.markup_type
     OR NEW.markup_pct IS DISTINCT FROM OLD.markup_pct
     OR NEW.fixed_price IS DISTINCT FROM OLD.fixed_price THEN
    NEW.status := 'pending';      -- a changed markup needs approval again
  ELSE
    NEW.status := OLD.status;     -- never self-approve
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_affiliate_markups_pin_status ON public.affiliate_product_markups;
CREATE TRIGGER trg_affiliate_markups_pin_status
  BEFORE INSERT OR UPDATE ON public.affiliate_product_markups
  FOR EACH ROW EXECUTE FUNCTION public._affiliate_markups_pin_status();

-- ---------------------------------------------------------------------------
-- 3. Orders: customers never write orders or order lines directly (checkout
--    uses the server route). Till-only staff read orders and may update the
--    status, but not money fields; the till sells through the server route.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users insert own orders" ON public.orders;
DROP POLICY IF EXISTS "Enable insert for order items" ON public.order_items;
DROP POLICY IF EXISTS "Enable select for guest order items" ON public.order_items;

DROP POLICY IF EXISTS "Staff manage all orders" ON public.orders;
CREATE POLICY "Staff manage all orders" ON public.orders
  FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
DROP POLICY IF EXISTS "POS staff view orders" ON public.orders;
CREATE POLICY "POS staff view orders" ON public.orders
  FOR SELECT USING (public.is_admin_staff_or_pos());
DROP POLICY IF EXISTS "POS staff update orders" ON public.orders;
CREATE POLICY "POS staff update orders" ON public.orders
  FOR UPDATE USING (public.is_admin_staff_or_pos()) WITH CHECK (public.is_admin_staff_or_pos());

CREATE OR REPLACE FUNCTION public._orders_pin_money_for_pos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'staff_pos' THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
     OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
     OR NEW.shipping_total IS DISTINCT FROM OLD.shipping_total
     OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Till staff cannot change payment or totals on an order';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_pin_money_for_pos ON public.orders;
CREATE TRIGGER trg_orders_pin_money_for_pos
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._orders_pin_money_for_pos();

DROP POLICY IF EXISTS "Staff manage order items" ON public.order_items;
CREATE POLICY "Staff manage order items" ON public.order_items
  FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
DROP POLICY IF EXISTS "POS staff view order items" ON public.order_items;
CREATE POLICY "POS staff view order items" ON public.order_items
  FOR SELECT USING (public.is_admin_staff_or_pos());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_quantity_positive') THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0);
  END IF;
END $$;

-- Customers: till staff read only (the till saves customers through the
-- guarded upsert_customer_from_order function / the server route).
DROP POLICY IF EXISTS "Staff can manage customers" ON public.customers;
CREATE POLICY "Staff can manage customers" ON public.customers
  FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());

-- ---------------------------------------------------------------------------
-- 4. Products: till staff may save a price (by design since 2026-10-16) but
--    nothing else. Other columns keep their stored values.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._products_pos_price_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_price numeric;
  v_compare numeric;
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'staff_pos' THEN
    RETURN NEW;
  END IF;
  IF NEW.price IS NULL OR NEW.price <= 0 THEN
    RAISE EXCEPTION 'Price must be greater than 0';
  END IF;
  v_price := NEW.price;
  v_compare := NEW.compare_at_price;
  NEW := OLD;
  NEW.price := v_price;
  NEW.compare_at_price := v_compare;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_products_pos_price_only ON public.products;
CREATE TRIGGER trg_products_pos_price_only
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public._products_pos_price_only();

DROP TRIGGER IF EXISTS trg_product_variants_pos_price_only ON public.product_variants;
CREATE TRIGGER trg_product_variants_pos_price_only
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public._products_pos_price_only();

-- ---------------------------------------------------------------------------
-- 5. Reviews and returns: customers cannot approve their own review or set a
--    refund. "Verified purchase" is worked out here, not sent by the browser.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._reviews_pin_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.helpful_votes := 0;
  ELSE
    NEW.helpful_votes := OLD.helpful_votes;
    NEW.user_id := OLD.user_id;
    NEW.product_id := OLD.product_id;
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.content IS DISTINCT FROM OLD.content THEN
      NEW.status := 'pending';    -- an edited review is moderated again
    ELSE
      NEW.status := OLD.status;
    END IF;
  END IF;
  NEW.verified_purchase := EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.user_id = NEW.user_id
      AND o.payment_status = 'paid'
      AND oi.product_id = NEW.product_id
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reviews_pin_moderation ON public.reviews;
CREATE TRIGGER trg_reviews_pin_moderation
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public._reviews_pin_moderation();

CREATE OR REPLACE FUNCTION public._returns_pin_for_customers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  NEW.status := 'pending';
  NEW.refund_amount := NULL;
  NEW.refund_method := NULL;
  NEW.admin_notes := NULL;
  -- Only for the customer's own order.
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = NEW.order_id AND o.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'That order is not on your account';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_returns_pin_for_customers ON public.return_requests;
CREATE TRIGGER trg_returns_pin_for_customers
  BEFORE INSERT ON public.return_requests
  FOR EACH ROW EXECUTE FUNCTION public._returns_pin_for_customers();

-- ---------------------------------------------------------------------------
-- 6. Coupons: codes are no longer readable by visitors; checkout validates a
--    code on the server.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anon read access to coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow authenticated read access to coupons" ON public.coupons;
DROP POLICY IF EXISTS "Staff read coupons" ON public.coupons;
CREATE POLICY "Staff read coupons" ON public.coupons
  FOR SELECT USING (public.is_admin_or_staff());

-- ---------------------------------------------------------------------------
-- 7. mark_order_paid: do nothing the second time. Returns the order either
--    way, with "already_paid": true when it was paid before this call, so the
--    caller sends the confirmation and counts the sale once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_order_paid(order_ref text, moolre_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_order orders;
  existing_order orders;
BEGIN
  UPDATE orders
  SET payment_status = 'paid',
      status = CASE
        WHEN status = 'pending'          THEN 'processing'::order_status
        WHEN status = 'awaiting_payment' THEN 'processing'::order_status
        ELSE status
      END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'moolre_reference',     moolre_ref,
        'payment_verified_at',  to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
  WHERE order_number = order_ref
    AND payment_status IS DISTINCT FROM 'paid'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    SELECT * INTO existing_order FROM orders WHERE order_number = order_ref;
    IF existing_order.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN to_jsonb(existing_order) || '{"already_paid": true}'::jsonb;
  END IF;

  IF (updated_order.metadata->>'stock_reduced') IS NULL THEN
    UPDATE product_variants pv
    SET    quantity   = GREATEST(0, pv.quantity - oi.quantity),
           updated_at = NOW()
    FROM   order_items oi
    WHERE  oi.order_id   = updated_order.id
      AND  oi.variant_id IS NOT NULL
      AND  oi.variant_id = pv.id;

    UPDATE product_variants pv
    SET    quantity   = GREATEST(0, pv.quantity - oi.quantity),
           updated_at = NOW()
    FROM   order_items oi
    WHERE  oi.order_id    = updated_order.id
      AND  oi.variant_id IS NULL
      AND  oi.product_id  = pv.product_id
      AND  oi.variant_name IS NOT NULL
      AND  oi.variant_name = pv.name;

    UPDATE products p
    SET    quantity   = GREATEST(0, p.quantity - oi.quantity),
           updated_at = NOW()
    FROM   order_items oi
    WHERE  oi.order_id   = updated_order.id
      AND  oi.product_id = p.id
      AND  NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

    UPDATE products p
    SET    quantity   = s.total,
           updated_at = NOW()
    FROM (
      SELECT v.product_id, COALESCE(SUM(v.quantity), 0)::int AS total
      FROM   product_variants v
      WHERE  v.product_id IN (
        SELECT DISTINCT oi.product_id
        FROM   order_items oi
        WHERE  oi.order_id = updated_order.id
          AND  oi.product_id IS NOT NULL
      )
      GROUP BY v.product_id
    ) s
    WHERE p.id = s.product_id
      AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

    UPDATE orders
    SET    metadata = COALESCE(metadata, '{}'::jsonb) || '{"stock_reduced": true}'::jsonb
    WHERE  id = updated_order.id
    RETURNING * INTO updated_order;
  END IF;

  -- Count a coupon once, when the order is first paid.
  IF COALESCE(updated_order.metadata->>'coupon_code', '') <> '' THEN
    UPDATE coupons SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = now()
    WHERE upper(code) = upper(updated_order.metadata->>'coupon_code');
  END IF;

  RETURN to_jsonb(updated_order);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. New server-only tables (no browser access: row level security on, no
--    policies, no grants). The contact form and newsletter box save here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read contact submissions" ON public.contact_submissions;
CREATE POLICY "Staff read contact submissions" ON public.contact_submissions
  FOR SELECT USING (public.is_admin_or_staff());

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  email text NOT NULL,
  source text,
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_key
  ON public.newsletter_subscribers (lower(email));
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read newsletter subscribers" ON public.newsletter_subscribers;
CREATE POLICY "Staff read newsletter subscribers" ON public.newsletter_subscribers
  FOR SELECT USING (public.is_admin_or_staff());

-- Staff read these through the dashboard (the per-store browser roles).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'departmentstore_authenticated') THEN
    GRANT SELECT ON public.contact_submissions, public.newsletter_subscribers TO departmentstore_authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Sessions: a counter that signs out old sessions when a password changes
--    or an account is banned.
-- ---------------------------------------------------------------------------
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 10. Functions are server-only unless granted. Keep it that way.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'departmentstore_authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.current_app_role() TO departmentstore_authenticated, departmentstore_anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 11. Dashboard inbox: staff mark a contact message as handled.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff update contact submissions" ON public.contact_submissions;
CREATE POLICY "Staff update contact submissions" ON public.contact_submissions
  FOR UPDATE USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'departmentstore_authenticated') THEN
    GRANT UPDATE (status) ON public.contact_submissions TO departmentstore_authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 12. Till: a retried sale with the same key can never create a second order.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uniq
  ON public.orders ((metadata->>'idempotency_key'))
  WHERE metadata ? 'idempotency_key';

-- ---------------------------------------------------------------------------
-- 13. Support tickets: customers never see staff-only notes, cannot post a
--     note marked internal, and cannot reassign, re-prioritise or delete.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users view ticket messages" ON public.support_messages;
CREATE POLICY "Users view ticket messages" ON public.support_messages FOR SELECT
  USING (is_internal = false AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = support_messages.ticket_id AND t.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Users create messages" ON public.support_messages;
CREATE POLICY "Users create messages" ON public.support_messages FOR INSERT
  WITH CHECK (is_internal = false AND user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = support_messages.ticket_id AND t.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users manage own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users view own tickets" ON public.support_tickets FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users create own tickets" ON public.support_tickets;
CREATE POLICY "Users create own tickets" ON public.support_tickets FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users update own tickets" ON public.support_tickets;
CREATE POLICY "Users update own tickets" ON public.support_tickets FOR UPDATE
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public._tickets_pin_for_customers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.assigned_to := NULL;
    NEW.priority := 'medium';
    NEW.status := 'open';
  ELSE
    NEW.assigned_to := OLD.assigned_to;
    NEW.priority := OLD.priority;
    NEW.user_id := OLD.user_id;
    -- A customer may reopen or close their own ticket, nothing else.
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('open', 'closed') THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tickets_pin_for_customers ON public.support_tickets;
CREATE TRIGGER trg_tickets_pin_for_customers
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public._tickets_pin_for_customers();
