'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import OrderHistory from './OrderHistory';
import AddressBook from './AddressBook';
import AffiliateDashboardPanel from '@/components/AffiliateDashboardPanel';
import { supabase } from '@/lib/supabase';

const TAB_IDS = ['profile', 'orders', 'addresses', 'security', 'affiliate'];

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'profile';

  const [activeTab, setActiveTab] = useState(TAB_IDS.includes(initialTab) ? initialTab : 'profile');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Update active tab when URL param changes
  useEffect(() => {
    const tab = searchParams.get('tab');
    setActiveTab(tab && TAB_IDS.includes(tab) ? tab : 'profile');
  }, [searchParams]);

  // Profile Form States
  const [profileData, setProfileData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  });
  const [profileMessage, setProfileMessage] = useState({ type: '', text: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  // Password Form States
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    password: '',
    confirmPassword: ''
  });
  const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/auth/login');
        return;
      }

      setUser(session.user);
      const meta = session.user.user_metadata || {};
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', session.user.id)
        .maybeSingle();
      const fromProfile = splitName(profile?.full_name || '');
      setProfileData({
        firstName: fromProfile.first || meta.first_name || '',
        lastName: fromProfile.first ? fromProfile.last : (meta.last_name || ''),
        email: session.user.email || '',
        phone: profile?.phone || meta.phone || session.user.phone || ''
      });
      setLoading(false);
    }
    checkUser();
  }, [router]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMessage({ type: '', text: '' });

    const phone = profileData.phone.trim();
    const phoneDigits = phone.replace(/\D/g, '');
    if (phone && !(/^0\d{9}$/.test(phoneDigits) || /^233\d{9}$/.test(phoneDigits))) {
      setProfileMessage({ type: 'error', text: 'Enter a Ghana phone number, for example 024 123 4567.' });
      setProfileLoading(false);
      return;
    }
    const fullName = `${profileData.firstName.trim()} ${profileData.lastName.trim()}`.trim();

    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName || null, phone: phone || null, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (profileError) throw profileError;

      // Keep the sign-in metadata in step (used by the header greeting and checkout prefill).
      await supabase.auth.updateUser({
        data: {
          first_name: profileData.firstName.trim(),
          last_name: profileData.lastName.trim(),
          phone,
        }
      });
      setProfileMessage({ type: 'success', text: 'Your details were saved.' });
    } catch (err: any) {
      setProfileMessage({ type: 'error', text: 'Your details could not be saved. Please try again.' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage({ type: '', text: '' });
    if (!passwordData.currentPassword) {
      setPasswordMessage({ type: 'error', text: 'Enter your current password.' });
      return;
    }
    if (passwordData.password.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Your new password must be at least 8 characters.' });
      return;
    }
    if (passwordData.password !== passwordData.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'The new passwords do not match.' });
      return;
    }
    if (passwordData.password === passwordData.currentPassword) {
      setPasswordMessage({ type: 'error', text: 'Choose a new password that is different from the current one.' });
      return;
    }

    setPasswordLoading(true);
    try {
      // The server only accepts a password change shortly after a sign-in,
      // so confirm the current password first.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: passwordData.currentPassword,
      });
      if (signInError) {
        const status = (signInError as any).status;
        setPasswordMessage({
          type: 'error',
          text: status === 429
            ? (signInError.message || 'Too many attempts. Please wait and try again.')
            : 'Your current password is not correct.',
        });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: passwordData.password });
      if (error) {
        const code = (error as any).code;
        const status = (error as any).status;
        if (code === 'reauthentication_needed' || status === 401) {
          setPasswordMessage({ type: 'error', text: 'Please sign in again to change your password.' });
        } else {
          setPasswordMessage({ type: 'error', text: error.message || 'The request could not be completed.' });
        }
        return;
      }

      // The server signs out every session after a password change.
      setPasswordData({ currentPassword: '', password: '', confirmPassword: '' });
      await supabase.auth.signOut();
      router.push('/auth/login?changed=1');
      router.refresh();
    } catch {
      setPasswordMessage({ type: 'error', text: 'The request could not be completed.' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
    router.refresh();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#ecfdf5]/50">
        <i className="ri-loader-4-line animate-spin text-4xl text-emerald-600"></i>
      </div>
    );
  }

  const securityOptions = [
    {
      icon: 'ri-mail-check-line',
      title: 'Email',
      description: user?.email,
      status: user?.email_confirmed_at ? 'verified' : 'unverified',
      href: null as string | null,
      onClick: null as null | (() => void),
    },
    {
      icon: 'ri-lock-password-line',
      title: 'Change password',
      description: 'Confirm your current password, then choose a new one',
      status: '',
      href: null,
      onClick: () => {
        setActiveTab('profile');
        router.replace('/account?tab=profile#change-password');
        setTimeout(() => document.getElementById('change-password')?.scrollIntoView({ behavior: 'smooth' }), 50);
      },
    },
    {
      icon: 'ri-shield-user-line',
      title: 'Privacy & Data',
      description: 'Download your data or ask us to delete your account',
      status: '',
      href: '/account/privacy',
      onClick: null,
    },
  ];

  const tabs = [
    { id: 'profile', icon: 'ri-user-line', label: 'Profile' },
    { id: 'orders', icon: 'ri-shopping-bag-line', label: 'Orders' },
    { id: 'addresses', icon: 'ri-map-pin-line', label: 'Addresses' },
    { id: 'affiliate', icon: 'ri-user-star-line', label: 'Affiliate' },
    { id: 'security', icon: 'ri-shield-keyhole-line', label: 'Security' },
  ];

  const inputCls =
    'w-full h-11 px-4 rounded-xl border border-[#d1fae5] bg-white text-[#0B1B3A] transition-all focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/50 focus:outline-none';

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#ecfdf5]/60 to-white py-10 lg:py-14 pb-24 lg:pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Heading */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight text-[#0B1B3A]">My Account</h1>
            <p className="mt-2 text-gray-500">Manage your profile, orders, and delivery addresses.</p>
          </div>
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 rounded-full border border-[#d1fae5] bg-white px-5 py-2.5 text-sm font-medium text-[#0B1B3A] transition-all hover:border-emerald-300 hover:text-emerald-700"
          >
            <i className="ri-logout-box-r-line"></i>
            Sign Out
          </button>
        </div>

        {/* Pill tabs */}
        <div className="mt-8 mb-8">
          <div className="flex w-full flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-[#d1fae5]/50 scrollbar-hide sm:w-fit sm:flex-wrap">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  router.replace(`/account?tab=${tab.id}`, { scroll: false });
                }}
                aria-pressed={activeTab === tab.id}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'border border-emerald-200 bg-[#ecfdf5] text-emerald-700'
                    : 'border border-transparent text-gray-500 hover:text-[#0B1B3A]'
                }`}
              >
                <i className={`${tab.icon} text-base`}></i>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div>
          {activeTab === 'profile' && (
            <div className="max-w-2xl space-y-8">
              <div>
                <h3 className="font-serif text-xl font-semibold text-[#0B1B3A]">Personal Information</h3>
                <p className="mt-1 text-sm text-gray-500">Update your personal details and preferences.</p>
              </div>

              {profileMessage.text && (
                <div role={profileMessage.type === 'error' ? 'alert' : 'status'} className={`p-4 rounded-xl flex items-start gap-3 ${profileMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                  <i className={`text-xl mt-0.5 ${profileMessage.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}`}></i>
                  <div>{profileMessage.text}</div>
                </div>
              )}

              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="account-first-name" className="text-sm font-medium text-[#0B1B3A]">First Name</label>
                    <input
                      id="account-first-name"
                      type="text"
                      autoComplete="given-name"
                      value={profileData.firstName}
                      onChange={e => setProfileData({ ...profileData, firstName: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="account-last-name" className="text-sm font-medium text-[#0B1B3A]">Last Name</label>
                    <input
                      id="account-last-name"
                      type="text"
                      autoComplete="family-name"
                      value={profileData.lastName}
                      onChange={e => setProfileData({ ...profileData, lastName: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="account-email" className="text-sm font-medium text-[#0B1B3A]">Email Address</label>
                    <div className="relative">
                      <input
                        id="account-email"
                        type="email"
                        value={profileData.email}
                        disabled
                        className="w-full h-11 pl-4 pr-24 rounded-xl border border-[#d1fae5] bg-[#ecfdf5]/50 text-gray-500 cursor-not-allowed"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-1 rounded">Read Only</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="account-phone" className="text-sm font-medium text-[#0B1B3A]">Phone Number</label>
                    <input
                      id="account-phone"
                      type="tel"
                      autoComplete="tel"
                      value={profileData.phone}
                      onChange={e => setProfileData({ ...profileData, phone: e.target.value })}
                      placeholder="024 123 4567"
                      className={inputCls}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={profileLoading}
                  className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  {profileLoading ? 'Saving…' : 'Save Changes'}
                </button>
              </form>

              <div id="change-password" className="mt-4 pt-8 border-t border-[#d1fae5]/50 scroll-mt-24">
                <h3 className="font-serif text-xl font-semibold text-[#0B1B3A]">Change Password</h3>
                <p className="mt-1 text-sm text-gray-500 mb-6">Enter your current password, then choose a new one of at least 8 characters. You will be asked to sign in again afterwards.</p>

                {passwordMessage.text && (
                  <div role={passwordMessage.type === 'error' ? 'alert' : 'status'} className={`mb-6 p-4 rounded-xl flex items-start gap-3 ${passwordMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                    <i className={`text-xl mt-0.5 ${passwordMessage.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}`}></i>
                    <div>{passwordMessage.text}</div>
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2 sm:col-span-2 sm:max-w-[calc(50%-0.75rem)]">
                      <label htmlFor="account-current-password" className="text-sm font-medium text-[#0B1B3A]">Current Password</label>
                      <input
                        id="account-current-password"
                        type="password"
                        autoComplete="current-password"
                        value={passwordData.currentPassword}
                        onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="account-new-password" className="text-sm font-medium text-[#0B1B3A]">New Password</label>
                      <input
                        id="account-new-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        value={passwordData.password}
                        onChange={e => setPasswordData({ ...passwordData, password: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="account-confirm-password" className="text-sm font-medium text-[#0B1B3A]">Confirm New Password</label>
                      <input
                        id="account-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        value={passwordData.confirmPassword}
                        onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="rounded-full border border-[#d1fae5] px-8 py-3 text-sm font-medium text-[#0B1B3A] transition-all hover:border-emerald-400 hover:text-emerald-700 active:scale-95 disabled:opacity-50"
                  >
                    {passwordLoading ? 'Updating…' : 'Update Password'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'orders' && <OrderHistory />}

          {activeTab === 'addresses' && <AddressBook />}

          {activeTab === 'affiliate' && (
            <div>
              <h3 className="font-serif text-xl font-semibold text-[#0B1B3A] mb-6">Affiliate</h3>
              <AffiliateDashboardPanel />
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h3 className="font-serif text-xl font-semibold text-[#0B1B3A] mb-6">Security Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {securityOptions.map((option) => {
                  const inner = (
                    <>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 bg-[#ecfdf5] rounded-full flex items-center justify-center text-[#0B1B3A]/70 group-hover:text-emerald-600 transition-colors flex-shrink-0">
                          <i className={`${option.icon} text-xl`} aria-hidden="true"></i>
                        </div>
                        <div className="min-w-0 text-left">
                          <h4 className="font-semibold text-[#0B1B3A] truncate">{option.title}</h4>
                          <p className="text-sm text-gray-500 truncate">{option.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {option.status === 'verified' && (
                          <span className="text-[10px] sm:text-xs font-semibold px-2 sm:px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-1">
                            <i className="ri-verified-badge-fill" aria-hidden="true"></i> Confirmed
                          </span>
                        )}
                        {option.status === 'unverified' && (
                          <span className="text-[10px] sm:text-xs font-semibold px-2 sm:px-3 py-1 bg-amber-50 text-amber-700 rounded-full flex items-center gap-1">
                            <i className="ri-error-warning-fill" aria-hidden="true"></i> Not confirmed
                          </span>
                        )}
                        {(option.href || option.onClick) && (
                          <i className="ri-arrow-right-line text-gray-300 group-hover:text-emerald-400 transition-colors" aria-hidden="true"></i>
                        )}
                      </div>
                    </>
                  );
                  const cls = 'flex w-full items-center justify-between p-5 border border-[#d1fae5] rounded-2xl bg-white transition-all group';
                  if (option.href) {
                    return (
                      <Link key={option.title} href={option.href} className={`${cls} hover:border-emerald-300 hover:shadow-md`}>
                        {inner}
                      </Link>
                    );
                  }
                  if (option.onClick) {
                    return (
                      <button key={option.title} type="button" onClick={option.onClick} className={`${cls} hover:border-emerald-300 hover:shadow-md`}>
                        {inner}
                      </button>
                    );
                  }
                  return <div key={option.title} className={cls}>{inner}</div>;
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#ecfdf5]/50">
        <i className="ri-loader-4-line animate-spin text-4xl text-emerald-600"></i>
      </div>
    }>
      <AccountContent />
    </Suspense>
  );
}
