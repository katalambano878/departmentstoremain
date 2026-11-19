import Link from 'next/link';

export default function GuestNotice({ returnTo }: { returnTo: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-8 text-center max-w-lg mx-auto">
      <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-full mx-auto mb-4">
        <i className="ri-lock-line text-3xl text-emerald-700" aria-hidden="true"></i>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in to use support tickets</h1>
      <p className="text-gray-600 mb-6">
        Tickets are linked to your account so you can follow our replies. No account? Send us a message instead.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href={`/auth/login?redirect=${encodeURIComponent(returnTo)}`}
          className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Sign in
        </Link>
        <Link
          href="/contact"
          className="border-2 border-gray-300 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
        >
          Contact us
        </Link>
      </div>
    </div>
  );
}
