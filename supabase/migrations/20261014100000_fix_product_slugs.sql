-- Repair product web addresses that contain spaces, capitals, or stray letters.
-- Where the plain name is already used, the repaired address gets a number suffix.

UPDATE public.products AS p
SET slug = v.new_slug
FROM (VALUES
  ('beach-net-bag 5', 'beach-net-bag-5'),
  ('cleaning-sponge Pulp', 'cleaning-sponge-pulp'),
  ('cute-bear textured keychain', 'cute-bear-textured-keychain'),
  ('Effortless garlic-grinder ', 'garlic-grinder'),
  ('garlic crusher', 'garlic-crusher'),
  ('iceberg-drinking-glass-6pcs-per-bGox', 'iceberg-drinking-glass-6pcs-per-box-2'),
  ('Mmini-beach-bag-for-kids', 'mini-beach-bag-for-kids-2'),
  ('sneakers 1 ', 'sneakers-in-size-37'),
  ('Ssstainless-steel-non-tarnish-earring', 'stainless-steel-non-tarnish-earring-2'),
  ('Sstainless-steel-non-tarnish-earring', 'stainless-steel-non-tarnish-earring-3'),
  ('sulfer-soap ', 'sulfer-soap')
) AS v(old_slug, new_slug)
WHERE p.slug = v.old_slug
  AND NOT EXISTS (
    SELECT 1 FROM public.products taken
    WHERE taken.slug = v.new_slug AND taken.id <> p.id
  );

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_slug_format;
ALTER TABLE public.products
  ADD CONSTRAINT products_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
