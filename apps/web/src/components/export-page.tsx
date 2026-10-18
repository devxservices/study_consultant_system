import { EXPORT_DATASETS, EXPORT_META, type AuthUser } from '@crm/shared';
import { can } from '@/lib/permissions';
import { enabledModules } from '@/lib/entitlements';
import { Card, PageHeader, buttonClass } from './ui';
import { IconDownload, IconLock } from './icons';

const CONTROL =
  'h-9 w-full min-w-0 rounded-md border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900 focus:border-brand-500';

/**
 * The consultancy's data as spreadsheets. Each download is a plain link to
 * the API, which checks the permission, scopes the rows to what this person
 * may see, and records the export in the audit trail.
 */
export async function ExportPage({ user }: { user: AuthUser }) {
  const modules = await enabledModules();
  const datasets = EXPORT_DATASETS.map((k) => EXPORT_META[k]).filter(
    (m) => (!m.billing || modules.has('billing')) && m.alsoRequires.every((p) => can(user, p)),
  );
  const onlyOwn = user.role === 'consultant' && !can(user, 'client.view_all');

  return (
    <>
      <PageHeader
        title="Export"
        subtitle="Download your data as CSV files that open in Excel, Numbers or Google Sheets."
      />

      {onlyOwn && (
        <p className="mb-4 rounded-lg border border-line bg-paper px-4 py-2.5 text-[13px] text-ink-600 shadow-card">
          Your exports include the clients assigned to you, and their applications and money.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {datasets.map((d) => (
          <Card key={d.key} className="flex flex-col p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600">
                <IconDownload size={19} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-ink-950">{d.label}</h2>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">{d.description}</p>
              </div>
            </div>

            <form method="get" action={`/api/export/${d.key}`} className="mt-4 flex flex-1 flex-col justify-end gap-3">
              <fieldset>
                <legend className="mb-1.5 text-[12px] text-ink-400">
                  Optional: only rows by {d.dateField}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="sr-only">From</span>
                    <input type="date" name="from" className={CONTROL} aria-label={`${d.label} from`} />
                  </label>
                  <label>
                    <span className="sr-only">To</span>
                    <input type="date" name="to" className={CONTROL} aria-label={`${d.label} to`} />
                  </label>
                </div>
              </fieldset>
              <button type="submit" className={buttonClass('secondary')}>
                <IconDownload size={16} />
                Download {d.label.toLowerCase()}
              </button>
            </form>
          </Card>
        ))}
      </div>

      <Card className="mt-6 flex items-start gap-3 p-4 sm:p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600">
          <IconLock size={17} />
        </span>
        <p className="text-[13px] leading-relaxed text-ink-600">
          Exports can contain passport numbers and payment records. Every download is recorded in the audit
          trail with who took it, how many rows, and from where. Store the files somewhere only the right
          people can open, and delete them when you are done.
        </p>
      </Card>
    </>
  );
}
