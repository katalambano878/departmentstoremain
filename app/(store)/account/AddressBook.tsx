'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const GHANA_REGIONS = [
  'Greater Accra',
  'Ashanti',
  'Central',
  'Eastern',
  'Western',
  'Western North',
  'Volta',
  'Oti',
  'Northern',
  'Savannah',
  'North East',
  'Upper East',
  'Upper West',
  'Bono',
  'Bono East',
  'Ahafo',
];

interface Address {
  id: string;
  label: string | null;
  full_name: string;
  phone: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

type FormState = {
  label: string;
  full_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  is_default: boolean;
};

const EMPTY_FORM: FormState = {
  label: '',
  full_name: '',
  phone: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: 'Greater Accra',
  postal_code: '',
  is_default: false,
};

const COLUMNS = 'id, label, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default';

/** Ghana numbers: 0XXXXXXXXX or 233XXXXXXXXX (spaces, dashes and + allowed). */
function validGhanaPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return /^0[235]\d{8}$/.test(digits) || /^233[235]\d{8}$/.test(digits);
}

const inputCls =
  'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-700 focus:border-transparent';

export default function AddressBook() {
  const [userId, setUserId] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }
    setUserId(session.user.id);
    const { data, error } = await supabase
      .from('addresses')
      .select(COLUMNS)
      .eq('user_id', session.user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(true);
    } else {
      setAddresses((data || []) as Address[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, is_default: addresses.length === 0 });
    setFormErrors({});
    setMessage(null);
    setShowForm(true);
  };

  const openEdit = (address: Address) => {
    setEditingId(address.id);
    setForm({
      label: address.label || '',
      full_name: address.full_name,
      phone: address.phone,
      address_line1: address.address_line1,
      address_line2: address.address_line2 || '',
      city: address.city,
      state: GHANA_REGIONS.includes(address.state) ? address.state : 'Greater Accra',
      postal_code: address.postal_code === '-' ? '' : address.postal_code,
      is_default: address.is_default,
    });
    setFormErrors({});
    setMessage(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormErrors({});
  };

  const validate = (): boolean => {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.full_name.trim()) errors.full_name = 'Enter the name of the person receiving the order.';
    if (!validGhanaPhone(form.phone)) errors.phone = 'Enter a Ghana phone number, for example 024 123 4567.';
    if (!form.address_line1.trim()) errors.address_line1 = 'Enter a street, house number or landmark.';
    if (!form.city.trim()) errors.city = 'Enter the town or city.';
    if (!GHANA_REGIONS.includes(form.state)) errors.state = 'Choose a region.';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /** Only one default: clear the flag on the others first. */
  const clearOtherDefaults = async (keepId: string | null) => {
    if (!userId) return;
    let q = supabase.from('addresses').update({ is_default: false }).eq('user_id', userId).eq('is_default', true);
    if (keepId) q = q.neq('id', keepId);
    const { error } = await q;
    if (error) throw error;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !validate()) return;
    setSaving(true);
    setMessage(null);
    const row = {
      user_id: userId,
      type: 'shipping',
      label: form.label.trim() || null,
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      address_line1: form.address_line1.trim(),
      address_line2: form.address_line2.trim() || null,
      city: form.city.trim(),
      state: form.state,
      postal_code: form.postal_code.trim() || '-',
      country: 'Ghana',
      is_default: form.is_default,
      updated_at: new Date().toISOString(),
    };
    try {
      if (form.is_default) await clearOtherDefaults(editingId);
      if (editingId) {
        const { error } = await supabase.from('addresses').update(row).eq('id', editingId).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('addresses').insert(row);
        if (error) throw error;
      }
      setMessage({ type: 'success', text: editingId ? 'Address updated.' : 'Address saved.' });
      closeForm();
      await load();
    } catch (err) {
      console.error('Address save failed:', err);
      setMessage({ type: 'error', text: 'The address could not be saved. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!userId) return;
    setBusyId(id);
    setMessage(null);
    const { error } = await supabase.from('addresses').delete().eq('id', id).eq('user_id', userId);
    setBusyId(null);
    setConfirmDeleteId(null);
    if (error) {
      setMessage({ type: 'error', text: 'The address could not be deleted. Please try again.' });
      return;
    }
    setMessage({ type: 'success', text: 'Address deleted.' });
    await load();
  };

  const handleSetDefault = async (id: string) => {
    if (!userId) return;
    setBusyId(id);
    setMessage(null);
    try {
      await clearOtherDefaults(id);
      const { error } = await supabase.from('addresses').update({ is_default: true }).eq('id', id).eq('user_id', userId);
      if (error) throw error;
      await load();
    } catch {
      setMessage({ type: 'error', text: 'The default address could not be changed. Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  const field = (key: keyof FormState, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const errorText = (key: keyof FormState) =>
    formErrors[key] ? <p id={`addr-${key}-error`} className="text-sm text-red-600 mt-1">{formErrors[key]}</p> : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Address Book</h2>
        {!showForm && !loading && !loadError && (
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap"
          >
            <i className="ri-add-line mr-2" aria-hidden="true"></i>
            Add New Address
          </button>
        )}
      </div>

      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`mb-6 p-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}
        >
          {message.text}
        </div>
      )}

      {showForm && (
        <div className="bg-white border-2 border-emerald-700 rounded-lg p-4 sm:p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">
            {editingId ? 'Edit Address' : 'New Address'}
          </h3>
          <form onSubmit={handleSave} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="addr-full_name" className="block text-sm font-semibold text-gray-900 mb-2">Full name *</label>
              <input
                id="addr-full_name"
                type="text"
                autoComplete="name"
                value={form.full_name}
                onChange={(e) => field('full_name', e.target.value)}
                aria-invalid={!!formErrors.full_name}
                aria-describedby={formErrors.full_name ? 'addr-full_name-error' : undefined}
                className={inputCls}
              />
              {errorText('full_name')}
            </div>
            <div>
              <label htmlFor="addr-phone" className="block text-sm font-semibold text-gray-900 mb-2">Phone number *</label>
              <input
                id="addr-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => field('phone', e.target.value)}
                aria-invalid={!!formErrors.phone}
                aria-describedby={formErrors.phone ? 'addr-phone-error' : undefined}
                className={inputCls}
                placeholder="024 123 4567"
              />
              {errorText('phone')}
            </div>
            <div className="md:col-span-2">
              <label htmlFor="addr-address_line1" className="block text-sm font-semibold text-gray-900 mb-2">Street, house number or landmark *</label>
              <input
                id="addr-address_line1"
                type="text"
                autoComplete="address-line1"
                value={form.address_line1}
                onChange={(e) => field('address_line1', e.target.value)}
                aria-invalid={!!formErrors.address_line1}
                aria-describedby={formErrors.address_line1 ? 'addr-address_line1-error' : undefined}
                className={inputCls}
              />
              {errorText('address_line1')}
            </div>
            <div className="md:col-span-2">
              <label htmlFor="addr-address_line2" className="block text-sm font-semibold text-gray-900 mb-2">More directions (optional)</label>
              <input
                id="addr-address_line2"
                type="text"
                autoComplete="address-line2"
                value={form.address_line2}
                onChange={(e) => field('address_line2', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="addr-city" className="block text-sm font-semibold text-gray-900 mb-2">Town or city *</label>
              <input
                id="addr-city"
                type="text"
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) => field('city', e.target.value)}
                aria-invalid={!!formErrors.city}
                aria-describedby={formErrors.city ? 'addr-city-error' : undefined}
                className={inputCls}
              />
              {errorText('city')}
            </div>
            <div>
              <label htmlFor="addr-state" className="block text-sm font-semibold text-gray-900 mb-2">Region *</label>
              <select
                id="addr-state"
                value={form.state}
                onChange={(e) => field('state', e.target.value)}
                className={`${inputCls} bg-white pr-8`}
              >
                {GHANA_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              {errorText('state')}
            </div>
            <div>
              <label htmlFor="addr-postal_code" className="block text-sm font-semibold text-gray-900 mb-2">GhanaPost GPS (optional)</label>
              <input
                id="addr-postal_code"
                type="text"
                value={form.postal_code}
                onChange={(e) => field('postal_code', e.target.value.toUpperCase())}
                className={inputCls}
                placeholder="GA-123-4567"
              />
            </div>
            <div>
              <label htmlFor="addr-label" className="block text-sm font-semibold text-gray-900 mb-2">Label (optional)</label>
              <input
                id="addr-label"
                type="text"
                value={form.label}
                onChange={(e) => field('label', e.target.value)}
                className={inputCls}
                placeholder="Home, Work…"
              />
            </div>
            <div className="md:col-span-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => field('is_default', e.target.checked)}
                  className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-700"
                />
                <span className="text-sm text-gray-700">Use as my default address</span>
              </label>
            </div>
            <div className="md:col-span-2 flex flex-col sm:flex-row gap-3">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Address'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="flex-1 py-3 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && (
        <div className="py-8 text-center">
          <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700" aria-hidden="true"></i>
          <p className="mt-2 text-gray-500">Loading addresses…</p>
        </div>
      )}

      {!loading && loadError && (
        <div role="alert" className="py-10 text-center bg-white rounded-lg border border-gray-200">
          <p className="text-gray-900 font-semibold mb-1">We could not load your addresses</p>
          <p className="text-gray-500 mb-4">Check your connection and try again.</p>
          <button type="button" onClick={load} className="bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-emerald-800 transition-colors">
            Try again
          </button>
        </div>
      )}

      {!loading && !loadError && addresses.length === 0 && !showForm && (
        <div className="py-10 text-center bg-white rounded-lg border border-gray-200">
          <i className="ri-map-pin-line text-3xl text-gray-400" aria-hidden="true"></i>
          <p className="mt-2 text-gray-900 font-semibold">No saved addresses yet</p>
          <p className="text-gray-500">Add one to fill in checkout faster.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {addresses.map((address) => (
          <div
            key={address.id}
            className={`bg-white border-2 rounded-lg p-4 sm:p-6 relative ${address.is_default ? 'border-emerald-700' : 'border-gray-200'}`}
          >
            {address.is_default && (
              <div className="absolute top-4 right-4">
                <span className="px-3 py-1 bg-emerald-700 text-white text-xs font-semibold rounded-full whitespace-nowrap">
                  Default
                </span>
              </div>
            )}

            <div className="mb-4 pr-20">
              {address.label && <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{address.label}</p>}
              <h3 className="text-lg font-bold text-gray-900">{address.full_name}</h3>
              <p className="text-gray-600">{address.phone}</p>
            </div>

            <div className="text-gray-700 space-y-1 mb-6">
              <p>{address.address_line1}</p>
              {address.address_line2 && <p>{address.address_line2}</p>}
              <p>{address.city}, {address.state}</p>
              {address.postal_code && address.postal_code !== '-' && <p>{address.postal_code}</p>}
            </div>

            {confirmDeleteId === address.id ? (
              <div role="alertdialog" aria-labelledby={`del-${address.id}`} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p id={`del-${address.id}`} className="text-sm text-red-800 mb-3">Delete this address? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(address.id)}
                    disabled={busyId === address.id}
                    className="flex-1 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
                  >
                    {busyId === address.id ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 py-2 border border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(address)}
                  className="flex-1 py-2 border border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Edit
                </button>
                {!address.is_default && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(address.id)}
                    disabled={busyId === address.id}
                    className="flex-1 py-2 border border-emerald-700 text-emerald-700 rounded-lg font-semibold hover:bg-emerald-50 transition-colors whitespace-nowrap disabled:opacity-60"
                  >
                    Set Default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(address.id)}
                  aria-label={`Delete address for ${address.full_name}`}
                  className="px-4 py-2 border border-red-600 text-red-600 rounded-lg font-semibold hover:bg-red-50 transition-colors whitespace-nowrap"
                >
                  <i className="ri-delete-bin-line" aria-hidden="true"></i>
                  <span className="sm:hidden ml-2">Delete</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
