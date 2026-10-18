import type {
  DocumentType,
  DocumentTypeView,
  DocumentView,
  DriveListing,
  DriveSettingsView,
  Paginated,
  StudentChecklistView,
} from '@crm/shared';
import { Card, EmptyState } from '@/components/ui';
import { PageStamp } from '@/components/page-stamp';
import { ClientChecklist } from '@/components/client-checklist';
import { DropZone } from '@/components/drive/drop-zone';
import { DriveItems } from '@/components/drive/drive-items';
import { ChecklistPanel } from '@/components/drive/checklist-panel';
import { apiFetch, qs } from '@/lib/api';
import { getPortalClient, getPortalCase } from '@/lib/portal';

export const metadata = { title: 'Documents' };

/**
 * A student's documents: what this step needs (with an upload on every row),
 * the full checklist per application, somewhere to send anything else, and
 * their own folders - the same drive their consultant sees, minus anything
 * the consultancy keeps to itself.
 */
export default async function PortalDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { firstCase } = await getPortalClient();

  const [detail, caseDocs, checklist, listing, types, settings] = await Promise.all([
    firstCase ? getPortalCase(firstCase.id) : Promise.resolve(null),
    firstCase
      ? apiFetch<Paginated<DocumentView>>(`/documents?caseId=${firstCase.id}&pageSize=100&sort=newest`)
      : Promise.resolve(null),
    apiFetch<StudentChecklistView>('/drive/checklist').catch(() => null),
    apiFetch<DriveListing>(`/drive${qs({ folderId: sp.folderId, q: sp.q, pageSize: 100 })}`),
    apiFetch<DocumentTypeView[]>('/drive/types'),
    apiFetch<DriveSettingsView>('/drive/settings'),
  ]);
  const inFolder = Boolean(sp.folderId);

  return (
    <div className="space-y-6">
      <PageStamp />
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-950">Documents</h1>
        <p className="mt-0.5 text-[14px] text-ink-500">What is approved, what is being checked, and what still needs sending.</p>
      </div>

      {!inFolder && detail && caseDocs && detail.progress.required > 0 && (
        <section aria-labelledby="step">
          <h2 id="step" className="mb-2 text-[15px] font-semibold text-ink-950">
            For this step
          </h2>
          <ClientChecklist
            caseId={detail.id}
            items={detail.progress.items}
            documents={caseDocs.items}
            verified={detail.progress.verified}
            required={detail.progress.required}
            satisfied={detail.progress.satisfied}
          />
        </section>
      )}

      {!inFolder && checklist && checklist.applications.some((a) => a.items.length > 0) && (
        <section aria-labelledby="all">
          <h2 id="all" className="mb-2 text-[15px] font-semibold text-ink-950">
            Everything your application{checklist.applications.length > 1 ? 's' : ''} need{checklist.applications.length > 1 ? '' : 's'}
          </h2>
          <ChecklistPanel checklist={checklist} audience="student" documentHref={(id) => `/portal/documents?open=${id}`} />
        </section>
      )}

      {!inFolder && (
        <section aria-labelledby="send">
          <h2 id="send" className="mb-2 text-[15px] font-semibold text-ink-950">
            Send a document
          </h2>
          <DropZone
            target={{}}
            types={types.filter((t) => t.active)}
            acceptedTypes={settings.acceptedTypes}
            maxFileMb={settings.maxFileMb}
            title="Drop files here, or take a photo"
          />
        </section>
      )}

      <section aria-labelledby="folders">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="folders" className="text-[15px] font-semibold text-ink-950">
            {inFolder ? (listing.folder?.name ?? 'Folder') : 'Your folders'}
          </h2>
          {inFolder && (
            <a href="/portal/documents" className="text-[13px] font-medium text-brand-700 hover:underline">
              All folders
            </a>
          )}
        </div>
        {listing.folders.length === 0 && listing.documents.length === 0 ? (
          <Card>
            <EmptyState compact title="Nothing here yet" description="Documents you send are filed here automatically." />
          </Card>
        ) : (
          <DriveItems
            folders={listing.folders}
            documents={listing.documents}
            layout="list"
            basePath="/portal/documents"
            abilities={{ manage: false, share: false, review: false, manager: false, trash: true }}
            trashView={false}
            openId={sp.open ?? null}
          />
        )}
      </section>
    </div>
  );
}
