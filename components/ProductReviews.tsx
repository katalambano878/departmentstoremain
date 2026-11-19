'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cachedQuery, invalidateCache } from '@/lib/query-cache';
import { useRecaptcha } from '@/hooks/useRecaptcha';

interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  verified: boolean;
  title: string;
  content: string;
  user_id: string;
}

interface ProductReviewsProps {
  productId: string;
}

export default function ProductReviews({ productId }: ProductReviewsProps) {
  const [filter, setFilter] = useState('all');
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);

  const [reviewForm, setReviewForm] = useState({
    rating: 5,
    title: '',
    content: ''
  });
  const { getToken, verifying } = useRecaptcha();

  useEffect(() => {
    // Check auth
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
    });

    fetchReviews();
  }, [productId]);

  const fetchReviews = async () => {
    try {
      // Fetch approved reviews (cached for 5 minutes)
      const { data, error } = await cachedQuery<{ data: any; error: any }>(
        `reviews:${productId}`,
        (() => supabase
          .from('reviews')
          .select('id, rating, title, content, verified_purchase, created_at, user_id')
          .eq('product_id', productId)
          .eq('status', 'approved')
          .order('created_at', { ascending: false })) as any,
        5 * 60 * 1000
      );

      if (error) throw error;

      if (data) {
        // We need to fetch user names if possible. Since we don't have public profiles easily accessible 
        // without complicated RLS/joins in client, we might fallback to generic name or metadata if stored.
        // For this demo, we'll try to use a "clean" name or just "Verified Customer"

        const formattedReviews = data.map((r: any) => ({
          id: r.id,
          author: 'Customer', // names are not public
          rating: r.rating,
          date: r.created_at,
          verified: r.verified_purchase,
          title: r.title,
          content: r.content,
          user_id: r.user_id
        }));
        setReviews(formattedReviews);
      }
    } catch (err) {
      console.error('Error fetching reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  const averageRating = reviews.length > 0
    ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
    : 0;

  const ratingDistribution = [5, 4, 3, 2, 1].map(star => {
    const count = reviews.filter(r => r.rating === star).length;
    return {
      star,
      count,
      percentage: reviews.length > 0 ? (count / reviews.length) * 100 : 0
    };
  });

  const filteredReviews = filter === 'all'
    ? reviews
    : reviews.filter(r => r.rating === parseInt(filter));

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert('Please login to submit a review');
      return;
    }

    // reCAPTCHA verification
    const isHuman = await getToken('review');
    if (!isHuman) {
      alert('Security verification failed. Please try again.');
      return;
    }

    setIsSubmitting(true);

    try {
      // The database sets the status (pending until approved) and works out
      // "verified purchase" itself, so we only send what the shopper wrote.
      const { error } = await supabase.from('reviews').insert([{
        product_id: productId,
        user_id: user.id,
        rating: reviewForm.rating,
        title: reviewForm.title,
        content: reviewForm.content,
      }]);

      if (error) throw error;

      setSubmitted(true);
      setShowReviewForm(false);
      setReviewForm({ rating: 5, title: '', content: '' });
      invalidateCache(`reviews:${productId}`); // Clear cache so fresh data is fetched
      fetchReviews(); // Refresh list

    } catch (err: any) {
      console.error('Submit review error:', err);
      alert('Failed to submit review: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-gray-500">Loading reviews...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Customer Reviews</h2>

      {submitted && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          Thanks! Your review will appear once it has been approved.
        </div>
      )}

      {reviews.length === 0 && !showReviewForm ? (
        <div className="text-center py-8 mb-8 border-b border-gray-200">
          <p className="text-gray-500 mb-4">No reviews yet. Be the first to review!</p>
          <button
            type="button"
            onClick={() => { setShowReviewForm(true); setSubmitted(false); }}
            className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
          >
            Write a Review
          </button>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-8 mb-8 pb-8 border-b border-gray-200">
            <div className="text-center">
              <div className="text-5xl font-bold text-gray-900 mb-2">{averageRating.toFixed(1)}</div>
              <div className="flex items-center justify-center mb-2" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((star) => (
                  <i
                    key={star}
                    className={`ri-star-${star <= Math.round(averageRating) ? 'fill' : 'line'} text-xl ${star <= Math.round(averageRating) ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                  ></i>
                ))}
              </div>
              <p className="text-gray-600">
                <span className="sr-only">{averageRating.toFixed(1)} out of 5 stars. </span>
                Based on {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              </p>
            </div>

            <div className="md:col-span-2">
              <div className="space-y-2">
                {ratingDistribution.map((dist) => (
                  <div key={dist.star} className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setFilter(dist.star.toString())}
                      aria-label={`Show ${dist.star}-star reviews (${dist.count})`}
                      aria-pressed={filter === dist.star.toString()}
                      className="flex items-center space-x-1 hover:text-emerald-700 transition-colors"
                    >
                      <span className="text-sm font-medium w-6">{dist.star}</span>
                      <i className="ri-star-fill text-yellow-400 text-sm" aria-hidden="true"></i>
                    </button>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden" aria-hidden="true">
                      <div
                        className="h-full bg-yellow-400 transition-all duration-300"
                        style={{ width: `${dist.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-600 w-8">{dist.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setFilter('all')}
                aria-pressed={filter === 'all'}
                className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${filter === 'all'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                All Reviews ({reviews.length})
              </button>
              {/* Simplified filter buttons for brevity */}
            </div>

            {!showReviewForm && (
              <button
                type="button"
                onClick={() => { setShowReviewForm(true); setSubmitted(false); }}
                className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap"
              >
                Write a Review
              </button>
            )}
          </div>
        </>
      )}

      {showReviewForm && (
        <form onSubmit={handleSubmitReview} className="bg-gray-50 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Write Your Review</h3>

          <fieldset className="mb-4">
            <legend className="block text-sm font-semibold text-gray-900 mb-2">Your Rating *</legend>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  aria-pressed={reviewForm.rating === star}
                  className="w-10 h-10 flex items-center justify-center"
                >
                  <i
                    aria-hidden="true"
                    className={`ri-star-${star <= reviewForm.rating ? 'fill' : 'line'} text-3xl ${star <= reviewForm.rating ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                  ></i>
                </button>
              ))}
            </div>
          </fieldset>

          {!user && (
            <div className="mb-4 p-4 bg-amber-50 text-amber-800 rounded-lg">
              Please{' '}
              <a
                href="/auth/login"
                className="font-semibold underline"
              >
                sign in
              </a>{' '}
              to write a review.
            </div>
          )}

          <div className="mb-4">
            <label htmlFor={`review-title-${productId}`} className="block text-sm font-semibold text-gray-900 mb-2">Review Title *</label>
            <input
              id={`review-title-${productId}`}
              type="text"
              value={reviewForm.title}
              onChange={(e) => setReviewForm({ ...reviewForm, title: e.target.value })}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Sum up your experience"
              required
              disabled={!user}
            />
          </div>

          <div className="mb-4">
            <label htmlFor={`review-content-${productId}`} className="block text-sm font-semibold text-gray-900 mb-2">Your Review *</label>
            <textarea
              id={`review-content-${productId}`}
              value={reviewForm.content}
              onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Share your experience with this product"
              required
              disabled={!user}
            ></textarea>
          </div>

          <p className="mb-4 text-xs text-gray-500">Reviews are checked by our team before they appear.</p>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isSubmitting || !user}
              className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {isSubmitting || verifying ? 'Submitting...' : 'Submit Review'}
            </button>
            <button
              type="button"
              onClick={() => setShowReviewForm(false)}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-6">
        {filteredReviews.map((review) => (
          <div key={review.id} className="pb-6 border-b border-gray-200 last:border-0">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-full text-emerald-700 font-bold text-lg">
                  {review.author.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-900">{review.author}</span>
                    {review.verified && (
                      <span className="flex items-center text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                        <i className="ri-checkbox-circle-fill mr-1" aria-hidden="true"></i>
                        Verified purchase
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{new Date(review.date).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="flex items-center space-x-1" role="img" aria-label={`${review.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <i
                    key={star}
                    aria-hidden="true"
                    className={`ri-star-${star <= review.rating ? 'fill' : 'line'} text-lg ${star <= review.rating ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                  ></i>
                ))}
              </div>
            </div>

            <h4 className="font-semibold text-gray-900 mb-2">{review.title}</h4>
            <p className="text-gray-700">{review.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
