'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function AdminReviewsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedReviews, setSelectedReviews] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('date');
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          *,
          profiles:user_id (full_name, email),
          products:product_id (name, product_images (url))
        `)
        .order('created_at', { ascending: false });

      if (error) {
        // Graceful fallback if table doesn't exist or permissions fail
        console.warn('Error fetching reviews:', error);
        // setReviews([]); // Keep empty
      } else if (data) {
        const formatted = data.map((r: any) => ({
          id: r.id,
          customer: {
            name: r.profiles?.full_name || 'Anonymous',
            email: r.profiles?.email || 'N/A',
            avatar: getInitials(r.profiles?.full_name || r.profiles?.email)
          },
          product: {
            name: r.products?.name || 'Unknown Product',
            image: r.products?.product_images?.[0]?.url || 'https://via.placeholder.com/150'
          },
          rating: r.rating,
          title: r.title,
          comment: r.content,
          date: new Date(r.created_at).toLocaleDateString(),
          // Shown as Pending / Approved / Rejected; stored lowercase.
          status: r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : 'Pending',
          helpful: r.helpful || 0
        }));
        setReviews(formatted);
      }
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name
      .replace(/[^a-zA-Z ]/g, '')
      .split(' ')
      .map(n => n?.[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '??';
  };

  const filteredReviews = reviews.filter(r =>
    statusFilter === 'all' || r.status.toLowerCase() === statusFilter
  ).sort((a, b) => {
    switch (sortBy) {
      case 'rating': return (b.rating || 0) - (a.rating || 0);
      case 'helpful': return (b.helpful || 0) - (a.helpful || 0);
      case 'date':
      default: return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    }
  });

  const stats = {
    total: reviews.length,
    pending: reviews.filter(r => r.status.toLowerCase() === 'pending').length,
    approved: reviews.filter(r => r.status.toLowerCase() === 'approved').length,
    rejected: reviews.filter(r => r.status.toLowerCase() === 'rejected').length
  };

  const statusColors: any = {
    'Pending': 'bg-amber-100 text-amber-700',
    'Approved': 'bg-blue-100 text-blue-700',
    'Rejected': 'bg-red-100 text-red-700'
  };

  const handleSelectAll = () => {
    if (selectedReviews.length === filteredReviews.length) {
      setSelectedReviews([]);
    } else {
      setSelectedReviews(filteredReviews.map(r => r.id));
    }
  };

  const handleSelectReview = (reviewId: string) => {
    if (selectedReviews.includes(reviewId)) {
      setSelectedReviews(selectedReviews.filter(id => id !== reviewId));
    } else {
      setSelectedReviews([...selectedReviews, reviewId]);
    }
  };

  const handleBulkAction = async (action: string) => {
    if (selectedReviews.length === 0) return;
    try {
      let newStatus = '';
      // review_status enum values are lowercase.
      if (action === 'Approve') newStatus = 'approved';
      if (action === 'Reject') newStatus = 'rejected';

      if (newStatus) {
        const { error } = await supabase
          .from('reviews')
          .update({ status: newStatus })
          .in('id', selectedReviews);

        if (error) throw error;
        fetchReviews();
        setSelectedReviews([]);
      }
    } catch (err) {
      console.error('Error updating reviews', err);
      alert('Failed to update reviews. Functionality might be limited.');
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center space-x-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <i
            key={star}
            className={`${star <= rating ? 'ri-star-fill text-amber-500' : 'ri-star-line text-gray-300'} text-lg`}
          ></i>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reviews</h1>
          <p className="text-gray-600 mt-1">Moderate and manage customer reviews</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'all' ? 'border-blue-700 bg-blue-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-sm text-gray-600 mt-1">Total Reviews</p>
        </button>
        <button
          onClick={() => setStatusFilter('pending')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'pending' ? 'border-amber-700 bg-amber-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
          <p className="text-sm text-gray-600 mt-1">Pending Review</p>
        </button>
        <button
          onClick={() => setStatusFilter('approved')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'approved' ? 'border-blue-700 bg-blue-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-blue-700">{stats.approved}</p>
          <p className="text-sm text-gray-600 mt-1">Approved</p>
        </button>
        <button
          onClick={() => setStatusFilter('rejected')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'rejected' ? 'border-red-700 bg-red-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-red-700">{stats.rejected}</p>
          <p className="text-sm text-gray-600 mt-1">Rejected</p>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 text-transform capitalize">
              {statusFilter === 'all' ? 'All Reviews' : `${statusFilter} Reviews`}
            </h2>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
            >
              <option value="date">Sort by Date</option>
              <option value="rating">Sort by Rating</option>
              <option value="helpful">Sort by Helpful</option>
            </select>
          </div>
        </div>

        {selectedReviews.length > 0 && (
          <div className="p-4 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
            <p className="text-blue-800 font-semibold">
              {selectedReviews.length} review{selectedReviews.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleBulkAction('Approve')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-check-line mr-2"></i>
                Approve
              </button>
              <button
                onClick={() => handleBulkAction('Reject')}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-close-line mr-2"></i>
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-4 px-6">
                  <input
                    type="checkbox"
                    checked={selectedReviews.length === filteredReviews.length && filteredReviews.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/4">Product</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/4">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/3">Review</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Date</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">Loading reviews...</td></tr>
              ) : filteredReviews.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">No reviews found in this category.</td></tr>
              ) : (
                filteredReviews.map((review) => (
                  <tr key={review.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedReviews.includes(review.id)}
                        onChange={() => handleSelectReview(review.id)}
                        className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <img
                          src={review.product.image}
                          alt={review.product.name}
                          className="w-12 h-12 rounded-lg object-cover border border-gray-100"
                        />
                        <span className="text-sm font-medium text-gray-900 line-clamp-2">{review.product.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                          {review.customer.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{review.customer.name}</p>
                          <p className="text-xs text-gray-500">{review.customer.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        {renderStars(review.rating)}
                        <p className="text-sm font-bold text-gray-900">{review.title}</p>
                        <p className="text-sm text-gray-600 line-clamp-2">{review.comment}</p>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600 whitespace-nowrap">{review.date}</td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[review.status] || 'bg-gray-100'}`}>
                        {review.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-6 border-t border-gray-200">
          <p className="text-gray-600 text-sm">Showing {filteredReviews.length} reviews</p>
        </div>
      </div>
    </div>
  );
}
