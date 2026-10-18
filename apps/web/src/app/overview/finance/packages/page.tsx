import { redirect } from 'next/navigation';

/** The price list is now the fee catalogue, under Finance settings. */
export default function PackagesPage() {
  redirect('/overview/finance/settings?tab=catalogue');
}
