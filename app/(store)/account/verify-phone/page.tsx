import { redirect } from 'next/navigation';

// Email and phone confirmation are not offered on this page; send old links to the account.
export default function RemovedVerificationPage() {
  redirect('/account?tab=security');
}
