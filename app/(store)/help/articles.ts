/**
 * Help centre articles. Keep every answer in line with how the shop really works:
 * Hubtel payment only (mobile money or card), no cash on delivery;
 * doorstep delivery at cost (the rider tells you the fee) or free store pickup;
 * delivery within 24–72 hours after payment.
 */

export const STORE_PHONE = '0248615775';
export const STORE_EMAIL = 'info@discountdiscoveryzone.com';

export type HelpSection = {
  heading?: string;
  paragraphs?: string[];
  list?: string[];
};

export type HelpArticle = {
  id: string;
  category: HelpCategoryId;
  title: string;
  summary: string;
  sections: HelpSection[];
  links?: { href: string; label: string }[];
};

export type HelpCategoryId = 'ordering' | 'payment' | 'delivery' | 'tracking' | 'returns' | 'account';

export const HELP_CATEGORIES: { id: HelpCategoryId; title: string; icon: string }[] = [
  { id: 'ordering', title: 'Ordering', icon: 'ri-shopping-bag-line' },
  { id: 'payment', title: 'Paying with Hubtel', icon: 'ri-bank-card-line' },
  { id: 'delivery', title: 'Delivery and pickup', icon: 'ri-truck-line' },
  { id: 'tracking', title: 'Tracking an order', icon: 'ri-map-pin-line' },
  { id: 'returns', title: 'Returns', icon: 'ri-arrow-left-right-line' },
  { id: 'account', title: 'Your account', icon: 'ri-user-line' },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'how-to-order',
    category: 'ordering',
    title: 'How do I place an order?',
    summary: 'Add items to your bag, choose delivery or pickup, then pay through Hubtel.',
    sections: [
      {
        list: [
          'Find the item in the shop and choose a size or colour if the product has options.',
          'Tap "Add to Bag". You can keep shopping or open your bag to check out.',
          'At checkout, enter your name, phone number and email, then choose doorstep delivery or free store pickup.',
          'Pay through Hubtel with mobile money or a bank card.',
          'After payment you get an order number by email and SMS. Keep it: you need it to track the order or ask about it.',
        ],
      },
      {
        paragraphs: ['You do not need an account to order. With an account you can see your past orders and save delivery addresses.'],
      },
    ],
    links: [{ href: '/shop', label: 'Go to the shop' }],
  },
  {
    id: 'change-or-cancel-order',
    category: 'ordering',
    title: 'Can I change or cancel my order?',
    summary: 'Contact us quickly. Before the order leaves the store we can usually change it.',
    sections: [
      {
        paragraphs: [
          `Call or WhatsApp us on ${STORE_PHONE} as soon as possible with your order number. If the order has not been sent out yet, we can usually change the items, the address or cancel it.`,
          'Once the rider has collected the order we cannot change it, but you can still start a return after it arrives.',
        ],
      },
    ],
    links: [{ href: '/contact', label: 'Contact us' }],
  },
  {
    id: 'paying-with-hubtel',
    category: 'payment',
    title: 'How do I pay?',
    summary: 'All orders are paid online through Hubtel, with mobile money or a bank card.',
    sections: [
      {
        paragraphs: [
          'When you place an order you are taken to the Hubtel checkout. There you can pay with mobile money (MTN, Telecel or AirtelTigo) or with a Visa or Mastercard bank card.',
          'Your order is confirmed once Hubtel tells us the payment went through. We never see or store your card details.',
        ],
      },
      {
        heading: 'What we do not offer',
        list: ['Cash on delivery', 'Paying in instalments', 'Other payment services'],
      },
    ],
  },
  {
    id: 'payment-failed',
    category: 'payment',
    title: 'My payment did not go through',
    summary: 'Your order waits for payment. You can try again from the payment link.',
    sections: [
      {
        paragraphs: [
          'If you closed the Hubtel page, did not approve the mobile money prompt, or your card was declined, the order stays unpaid and we do not send it out.',
          'Check that you have enough balance and that you approved the prompt on your phone, then try again from the payment page or the payment link we sent you.',
          `If money left your account but the order still shows as unpaid, do not pay twice. Call or WhatsApp us on ${STORE_PHONE} with your order number and we will check it with Hubtel.`,
        ],
      },
    ],
    links: [{ href: '/order-tracking', label: 'Check an order' }],
  },
  {
    id: 'delivery-times-and-fees',
    category: 'delivery',
    title: 'How long does delivery take, and what does it cost?',
    summary: 'Orders are delivered within 24–72 hours after payment. Doorstep delivery is charged at cost.',
    sections: [
      {
        paragraphs: [
          'We deliver within Ghana. Orders are delivered within 24–72 hours after payment.',
          'Doorstep delivery is charged at cost: the fee depends on your location, and the rider tells you the fee. It is not included in the amount you pay online.',
          'If you would rather not pay for delivery, choose store pickup at checkout. Pickup is free.',
        ],
      },
    ],
    links: [{ href: '/shipping', label: 'Delivery information' }],
  },
  {
    id: 'store-pickup',
    category: 'delivery',
    title: 'How does store pickup work?',
    summary: 'Choose pickup at checkout and collect your order from our store for free.',
    sections: [
      {
        list: [
          'Choose "Store pickup" at checkout and pay as usual through Hubtel.',
          'Bring your order number when you come to collect.',
          `If you are not sure the order is ready, call or WhatsApp us on ${STORE_PHONE} before you travel.`,
        ],
      },
    ],
  },
  {
    id: 'track-your-order',
    category: 'tracking',
    title: 'How do I track my order?',
    summary: 'Use the order tracking page with your order number, email or phone number.',
    sections: [
      {
        paragraphs: [
          'Open the order tracking page and enter your order number, or the email or phone number you used at checkout. You will see the current status of the order.',
          'If you have an account, your orders are also listed under My Account → Orders.',
          `If the status has not changed for longer than expected, call or WhatsApp us on ${STORE_PHONE}.`,
        ],
      },
    ],
    links: [{ href: '/order-tracking', label: 'Track an order' }],
  },
  {
    id: 'start-a-return',
    category: 'returns',
    title: 'How do I return an item?',
    summary: 'Start a request on the returns page. We contact you within 2 working days.',
    sections: [
      {
        list: [
          'Open the returns page and enter your order number and the email or phone number used on the order.',
          'Choose a reason and tell us which item and what happened.',
          'We contact you within 2 working days to agree how the item comes back to us.',
        ],
      },
      {
        heading: 'Before you start',
        list: [
          'Start the request within 14 days of receiving your order.',
          'Items should be unused and in their original packaging, unless they arrived damaged or wrong.',
          'Keep the item and its packaging until we have spoken.',
        ],
      },
    ],
    links: [{ href: '/returns', label: 'Start a return' }],
  },
  {
    id: 'refunds',
    category: 'returns',
    title: 'How do refunds work?',
    summary: 'If a refund is agreed, our team tells you how and when it will be paid.',
    sections: [
      {
        paragraphs: [
          'Every return request is reviewed by our team. If we agree a refund, we tell you the amount, how it will be paid and when to expect it.',
          'Doorstep delivery fees paid to the rider are not part of the online payment.',
        ],
      },
    ],
  },
  {
    id: 'create-account',
    category: 'account',
    title: 'Do I need an account?',
    summary: 'No. An account lets you see your orders and save delivery addresses.',
    sections: [
      {
        paragraphs: [
          'You can order as a guest. If you create an account with the same email, you can see your orders, save delivery addresses and update your name and phone number.',
        ],
      },
    ],
    links: [{ href: '/auth/signup', label: 'Create an account' }],
  },
  {
    id: 'reset-password',
    category: 'account',
    title: 'I forgot my password',
    summary: 'Request a reset link on the forgot password page.',
    sections: [
      {
        paragraphs: [
          'On the sign-in page, choose "Forgot password", enter your email and open the link we send you. Check your spam folder if it does not arrive within a few minutes.',
          'To change a password you know, sign in and go to My Account → Profile → Change password.',
        ],
      },
    ],
    links: [{ href: '/auth/forgot-password', label: 'Reset my password' }],
  },
  {
    id: 'manage-addresses',
    category: 'account',
    title: 'How do I save delivery addresses?',
    summary: 'Add, edit and remove addresses under My Account → Addresses.',
    sections: [
      {
        paragraphs: [
          'Sign in and open My Account → Addresses. You can add several addresses, edit or delete them, and mark one as your default.',
        ],
      },
    ],
    links: [{ href: '/account?tab=addresses', label: 'My addresses' }],
  },
  {
    id: 'delete-account',
    category: 'account',
    title: 'Can I download my data or delete my account?',
    summary: 'Yes. Download a copy of your data or send us a deletion request from Privacy & Data.',
    sections: [
      {
        paragraphs: [
          'Sign in and open My Account → Security → Privacy & Data. You can download your profile, addresses and orders as a file.',
          'You can also send us an account deletion request there. Our team handles it by hand and contacts you to confirm. Records we must keep by law, such as paid orders, are kept.',
        ],
      },
    ],
    links: [{ href: '/account/privacy', label: 'Privacy & Data' }],
  },
];

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id);
}
