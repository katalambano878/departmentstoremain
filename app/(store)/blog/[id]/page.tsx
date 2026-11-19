import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sanitizeHtml } from '@/lib/sanitize';
import BlogNewsletterForm from '../BlogNewsletterForm';
import { formatPostDate, getPublishedPost, readingMinutes } from '../blog-data';

export const dynamic = 'force-dynamic';

const loadPost = cache((id: string) => getPublishedPost(id));

const HTML_HINT_RE = /<(p|h[1-6]|ul|ol|li|br|strong|em|a|img|blockquote)\b/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const post = await loadPost(id);
  if (!post || post === 'error') return { title: 'Blog' };
  return {
    title: post.seo_title || post.title,
    description: post.seo_description || post.excerpt || undefined,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: post.featured_image ? { images: [post.featured_image] } : undefined,
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await loadPost(id);

  if (post === 'error') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div role="alert" className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">We could not load this post</h1>
          <p className="text-gray-600 mb-6">Please refresh the page in a moment.</p>
          <Link href="/blog" className="text-emerald-700 font-medium hover:underline">Back to the blog</Link>
        </div>
      </div>
    );
  }
  if (!post) notFound();

  const isHtml = HTML_HINT_RE.test(post.content);
  const paragraphs = isHtml ? [] : post.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const minutes = readingMinutes(post.content);

  return (
    <div className="min-h-screen bg-white">
      <header className={`relative ${post.featured_image ? 'min-h-[20rem] sm:min-h-[24rem] bg-gray-900' : 'bg-gradient-to-br from-emerald-50 via-white to-amber-50'}`}>
        {post.featured_image && (
          <img src={post.featured_image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        )}
        <div className={`relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center ${post.featured_image ? 'text-white' : 'text-gray-900'}`}>
          <h1 className="text-3xl sm:text-5xl font-bold mb-6 leading-tight">{post.title}</h1>
          <div className={`flex flex-wrap items-center justify-center gap-6 ${post.featured_image ? 'text-emerald-100' : 'text-gray-500'}`}>
            <span className="flex items-center gap-2">
              <i className="ri-calendar-line" aria-hidden="true"></i>
              <time>{formatPostDate(post)}</time>
            </span>
            <span className="flex items-center gap-2">
              <i className="ri-time-line" aria-hidden="true"></i>
              {minutes} min read
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed">
          {isHtml ? (
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }} />
          ) : (
            paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-line">{p}</p>
            ))
          )}
        </article>

        {post.tags && post.tags.length > 0 && (
          <ul className="mt-10 flex flex-wrap gap-2" aria-label="Tags">
            {post.tags.map((tag) => (
              <li key={tag} className="px-4 py-2 bg-gray-100 rounded-full text-sm text-gray-700">#{tag}</li>
            ))}
          </ul>
        )}

        <div className="mt-16 bg-gradient-to-br from-emerald-700 to-emerald-900 rounded-2xl p-6 sm:p-12 text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Hear about new posts</h2>
          <p className="text-emerald-100 mb-8 text-lg">An occasional email from us. Unsubscribe at any time.</p>
          <BlogNewsletterForm tone="dark" />
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-emerald-700 font-medium hover:gap-3 transition-all"
          >
            <i className="ri-arrow-left-line" aria-hidden="true"></i>
            Back to the blog
          </Link>
        </div>
      </div>
    </div>
  );
}
