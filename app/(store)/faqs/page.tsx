"use client";

import { useState } from 'react';
import Link from 'next/link';
import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_CONTACT_PHONE_DISPLAY,
  PUBLIC_CONTACT_PHONE_WHATSAPP,
} from '@/lib/brand-contact';

export default function FAQsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const categories = [
    { id: 'all', name: 'All Questions', icon: 'ri-question-line' },
    { id: 'orders', name: 'Orders', icon: 'ri-shopping-bag-line' },
    { id: 'shipping', name: 'Shipping', icon: 'ri-truck-line' },
    { id: 'returns', name: 'Returns', icon: 'ri-arrow-go-back-line' },
    { id: 'payment', name: 'Payment', icon: 'ri-bank-card-line' },
    { id: 'account', name: 'Account', icon: 'ri-user-line' }
  ];

  const faqs = [
    {
      category: 'orders',
      question: 'How do I place an order?',
      answer: 'Browse our products, add items to your cart, proceed to checkout, provide your delivery address, select payment method, and confirm your order. You\'ll receive an email confirmation with your order details and tracking number.'
    },
    {
      category: 'orders',
      question: 'Can I modify or cancel my order?',
      answer: `You can modify or cancel your order within 1 hour of placing it. Contact our customer service immediately via WhatsApp at ${PUBLIC_CONTACT_PHONE_DISPLAY} or email ${PUBLIC_CONTACT_EMAIL}. Once an order is processed, modifications may not be possible.`
    },
    {
      category: 'orders',
      question: 'How do I track my order?',
      answer: 'After your order is confirmed, you\'ll receive details via email and SMS. Visit our Order Tracking page and enter your email, order number, or phone number to see updates on your delivery status.'
    },
    {
      category: 'orders',
      question: 'What if I receive the wrong item?',
      answer: 'We sincerely apologise if you receive the wrong item. Contact us within 48 hours with photos of the item received. We\'ll arrange for the correct item to be sent immediately and collect the wrong item at no cost to you.'
    },
    {
      category: 'shipping',
      question: 'What are your delivery times?',
      answer: 'Doorstep delivery typically takes 1-3 business days within Ghana. Orders placed before 2pm are dispatched the same day. Remote areas may take a little longer. Store pickup from our Accra location is usually ready within 24 hours.'
    },
    {
      category: 'shipping',
      question: 'How much does shipping cost?',
      answer: 'Doorstep delivery is charged based on your location — our team will contact you with the exact delivery fee after you place the order. Store pickup from our Accra store is completely FREE.'
    },
    {
      category: 'shipping',
      question: 'Do you ship outside Ghana?',
      answer: 'Currently, we only ship within Ghana. We\'re working on expanding to neighbouring West African countries. Sign up for our newsletter to be notified when international shipping becomes available.'
    },
    {
      category: 'shipping',
      question: 'What if nobody is home for delivery?',
      answer: 'Our delivery partner will attempt delivery twice. If unsuccessful, the package will be held at the nearest collection point for 5 days. You\'ll receive SMS and email notifications with collection instructions.'
    },
    {
      category: 'returns',
      question: 'What is your return policy?',
      answer: 'We offer a 14-day return policy for unused items in original packaging. Simply initiate a return from your account, print the return label, and ship it back. Refunds are processed within 5-7 business days after we receive the item.'
    },
    {
      category: 'returns',
      question: 'Which items cannot be returned?',
      answer: 'For hygiene reasons, we cannot accept returns on opened cosmetics, intimate apparel, earrings, or perishable goods. Custom or personalised items are also non-returnable unless defective.'
    },
    {
      category: 'returns',
      question: 'Who pays for return shipping?',
      answer: 'If you\'re returning due to a defect or our error, we cover return shipping. For change-of-mind returns, customers pay return shipping costs (GHS 15 standard rate). Free shipping on returns for defective items.'
    },
    {
      category: 'returns',
      question: 'Can I exchange an item instead of returning it?',
      answer: 'Yes! If you need a different size or colour, select "Exchange" when initiating your return. We\'ll send the replacement as soon as we receive your original item. Exchange shipping is FREE.'
    },
    {
      category: 'payment',
      question: 'What payment methods do you accept?',
      answer: 'We accept MTN Mobile Money, Vodafone Cash, AirtelTigo Money, and Visa/Mastercard credit and debit cards via our secure Moolre payment gateway. All transactions are encrypted and processed securely.'
    },
    {
      category: 'payment',
      question: 'Is it safe to use my credit card on your site?',
      answer: 'Absolutely. We use industry-standard SSL encryption and partner with Moolre for secure payment processing. We never store your full card details on our servers. All transactions are PCI-DSS compliant.'
    },
    {
      category: 'payment',
      question: 'Can I pay in instalments?',
      answer: 'Yes! We offer payment plans through our partners for purchases over GHS 500. Select "Pay in Instalments" at checkout to see available options. Approval is instant and no interest is charged.'
    },
    {
      category: 'payment',
      question: 'When will my payment be charged?',
      answer: 'For card and mobile money payments, you\'re charged immediately. For Cash on Delivery, you pay when you receive your order. If an item is out of stock, we\'ll refund you within 24 hours.'
    },
    {
      category: 'payment',
      question: 'How do refunds work?',
      answer: 'Refunds are processed to your original payment method within 5-7 business days after we receive and inspect your return. For mobile money refunds, ensure you provide correct details. You\'ll receive confirmation via email.'
    },
    {
      category: 'account',
      question: 'Do I need an account to place an order?',
      answer: 'No, you can checkout as a guest. However, creating an account lets you track orders, save addresses, view purchase history, manage your wishlist, and receive exclusive offers. It only takes 30 seconds to sign up.'
    },
    {
      category: 'account',
      question: 'How do I reset my password?',
      answer: 'Click "Forgot Password" on the login page, enter your email address, and we\'ll send you a reset link. The link is valid for 1 hour. If you don\'t receive it, check your spam folder or contact support.'
    },
    {
      category: 'account',
      question: 'Can I have multiple delivery addresses?',
      answer: 'Yes! You can save multiple delivery addresses in your account. During checkout, simply select the address you want to use or add a new one. This is perfect for sending gifts or alternating between work and home.'
    },
    {
      category: 'account',
      question: 'How do I update my account information?',
      answer: 'Log in to your account and go to "Account Settings". You can update your name, email, phone number, password, and saved addresses. Changes are saved instantly and you\'ll receive a confirmation email.'
    },
    {
      category: 'account',
      question: 'What are loyalty points and how do they work?',
      answer: 'Earn 1 point for every GHS 10 spent. 100 points = GHS 10 discount on your next purchase. Points are automatically added to your account after each order. Check your points balance in your account dashboard.'
    }
  ];

  const filteredFAQs = faqs.filter(faq => {
    const matchesCategory = activeCategory === 'all' || faq.category === activeCategory;
    const matchesSearch = searchQuery === '' || 
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Frequently Asked Questions
            </h1>
            <p className="text-xl text-gray-600 mb-8 leading-relaxed">
              Find quick answers to common questions about ordering, shipping, returns, payments, and more.
            </p>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for answers..."
                className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-full focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm shadow-lg"
              />
              <i className="ri-search-line absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 text-xl"></i>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex flex-wrap gap-3 justify-center mb-12">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-medium transition-all whitespace-nowrap ${
                activeCategory === category.id
                  ? 'bg-emerald-700 text-white shadow-lg'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <i className={`${category.icon} text-lg`}></i>
              {category.name}
            </button>
          ))}
        </div>

        {filteredFAQs.length > 0 ? (
          <div className="max-w-4xl mx-auto space-y-4">
            {filteredFAQs.map((faq, index) => (
              <details
                key={index}
                className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow"
              >
                <summary className="px-6 py-5 font-medium text-gray-900 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between">
                  <span className="flex-1 pr-4">{faq.question}</span>
                  <i className="ri-arrow-down-s-line text-xl text-gray-400"></i>
                </summary>
                <div className="px-6 pb-5 text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
                  {faq.answer}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-search-line text-4xl text-gray-400"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No results found</h3>
            <p className="text-gray-600">
              Try adjusting your search or browse different categories
            </p>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="ri-customer-service-2-line text-3xl text-white"></i>
          </div>
          <h2 className="text-3xl font-bold text-white mb-4">Still Have Questions?</h2>
          <p className="text-xl text-emerald-100 mb-8 leading-relaxed">
            Our customer service team is ready to help. Contact us and we'll respond within 24 hours.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-white text-emerald-700 px-8 py-4 rounded-full font-medium hover:bg-emerald-50 transition-colors whitespace-nowrap"
            >
              <i className="ri-mail-line text-lg"></i>
              Contact Support
            </Link>
            <a
              href={`https://wa.me/${PUBLIC_CONTACT_PHONE_WHATSAPP}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-8 py-4 rounded-full font-medium hover:bg-emerald-500 transition-colors whitespace-nowrap"
            >
              <i className="ri-whatsapp-line text-lg"></i>
              Chat on WhatsApp
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Quick Links</h2>
          <p className="text-gray-600">Explore more helpful resources</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Link href="/shipping" className="bg-gray-50 p-8 rounded-2xl hover:shadow-lg transition-all cursor-pointer">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <i className="ri-truck-line text-2xl text-emerald-700"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Shipping Policy</h3>
            <p className="text-gray-600 leading-relaxed">
              Learn about delivery times, costs, and tracking your orders
            </p>
          </Link>

          <Link href="/returns" className="bg-gray-50 p-8 rounded-2xl hover:shadow-lg transition-all cursor-pointer">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <i className="ri-arrow-go-back-line text-2xl text-emerald-700"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Returns Policy</h3>
            <p className="text-gray-600 leading-relaxed">
              Understand our return process, timeframes, and refund policy
            </p>
          </Link>

          <Link href="/privacy" className="bg-gray-50 p-8 rounded-2xl hover:shadow-lg transition-all cursor-pointer">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <i className="ri-shield-check-line text-2xl text-emerald-700"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Privacy & Security</h3>
            <p className="text-gray-600 leading-relaxed">
              See how we protect your personal information and data
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
