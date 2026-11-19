'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function PrivacySettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/auth/login?redirect=/account/privacy');
        return;
      }
      setUser(session.user);
    });
  }, [router]);

  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const [profileRes, addressesRes, ordersRes] = await Promise.all([
        supabase.from('profiles').select('email, full_name, phone, date_of_birth, gender, created_at').eq('id', user.id).maybeSingle(),
        supabase.from('addresses').select('label, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default, created_at').eq('user_id', user.id),
        supabase
          .from('orders')
          .select('order_number, created_at, status, payment_status, subtotal, shipping_total, discount_total, total, shipping_method, shipping_address, order_items(product_name, variant_name, quantity, unit_price, total_price)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
      ]);
      const failed = [profileRes, addressesRes, ordersRes].find((r) => r.error);
      if (failed) throw failed.error;

      const userData = {
        exportedAt: new Date().toISOString(),
        account: { email: user.email, createdAt: user.created_at },
        profile: profileRes.data || null,
        addresses: addressesRes.data || [],
        orders: ordersRes.data || [],
      };

      const dataBlob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ddz-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage({ type: 'success', text: 'Your data file has been downloaded.' });
    } catch (err) {
      console.error('Data export failed:', err);
      setExportMessage({ type: 'error', text: 'We could not prepare your data. Please try again.' });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    setDeleteMessage(null);
    const { error } = await supabase.from('support_tickets').insert({
      user_id: user.id,
      email: user.email,
      subject: 'Account deletion request',
      description: 'I would like my Discount Discovery Zone account and personal data to be deleted.',
      category: 'account',
    });
    setDeleting(false);
    if (error) {
      console.error('Deletion request failed:', error);
      setDeleteMessage({ type: 'error', text: 'Your request could not be sent. Please try again, or email info@discountdiscoveryzone.com.' });
      return;
    }
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
    setDeleteMessage({
      type: 'success',
      text: 'Your deletion request has been sent to our team as a support ticket. Your account is not deleted yet: we will contact you to confirm before we delete it. You can follow the request under My support tickets.',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/account?tab=security" aria-label="Back to my account" className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors">
              <i className="ri-arrow-left-line text-xl"></i>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Privacy & Data</h1>
              <p className="text-sm text-gray-600">Manage your personal information</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex gap-3">
            <i className="ri-shield-check-line text-xl text-emerald-600 flex-shrink-0 mt-0.5"></i>
            <div>
              <h3 className="font-semibold text-emerald-900 mb-1">Your Privacy Matters</h3>
              <p className="text-sm text-emerald-800">
                You can download a copy of the personal data we hold for your account, or ask us to delete your account.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold mb-4">Data Export</h2>
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <i className="ri-download-cloud-line text-lg"></i>
                Download Your Data
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Download your profile, saved addresses and orders as a JSON file.
              </p>
              <button
                type="button"
                onClick={handleExportData}
                disabled={exporting || !user}
                className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium whitespace-nowrap"
              >
                {exporting ? (
                  <>
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Preparing file…
                  </>
                ) : (
                  <>
                    <i className="ri-download-line mr-2"></i>
                    Export My Data
                  </>
                )}
              </button>
            </div>

            {exportMessage && (
              <p role={exportMessage.type === 'error' ? 'alert' : 'status'} className={`text-sm p-3 rounded-lg ${exportMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                {exportMessage.text}
              </p>
            )}
          </div>

          <div className="border-t pt-6">
            <h2 className="text-lg font-bold mb-4 text-red-600">Danger Zone</h2>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                <i className="ri-delete-bin-line text-lg"></i>
                Delete Account
              </h3>
              <p className="text-sm text-red-800 mb-4">
                Send us a request to delete your account. Our team handles it by hand and contacts you to confirm first. Records we must keep by law, such as paid orders, are kept.
              </p>
              
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(true); setDeleteMessage(null); }}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium whitespace-nowrap"
                >
                  Request Account Deletion
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white rounded-lg p-4 border border-red-300">
                    <h4 className="font-semibold text-red-900 mb-2">Before you continue</h4>
                    <ul className="space-y-2 text-sm text-gray-700 mb-4">
                      <li className="flex items-start gap-2">
                        <i className="ri-alert-line text-red-600 mt-0.5 flex-shrink-0" aria-hidden="true"></i>
                        <span>Once deleted, you can no longer sign in or see your order history here.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <i className="ri-alert-line text-red-600 mt-0.5 flex-shrink-0" aria-hidden="true"></i>
                        <span>Download your data first if you want to keep a copy.</span>
                      </li>
                    </ul>

                    <div className="mb-4">
                      <label htmlFor="delete-confirm" className="block text-sm font-medium mb-2 text-gray-900">
                        Type <span className="font-bold">DELETE</span> to confirm:
                      </label>
                      <input
                        id="delete-confirm"
                        type="text"
                        autoComplete="off"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteConfirmText('');
                        }}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium whitespace-nowrap"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteAccount}
                        disabled={deleteConfirmText !== 'DELETE' || deleting}
                        className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium whitespace-nowrap"
                      >
                        {deleting ? (
                          <>
                            <i className="ri-loader-4-line animate-spin mr-2"></i>
                            Sending…
                          </>
                        ) : (
                          'Send deletion request'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {deleteMessage && (
                <p role={deleteMessage.type === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm p-3 rounded-lg ${deleteMessage.type === 'success' ? 'bg-white text-emerald-800 border border-emerald-200' : 'bg-white text-red-700 border border-red-200'}`}>
                  {deleteMessage.text}{' '}
                  {deleteMessage.type === 'success' && <Link href="/support/tickets" className="font-semibold underline">My support tickets</Link>}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold mb-4">Your Privacy Rights</h2>
          <div className="space-y-4 text-sm text-gray-700">
            <div className="flex gap-3">
              <i className="ri-eye-line text-lg text-gray-400 flex-shrink-0"></i>
              <div>
                <h3 className="font-semibold mb-1">Right to Access</h3>
                <p className="text-gray-600">You can download your profile, addresses and orders at any time.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <i className="ri-edit-line text-lg text-gray-400 flex-shrink-0"></i>
              <div>
                <h3 className="font-semibold mb-1">Right to Rectification</h3>
                <p className="text-gray-600">You can update and correct your personal information in account settings.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <i className="ri-delete-bin-line text-lg text-gray-400 flex-shrink-0"></i>
              <div>
                <h3 className="font-semibold mb-1">Right to Erasure</h3>
                <p className="text-gray-600">You can ask us to delete your account. We keep only what the law requires.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <i className="ri-file-shield-line text-lg text-gray-400 flex-shrink-0"></i>
              <div>
                <h3 className="font-semibold mb-1">Right to Data Portability</h3>
                <p className="text-gray-600">Export your data in a structured, machine-readable format.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-100 rounded-xl p-4">
          <p className="text-sm text-gray-600 text-center">
            Questions about privacy? Read our{' '}
            <Link href="/privacy" className="text-black font-medium hover:underline">
              Privacy Policy
            </Link>
            {' '}or{' '}
            <Link href="/contact" className="text-black font-medium hover:underline">
              contact support
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
