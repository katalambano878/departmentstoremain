import Link from 'next/link';

export default function ShippingPage() {
  const deliveryOptions = [
    {
      type: 'Doorstep Delivery',
      time: 'Within 24–72 hours after payment',
      cost: 'At cost',
      description: 'We deliver to your address anywhere in Ghana. The fee depends on your location and the rider tells you the fee. It is not part of the online payment.',
      icon: 'ri-truck-line'
    },
    {
      type: 'Store Pickup',
      time: 'Collect after payment',
      cost: 'Free',
      description: 'Collect your order from our Accra store at no extra charge. Bring your order number.',
      icon: 'ri-store-2-line'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">Shipping & Delivery</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              Orders are delivered within 24–72 hours after payment. Doorstep delivery is charged at cost, or pick up free from our Accra store.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Delivery Options</h2>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {deliveryOptions.map((option, index) => (
              <div key={index} className="bg-white border-2 border-gray-200 p-8 rounded-2xl hover:border-emerald-500 hover:shadow-lg transition-all">
                <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
                  <i className={`${option.icon} text-2xl text-emerald-700`}></i>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{option.type}</h3>
                <div className="text-emerald-700 font-bold text-xl mb-2">{option.cost}</div>
                <div className="text-gray-600 font-medium mb-4">{option.time}</div>
                <p className="text-gray-600 leading-relaxed">{option.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-8 mb-16 text-center">
          <div className="w-16 h-16 bg-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="ri-store-2-line text-3xl text-white"></i>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">Free Store Pickup</h3>
          <p className="text-lg text-gray-600">
            Skip the delivery fee — pick up your order from our Accra store at <span className="font-bold text-emerald-700">no cost</span>.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-6">How Delivery Works</h2>
            <ol className="space-y-6">
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-emerald-700">1</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Pay for your order</h3>
                  <p className="text-gray-600 leading-relaxed">Pay online through Hubtel with mobile money or a card. We start preparing your order once the payment goes through.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-emerald-700">2</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-2">We pack it</h3>
                  <p className="text-gray-600 leading-relaxed">We check and pack your items at our Accra store.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-emerald-700">3</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Delivery or pickup</h3>
                  <p className="text-gray-600 leading-relaxed">For doorstep delivery, a rider brings the order within 24–72 hours after payment and tells you the delivery fee. For pickup, collect it from our store for free.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-emerald-700">4</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Check the status</h3>
                  <p className="text-gray-600 leading-relaxed">Use the Order Tracking page with your order number, email or phone number to see where your order is.</p>
                </div>
              </li>
            </ol>
          </div>

          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-6">Important Information</h2>
            <div className="bg-gray-50 rounded-2xl p-6 space-y-6">
              <div>
                <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <i className="ri-map-pin-line text-emerald-700" aria-hidden="true"></i>
                  Where we deliver
                </h3>
                <p className="text-gray-600 leading-relaxed text-sm">Anywhere in Ghana. We do not deliver outside Ghana.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <i className="ri-money-dollar-circle-line text-emerald-700" aria-hidden="true"></i>
                  Delivery fee
                </h3>
                <p className="text-gray-600 leading-relaxed text-sm">Charged at cost for your location. The rider tells you the fee; it is not included in the online payment. Store pickup is free.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <i className="ri-phone-line text-emerald-700" aria-hidden="true"></i>
                  Keep your phone on
                </h3>
                <p className="text-gray-600 leading-relaxed text-sm">The rider calls the phone number on your order. Please make sure it is correct and reachable.</p>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <i className="ri-error-warning-line text-emerald-700" aria-hidden="true"></i>
                  Damaged or wrong item
                </h3>
                <p className="text-gray-600 leading-relaxed text-sm">Tell us as soon as possible by starting a return or by WhatsApp on 0248615775.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Order Tracking</h2>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Check your order at any time with your order number, email or phone number. The status moves through these steps:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="ri-checkbox-circle-line text-2xl text-emerald-700"></i>
              </div>
              <p className="font-medium text-gray-900">Order Confirmed</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="ri-package-line text-2xl text-amber-700"></i>
              </div>
              <p className="font-medium text-gray-900">Processing</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="ri-truck-line text-2xl text-purple-700"></i>
              </div>
              <p className="font-medium text-gray-900">Out for Delivery</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="ri-gift-line text-2xl text-emerald-700"></i>
              </div>
              <p className="font-medium text-gray-900">Delivered</p>
            </div>
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/order-tracking"
              className="inline-flex items-center gap-2 bg-emerald-700 text-white px-8 py-4 rounded-full font-medium hover:bg-emerald-800 transition-colors whitespace-nowrap"
            >
              <i className="ri-map-pin-line"></i>
              Track Your Order
            </Link>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 rounded-2xl p-8 text-white text-center">
          <h2 className="text-3xl font-bold mb-4">Need Help with Your Delivery?</h2>
          <p className="text-emerald-100 mb-6 leading-relaxed">
            Questions about delivery fees, timing or tracking? Call or WhatsApp us on 0248615775, or send us a message.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-white text-emerald-700 px-6 py-3 rounded-full font-medium hover:bg-emerald-50 transition-colors whitespace-nowrap"
            >
              Contact Support
            </Link>
            <Link
              href="/faqs"
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-full font-medium hover:bg-emerald-500 transition-colors whitespace-nowrap"
            >
              View FAQs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
