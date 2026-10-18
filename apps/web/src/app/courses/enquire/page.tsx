import { TEST_TYPE_LABEL, COURSE_MODE_LABEL, type PublicCoursesView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { EnquireForm } from './enquire-form';
import { LegalLinks } from '@/components/legal-document';

export const metadata = { title: 'Ask about a course' };

/**
 * The consultancy's public course page: what it teaches, the batches about to
 * start, and a short form. No account needed - the enquiry goes to staff, who
 * call back.
 */
export default async function EnquirePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const info = await apiFetch<PublicCoursesView>('/public/courses/enquire').catch(() => null);
  const { course } = await searchParams;
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10">
      <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink-950">Ask about a course{info ? ` at ${info.consultancy}` : ''}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
        IELTS, PTE and our other courses. Leave your details and we will call you back about fees, timings and a free trial class.
      </p>
      {info && info.courses.length > 0 && (
        <ul className="mt-5 space-y-2">
          {info.courses.map((c) => (
            <li key={c.id} className="rounded-lg bg-paper px-4 py-3 text-[13.5px] shadow-card">
              <p className="font-medium text-ink-950">{c.name}</p>
              <p className="text-ink-500">
                {c.testType !== 'none' ? `${TEST_TYPE_LABEL[c.testType]} · ` : ''}
                {COURSE_MODE_LABEL[c.mode]} · {c.durationWeeks} weeks
                {c.batches.length ? ` · next batch starts ${c.batches[0]!.startDate}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 rounded-xl bg-paper p-5 shadow-card">
        {!info ? <p className="text-[14px] text-ink-600">This page is on each consultancy’s own website.</p> : <EnquireForm courses={info.courses} initialCourse={course ?? ''} />}
      </div>
      <LegalLinks className="mt-4 text-[12.5px] text-ink-400" lead="By sending this you agree that we may contact you about it, as our privacy policy describes. " />
    </main>
  );
}
