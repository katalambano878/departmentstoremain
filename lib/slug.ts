/** Lowercase web address: letters, numbers, and single hyphens. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Longest web address the store saves. */
const MAX_SLUG_LENGTH = 80;

/**
 * `base` if no other record uses it, else the first of `base-2`, `base-3`…
 * that is free. `taken` is the list of addresses already in use.
 */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const ending = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - ending.length).replace(/-+$/g, '')}${ending}`;
    if (!used.has(candidate)) return candidate;
  }
}
