-- Customer birthdays (day and month only, no year) for automatic birthday
-- messages. Customers give it optionally at checkout; staff can edit it on the
-- customer page. birthday_greeted_year stops a second message in one year.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS birthday_month smallint,
  ADD COLUMN IF NOT EXISTS birthday_day smallint,
  ADD COLUMN IF NOT EXISTS birthday_greeted_year smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_birthday_valid') THEN
    ALTER TABLE public.customers ADD CONSTRAINT customers_birthday_valid CHECK (
      (birthday_month IS NULL AND birthday_day IS NULL)
      OR (
        birthday_month BETWEEN 1 AND 12
        AND birthday_day BETWEEN 1 AND
          CASE
            WHEN birthday_month = 2 THEN 29
            WHEN birthday_month IN (4, 6, 9, 11) THEN 30
            ELSE 31
          END
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customers_birthday_idx
  ON public.customers (birthday_month, birthday_day)
  WHERE birthday_month IS NOT NULL;
