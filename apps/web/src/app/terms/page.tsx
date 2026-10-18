import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { LegalDocument, getLegalDocs } from '@/components/legal-document';

export const metadata = { title: 'Terms of service' };

export default async function TermsPage() {
  const docs = await getLegalDocs();
  if (!docs?.terms) notFound();
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10">
      <Link href="/sign-in" className="mb-6 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <span aria-hidden>&larr;</span> Back to sign in
      </Link>
      <div className="rounded-xl bg-paper p-5 shadow-card sm:p-8">
        <LegalDocument text={docs.terms} />
        {docs.updatedAt && <p className="mt-8 text-[12px] text-ink-400">Published {formatDate(docs.updatedAt)}</p>}
      </div>
    </main>
  );
}
