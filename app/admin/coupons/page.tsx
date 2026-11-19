'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/** coupons.type (discount_type enum) -> label shown in the table. */
const TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage',
  fixed_amount: 'Fixed Amount',
  free_shipping: 'Free Shipping',
};

export default function AdminCouponsPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<any>(null);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCoupons();
  }, []);

  const fetchCoupons = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Coupons table might not exist or error fetching:', error);
      } else if (data) {
        setCoupons(data.map((c: any) => ({
          id: c.id,
          code: c.code,
          type: TYPE_LABELS[c.type] || 'Percentage',
          value: Number(c.value) || 0,
          minPurchase: Number(c.minimum_purchase) || 0,
          usageLimit: c.usage_limit || null,
          usedCount: c.usage_count || 0,
          startDate: c.start_date ? new Date(c.start_date).toLocaleDateString() : 'N/A',
          endDate: c.end_date ? new Date(c.end_date).toLocaleDateString() : null,
          // yyyy-mm-dd for the edit form's date input
          endDateInput: c.end_date ? String(c.end_date).slice(0, 10) : '',
          isActive: c.is_active !== false,
          status: isCouponActive(c) ? 'Active' : 'Expired' // Derive status
        })));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isCouponActive = (c: any) => {
    // Simple check
    if (!c.is_active) return false;
    if (c.end_date && new Date(c.end_date) < new Date()) return false;
    return true;
  };

  const statusColors: any = {
    'Active': 'bg-blue-100 text-blue-700',
    'Scheduled': 'bg-blue-100 text-blue-700',
    'Expired': 'bg-gray-100 text-gray-700',
    'Disabled': 'bg-red-100 text-red-700'
  };

  const [couponForm, setCouponForm] = useState({
    code: '',
    discount_type: 'percentage',
    discount_value: 0,
    min_purchase_amount: 0,
    usage_limit: 0,
    end_date: '',
    is_active: true
  });

  const handleEdit = (coupon: any) => {
    setEditingCoupon(coupon);
    setCouponForm({
      code: coupon.code || '',
      discount_type: (coupon.type || 'percentage').toLowerCase().replace(' ', '_'),
      discount_value: coupon.value || 0,
      min_purchase_amount: coupon.minPurchase || 0,
      usage_limit: coupon.usageLimit || 0,
      end_date: coupon.endDateInput || '',
      is_active: coupon.isActive
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setCouponForm({ code: '', discount_type: 'percentage', discount_value: 0, min_purchase_amount: 0, usage_limit: 0, end_date: '', is_active: true });
  };

  const handleSaveCoupon = async () => {
    if (!couponForm.code.trim()) { alert('Please enter a coupon code'); return; }
    const freeShipping = couponForm.discount_type === 'free_shipping';
    if (!freeShipping && couponForm.discount_value <= 0) { alert('Please enter a discount value'); return; }
    if (couponForm.discount_type === 'percentage' && couponForm.discount_value > 100) { alert('A percentage discount cannot be more than 100%'); return; }

    const payload = {
      code: couponForm.code.toUpperCase().trim(),
      type: couponForm.discount_type,
      value: freeShipping ? 0 : couponForm.discount_value,
      minimum_purchase: couponForm.min_purchase_amount || 0,
      usage_limit: couponForm.usage_limit || null,
      end_date: couponForm.end_date || null,
      is_active: couponForm.is_active
    };

    if (showEditModal && editingCoupon) {
      const { error } = await supabase.from('coupons').update(payload).eq('id', editingCoupon.id);
      if (error) { alert('Failed to update coupon: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('coupons').insert([{ ...payload, start_date: new Date().toISOString() }]);
      if (error) { alert('Failed to create coupon: ' + error.message); return; }
    }

    setShowAddModal(false);
    setShowEditModal(false);
    resetForm();
    fetchCoupons();
  };

  const handleDeleteCoupon = async (couponId: string) => {
    if (!confirm('Are you sure you want to delete this coupon?')) return;
    const { error } = await supabase.from('coupons').delete().eq('id', couponId);
    if (error) { alert('Failed to delete coupon: ' + error.message); return; }
    setCoupons(coupons.filter(c => c.id !== couponId));
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => alert('Coupon code copied!')).catch(() => {});
  };

  const activeCoupons = coupons.filter(c => c.status === 'Active');
  const totalUses = coupons.reduce((sum, c) => sum + c.usedCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Coupons & Promotions</h1>
          <p className="text-gray-600 mt-1">Create and manage discount codes</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAddModal(true); }}
          className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line mr-2"></i>
          Create Coupon
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Coupons</p>
          <p className="text-2xl font-bold text-gray-900">{coupons.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-2xl font-bold text-blue-700">{activeCoupons.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Uses</p>
          <p className="text-2xl font-bold text-gray-900">{totalUses}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Discount</p>
          <p className="text-2xl font-bold text-purple-700">--</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">All Coupons</h2>
            <div className="flex items-center space-x-3">
              <select className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer">
                <option>All Status</option>
                <option>Active</option>
                <option>Scheduled</option>
                <option>Expired</option>
              </select>
              <select className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer">
                <option>Sort by Date</option>
                <option>Sort by Usage</option>
                <option>Sort by Value</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-semibold text-gray-700">Code</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Type</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Value</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Min Purchase</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Usage</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Valid Period</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">Loading coupons...</td></tr>
              ) : coupons.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">No coupons found.</td></tr>
              ) : (
                coupons.map((coupon) => (
                  <tr key={coupon.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded">{coupon.code}</span>
                        <button
                          onClick={() => handleCopyCode(coupon.code)}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                          title="Copy code"
                        >
                          <i className="ri-file-copy-line"></i>
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700">{coupon.type}</td>
                    <td className="py-4 px-4 font-semibold text-gray-900">
                      {coupon.type === 'Percentage' ? `${coupon.value}%` : coupon.type === 'Fixed Amount' ? `GH₵ ${coupon.value}` : 'Free Shipping'}
                    </td>
                    <td className="py-4 px-4 text-gray-700 whitespace-nowrap">
                      {coupon.minPurchase > 0 ? `GH₵ ${coupon.minPurchase.toFixed(2)}` : 'No minimum'}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-900 font-semibold">{coupon.usedCount}</span>
                        <span className="text-gray-500">/</span>
                        <span className="text-gray-600">{coupon.usageLimit || '∞'}</span>
                      </div>
                      {coupon.usageLimit && (
                        <div className="w-24 h-2 bg-gray-200 rounded-full mt-2">
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${Math.min((coupon.usedCount / coupon.usageLimit) * 100, 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-sm text-gray-700 whitespace-nowrap">{coupon.startDate}</p>
                      <p className="text-sm text-gray-500 whitespace-nowrap">{coupon.endDate || 'No expiry'}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[coupon.status] || 'bg-gray-100'}`}>
                        {coupon.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEdit(coupon)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-edit-line text-lg"></i>
                        </button>
                        <button
                          onClick={() => handleDeleteCoupon(coupon.id)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete coupon"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              {showEditModal ? 'Edit Coupon' : 'Create New Coupon'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Coupon Code *</label>
                <input
                  type="text"
                  value={couponForm.code}
                  onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. SAVE20"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Discount Type</label>
                  <select
                    value={couponForm.discount_type}
                    onChange={(e) => setCouponForm({ ...couponForm, discount_type: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg cursor-pointer"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed_amount">Fixed Amount (GH₵)</option>
                    <option value="free_shipping">Free Shipping</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {couponForm.discount_type === 'percentage' ? 'Percentage (%)' : 'Amount (GH₵)'}
                  </label>
                  <input
                    type="number"
                    value={couponForm.discount_value || ''}
                    onChange={(e) => setCouponForm({ ...couponForm, discount_value: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                    disabled={couponForm.discount_type === 'free_shipping'}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Min Purchase (GH₵)</label>
                  <input
                    type="number"
                    value={couponForm.min_purchase_amount || ''}
                    onChange={(e) => setCouponForm({ ...couponForm, min_purchase_amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0 = no minimum"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Usage Limit</label>
                  <input
                    type="number"
                    value={couponForm.usage_limit || ''}
                    onChange={(e) => setCouponForm({ ...couponForm, usage_limit: parseInt(e.target.value) || 0 })}
                    placeholder="0 = unlimited"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Expiry Date (optional)</label>
                <input
                  type="date"
                  value={couponForm.end_date}
                  onChange={(e) => setCouponForm({ ...couponForm, end_date: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                />
              </div>
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={couponForm.is_active}
                  onChange={(e) => setCouponForm({ ...couponForm, is_active: e.target.checked })}
                  className="w-5 h-5 text-blue-700 rounded"
                />
                <span className="text-sm font-medium text-gray-700">Active</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowAddModal(false); setShowEditModal(false); resetForm(); }}
                className="flex-1 border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCoupon}
                className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-colors cursor-pointer"
              >
                {showEditModal ? 'Save Changes' : 'Create Coupon'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
