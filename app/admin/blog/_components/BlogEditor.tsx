'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { slugify } from '@/lib/slug';

type BlogStatus = 'draft' | 'published' | 'archived';

type Form = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featured_image: string;
  tags: string;
  status: BlogStatus;
  seo_title: string;
  seo_description: string;
};

const EMPTY: Form = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  featured_image: '',
  tags: '',
  status: 'draft',
  seo_title: '',
  seo_description: '',
};

const inputClass =
  'w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

/** Create (no postId) or edit (postId) a row in blog_posts. */
export default function BlogEditor({ postId }: { postId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!postId);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  // Keep the slug following the title until someone edits the slug by hand.
  const slugTouched = useRef(!!postId);

  useEffect(() => {
    if (!postId) return;
    (async () => {
      const { data, error } = await supabase
        .from('blog_posts')
        .select('title, slug, excerpt, content, featured_image, tags, status, published_at, seo_title, seo_description')
        .eq('id', postId)
        .maybeSingle();
      if (error) setError(`Could not load the post: ${error.message}`);
      else if (!data) setNotFound(true);
      else {
        setForm({
          title: data.title || '',
          slug: data.slug || '',
          excerpt: data.excerpt || '',
          content: data.content || '',
          featured_image: data.featured_image || '',
          tags: (data.tags || []).join(', '),
          status: (data.status || 'draft') as BlogStatus,
          seo_title: data.seo_title || '',
          seo_description: data.seo_description || '',
        });
        setPublishedAt(data.published_at || null);
      }
      setLoading(false);
    })();
  }, [postId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaved('');
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !slugTouched.current) next.slug = slugify(String(value));
      return next;
    });
  };

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (JPG, PNG, WebP or GIF).');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const fileName = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('blog').upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('blog').getPublicUrl(fileName);
      set('featured_image', publicUrl);
    } catch (err: any) {
      setError(`Image not uploaded: ${err?.message || 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    const slug = slugify(form.slug || form.title);
    if (!title) { setError('Add a title.'); return; }
    if (!slug) { setError('Add a web address (slug) using letters or numbers.'); return; }
    if (!form.content.trim()) { setError('Add the post content.'); return; }

    setSaving(true);
    setError('');
    setSaved('');

    const tags = Array.from(new Set(form.tags.split(',').map(t => t.trim()).filter(Boolean)));
    // published_at is set the first time a post is published and kept after that.
    const nextPublishedAt = form.status === 'published' ? (publishedAt || new Date().toISOString()) : publishedAt;

    const payload: Record<string, unknown> = {
      title,
      slug,
      excerpt: form.excerpt.trim() || null,
      content: form.content,
      featured_image: form.featured_image || null,
      tags: tags.length ? tags : null,
      status: form.status,
      published_at: nextPublishedAt,
      seo_title: form.seo_title.trim() || null,
      seo_description: form.seo_description.trim() || null,
    };

    try {
      if (postId) {
        const { error } = await supabase.from('blog_posts').update(payload).eq('id', postId);
        if (error) throw error;
        setPublishedAt(nextPublishedAt);
        setForm(prev => ({ ...prev, slug }));
        setSaved(form.status === 'published' ? 'Saved. The post is published.' : 'Saved.');
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase
          .from('blog_posts')
          .insert([{ ...payload, author_id: session?.user.id || null }])
          .select('id')
          .single();
        if (error) throw error;
        router.replace(`/admin/blog/${data.id}`);
        return;
      }
    } catch (err: any) {
      const msg = err?.message || 'unknown error';
      setError(/blog_posts_slug_key|duplicate key/i.test(msg)
        ? `Another post already uses the address "${slug}". Change the slug.`
        : `Not saved: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-12 text-center text-gray-500">Loading post...</div>;
  if (notFound) {
    return (
      <div className="p-12 text-center text-gray-600">
        This post does not exist. <Link href="/admin/blog" className="text-blue-700 underline">Back to the blog</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin/blog" className="w-10 h-10 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400" aria-label="Back to blog">
            <i className="ri-arrow-left-line text-xl text-gray-700"></i>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{postId ? 'Edit post' : 'New post'}</h1>
            {postId && publishedAt && (
              <p className="text-sm text-gray-500">First published {new Date(publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value as BlogStatus)}
            aria-label="Status"
            className="px-4 py-3 border-2 border-gray-300 rounded-lg font-medium cursor-pointer"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <button
            type="submit"
            disabled={saving || uploading}
            className="px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <><i className="ri-loader-4-line animate-spin"></i> Saving...</> : <><i className="ri-save-line"></i> Save</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg" role="status">
          <i className="ri-checkbox-circle-line text-green-600"></i>
          {saved}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label htmlFor="post-title" className="block text-sm font-semibold text-gray-900 mb-2">Title</label>
          <input id="post-title" value={form.title} onChange={(e) => set('title', e.target.value)} className={inputClass} required />
        </div>
        <div>
          <label htmlFor="post-slug" className="block text-sm font-semibold text-gray-900 mb-2">Web address (slug)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 whitespace-nowrap">/blog/</span>
            <input
              id="post-slug"
              value={form.slug}
              onChange={(e) => { slugTouched.current = true; set('slug', e.target.value); }}
              onBlur={() => set('slug', slugify(form.slug))}
              className={`${inputClass} font-mono text-sm`}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">Filled from the title. Lowercase letters, numbers and hyphens.</p>
        </div>
        <div>
          <label htmlFor="post-excerpt" className="block text-sm font-semibold text-gray-900 mb-2">Short summary</label>
          <textarea id="post-excerpt" rows={2} value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="post-content" className="block text-sm font-semibold text-gray-900 mb-2">Content</label>
          <textarea id="post-content" rows={16} value={form.content} onChange={(e) => set('content', e.target.value)} className={`${inputClass} leading-relaxed`} required />
        </div>
        <div>
          <label htmlFor="post-tags" className="block text-sm font-semibold text-gray-900 mb-2">Tags</label>
          <input id="post-tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="fashion, new arrivals" className={inputClass} />
          <p className="text-xs text-gray-500 mt-1">Separate tags with commas.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Featured image</h2>
        {form.featured_image ? (
          <div className="space-y-3">
            <img src={form.featured_image} alt="" className="w-full max-h-72 object-cover rounded-lg border border-gray-200" />
            <div className="flex gap-3">
              <label className="px-4 py-2 border-2 border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                {uploading ? 'Uploading...' : 'Replace'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }} />
              </label>
              <button type="button" onClick={() => set('featured_image', '')} className="px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg">
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-8 text-gray-600 hover:border-blue-500 hover:bg-blue-50 cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <i className={`${uploading ? 'ri-loader-4-line animate-spin' : 'ri-upload-2-line'} text-3xl`}></i>
            <span className="text-sm font-medium">{uploading ? 'Uploading...' : 'Upload an image'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }} />
          </label>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-bold text-gray-900">Search engines (optional)</h2>
        <div>
          <label htmlFor="post-seo-title" className="block text-sm font-semibold text-gray-900 mb-2">Search title</label>
          <input id="post-seo-title" value={form.seo_title} onChange={(e) => set('seo_title', e.target.value)} placeholder={form.title} className={inputClass} />
        </div>
        <div>
          <label htmlFor="post-seo-description" className="block text-sm font-semibold text-gray-900 mb-2">Search description</label>
          <textarea id="post-seo-description" rows={2} value={form.seo_description} onChange={(e) => set('seo_description', e.target.value)} placeholder={form.excerpt} className={inputClass} />
        </div>
      </div>
    </form>
  );
}
