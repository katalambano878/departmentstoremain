-- Activity log: every create / update / delete on business tables, staff sign-ins,
-- and explicit admin actions (exports, prints) are written to public.audit_logs.
-- Only admins can read it, except users listed in audit_log_blocked_users.
-- Nobody can edit or delete log rows through the API.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS actor_role  text,
  ADD COLUMN IF NOT EXISTS table_name  text,
  ADD COLUMN IF NOT EXISTS record_id   text,
  ADD COLUMN IF NOT EXISTS summary     text,
  ADD COLUMN IF NOT EXISTS changes     jsonb;

ALTER TABLE public.audit_logs ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx    ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_table_idx      ON public.audit_logs (table_name, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_log_blocked_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log_blocked_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log_blocked_users FROM anon, authenticated;

INSERT INTO public.audit_log_blocked_users (user_id, note)
SELECT id, 'Bright: no access to activity logs'
FROM auth.users WHERE lower(email) = 'bright@discountdiscoveryzone.com'
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_view_audit_logs()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM public.audit_log_blocked_users b WHERE b.user_id = p.id)
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_audit_logs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_audit_logs() TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Staff view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
CREATE POLICY "Admins view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.can_view_audit_logs()));

REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- Resolve who is acting. Browser requests carry the user's JWT; server routes use
-- the service role and forward the verified staff id in the x-audit-actor header.
CREATE OR REPLACE FUNCTION public._audit_actor()
RETURNS TABLE (actor_id uuid, actor_email text, actor_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_claim_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_header text;
BEGIN
  IF v_uid IS NULL AND v_claim_role = 'service_role' THEN
    v_header := coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-audit-actor', '');
    IF v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uid := v_header::uuid;
    END IF;
  END IF;

  IF v_uid IS NOT NULL THEN
    RETURN QUERY
      SELECT v_uid,
             coalesce(p.email, u.email::text),
             coalesce(p.role::text, 'customer')
      FROM (SELECT v_uid AS id) x
      LEFT JOIN public.profiles p ON p.id = x.id
      LEFT JOIN auth.users u ON u.id = x.id;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::text,
    CASE
      WHEN v_claim_role = 'service_role' THEN 'system'
      WHEN v_claim_role = 'anon' THEN 'guest'
      WHEN v_claim_role = '' THEN 'database'
      ELSE v_claim_role
    END;
END;
$$;
REVOKE ALL ON FUNCTION public._audit_actor() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  v_actor record;
  v_id text := v_row ->> 'id';
  v_label text;
  v_ignored text[] := ARRAY['updated_at', 'search_vector', 'fts', 'rating_avg', 'review_count'];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(n.key, jsonb_build_object('from', v_old -> n.key, 'to', n.value))
      INTO v_changes
    FROM jsonb_each(v_new) n
    WHERE NOT (n.key = ANY (v_ignored))
      AND (v_old -> n.key) IS DISTINCT FROM n.value;
    IF v_changes IS NULL THEN
      RETURN NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changes := v_new;
  ELSE
    v_changes := v_old;
  END IF;

  v_label := coalesce(
    v_row ->> 'order_number', v_row ->> 'product_name', v_row ->> 'name', v_row ->> 'title', v_row ->> 'code',
    v_row ->> 'sku', v_row ->> 'key', v_row ->> 'email', v_row ->> 'full_name', v_id
  );

  SELECT * INTO v_actor FROM public._audit_actor();

  INSERT INTO public.audit_logs
    (user_id, actor_email, actor_role, action, entity_type, table_name, entity_id, record_id, summary, changes)
  VALUES (
    v_actor.actor_id, v_actor.actor_email, v_actor.actor_role,
    lower(TG_OP), TG_TABLE_NAME, TG_TABLE_NAME,
    CASE WHEN v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_id::uuid END,
    v_id, left(v_label, 300), v_changes
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit log write failed on %.%: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._audit_row_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  audited text[] := ARRAY[
    'products', 'product_variants', 'product_images', 'categories',
    'orders', 'order_items', 'customers', 'profiles', 'coupons', 'banners',
    'site_settings', 'store_settings', 'store_modules', 'cms_content', 'pages',
    'blog_posts', 'navigation_menus', 'navigation_items', 'reviews',
    'return_requests', 'return_items', 'support_tickets',
    'affiliates', 'affiliate_commissions', 'affiliate_payouts', 'affiliate_product_markups'
  ];
BEGIN
  FOREACH t IN ARRAY audited LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row_change ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public._audit_row_change()', t);
    END IF;
  END LOOP;
END $$;

-- Sign-ins and password changes (values are never stored).
CREATE OR REPLACE FUNCTION public._audit_auth_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.id;

  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at AND NEW.last_sign_in_at IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_id, actor_email, actor_role, action, entity_type, table_name, entity_id, record_id, summary)
    VALUES (NEW.id, NEW.email, coalesce(v_role, 'customer'), 'sign_in', 'auth', 'auth.users', NEW.id, NEW.id::text,
            'Signed in: ' || coalesce(NEW.email, NEW.id::text));
  END IF;

  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    INSERT INTO public.audit_logs (user_id, actor_email, actor_role, action, entity_type, table_name, entity_id, record_id, summary)
    VALUES (NEW.id, NEW.email, coalesce(v_role, 'customer'), 'password_change', 'auth', 'auth.users', NEW.id, NEW.id::text,
            'Password changed: ' || coalesce(NEW.email, NEW.id::text));
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    INSERT INTO public.audit_logs (user_id, actor_email, actor_role, action, entity_type, table_name, entity_id, record_id, summary, changes)
    VALUES (NEW.id, NEW.email, coalesce(v_role, 'customer'), 'email_change', 'auth', 'auth.users', NEW.id, NEW.id::text,
            'Login email changed', jsonb_build_object('email', jsonb_build_object('from', OLD.email, 'to', NEW.email)));
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit auth log failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._audit_auth_user_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_auth_user_change ON auth.users;
CREATE TRIGGER trg_audit_auth_user_change
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._audit_auth_user_change();

-- Explicit app actions that do not write a row (exports, prints, etc).
CREATE OR REPLACE FUNCTION public.log_activity(p_action text, p_summary text, p_details jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
BEGIN
  IF NOT public.is_admin_staff_or_pos() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR length(p_action) > 60 THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  SELECT * INTO v_actor FROM public._audit_actor();
  INSERT INTO public.audit_logs (user_id, actor_email, actor_role, action, entity_type, summary, changes)
  VALUES (v_actor.actor_id, v_actor.actor_email, v_actor.actor_role, p_action, 'app', left(p_summary, 300), p_details);
END;
$$;
REVOKE ALL ON FUNCTION public.log_activity(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_activity(text, text, jsonb) TO authenticated, service_role;
