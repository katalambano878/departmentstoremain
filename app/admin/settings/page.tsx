'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCMS } from '@/context/CMSContext';
import { useStaffRole } from '../_lib/useStaffRole';

// Same default as lib/birthdays.ts (server); {name} becomes the customer's first name.
const DEFAULT_BIRTHDAY_MESSAGE =
  'Happy birthday, {name}! Everyone at Discount Discovery Zone wishes you a wonderful day. Thank you for shopping with us.';

export default function SettingsPage() {
  const { settings, getSetting, updateSetting, refreshCMS } = useCMS();

  const [saving, setSaving] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState<'dark' | 'white' | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { role, loading: roleLoading } = useStaffRole();
  // site_settings writes are admin-only in the database.
  const readOnly = roleLoading || role !== 'admin';

  // Local form state
  const [siteName, setSiteName] = useState(getSetting('site_name'));
  const [siteTagline, setSiteTagline] = useState(getSetting('site_tagline'));
  const [contactEmail, setContactEmail] = useState(getSetting('contact_email'));
  const [contactPhone, setContactPhone] = useState(getSetting('contact_phone'));
  const [whatsappNumber, setWhatsappNumber] = useState(getSetting('whatsapp_number'));
  const [whatsappEnabled, setWhatsappEnabled] = useState(getSetting('whatsapp_button_enabled') !== 'false');
  const [birthdayEnabled, setBirthdayEnabled] = useState(getSetting('birthday_messages_enabled') !== 'false');
  const [birthdayMessage, setBirthdayMessage] = useState(getSetting('birthday_message') || DEFAULT_BIRTHDAY_MESSAGE);
  const birthdayEdited = useRef(false);

  // Settings can arrive after this page first renders (direct visit). Fill the
  // form from them until the admin starts typing, so Save never writes defaults.
  const edited = useRef(false);
  useEffect(() => {
    if (edited.current) return;
    setSiteName(getSetting('site_name'));
    setSiteTagline(getSetting('site_tagline'));
    setContactEmail(getSetting('contact_email'));
    setContactPhone(getSetting('contact_phone'));
    setWhatsappNumber(getSetting('whatsapp_number'));
    setWhatsappEnabled(getSetting('whatsapp_button_enabled') !== 'false');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  useEffect(() => {
    if (birthdayEdited.current) return;
    setBirthdayEnabled(getSetting('birthday_messages_enabled') !== 'false');
    setBirthdayMessage(getSetting('birthday_message') || DEFAULT_BIRTHDAY_MESSAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const handleSaveBirthday = async () => {
    setSaving('birthday');
    setSaveError(null);
    try {
      const text = birthdayMessage.trim();
      await updateSetting('birthday_messages_enabled', birthdayEnabled ? 'true' : 'false');
      await updateSetting('birthday_message', text === DEFAULT_BIRTHDAY_MESSAGE ? '' : text);
      birthdayEdited.current = false;
      showSuccess('Birthday message settings saved');
    } catch (err: any) {
      setSaveError('Not saved: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(null);
    }
  };

  const currentDarkLogo = getSetting('site_logo') || '/logo.png';
  const currentWhiteLogo = getSetting('site_logo_white') || '/logo-white.png';

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const uploadLogo = async (file: File, type: 'dark' | 'white') => {
    setUploadingLogo(type);
    setSaveError(null);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `branding/logo-${type}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('products')
        .getPublicUrl(fileName);

      const settingKey = type === 'dark' ? 'site_logo' : 'site_logo_white';
      await updateSetting(settingKey, publicUrl);
      await refreshCMS();

      showSuccess(`${type === 'dark' ? 'Header' : 'Footer'} logo updated successfully`);
    } catch (err: any) {
      setSaveError('Logo not saved: ' + (err?.message || 'unknown error'));
    } finally {
      setUploadingLogo(null);
    }
  };

  const handleSaveGeneral = async () => {
    setSaving('general');
    setSaveError(null);
    try {
      await updateSetting('site_name', siteName);
      await updateSetting('site_tagline', siteTagline);
      await updateSetting('contact_email', contactEmail);
      await updateSetting('contact_phone', contactPhone);
      await updateSetting('whatsapp_number', whatsappNumber.trim());
      await updateSetting('whatsapp_button_enabled', whatsappEnabled ? 'true' : 'false');
      showSuccess('Settings saved successfully');
    } catch (err: any) {
      setSaveError('Not saved: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Store Settings</h1>
        <p className="text-gray-600 mt-1">Manage your store branding and general information</p>
      </div>

      {!roleLoading && role !== 'admin' && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg">
          <i className="ri-lock-line text-amber-600 mt-0.5"></i>
          <span className="min-w-0">Only an admin can change store settings. You can view them here.</span>
        </div>
      )}

      {saveError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="min-w-0 flex-1 break-words">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center text-red-700 hover:text-red-900 sm:m-0 sm:block sm:h-auto sm:w-auto" aria-label="Dismiss">
            <i className="ri-close-line"></i>
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          <i className="ri-checkbox-circle-line text-green-600"></i>
          {success}
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-6 sm:space-y-8 min-w-0">
      {/* Logo Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Logo</h2>
        <p className="text-sm text-gray-600 mb-6">
          Upload separate logos for the header and footer. Use a dark logo on the header (light background) and a white/light logo on the footer (dark background).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {/* Dark Logo (Header) */}
          <div className="border-2 border-gray-200 rounded-xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
              <i className="ri-sun-line text-gray-700"></i>
              <h3 className="font-semibold text-gray-900">Header Logo</h3>
              <span className="text-xs text-gray-500">(dark version)</span>
            </div>

            <div className="bg-gray-100 rounded-lg p-4 flex items-center justify-center mb-4 h-24">
              <img
                src={currentDarkLogo}
                alt="Header Logo"
                className="max-h-16 max-w-full object-contain"
                key={currentDarkLogo}
              />
            </div>

            <label className={`flex items-center justify-center gap-2 w-full min-h-[44px] sm:min-h-0 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer text-sm font-medium text-gray-600 hover:text-blue-700 ${uploadingLogo === 'dark' ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {uploadingLogo === 'dark' ? (
                <><i className="ri-loader-4-line animate-spin"></i> Uploading...</>
              ) : (
                <><i className="ri-upload-2-line"></i> Upload New Logo</>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={readOnly || uploadingLogo !== null}
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0], 'dark')}
              />
            </label>
          </div>

          {/* White Logo (Footer) */}
          <div className="border-2 border-gray-200 rounded-xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
              <i className="ri-moon-line text-gray-700"></i>
              <h3 className="font-semibold text-gray-900">Footer Logo</h3>
              <span className="text-xs text-gray-500">(white/light version)</span>
            </div>

            <div className="bg-gray-900 rounded-lg p-4 flex items-center justify-center mb-4 h-24">
              <img
                src={currentWhiteLogo}
                alt="Footer Logo"
                className="max-h-16 max-w-full object-contain"
                key={currentWhiteLogo}
              />
            </div>

            <label className={`flex items-center justify-center gap-2 w-full min-h-[44px] sm:min-h-0 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer text-sm font-medium text-gray-600 hover:text-blue-700 ${uploadingLogo === 'white' ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {uploadingLogo === 'white' ? (
                <><i className="ri-loader-4-line animate-spin"></i> Uploading...</>
              ) : (
                <><i className="ri-upload-2-line"></i> Upload New Logo</>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={readOnly || uploadingLogo !== null}
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0], 'white')}
              />
            </label>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          <i className="ri-information-line mr-1"></i>
          Recommended: PNG with transparent background, min 400px wide. Changes take effect immediately.
        </p>
      </div>

      {/* General Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6" onChange={() => { edited.current = true; }}>
        <h2 className="text-lg font-bold text-gray-900 mb-6">General Information</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Store Name</label>
              <input
                type="text"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Discount Discovery Zone"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Tagline</label>
              <input
                type="text"
                value={siteTagline}
                onChange={(e) => setSiteTagline(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Dresses, Electronics, Bags, Shoes & More"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Contact Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Contact Phone</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="whatsapp-number" className="block text-sm font-semibold text-gray-900 mb-2">WhatsApp chat number</label>
              <input
                id="whatsapp-number"
                type="tel"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder={contactPhone || '+233 24 861 5775'}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">The green chat button on the website opens this number. Leave it empty to use the contact phone.</p>
            </div>
            <label className="flex items-start gap-3 sm:pt-9 cursor-pointer">
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={(e) => setWhatsappEnabled(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">
                <span className="block font-semibold text-gray-900">Show the WhatsApp chat button</span>
                Customers see it in the bottom corner of every store page.
              </span>
            </label>
          </div>
        </div>

        <button
          onClick={handleSaveGeneral}
          disabled={readOnly || saving === 'general'}
          className="mt-6 w-full sm:w-auto justify-center sm:justify-start px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving === 'general' ? (
            <><i className="ri-loader-4-line animate-spin"></i> Saving...</>
          ) : (
            <><i className="ri-save-line"></i> Save Changes</>
          )}
        </button>
      </div>

      {/* Birthday messages */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6" onChange={() => { birthdayEdited.current = true; }}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Birthday messages</h2>
        <p className="text-sm text-gray-600 mb-6">
          Customers can add their birthday at checkout. On the day, they get this message by SMS and email, once a year.
        </p>

        <label className="flex items-start gap-3 cursor-pointer mb-5">
          <input
            type="checkbox"
            checked={birthdayEnabled}
            onChange={(e) => setBirthdayEnabled(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            <span className="block font-semibold text-gray-900">Send birthday messages</span>
            Turn this off to stop all birthday messages.
          </span>
        </label>

        <label htmlFor="birthday-message" className="block text-sm font-semibold text-gray-900 mb-2">Message</label>
        <textarea
          id="birthday-message"
          rows={4}
          maxLength={480}
          value={birthdayMessage}
          onChange={(e) => setBirthdayMessage(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-gray-500">
          <span>{'{name}'} is replaced with the customer&apos;s first name.</span>
          <span>{birthdayMessage.length} characters{birthdayMessage.length > 160 ? ` (${Math.ceil(birthdayMessage.length / 153)} SMS parts)` : ''}</span>
        </div>
        <p className="mt-3 text-sm text-gray-600 break-words">
          Preview: {birthdayMessage.replace(/\{name\}/gi, 'Ama')}
        </p>

        <button
          onClick={handleSaveBirthday}
          disabled={readOnly || saving === 'birthday'}
          className="mt-6 w-full sm:w-auto justify-center sm:justify-start px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving === 'birthday' ? (
            <><i className="ri-loader-4-line animate-spin"></i> Saving...</>
          ) : (
            <><i className="ri-save-line"></i> Save Changes</>
          )}
        </button>
      </div>
      </fieldset>
    </div>
  );
}
