import { redirect } from 'next/navigation';
import { ROLE_HOME } from '@crm/shared';
import { getSession } from '@/lib/session';

/** The front door: everyone lands here and is sent to their own portal. */
export default async function Home() {
  const user = await getSession();
  redirect(user ? ROLE_HOME[user.role] : '/sign-in');
}
