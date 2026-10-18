import Link from 'next/link';
import { DOCUMENT_STATUS_CLIENT_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_TONE, type StudentChecklistView } from '@crm/shared';
import { Card, Pill, cx } from '../ui';
import { IconCheck } from '../icons';

/**
 * Which documents each application needs and how far along the student is -
 * the same numbers the student sees in their portal.
 */
export function ChecklistPanel({
  checklist,
  audience,
  documentHref,
}: {
  checklist: StudentChecklistView;
  audience: 'staff' | 'student';
  documentHref?: (documentId: string) => string;
}) {
  const label = audience === 'student' ? DOCUMENT_STATUS_CLIENT_LABEL : DOCUMENT_STATUS_LABEL;
  return (
    <div className="space-y-4">
      {checklist.applications.map((a) => (
        <Card key={a.caseId ?? 'general'} className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink-950">
                  {a.reference ? `${a.reference}${a.targetCountry ? ` · ${a.targetCountry}` : ''}` : audience === 'student' ? 'Your documents' : 'General checklist'}
                </p>
                <p className="text-[12px] text-ink-500">
                  {a.setName} · {a.approved} of {a.required} required approved
                </p>
              </div>
              <span className={cx('tnum text-[18px] font-semibold', a.percent === 100 ? 'text-ok-700' : 'text-ink-900')}>{a.percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={a.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist complete">
              <div className={cx('h-full origin-left rounded-full', a.percent === 100 ? 'bg-ok-500' : 'bg-brand-500')} style={{ transform: `scaleX(${a.percent / 100})` }} />
            </div>
          </div>
          <ul className="divide-y divide-line">
            {a.items.map((i) => {
              const content = (
                <>
                  <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full', i.status === 'verified' && !i.expired ? 'bg-ok-100 text-ok-700' : 'bg-ink-100 text-ink-300')}>
                    {i.status === 'verified' && !i.expired ? <IconCheck size={12} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink-900">
                      {i.label}
                      {!i.required && <span className="ml-1 text-[11.5px] text-ink-400">(if you have it)</span>}
                    </span>
                    {(i.note || i.expired) && (
                      <span className={cx('block text-[11.5px]', i.expired ? 'text-bad-700' : 'text-ink-500')}>{i.expired ? `Expired ${i.expiresOn}` : i.note}</span>
                    )}
                  </span>
                  {i.status === 'missing' ? (
                    <span className="shrink-0 text-[12px] text-ink-400">{audience === 'student' ? 'Not sent yet' : 'Missing'}</span>
                  ) : (
                    <Pill tone={i.expired ? 'bad' : DOCUMENT_STATUS_TONE[i.status]}>{i.expired ? 'Expired' : label[i.status]}</Pill>
                  )}
                </>
              );
              return (
                <li key={i.typeKey}>
                  {i.documentId && documentHref ? (
                    <Link href={documentHref(i.documentId)} className="flex items-center gap-2.5 px-4 py-2 hover:bg-ink-50">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2.5 px-4 py-2">{content}</div>
                  )}
                </li>
              );
            })}
            {a.items.length === 0 && <li className="px-4 py-3 text-[12.5px] text-ink-500">No checklist applies. Set one up under document settings.</li>}
          </ul>
        </Card>
      ))}
    </div>
  );
}
