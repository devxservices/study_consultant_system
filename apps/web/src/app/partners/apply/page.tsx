import { apiFetch } from '@/lib/api';
import { ApplyForm } from './apply-form';
import { LegalLinks } from '@/components/legal-document';

export const metadata = { title: 'Become a partner' };

/**
 * The consultancy's public "become a partner" page. No account needed: the
 * application goes to staff, who take it from there - papers, the agreement,
 * then a login.
 */
export default async function ApplyPage() {
  const info = await apiFetch<{ open: boolean; name: string }>('/public/partners/apply').catch(() => null);
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10">
      <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink-950">Become a partner{info ? ` of ${info.name}` : ''}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
        Recruitment agencies and education counsellors who introduce students to us are paid a share of what we earn on each student who enrols. Tell us about your
        organisation and we will be in touch about the next steps: your registration papers and the partner agreement.
      </p>
      <div className="mt-6 rounded-xl bg-paper p-5 shadow-card">
        {!info ? (
          <p className="text-[14px] text-ink-600">This page is on each consultancy’s own website.</p>
        ) : !info.open ? (
          <p className="text-[14px] text-ink-600">We are not taking new partner applications at the moment.</p>
        ) : (
          <ApplyForm />
        )}
      </div>
      <LegalLinks className="mt-4 text-[12.5px] text-ink-400" lead="By applying you agree that we may hold your details to review it, as our privacy policy describes. " />
    </main>
  );
}
