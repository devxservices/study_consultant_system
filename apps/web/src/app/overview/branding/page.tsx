import type { BrandingSettings } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { TenantBranding } from '@/components/admin/tenant-branding';
import { DomainsCard } from '@/components/domains-card';

export const metadata = { title: 'Branding and web address' };

/**
 * The consultancy's own white label, run by its manager: how it looks to
 * students, staff and partners, and the address they use.
 */
export default async function BrandingPage() {
  await requireRole('manager');
  const b = await apiFetch<BrandingSettings>('/tenancy/branding');
  return (
    <>
      <PageHeader
        title="Branding and web address"
        subtitle="Your name, colour and logo on every screen and email, and the address everyone signs in at."
      />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <TenantBranding tenant={b} base="/api/tenancy/branding" />
        <DomainsCard base="/api/tenancy/branding" platformHost={b.platformHost} domains={b.domains} audience="owner" />
      </div>
    </>
  );
}
