'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_STAFF_ROLE, roleLabel, type StaffRole } from '@/lib/admin-staff-shared';

type StaffMember = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: StaffRole;
  created_at: string;
  updated_at?: string;
  last_sign_in_at?: string | null;
  banned?: boolean;
};

type Counts = {
  total: number;
  admin: number;
  staff: number;
  staff_pos: number;
};

const ROLE_BADGE: Record<StaffRole, string> = {
  admin: 'bg-rose-100 text-rose-800 border-rose-200',
  staff: 'bg-blue-100 text-blue-800 border-blue-200',
  staff_pos: 'bg-violet-100 text-violet-800 border-violet-200',
};

const ROLE_OPTIONS: { value: StaffRole; label: string; help: string }[] = [
  { value: 'staff', label: 'Staff', help: 'Full admin panel access (default)' },
  { value: 'staff_pos', label: 'POS only', help: 'Can use POS and Orders only' },
  { value: 'admin', label: 'Admin', help: 'Full access including staff management' },
];

function formatDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | StaffRole>('all');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState<StaffMember | null>(null);
  const [passwordOpen, setPasswordOpen] = useState<StaffMember | null>(null);

  const [addForm, setAddForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: DEFAULT_STAFF_ROLE as StaffRole,
  });
  const [editForm, setEditForm] = useState({
    full_name: '',
    phone: '',
    role: DEFAULT_STAFF_ROLE as StaffRole,
  });
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, []);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/staff', {
        headers: await authHeaders(),
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load staff');
      setStaff(json.staff || []);
      setCounts(json.counts || null);
      setViewerId(json.viewerId || null);
      setViewerRole(json.viewerRole || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (roleFilter !== 'all' && s.role !== roleFilter) return false;
      if (!q) return true;
      return (
        (s.full_name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
      );
    });
  }, [staff, search, roleFilter]);

  // Only an admin may add, edit, reset or remove staff. Other staff can only view the list.
  const isAdmin = viewerRole === 'admin';
  const canAssignAdmin = isAdmin;
  const [notice, setNotice] = useState('');

  const openAdd = () => {
    setAddForm({
      full_name: '',
      email: '',
      password: '',
      role: DEFAULT_STAFF_ROLE,
    });
    setAddOpen(true);
  };

  const openEdit = (member: StaffMember) => {
    setEditForm({
      full_name: member.full_name || '',
      phone: member.phone || '',
      role: member.role,
    });
    setEditOpen(member);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(addForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create staff');
      setAddOpen(false);
      setNotice(
        json.promoted
          ? `${addForm.email} now has ${roleLabel(addForm.role)} access. ${json.message || 'This person keeps their existing password.'}`
          : `${addForm.email} was added as ${roleLabel(addForm.role)}.`
      );
      await loadStaff();
    } catch (err: any) {
      setError(err.message || 'Could not create staff');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOpen) return;
    // Send only what changed, so editing a name never touches the role.
    const changes: Partial<typeof editForm> = {};
    if (editForm.full_name.trim() !== (editOpen.full_name || '')) changes.full_name = editForm.full_name.trim();
    if (editForm.phone.trim() !== (editOpen.phone || '')) changes.phone = editForm.phone.trim();
    if (editForm.role !== editOpen.role && editOpen.id !== viewerId) changes.role = editForm.role;
    if (Object.keys(changes).length === 0) {
      setEditOpen(null);
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/staff/${editOpen.id}`, {
        method: 'PATCH',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(changes),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not update staff');
      setEditOpen(null);
      await loadStaff();
    } catch (err: any) {
      setError(err.message || 'Could not update staff');
    } finally {
      setSaving(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOpen) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/staff/${passwordOpen.id}`, {
        method: 'PUT',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ password: newPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not update password');
      setPasswordOpen(null);
      setNewPassword('');
      alert('Password updated successfully.');
    } catch (err: any) {
      setError(err.message || 'Could not update password');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member: StaffMember) => {
    if (member.id === viewerId) {
      alert('You cannot remove your own account.');
      return;
    }
    const ok = window.confirm(
      `Remove staff access for ${member.full_name || member.email}?\n\nThey will no longer be able to sign in to the admin panel. Their account history is kept.`
    );
    if (!ok) return;

    setBusyId(member.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/staff/${member.id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not remove staff');
      await loadStaff();
    } catch (err: any) {
      setError(err.message || 'Could not remove staff');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Staff</h1>
          <p className="text-gray-600 mt-1">
            Add, edit, and manage staff accounts. Existing roles stay the same.
          </p>
        </div>
        {isAdmin && (
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors"
        >
          <i className="ri-user-add-line text-lg"></i>
          Add Staff
        </button>
        )}
      </div>

      {!loading && !isAdmin && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          You can view the staff list. Only an admin can add, edit or remove staff.
        </div>
      )}

      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total staff</p>
            <p className="text-2xl font-bold text-gray-900">{counts.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Admins</p>
            <p className="text-2xl font-bold text-rose-700">{counts.admin}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Staff</p>
            <p className="text-2xl font-bold text-blue-700">{counts.staff}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">POS only</p>
            <p className="text-2xl font-bold text-violet-700">{counts.staff_pos}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {(['all', 'admin', 'staff', 'staff_pos'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={`px-3 py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
                roleFilter === key ? 'bg-blue-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {key === 'all' ? 'All' : roleLabel(key)}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-loader-4-line animate-spin text-3xl text-blue-600"></i>
            <p className="mt-3">Loading staff...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-shield-user-line text-5xl text-gray-300"></i>
            <p className="mt-3 font-semibold text-gray-700">No staff found</p>
            <p className="text-sm mt-1">Add a staff member to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Staff</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase hidden md:table-cell">
                    Last sign-in
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase hidden lg:table-cell">
                    Created
                  </th>
                  {isAdmin && <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {member.full_name || '—'}
                          {member.id === viewerId && (
                            <span className="ml-2 text-xs font-medium text-emerald-700">(you)</span>
                          )}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{member.email}</p>
                        {member.phone && <p className="text-xs text-gray-400">{member.phone}</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${ROLE_BADGE[member.role]}`}
                      >
                        {roleLabel(member.role)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 hidden md:table-cell">
                      {formatDate(member.last_sign_in_at)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 hidden lg:table-cell">
                      {formatDate(member.created_at)}
                    </td>
                    {isAdmin && (
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(member)}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNewPassword('');
                            setPasswordOpen(member);
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50"
                          title="Change password"
                        >
                          Password
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(member)}
                          disabled={busyId === member.id || member.id === viewerId}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                          title="Remove staff access"
                        >
                          {busyId === member.id ? '…' : 'Remove'}
                        </button>
                      </div>
                    </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add modal */}
      {isAdmin && addOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setAddOpen(false)} />
          <form
            onSubmit={handleCreate}
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 p-6 space-y-4"
          >
            <h2 className="text-xl font-bold text-gray-900">Add staff member</h2>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Full name</label>
              <input
                required
                value={addForm.full_name}
                onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Email</label>
              <input
                required
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Temporary password</label>
              <input
                type="text"
                minLength={6}
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">At least 6 characters. Share this securely with the staff member. If the email already has a customer account, it is not used: they keep their own password.</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Role</label>
              <div className="space-y-2">
                {ROLE_OPTIONS.filter((o) => o.value !== 'admin' || canAssignAdmin).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${
                      addForm.role === opt.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="add-role"
                      checked={addForm.role === opt.value}
                      onChange={() => setAddForm((f) => ({ ...f, role: opt.value }))}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-gray-900">{opt.label}</span>
                      <span className="block text-xs text-gray-600">{opt.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setAddOpen(false)}
                className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create staff'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {isAdmin && editOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setEditOpen(null)} />
          <form
            onSubmit={handleEdit}
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 p-6 space-y-4"
          >
            <h2 className="text-xl font-bold text-gray-900">Edit staff</h2>
            <p className="text-sm text-gray-500">{editOpen.email}</p>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Full name</label>
              <input
                required
                value={editForm.full_name}
                onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">Phone (optional)</label>
              <input
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {editOpen.id === viewerId ? (
              <p className="text-sm text-gray-600">
                Role: <strong>{roleLabel(editOpen.role)}</strong>. You cannot change your own role; ask another admin.
              </p>
            ) : (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Role</label>
              <div className="space-y-2">
                {ROLE_OPTIONS.filter((o) => o.value !== 'admin' || canAssignAdmin || editOpen.role === 'admin').map(
                  (opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${
                        editForm.role === opt.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="edit-role"
                        checked={editForm.role === opt.value}
                        onChange={() => setEditForm((f) => ({ ...f, role: opt.value }))}
                        disabled={opt.value === 'admin' && !canAssignAdmin && editOpen.role !== 'admin'}
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-semibold text-gray-900">{opt.label}</span>
                        <span className="block text-xs text-gray-600">{opt.help}</span>
                      </span>
                    </label>
                  )
                )}
              </div>
            </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditOpen(null)}
                className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Password modal */}
      {isAdmin && passwordOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setPasswordOpen(null)} />
          <form
            onSubmit={handlePassword}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-6 space-y-4"
          >
            <h2 className="text-xl font-bold text-gray-900">Change password</h2>
            <p className="text-sm text-gray-500">
              Set a new password for <strong>{passwordOpen.full_name || passwordOpen.email}</strong>
            </p>
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">New password</label>
              <input
                required
                type="text"
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setPasswordOpen(null)}
                className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
