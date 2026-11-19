import { supabaseAnon } from '@/lib/supabase-server';

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  featured_image: string | null;
  published_at: string | null;
  created_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  tags: string[] | null;
};

const LIST_COLUMNS = 'id, title, slug, excerpt, featured_image, published_at, created_at, tags';
const DETAIL_COLUMNS = 'id, title, slug, excerpt, content, featured_image, published_at, created_at, seo_title, seo_description, tags';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export type BlogListItem = Omit<BlogPost, 'content' | 'seo_title' | 'seo_description'>;

/** Published posts, newest first. Returns null when the database could not be reached. */
export async function listPublishedPosts(limit = 30): Promise<BlogListItem[] | null> {
  const { data, error } = await supabaseAnon
    .from('blog_posts')
    .select(LIST_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.error('[blog] list failed:', error.message);
    return null;
  }
  return (data || []) as BlogListItem[];
}

/** A published post by slug or id; null when it does not exist; 'error' when the database failed. */
export async function getPublishedPost(idOrSlug: string): Promise<BlogPost | null | 'error'> {
  let key = idOrSlug;
  try {
    key = decodeURIComponent(idOrSlug);
  } catch {
    return null;
  }
  const isId = UUID_RE.test(key);
  if (!isId && !SLUG_RE.test(key)) return null;

  const { data, error } = await supabaseAnon
    .from('blog_posts')
    .select(DETAIL_COLUMNS)
    .eq('status', 'published')
    .eq(isId ? 'id' : 'slug', isId ? key : key.toLowerCase())
    .maybeSingle();
  if (error) {
    console.error('[blog] detail failed:', error.message);
    return 'error';
  }
  return (data as BlogPost) || null;
}

export function formatPostDate(post: { published_at: string | null; created_at: string | null }): string {
  const raw = post.published_at || post.created_at;
  if (!raw) return '';
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Accra' });
}

export function readingMinutes(text: string): number {
  const words = text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function postHref(post: { slug: string; id: string }): string {
  return `/blog/${post.slug || post.id}`;
}
