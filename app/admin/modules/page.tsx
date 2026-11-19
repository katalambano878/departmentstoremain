'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useStaffRole } from '../_lib/useStaffRole';

interface Module {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  enabled: boolean;
}

const colorMap: Record<string, string> = {
  red: 'bg-red-100 text-red-600',
  teal: 'bg-teal-100 text-teal-600',
  orange: 'bg-orange-100 text-orange-600',
};

// Only modules something in the app actually reads. Each one shows or hides
// a dashboard menu link (see app/admin/layout.tsx `moduleId`).
const MODULES: Module[] = [
  {
    id: 'notifications',
    name: 'Marketing Notifications',
    description: 'Shows the Notifications page in the menu, for email and SMS campaigns to customers.',
    icon: 'ri-notification-3-line',
    color: 'red',
    enabled: false,
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'Shows the Blog page in the menu, for writing and publishing posts.',
    icon: 'ri-article-line',
    color: 'teal',
    enabled: false,
  },
  {
    id: 'customer-insights',
    name: 'Customer Insights',
    description: 'Shows the Customer Insights page in the menu.',
    icon: 'ri-user-search-line',
    color: 'orange',
    enabled: false,
  },
];

export default function ModulesPage() {
  const { role, loading: roleLoading } = useStaffRole();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<Module[]>(MODULES);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (role !== 'admin') return;
    (async () => {
      try {
        const { data, error } = await supabase.from('store_modules').select('id, enabled');
        if (error) throw error;
        setModules(prev => prev.map(m => {
          const row = (data || []).find((d: any) => d.id === m.id);
          return row ? { ...m, enabled: !!row.enabled } : m;
        }));
      } catch (err: any) {
        setError(`Could not load modules: ${err?.message || 'unknown error'}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [role]);

  const toggleModule = async (id: string, currentState: boolean) => {
    const newState = !currentState;
    setSavingId(id);
    setError('');
    try {
      const { error } = await supabase
        .from('store_modules')
        .upsert({ id, enabled: newState, updated_at: new Date().toISOString() });
      if (error) throw error;
      // The sidebar reads modules once on load, so reload to show the change there.
      window.location.reload();
    } catch (err: any) {
      setError(`Not saved: ${err?.message || 'unknown error'}`);
      setSavingId(null);
    }
  };

  if (roleLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="ri-lock-2-line text-2xl text-gray-600"></i>
        </div>
        <h1 className="text-lg font-bold text-gray-900">Only an admin can change modules</h1>
        <p className="text-sm text-gray-600 mt-2">Ask an admin if you need a module turned on or off.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Modules</h1>
      <p className="text-gray-600 mb-6">
        Turn optional dashboard pages on or off. This only changes the menu; it does not delete any data.
      </p>

      {error && (
        <div className="mb-6 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading modules...</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map(module => (
            <div key={module.id} className={`bg-white rounded-xl border-2 p-6 transition-all ${module.enabled ? 'border-blue-500 shadow-md' : 'border-gray-200'}`}>
              <div className="flex justify-between items-start mb-4">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorMap[module.color] || 'bg-gray-100 text-gray-600'}`}>
                  <i className={`${module.icon} text-2xl`}></i>
                </div>
                <button
                  onClick={() => toggleModule(module.id, module.enabled)}
                  disabled={savingId !== null}
                  role="switch"
                  aria-checked={module.enabled}
                  aria-label={`${module.name}: ${module.enabled ? 'on' : 'off'}`}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${module.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${module.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <h3 className="text-lg font-bold text-gray-900">{module.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{module.description}</p>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${module.enabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {savingId === module.id ? 'Saving...' : module.enabled ? 'On' : 'Off'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
