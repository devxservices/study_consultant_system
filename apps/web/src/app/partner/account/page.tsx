import { requireRole } from '@/lib/session';
import { AccountPage } from '@/components/account-page';

export const metadata = { title: 'Account settings' };

export default async function Page() {
  const user = await requireRole('partner');
  return <AccountPage user={user} />;
}
