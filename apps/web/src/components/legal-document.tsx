import Link from 'next/link';
import { cache } from 'react';
import type { LegalDocsView } from '@crm/shared';
import { apiFetch } from '@/lib/api';

/** The published terms and privacy policy, once per request; null when the API cannot say. */
export const getLegalDocs = cache(async (): Promise<LegalDocsView | null> => {
  try {
    return await apiFetch<LegalDocsView>('/tenancy/legal');
  } catch {
    return null;
  }
});

/**
 * The platform admin's text, shown as written: "# " and "## " lines become
 * headings, "- " lines a list, blank lines separate paragraphs. Nothing in it
 * is ever treated as HTML.
 */
export function LegalDocument({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <article className="space-y-3 text-[14.5px] leading-relaxed text-ink-700">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-*] /, '')}</li>
              ))}
            </ul>
          );
        }
        const first = lines[0]!;
        if (first.startsWith('# ')) {
          return (
            <div key={i}>
              <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink-950">{first.slice(2)}</h1>
              {lines.length > 1 && <p className="mt-3 whitespace-pre-line">{lines.slice(1).join('\n')}</p>}
            </div>
          );
        }
        if (first.startsWith('## ')) {
          return (
            <div key={i} className="pt-3">
              <h2 className="text-[17px] font-medium text-ink-950">{first.slice(3)}</h2>
              {lines.length > 1 && <p className="mt-1.5 whitespace-pre-line">{lines.slice(1).join('\n')}</p>}
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {lines.join('\n')}
          </p>
        );
      })}
    </article>
  );
}

/** "Terms · Privacy" for a footer or under a form, only for what is published. */
export async function LegalLinks({ className, lead }: { className?: string; lead?: string }) {
  const docs = await getLegalDocs();
  if (!docs?.terms && !docs?.privacy) return null;
  return (
    <p className={className}>
      {lead}
      {docs.terms && (
        <Link href="/terms" className="font-medium text-brand-700 hover:underline">
          Terms
        </Link>
      )}
      {docs.terms && docs.privacy && <span aria-hidden> · </span>}
      {docs.privacy && (
        <Link href="/privacy" className="font-medium text-brand-700 hover:underline">
          Privacy
        </Link>
      )}
    </p>
  );
}
