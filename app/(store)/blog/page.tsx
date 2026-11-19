import type { Metadata } from 'next';
import Link from 'next/link';
import BlogNewsletterForm from './BlogNewsletterForm';
import { formatPostDate, listPublishedPosts, postHref } from './blog-data';

// Read from the database on each request (never during `next build`).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'News and shopping notes from Discount Discovery Zone.',
};

export default async function BlogPage() {
  const posts = await listPublishedPosts();
  const [featuredPost, ...rest] = posts || [];

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">Our Blog</h1>
            <p className="text-lg sm:text-xl text-gray-600 leading-relaxed">
              News, new arrivals and shopping notes from our team in Accra.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {posts === null && (
          <div role="alert" className="max-w-xl mx-auto text-center py-16">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">We could not load the blog</h2>
            <p className="text-gray-600 mb-6">Please refresh the page in a moment.</p>
          </div>
        )}

        {posts && posts.length === 0 && (
          <div className="max-w-xl mx-auto text-center py-16">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-article-line text-4xl text-gray-400" aria-hidden="true"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">No posts yet</h2>
            <p className="text-gray-600">Check back soon, or sign up below to hear when we publish.</p>
          </div>
        )}

        {featuredPost && (
          <Link href={postHref(featuredPost)} className="block mb-16 group">
            <article className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-lg group-hover:shadow-2xl transition-shadow">
              <div className={featuredPost.featured_image ? 'grid md:grid-cols-2 gap-0' : ''}>
                {featuredPost.featured_image && (
                  <div className="relative h-64 md:h-auto md:min-h-[24rem]">
                    <img
                      src={featuredPost.featured_image}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-6 sm:p-12 flex flex-col justify-center">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 mb-4">
                    <span className="bg-emerald-700 text-white px-3 py-1 rounded-full font-medium">Latest</span>
                    <time>{formatPostDate(featuredPost)}</time>
                  </div>
                  <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight group-hover:text-emerald-800 transition-colors">
                    {featuredPost.title}
                  </h2>
                  {featuredPost.excerpt && (
                    <p className="text-gray-600 text-lg leading-relaxed">{featuredPost.excerpt}</p>
                  )}
                </div>
              </div>
            </article>
          </Link>
        )}

        {rest.length > 0 && (
          <section aria-labelledby="more-posts">
            <h2 id="more-posts" className="text-3xl font-bold text-gray-900 mb-8">More posts</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {rest.map((post) => (
                <Link
                  key={post.id}
                  href={postHref(post)}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-lg transition-all group"
                >
                  {post.featured_image && (
                    <div className="relative h-56">
                      <img src={post.featured_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className="p-6">
                    <time className="block text-xs text-gray-500 mb-3">{formatPostDate(post)}</time>
                    <h3 className="text-xl font-bold text-gray-900 mb-3 leading-tight group-hover:text-emerald-800 transition-colors">
                      {post.title}
                    </h3>
                    {post.excerpt && <p className="text-gray-600 leading-relaxed text-sm">{post.excerpt}</p>}
                    {post.tags && post.tags.length > 0 && (
                      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Tags">
                        {post.tags.slice(0, 4).map((tag) => (
                          <li key={tag} className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-700">#{tag}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Hear about new posts and arrivals</h2>
          <p className="text-lg text-emerald-100 mb-8 leading-relaxed">
            An occasional email from us. Unsubscribe at any time.
          </p>
          <BlogNewsletterForm tone="dark" />
          <Link
            href="/shop"
            className="mt-6 inline-flex items-center gap-2 text-white font-medium hover:underline"
          >
            Browse the shop
            <i className="ri-arrow-right-line" aria-hidden="true"></i>
          </Link>
        </div>
      </div>
    </div>
  );
}
