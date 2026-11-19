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
      answer: 'Add items to your bag, go to checkout, enter your name, phone and email, choose doorstep delivery or free store pickup, then pay through Hubtel with mobile money or a card. You get your order number by email once the payment goes through.'
    },
    {
      category: 'orders',
      question: 'Can I change or cancel my order?',
      answer: `Contact us as soon as possible on WhatsApp ${PUBLIC_CONTACT_PHONE_DISPLAY} or by email at ${PUBLIC_CONTACT_EMAIL} with your order number. If the order has not left the store yet, we can usually change or cancel it.`
    },
    {
      category: 'orders',
      question: 'How do I track my order?',
      answer: 'Open the Order Tracking page and enter your order number, or the email or phone number you used at checkout, to see the current status.'
    },
    {
      category: 'orders',
      question: 'What if I receive the wrong item?',
      answer: 'Start a return on the Returns page and choose "Wrong item received", or WhatsApp us with your order number and a photo. We will contact you within 2 working days to put it right.'
    },
    {
      category: 'shipping',
      question: 'How long does delivery take?',
      answer: 'Orders are delivered within 24–72 hours after payment, anywhere we deliver in Ghana.'
    },
    {
      category: 'shipping',
      question: 'How much does delivery cost?',
      answer: 'Doorstep delivery is charged at cost: the fee depends on your location and the rider tells you the fee. It is not part of the online payment. Store pickup is free.'
    },
    {
      category: 'shipping',
      question: 'Do you deliver outside Ghana?',
      answer: 'No. We deliver within Ghana only.'
    },
    {
      category: 'shipping',
      question: 'What if I am not available when the rider arrives?',
      answer: 'The rider will call you on the phone number from your order. If you cannot be reached, call or WhatsApp us to arrange another time.'
    },
    {
      category: 'returns',
      question: 'What is your return policy?',
      answer: 'Start a return request within 14 days of receiving your order. Items should be unused and in their original packaging, unless they arrived damaged or wrong. We review every request and contact you within 2 working days to agree the next step.'
    },
    {
      category: 'returns',
      question: 'How do I start a return?',
      answer: 'Go to the Returns page, enter your order number and the email or phone number used on the order, choose a reason and tell us what happened. You get a reference straight away.'
    },
    {
      category: 'returns',
      question: 'Can I exchange an item instead?',
      answer: 'Say so in your return request (for example, the size you need). If the item is in stock, we will arrange it with you when we get in touch.'
    },
    {
      category: 'payment',
      question: 'How can I pay?',
      answer: 'All orders are paid online through Hubtel, with mobile money (MTN, Telecel, AirtelTigo) or a Visa or Mastercard bank card. We do not offer cash on delivery or payment in instalments.'
    },
    {
      category: 'payment',
      question: 'Is paying online safe?',
      answer: 'Payments are handled by Hubtel on their secure checkout. We never see or store your card details.'
    },
    {
      category: 'payment',
      question: 'My payment failed. What now?',
      answer: `Your order waits for payment and is not sent out until it is paid. Try again from the payment page or payment link. If money left your account but the order still shows unpaid, do not pay again: WhatsApp us on ${PUBLIC_CONTACT_PHONE_DISPLAY} with your order number.`
    },
    {
      category: 'payment',
      question: 'How do refunds work?',
      answer: 'If a refund is agreed after reviewing your return, our team tells you the amount, how it will be paid and when to expect it.'
    },
    {
      category: 'account',
      question: 'Do I need an account to order?',
      answer: 'No, you can check out as a guest. With an account you can see your orders, save delivery addresses and use support tickets.'
    },
    {
      category: 'account',
      question: 'How do I reset my password?',
      answer: 'Choose "Forgot password?" on the sign-in page, enter your email and open the link we send. Check your spam folder if it does not arrive within a few minutes.'
    },
    {
      category: 'account',
      question: 'Can I save more than one delivery address?',
      answer: 'Yes. Sign in and open My Account → Addresses to add, edit or delete addresses and choose a default.'
    },
    {
      category: 'account',
      question: 'How do I update my details?',
      answer: 'Sign in and open My Account → Profile to change your name and phone number, or to change your password.'
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
                aria-label="Search the FAQs"
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
              type="button"
              aria-pressed={activeCategory === category.id}
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
            Our team is ready to help. Send us a message and we usually reply within one working day.
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
