import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_CONTACT_PHONE,
  PUBLIC_CONTACT_PHONE_DISPLAY,
  PUBLIC_SITE_DOMAIN,
} from '@/lib/brand-contact';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">Terms & Conditions</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              Please read these terms carefully before using our website and services.
            </p>
            <p className="text-sm text-gray-500 mt-4">Last updated: February 2026</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="prose prose-lg max-w-none">
          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">1. Agreement to Terms</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              By accessing and using this website ({PUBLIC_SITE_DOMAIN}), you accept and agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, you must not use our website or services.
            </p>
            <p className="text-gray-600 leading-relaxed">
              These terms apply to all visitors, users, and customers who access or use our service. We reserve the right to update or modify these terms at any time without prior notice. Your continued use of the website following any changes indicates your acceptance of the new terms.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">2. Use of Website</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">2.1 Permitted Use</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              You may use our website for lawful purposes only. You agree not to:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Violate any local, national, or international law or regulation</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Transmit any harmful code, viruses, or malicious software</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Attempt to gain unauthorised access to our systems or networks</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Use the website for fraudulent purposes or in connection with any criminal activity</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Impersonate any person or entity or misrepresent your affiliation</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-close-circle-line text-red-500 mt-1"></i>
                <span>Interfere with or disrupt the website or servers</span>
              </li>
            </ul>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">2.2 Account Responsibility</h3>
            <p className="text-gray-600 leading-relaxed">
              If you create an account, you are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately of any unauthorised use of your account or any other security breach.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">3. Products & Pricing</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">3.1 Product Information</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              We make every effort to display our products accurately, including colours, descriptions, and specifications. However, we cannot guarantee that your device's display will accurately reflect product colours or that product descriptions are error-free.
            </p>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">3.2 Pricing</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              All prices are listed in Ghana Cedis (GHS) and include VAT where applicable. We reserve the right to:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Modify prices at any time without notice</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Correct pricing errors, even after an order is placed</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Limit quantities available for purchase</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Discontinue products at any time</span>
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed">
              If a product is listed at an incorrect price due to an error, we will contact you before processing your order. You may choose to cancel the order or proceed at the correct price.
            </p>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">3.3 Availability</h3>
            <p className="text-gray-600 leading-relaxed">
              Product availability is subject to change without notice. If an ordered item becomes unavailable, we will notify you and offer a refund or replacement option.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">4. Orders & Payment</h2>
            
            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">4.1 Order Acceptance</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              Placing an order does not guarantee acceptance. We reserve the right to refuse or cancel any order for reasons including:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Product unavailability or pricing errors</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Suspected fraudulent or unauthorised transactions</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Inaccuracies in product or pricing information</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-emerald-700 mt-1"></i>
                <span>Failure to meet age or eligibility requirements</span>
              </li>
            </ul>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">4.2 Payment</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              We accept the following payment methods:
            </p>
            <div className="bg-gray-50 p-6 rounded-xl mb-6">
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <i className="ri-smartphone-line text-emerald-700"></i>
                  <span>Mobile money (MTN, Telecel, AirtelTigo) through Hubtel</span>
                </li>
                <li className="flex items-center gap-2">
                  <i className="ri-bank-card-line text-emerald-700"></i>
                  <span>Bank cards (Visa, Mastercard) through Hubtel</span>
                </li>
              </ul>
            </div>
            <p className="text-gray-600 leading-relaxed">
              All payments are made online through Hubtel. We do not accept cash on delivery or payment in instalments. Payment must be received in full before the order is sent out. By providing payment information, you confirm that you are authorised to use the payment method and that there are sufficient funds available.
            </p>

            <h3 className="text-xl font-bold text-gray-900 mb-4 mt-8">4.3 Order Modifications</h3>
            <p className="text-gray-600 leading-relaxed">
              Contact us as soon as possible if you need to change or cancel an order. We can usually make changes until the order leaves our store; after that it cannot be changed.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">5. Shipping & Delivery</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Orders are delivered within Ghana within 24–72 hours after payment. Doorstep delivery is charged at cost: the rider tells you the fee for your location, and it is not part of the online payment. Store pickup is free. See our Shipping Policy for details.
            </p>
            <p className="text-gray-600 leading-relaxed mb-4">
              Risk of loss and title for products pass to you upon delivery to the carrier. We are not responsible for delays caused by the shipping carrier or circumstances beyond our control (weather, strikes, customs, etc.).
            </p>
            <p className="text-gray-600 leading-relaxed">
              You must provide accurate and complete delivery information. We are not responsible for delivery failures due to incorrect addresses.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">6. Returns & Refunds</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              We offer a 14-day return policy for most products. See our Returns Policy for complete details on eligibility, process, and conditions.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Every return request is reviewed by our team. If a refund is agreed, we tell you the amount, how it will be paid and when to expect it.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">7. Intellectual Property</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              All content on this website, including text, graphics, logos, images, videos, and software, is the property of Discount Discovery Zone or its content suppliers and is protected by copyright, trademark, and other intellectual property laws.
            </p>
            <p className="text-gray-600 leading-relaxed mb-4">
              You may not reproduce, distribute, modify, create derivative works of, publicly display, or otherwise use any content from this website without our express written permission.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Product names, logos, and brands are the property of their respective owners and are used for identification purposes only.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">8. User Content</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              You may submit reviews, comments, and other content to our website. By doing so, you grant us a non-exclusive, royalty-free, perpetual, worldwide licence to use, reproduce, modify, and display such content.
            </p>
            <p className="text-gray-600 leading-relaxed mb-4">
              You are solely responsible for your content and must ensure it:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span>Does not violate any laws or third-party rights</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span>Is not defamatory, offensive, or inappropriate</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span>Does not contain viruses or malicious code</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-emerald-700 mt-1"></i>
                <span>Is truthful and based on your genuine experience</span>
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed">
              We reserve the right to remove any content that violates these terms or that we deem inappropriate.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">9. Limitation of Liability</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              To the fullest extent permitted by law, Discount Discovery Zone shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from:
            </p>
            <ul className="space-y-2 text-gray-600 mb-6">
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-gray-400 mt-1"></i>
                <span>Your use or inability to use the website or services</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-gray-400 mt-1"></i>
                <span>Unauthorised access to or alteration of your data</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-gray-400 mt-1"></i>
                <span>Errors or omissions in website content</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-gray-400 mt-1"></i>
                <span>Product defects or performance issues</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="ri-arrow-right-s-line text-gray-400 mt-1"></i>
                <span>Delivery delays or failures</span>
              </li>
            </ul>
            <p className="text-gray-600 leading-relaxed">
              Our total liability for any claim arising from your use of the website or purchase of products shall not exceed the amount you paid for the product or service in question.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">10. Indemnification</h2>
            <p className="text-gray-600 leading-relaxed">
              You agree to indemnify and hold harmless Discount Discovery Zone, its affiliates, officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from your use of the website, violation of these terms, or infringement of any third-party rights.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">11. Governing Law & Disputes</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              These terms are governed by the laws of Ghana. Any disputes arising from these terms or your use of the website shall be subject to the exclusive jurisdiction of the courts of Ghana.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Before initiating any legal action, you agree to first contact us to seek resolution through informal negotiation.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">12. Severability</h2>
            <p className="text-gray-600 leading-relaxed">
              If any provision of these terms is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">13. Contact Information</h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              For questions about these Terms and Conditions, please contact us:
            </p>

            <div className="bg-gray-50 border border-gray-200 p-8 rounded-xl">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <i className="ri-mail-line text-emerald-700 text-xl mt-1"></i>
                  <div>
                    <p className="font-medium text-gray-900">Email</p>
                    <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} className="text-emerald-700 hover:underline">{PUBLIC_CONTACT_EMAIL}</a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <i className="ri-phone-line text-emerald-700 text-xl mt-1"></i>
                  <div>
                    <p className="font-medium text-gray-900">Phone</p>
                    <a href={`tel:${PUBLIC_CONTACT_PHONE}`} className="text-emerald-700 hover:underline">{PUBLIC_CONTACT_PHONE_DISPLAY}</a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <i className="ri-map-pin-line text-emerald-700 text-xl mt-1"></i>
                  <div>
                    <p className="font-medium text-gray-900">Address</p>
                    <p className="text-gray-600">Discount Discovery Zone<br />Accra, Ghana</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="bg-emerald-50 border-2 border-emerald-200 p-8 rounded-xl text-center">
            <i className="ri-checkbox-circle-line text-4xl text-emerald-700 mb-4"></i>
            <p className="text-gray-600 leading-relaxed">
              By using our website, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
