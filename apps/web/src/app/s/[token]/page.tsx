import { SharedFiles } from './shared-files';

export const metadata = { title: 'Shared documents', robots: { index: false, follow: false } };

/**
 * What someone outside the consultancy - a university's admissions office -
 * sees when they open a share link. No account; the link is the key and the
 * password, if there is one, the second.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-10">
      <SharedFiles token={token} />
    </main>
  );
}
