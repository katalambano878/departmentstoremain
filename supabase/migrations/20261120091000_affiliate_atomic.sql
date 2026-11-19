-- Atomic affiliate ledger operations (November 2026 audit).
-- Safe to run twice. Run as the database owner (store_departmentstore).
--
-- Replaces read-then-write code in lib/affiliate-server.ts and
-- app/api/admin/affiliates/[id]/route.ts, which could double-count balances
-- when two requests ran at once (every dashboard load matured commissions;
-- payouts had no lock, ignored min_payout and paid suspended affiliates).
--
-- Only server code (the database owner) calls these; browser roles get nothing.
--
-- Balance model (unchanged):
--   pending commission   -> counted in affiliates.balance_pending
--   matured commission   -> counted in affiliates.balance_available (+ total_earned)
--   paid commission      -> counted in affiliates.total_paid
-- While an automatic (Moolre) payout is 'processing', its matured commissions
-- carry payout_id and their amount is already taken out of balance_available.

-- ---------------------------------------------------------------------------
-- 1. Mature due commissions: pending -> matured, pending balance -> available.
--    One statement; a concurrent call skips rows the first one already moved.
--    Returns the number of commissions matured.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_mature_due_commissions(p_affiliate_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH due AS (
    UPDATE affiliate_commissions c
       SET status = 'matured',
           matured_at = now(),
           updated_at = now()
     WHERE c.status = 'pending'
       AND c.matures_at IS NOT NULL
       AND c.matures_at <= now()
       AND (p_affiliate_id IS NULL OR c.affiliate_id = p_affiliate_id)
    RETURNING c.affiliate_id, c.commission_amount
  ),
  sums AS (
    SELECT affiliate_id, SUM(commission_amount) AS amount, COUNT(*) AS n
      FROM due
     GROUP BY affiliate_id
  ),
  moved AS (
    UPDATE affiliates a
       SET balance_pending   = GREATEST(0, round(a.balance_pending - s.amount, 2)),
           balance_available = round(a.balance_available + s.amount, 2),
           total_earned      = round(a.total_earned + s.amount, 2),
           updated_at        = now()
      FROM sums s
     WHERE a.id = s.affiliate_id
    RETURNING a.id
  )
  SELECT COALESCE(SUM(n), 0)::integer INTO v_count FROM sums;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Record a commission for a paid order and add it to the pending balance in
--    the same transaction. Idempotent on order_id (unique constraint).
--    Returns true when a new commission row was written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_record_commission(
  p_affiliate_id uuid,
  p_order_id uuid,
  p_order_number text,
  p_base_amount numeric,
  p_commission_pct numeric,
  p_commission_amount numeric,
  p_matures_at timestamptz
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_commission_amount IS NULL OR p_commission_amount <= 0 THEN
    RETURN false;
  END IF;

  INSERT INTO affiliate_commissions (
    affiliate_id, order_id, order_number, base_amount, commission_pct,
    commission_amount, status, matures_at
  ) VALUES (
    p_affiliate_id, p_order_id, p_order_number, round(p_base_amount, 2), round(p_commission_pct, 2),
    round(p_commission_amount, 2), 'pending', p_matures_at
  )
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE affiliates
     SET balance_pending = round(balance_pending + p_commission_amount, 2),
         updated_at = now()
   WHERE id = p_affiliate_id;

  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Claw back the commission of a refunded/cancelled order (if not paid out
--    and not reserved by a payout in progress). Returns true when clawed back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_clawback_commission(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c affiliate_commissions;
BEGIN
  SELECT * INTO c FROM affiliate_commissions WHERE order_id = p_order_id FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN false;
  END IF;
  IF c.status NOT IN ('pending', 'matured') THEN
    RETURN false;
  END IF;
  IF c.status = 'matured' AND c.payout_id IS NOT NULL THEN
    -- Reserved by a payout that is being processed; leave it alone.
    RETURN false;
  END IF;

  UPDATE affiliate_commissions
     SET status = 'clawed_back', updated_at = now()
   WHERE id = c.id;

  IF c.status = 'pending' THEN
    UPDATE affiliates
       SET balance_pending = GREATEST(0, round(balance_pending - c.commission_amount, 2)),
           updated_at = now()
     WHERE id = c.affiliate_id;
  ELSE
    UPDATE affiliates
       SET balance_available = GREATEST(0, round(balance_available - c.commission_amount, 2)),
           updated_at = now()
     WHERE id = c.affiliate_id;
  END IF;

  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Start a payout of everything matured for one affiliate.
--    p_auto = true  -> payout row 'processing'; commissions reserved
--                      (payout_id set) and amount taken out of
--                      balance_available. Finish with affiliate_finish_payout.
--    p_auto = false -> manual record: payout 'paid' and commissions paid now.
--    Refuses (RAISE, SQLSTATE P0001, message starts with 'payout:') when the
--    affiliate is missing or not active, a payout is already pending or
--    processing, nothing is payable, or the amount is below min_payout.
--    Returns the payout row as JSON.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_begin_payout(
  p_affiliate_id uuid,
  p_processed_by uuid,
  p_auto boolean,
  p_reference text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a affiliates;
  p affiliate_payouts;
  v_amount numeric;
  v_min numeric := 0;
  v_setting jsonb;
BEGIN
  -- Serialise every payout for this affiliate on the affiliate row.
  SELECT * INTO a FROM affiliates WHERE id = p_affiliate_id FOR UPDATE;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'payout: affiliate not found';
  END IF;
  IF a.status <> 'active' THEN
    RAISE EXCEPTION 'payout: affiliate is %, only active affiliates can be paid', a.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM affiliate_payouts
     WHERE affiliate_id = p_affiliate_id
       AND status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'payout: a payout is already in progress for this affiliate';
  END IF;

  -- Bring the ledger up to date first (same transaction).
  PERFORM public.affiliate_mature_due_commissions(p_affiliate_id);
  SELECT * INTO a FROM affiliates WHERE id = p_affiliate_id;

  SELECT round(COALESCE(SUM(commission_amount), 0), 2) INTO v_amount
    FROM affiliate_commissions
   WHERE affiliate_id = p_affiliate_id
     AND status = 'matured'
     AND payout_id IS NULL;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payout: no available balance to pay out';
  END IF;

  SELECT value INTO v_setting FROM site_settings WHERE key = 'affiliate';
  IF v_setting IS NOT NULL AND jsonb_typeof(v_setting->'min_payout') = 'number' THEN
    v_min := (v_setting->>'min_payout')::numeric;
  END IF;
  IF v_amount < v_min THEN
    RAISE EXCEPTION 'payout: available balance GHS % is below the minimum payout of GHS %', v_amount, v_min;
  END IF;

  INSERT INTO affiliate_payouts (
    affiliate_id, amount, method, destination, provider, status,
    moolre_ref, processed_by, processed_at
  ) VALUES (
    p_affiliate_id, v_amount, 'momo', a.payout_number, a.payout_provider,
    CASE WHEN p_auto THEN 'processing'::affiliate_payout_status ELSE 'paid'::affiliate_payout_status END,
    p_reference, p_processed_by,
    CASE WHEN p_auto THEN NULL ELSE now() END
  )
  RETURNING * INTO p;

  IF p_auto THEN
    UPDATE affiliate_commissions
       SET payout_id = p.id, updated_at = now()
     WHERE affiliate_id = p_affiliate_id
       AND status = 'matured'
       AND payout_id IS NULL;

    UPDATE affiliates
       SET balance_available = GREATEST(0, round(balance_available - v_amount, 2)),
           updated_at = now()
     WHERE id = p_affiliate_id;
  ELSE
    UPDATE affiliate_commissions
       SET status = 'paid', payout_id = p.id, paid_at = now(), updated_at = now()
     WHERE affiliate_id = p_affiliate_id
       AND status = 'matured'
       AND payout_id IS NULL;

    UPDATE affiliates
       SET balance_available = GREATEST(0, round(balance_available - v_amount, 2)),
           total_paid        = round(total_paid + v_amount, 2),
           updated_at = now()
     WHERE id = p_affiliate_id;
  END IF;

  RETURN to_jsonb(p);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Finish an automatic payout after the Moolre transfer returned.
--    Success: payout 'paid', reserved commissions 'paid', total_paid += amount.
--    Failure: payout 'failed', commissions released, balance_available restored.
--    Only acts on a payout that is still 'processing' (so it runs once).
--    Returns the payout row as JSON, or NULL when nothing was processing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_finish_payout(
  p_payout_id uuid,
  p_success boolean,
  p_moolre_ref text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p affiliate_payouts;
BEGIN
  SELECT * INTO p FROM affiliate_payouts WHERE id = p_payout_id FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'processing' THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM affiliates WHERE id = p.affiliate_id FOR UPDATE;

  IF p_success THEN
    UPDATE affiliate_payouts
       SET status = 'paid',
           moolre_ref = COALESCE(NULLIF(p_moolre_ref, ''), moolre_ref),
           processed_at = now()
     WHERE id = p.id
    RETURNING * INTO p;

    UPDATE affiliate_commissions
       SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE payout_id = p.id
       AND status = 'matured';

    UPDATE affiliates
       SET total_paid = round(total_paid + p.amount, 2),
           updated_at = now()
     WHERE id = p.affiliate_id;
  ELSE
    UPDATE affiliate_payouts
       SET status = 'failed',
           failure_reason = left(COALESCE(p_failure_reason, 'Transfer failed'), 500),
           processed_at = now()
     WHERE id = p.id
    RETURNING * INTO p;

    UPDATE affiliate_commissions
       SET payout_id = NULL, updated_at = now()
     WHERE payout_id = p.id
       AND status = 'matured';

    UPDATE affiliates
       SET balance_available = round(balance_available + p.amount, 2),
           updated_at = now()
     WHERE id = p.affiliate_id;
  END IF;

  RETURN to_jsonb(p);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Privileges: server code only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.affiliate_mature_due_commissions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.affiliate_record_commission(uuid, uuid, text, numeric, numeric, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.affiliate_clawback_commission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.affiliate_begin_payout(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.affiliate_finish_payout(uuid, boolean, text, text) FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['departmentstore_anon', 'departmentstore_authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.affiliate_mature_due_commissions(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.affiliate_record_commission(uuid, uuid, text, numeric, numeric, numeric, timestamptz) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.affiliate_clawback_commission(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.affiliate_begin_payout(uuid, uuid, boolean, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.affiliate_finish_payout(uuid, boolean, text, text) FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
