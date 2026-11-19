'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type BlogStatus = 'draft' | 'published' | 'archived';

type PostRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featured_image: string | null;
  status: BlogStatus | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  tags: string[] | null;
};

const STATUS_BADGE: Record<BlogStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-800',
};

const STATUS_LABEL: Record<BlogStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

function formatDate(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminBlogPage() {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BlogStatus>('all');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, featured_image, status, published_at, updated_at, created_at, tags')
      .order('created_at', { ascending: false });
    if (error) setError(`Could not load posts: ${error.message}`);
    else {
      setError('');
      setPosts((data || []) as PostRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (post: PostRow) => {
    if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    setDeletingId(post.id);
    const { error } = await supabase.from('blog_posts').delete().eq('id', post.id);
    setDeletingId(null);
    if (error) {
      setError(`Post not deleted: ${error.message}`);
      return;
    }
    setPosts(prev => prev.filter(p => p.id !== post.id));
  };

  const counts = {
    all: posts.length,
    draft: posts.filter(p => (p.status || 'draft') === 'draft').length,
    published: posts.filter(p => p.status === 'published').length,
    archived: posts.filter(p => p.status === 'archived').length,
  };

  const q = search.trim().toLowerCase();
  const visible = posts.filter(p =>
    (statusFilter === 'all' || (p.status || 'draft') === statusFilter) &&
    (!q || p.title.toLowerCase().includes(q) || (p.tags || []).some(t => t.toLowerCase().includes(q)))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Blog</h1>
          <p className="text-gray-600 mt-1">Write posts and publish them when they are ready.</p>
        </div>
        <Link
          href="/admin/blog/new"
          className="inline-flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 text-white px-5 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap"
        >
          <i className="ri-add-line"></i>
          New post
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {(['all', 'published', 'draft', 'archived'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or tag"
            className="w-full pl-10 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-gray-500">Loading posts...</p>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            {posts.length === 0 ? (
              <>
                <p>No posts yet.</p>
                <Link href="/admin/blog/new" className="text-blue-700 font-semibold hover:underline mt-2 inline-block">Write the first one</Link>
              </>
            ) : (
              <p>No posts match this filter.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map(post => {
              const status = (post.status || 'draft') as BlogStatus;
              return (
                <li key={post.id} className="flex items-center gap-4 p-4 hover:bg-gray-50">
                  {post.featured_image ? (
                    <img src={post.featured_image} alt="" className="w-20 h-14 rounded-lg object-cover border border-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-20 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 flex-shrink-0">
                      <i className="ri-image-line text-xl"></i>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/blog/${post.id}`} className="font-semibold text-gray-900 hover:text-blue-700 line-clamp-1">
                      {post.title}
                    </Link>
                    <p className="text-sm text-gray-500 line-clamp-1">{post.excerpt || `/${post.slug}`}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {status === 'published' && post.published_at
                        ? `Published ${formatDate(post.published_at)}`
                        : `Updated ${formatDate(post.updated_at || post.created_at)}`}
                      {post.tags && post.tags.length > 0 && ` · ${post.tags.join(', ')}`}
                    </p>
                  </div>
                  <span className={`hidden sm:inline-flex px-3 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/admin/blog/${post.id}`}
                      className="w-9 h-9 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                      title="Edit post"
                      aria-label={`Edit ${post.title}`}
                    >
                      <i className="ri-edit-line text-lg"></i>
                    </Link>
                    <button
                      onClick={() => handleDelete(post)}
                      disabled={deletingId === post.id}
                      className="w-9 h-9 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg disabled:opacity-50"
                      title="Delete post"
                      aria-label={`Delete ${post.title}`}
                    >
                      <i className={deletingId === post.id ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line text-lg'}></i>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
