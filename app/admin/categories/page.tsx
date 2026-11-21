'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function AdminCategoriesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('all');

  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    image_url: '',
    parent_id: '' as string | null,
    featured: false,
    status: 'active'
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (category: any) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      image_url: category.image_url || '',
      parent_id: category.parent_id || '',
      featured: category.metadata?.featured || false,
      status: category.status
    });
    setShowEditModal(true);
  };

  const handleDelete = async (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    try {
      const [{ count: productCount, error: pErr }, { count: childCount, error: cErr }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('category_id', categoryId),
        supabase.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', categoryId),
      ]);
      if (pErr) throw pErr;
      if (cErr) throw cErr;

      const lines = [`Delete the category "${category?.name || ''}"? This cannot be undone.`];
      if (productCount) lines.push(`${productCount} product${productCount !== 1 ? 's' : ''} in it will become uncategorised.`);
      if (childCount) lines.push(`${childCount} subcategor${childCount !== 1 ? 'ies' : 'y'} will become top-level categories.`);
      if (!productCount && !childCount) lines.push('No products or subcategories use it.');
      if (!confirm(lines.join('\n\n'))) return;

      // The foreign keys have no ON DELETE rule, so detach first or the delete fails.
      if (productCount) {
        const { error } = await supabase.from('products').update({ category_id: null }).eq('category_id', categoryId);
        if (error) throw error;
      }
      if (childCount) {
        const { error } = await supabase.from('categories').update({ parent_id: null }).eq('parent_id', categoryId);
        if (error) throw error;
      }
      const { error } = await supabase.from('categories').delete().eq('id', categoryId);
      if (error) throw error;
      alert('Category deleted');
      fetchCategories();
    } catch (err: any) {
      alert('Category not deleted: ' + (err?.message || 'unknown error'));
      fetchCategories();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;

      setUploading(true);
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `cat-${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Upload to 'products' bucket for simplicity, or create a 'categories' bucket
      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('products')
        .getPublicUrl(filePath);

      setFormData({ ...formData, image_url: publicUrl });

    } catch (error: any) {
      alert('Error uploading image: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.slug) {
      alert('Name and Slug are required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        slug: formData.slug,
        description: formData.description,
        image_url: formData.image_url,
        parent_id: formData.parent_id || null, // Handle empty string as null
        status: formData.status,
        // Keep any other metadata keys (e.g. homepage settings) and only change `featured`.
        metadata: {
          ...((showEditModal && editingCategory?.metadata) || {}),
          featured: formData.featured
        }
      };

      if (showEditModal && editingCategory) {
        // Merge with the latest stored metadata, not the copy loaded with the list.
        const { data: current, error: readErr } = await supabase
          .from('categories').select('metadata').eq('id', editingCategory.id).single();
        if (readErr) throw readErr;
        payload.metadata = { ...(current?.metadata || {}), featured: formData.featured };
        const { error } = await supabase
          .from('categories')
          .update(payload)
          .eq('id', editingCategory.id);
        if (error) throw error;
        alert('Category updated');
      } else {
        const { error } = await supabase
          .from('categories')
          .insert([payload]);
        if (error) throw error;
        alert('Category created');
      }

      setShowAddModal(false);
      setShowEditModal(false);
      setEditingCategory(null);
      setFormData({ name: '', slug: '', description: '', image_url: '', parent_id: '', featured: false, status: 'active' });
      fetchCategories();

    } catch (err: any) {
      console.error(err);
      alert('Error saving category: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Auto-generate slug
  useEffect(() => {
    if (showAddModal && formData.name && !editingCategory) {
      setFormData(prev => ({
        ...prev,
        slug: prev.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
      }));
    }
  }, [formData.name, showAddModal, editingCategory]);


  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Categories</h1>
          <p className="text-gray-600 mt-1">Organize your products into categories</p>
        </div>
        <button
          onClick={() => {
            setEditingCategory(null);
            setFormData({ name: '', slug: '', description: '', image_url: '', parent_id: '', featured: false, status: 'active' });
            setShowAddModal(true);
          }}
          className="w-full sm:w-auto bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line mr-2"></i>
          Add Category
        </button>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-3 sm:p-4 min-w-0">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Categories</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900">{categories.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-3 sm:p-4 min-w-0">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Active</p>
          <p className="text-xl sm:text-2xl font-bold text-blue-700">{categories.filter(c => c.status === 'active').length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-3 sm:p-4 min-w-0">
          <p className="text-xs sm:text-sm text-gray-600 mb-1">Featured</p>
          <p className="text-xl sm:text-2xl font-bold text-blue-700">{categories.filter(c => c.metadata?.featured).length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Category</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Slug</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Parent</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Featured</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">Loading categories...</td></tr>
              ) : categories.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">No categories found. Create one to get started!</td></tr>
              ) : (
                categories.map((category) => (
                  <tr key={category.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-16 h-16 shrink-0 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                          {category.image_url ? (
                            <img src={category.image_url} alt={category.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <i className="ri-image-line text-2xl"></i>
                            </div>
                          )}
                        </div>
                        <span className="min-w-0 break-words font-semibold text-gray-900">{category.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm font-mono break-all">{category.slug}</td>
                    <td className="py-4 px-4 text-sm text-gray-600">
                      {categories.find(c => c.id === category.parent_id)?.name || '-'}
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap capitalize ${category.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                        {category.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      {category.metadata?.featured ? (
                        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold whitespace-nowrap">
                          Featured
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEdit(category)}
                          className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-edit-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(category.id)}
                          className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-lg w-4 h-4 flex items-center justify-center"></i>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90dvh] overflow-y-auto">
            <div className="p-4 sm:p-6 border-b border-gray-200 flex items-center justify-between gap-2 sticky top-0 bg-white z-10">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {showAddModal ? 'Add New Category' : 'Edit Category'}
              </h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                  setEditingCategory(null);
                }}
                className="w-11 h-11 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-2xl w-6 h-6 flex items-center justify-center"></i>
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-5">
              <div className="grid md:grid-cols-2 gap-5 md:gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Category Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter category name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Parent Category (Optional)
                  </label>
                  <select
                    value={formData.parent_id || ''}
                    onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">None (Top Level)</option>
                    {categories
                      .filter(c => c.id !== editingCategory?.id) // Prevent self-parenting
                      .map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  URL Slug *
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="category-url-slug"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Description
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Brief description of this category..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Category Image
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 sm:p-8 text-center hover:border-blue-700 hover:bg-blue-50 transition-colors relative">
                  {uploading ? (
                    <div className="flex flex-col items-center">
                      <i className="ri-loader-4-line animate-spin text-3xl mb-2 text-blue-700"></i>
                      <span className="text-sm font-medium text-gray-600">Uploading...</span>
                    </div>
                  ) : formData.image_url ? (
                    <div className="relative group">
                      <img src={formData.image_url} alt="Category" className="h-40 mx-auto object-contain rounded-lg shadow-sm" />
                      <div className="absolute inset-0 bg-black/40 opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg">
                        <label className="cursor-pointer bg-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-gray-100">
                          Change Image
                          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer block">
                      <i className="ri-upload-cloud-line text-4xl text-gray-400 mb-2 w-10 h-10 flex items-center justify-center mx-auto"></i>
                      <p className="text-gray-700 font-medium">Click to upload image</p>
                      <p className="text-sm text-gray-500 mt-1">Square (1:1) Recommended (e.g., 800x800px)</p>
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="flex items-center space-x-3 min-h-[44px] sm:min-h-0 sm:mt-6">
                  <input
                    type="checkbox"
                    checked={formData.featured}
                    onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
                    className="w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                  <label className="text-gray-900 font-medium">
                    Feature on homepage
                  </label>
                </div>
              </div>

            </div>

            <div className="p-4 sm:p-6 border-t border-gray-200 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-0 sm:space-x-3 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                  setEditingCategory(null);
                }}
                disabled={saving}
                className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || uploading}
                className={`px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center ${saving ? 'opacity-70' : ''}`}
              >
                {saving && <i className="ri-loader-4-line animate-spin mr-2"></i>}
                {showAddModal ? 'Add Category' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
