'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_STATUS_TONE,
  DOCX_MIME_TYPE,
  type DocumentVersionView,
  type DocumentView,
  type DriveDocumentView,
  type ShareAccessView,
  type ShareLinkView,
} from '@crm/shared';
import { formatBytes, formatDate } from '@/lib/format';
import { Button, Pill, cx } from '../ui';
import { callApi, FormAlert } from '../forms';
import { IconClose, IconDownload, IconShare, IconUndo } from '../icons';
import { GrantsEditor, ShareDialog, TextDialog } from './dialogs';

type Tab = 'details' | 'versions' | 'comments' | 'sharing' | 'access';

/**
 * One document, opened beside the list: the file itself (PDF, image or Word,
 * in the browser), what it is and whose, and everything that can be done to
 * it - review it, see and restore its earlier versions, discuss it with the
 * student, and share it outside.
 */
export function PreviewPanel({
  doc,
  basePath,
  canShare,
  manager = false,
  onClose,
}: {
  doc: DriveDocumentView;
  basePath: string;
  canShare: boolean;
  manager?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('details');
  const [ask, setAsk] = useState<null | 'reupload_requested' | 'rejected'>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab('details');
    setError(null);
  }, [doc.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function status(next: 'under_review' | 'verified' | 'rejected' | 'reupload_requested', comment?: string): Promise<string | null> {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/documents/${doc.id}/status`, { method: 'POST', json: { status: next, ...(comment ? { comment } : {}) } });
    setBusy(false);
    if (!res.ok) {
      const msg = res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.';
      setError(msg);
      return msg;
    }
    router.refresh();
    return null;
  }

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[560px] flex-col border-l border-line bg-paper shadow-raise"
      aria-label={`Document: ${doc.fileName}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink-950" title={doc.fileName}>
            {doc.fileName}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-500">
            <Pill tone={DOCUMENT_STATUS_TONE[doc.status]} dot>
              {DOCUMENT_STATUS_LABEL[doc.status]}
            </Pill>
            <span>{doc.typeLabel}</span>
            {doc.clientName && (
              <>
                <span aria-hidden>·</span>
                <Link href={`${basePath}?clientId=${doc.clientId}`} className="hover:text-brand-700">
                  {doc.clientName}
                </Link>
              </>
            )}
            {doc.versionCount > 1 && <span>· v{doc.version} of {doc.versionCount}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a href={doc.downloadUrl} className="press rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" title="Download">
            <IconDownload size={18} />
            <span className="sr-only">Download</span>
          </a>
          {canShare && (
            <button type="button" onClick={() => setSharing(true)} className="press rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" title="Share">
              <IconShare size={18} />
              <span className="sr-only">Share</span>
            </button>
          )}
          <button type="button" onClick={onClose} className="press rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" title="Close">
            <IconClose size={18} />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileView doc={doc} />

        {doc.canReview && doc.status !== 'verified' && !doc.trashedAt && (
          <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
            <Button size="sm" disabled={busy} onClick={() => void status('verified')}>
              Approve
            </Button>
            {doc.status !== 'under_review' && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void status('under_review')}>
                Mark under review
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsk('reupload_requested')}>
              Ask to re-upload
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk('rejected')}>
              Reject
            </Button>
          </div>
        )}
        {doc.canReview && doc.status === 'verified' && (
          <div className="border-b border-line px-4 py-3">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk('reupload_requested')}>
              Approved by mistake? Ask for it again
            </Button>
          </div>
        )}
        {error && (
          <div className="px-4 pt-3">
            <FormAlert>{error}</FormAlert>
          </div>
        )}
        {doc.reviewerComment && (
          <div className="mx-4 mt-3 rounded-lg bg-bad-50 px-3 py-2 text-[13px] text-bad-700">
            <span className="font-medium">Reason given: </span>
            {doc.reviewerComment}
          </div>
        )}
        {doc.duplicateOfId && (
          <div className="mx-4 mt-3 rounded-lg bg-warn-50 px-3 py-2 text-[13px] text-warn-700">
            The same file is already in this student’s drive.
          </div>
        )}

        <nav className="mt-2 flex gap-1 border-b border-line px-3" aria-label="Document sections">
          {(['details', 'versions', 'comments', ...(canShare ? (['sharing'] as const) : []), ...(manager ? (['access'] as const) : [])] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              className={cx(
                'border-b-2 px-2.5 pb-2 pt-2 text-[13px] font-medium capitalize',
                tab === t ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3">
          {tab === 'details' && <Details doc={doc} />}
          {tab === 'versions' && <Versions doc={doc} />}
          {tab === 'comments' && <Comments doc={doc} />}
          {tab === 'sharing' && <Sharing doc={doc} />}
          {tab === 'access' && <GrantsEditor resourceType="document" resourceId={doc.id} />}
        </div>
      </div>

      <TextDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask === 'rejected' ? 'Reject this document' : 'Ask for it again'}
        description="The student sees this exactly as written, in the app and by email."
        label="What is wrong, and what to send instead"
        placeholder="The bank stamp on page 2 is not readable - please scan the original again."
        multiline
        minLength={10}
        confirm={ask === 'rejected' ? 'Reject' : 'Ask to re-upload'}
        danger={ask === 'rejected'}
        onSubmit={(v) => status(ask!, v)}
      />
      <ShareDialog open={sharing} onClose={() => setSharing(false)} target={{ documentId: doc.id, name: doc.fileName }} />
    </aside>
  );
}

const DOC_TAGS = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP',
  'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG', 'SPAN', 'BLOCKQUOTE', 'PRE', 'CODE',
]);

/**
 * The converted Word document as markup a student cannot turn against staff:
 * a .docx is untrusted input, and its hyperlinks can be `javascript:` URLs.
 * Keeps known document tags only (others are unwrapped, script-like ones
 * dropped with their content), no attributes but a safe link target and an
 * embedded image.
 */
function cleanDocHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      // Upper-cased: SVG and MathML elements keep their lower-case names.
      const tag = child.tagName.toUpperCase();
      if (!DOC_TAGS.has(tag)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'FORM'].includes(tag)) {
          child.remove();
          continue;
        }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const href = child.getAttribute('href');
      const src = child.getAttribute('src');
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      if (tag === 'A' && href && /^(https?:|mailto:)/i.test(href.trim())) {
        child.setAttribute('href', href.trim());
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      if (tag === 'IMG') {
        if (src && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) child.setAttribute('src', src);
        else {
          child.remove();
          continue;
        }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** The file itself: PDF and images natively, Word documents converted in the browser. */
function FileView({ doc }: { doc: DriveDocumentView }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const docx = doc.mimeType === DOCX_MIME_TYPE;

  useEffect(() => {
    if (!docx) return;
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    (async () => {
      try {
        const [{ default: mammoth }, buf] = await Promise.all([
          import('mammoth'),
          fetch(doc.fileUrl).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.arrayBuffer();
          }),
        ]);
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(cleanDocHtml(out.value));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.fileUrl, docx]);

  if (doc.mimeType === 'application/pdf') {
    return <iframe src={doc.fileUrl} title={doc.fileName} className="h-[52vh] w-full border-b border-line bg-ink-50" />;
  }
  if (doc.mimeType.startsWith('image/') && doc.mimeType !== 'image/heic') {
    return (
      <div className="flex max-h-[52vh] justify-center overflow-auto border-b border-line bg-ink-50 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- an authorised, private file, not a static asset */}
        <img src={doc.fileUrl} alt={doc.fileName} className="max-h-[48vh] w-auto rounded shadow-card" />
      </div>
    );
  }
  if (docx) {
    return (
      <div className="max-h-[52vh] overflow-auto border-b border-line bg-ink-50 p-4">
        {failed ? (
          <p className="text-[13px] text-ink-500">This Word document could not be shown here. Download it to read it.</p>
        ) : html === null ? (
          <p className="text-[13px] text-ink-400">Opening…</p>
        ) : (
          // Passed through cleanDocHtml: document markup only, safe links, embedded images.
          <div className="prose-doc rounded bg-paper p-5 text-[13.5px] leading-relaxed text-ink-900 shadow-card" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    );
  }
  return <p className="border-b border-line px-4 py-8 text-center text-[13px] text-ink-500">No preview for this kind of file. Download it to open it.</p>;
}

function Details({ doc }: { doc: DriveDocumentView }) {
  const router = useRouter();
  const [expiresOn, setExpiresOn] = useState(doc.expiresOn ?? '');
  const [tags, setTags] = useState(doc.tags.join(', '));
  const [note, setNote] = useState<string | null>(null);
  const dirty = expiresOn !== (doc.expiresOn ?? '') || tags !== doc.tags.join(', ');

  async function save() {
    const res = await callApi(`/api/drive/documents/${doc.id}`, {
      method: 'PATCH',
      json: {
        expiresOn: expiresOn || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      },
    });
    setNote(res.ok ? 'Saved.' : (res.message ?? 'Could not save.'));
    if (res.ok) router.refresh();
  }

  const rows: [string, React.ReactNode][] = [
    ['Student', doc.clientName ?? 'Agency file'],
    ['Application', doc.caseReference ? `${doc.caseReference}${doc.targetCountry ? ` · ${doc.targetCountry}` : ''}` : 'All of the student’s applications'],
    ['Folder', doc.folderName ?? '-'],
    ['Uploaded', `${formatDate(doc.uploadedAt)} by ${doc.uploadedByName}${doc.uploadedByRole === 'client' ? ' (student)' : ''}`],
    ['Reviewed', doc.reviewedAt ? `${formatDate(doc.reviewedAt)} by ${doc.reviewedByName ?? '-'}` : 'Not yet'],
    ['Size', formatBytes(doc.fileSize)],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-500">{k}</dt>
            <dd className="min-w-0 text-ink-900">{v}</dd>
          </div>
        ))}
      </dl>
      {doc.canOrganise ? (
        <div className="space-y-3 rounded-lg bg-ink-50 p-3">
          <label className="block text-[12.5px] font-medium text-ink-700">
            Expires on
            <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-paper px-2 text-[13px]" />
          </label>
          <label className="block text-[12.5px] font-medium text-ink-700">
            Tags, separated by commas
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="final, certified" className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-paper px-2 text-[13px]" />
          </label>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-500">{note}</span>
            <Button size="sm" onClick={save} disabled={!dirty}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        doc.expiresOn && (
          <p className="text-[13px] text-ink-700">
            Expires {formatDate(doc.expiresOn)}
            {doc.daysToExpiry !== null && doc.daysToExpiry <= 90 && <span className="ml-1 text-warn-700">({doc.daysToExpiry < 0 ? 'expired' : `in ${doc.daysToExpiry} days`})</span>}
          </p>
        )
      )}
    </div>
  );
}

function Versions({ doc }: { doc: DriveDocumentView }) {
  const router = useRouter();
  const [versions, setVersions] = useState<DocumentVersionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/documents/${doc.id}/versions`)
      .then((r) => r.json())
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [doc.id]);

  async function restore(id: string) {
    const res = await callApi(`/api/documents/${doc.id}/versions/${id}/restore`, { method: 'POST' });
    if (!res.ok) return setError(res.message ?? 'Could not restore it.');
    router.refresh();
  }

  if (!versions) return <p className="text-[13px] text-ink-400">Loading…</p>;
  return (
    <div>
      {error && <FormAlert>{error}</FormAlert>}
      <ol className="divide-y divide-line">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] text-ink-900">
                v{v.version} · {v.fileName} {v.current && <Pill tone="info">Current</Pill>}
              </p>
              <p className="text-[12px] text-ink-500">
                {formatDate(v.uploadedAt)} by {v.uploadedByName} · {DOCUMENT_STATUS_LABEL[v.status]}
                {v.reviewerComment ? ` - “${v.reviewerComment}”` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <a href={v.fileUrl} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 text-[12.5px] text-brand-700 hover:bg-brand-50">
                Open
              </a>
              {!v.current && doc.canOrganise && (
                <button type="button" onClick={() => void restore(v.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-ink-700 hover:bg-ink-100">
                  <IconUndo size={13} />
                  Restore
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Comments({ doc }: { doc: DriveDocumentView }) {
  const [view, setView] = useState<DocumentView | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    fetch(`/api/documents/${doc.id}`)
      .then((r) => r.json())
      .then(setView)
      .catch(() => undefined);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  async function send() {
    const res = await callApi<DocumentView>(`/api/documents/${doc.id}/comments`, { method: 'POST', json: { body } });
    if (!res.ok || !res.data) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Not sent.');
    setBody('');
    setView(res.data);
  }

  return (
    <div className="space-y-3">
      {!view ? (
        <p className="text-[13px] text-ink-400">Loading…</p>
      ) : view.comments.length === 0 ? (
        <p className="text-[13px] text-ink-500">No questions yet. Ask the student something without rejecting the document.</p>
      ) : (
        <ul className="space-y-2">
          {view.comments.map((c) => (
            <li key={c.id} className={cx('rounded-lg px-3 py-2 text-[13px]', c.authorRole === 'client' ? 'bg-ink-50' : 'bg-info-50')}>
              <p className="text-ink-900">{c.body}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-500">
                {c.authorName} · {formatDate(c.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex gap-2">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ask about this document…" className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-3 text-[13px]" />
        <Button size="sm" onClick={send} disabled={body.trim().length < 2}>
          Send
        </Button>
      </div>
    </div>
  );
}

function Sharing({ doc }: { doc: DriveDocumentView }) {
  const [links, setLinks] = useState<ShareLinkView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<ShareAccessView[] | null>(null);
  const load = () =>
    fetch(`/api/drive/shares?documentId=${doc.id}`)
      .then((r) => r.json())
      .then(setLinks)
      .catch(() => setLinks([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  async function revoke(id: string) {
    await callApi(`/api/drive/shares/${id}/revoke`, { method: 'POST' });
    void load();
  }
  async function showLog(id: string) {
    setOpen(open === id ? null : id);
    setLog(null);
    const r = await fetch(`/api/drive/shares/${id}/access`);
    setLog(r.ok ? ((await r.json()) as ShareAccessView[]) : []);
  }

  if (!links) return <p className="text-[13px] text-ink-400">Loading…</p>;
  if (links.length === 0) return <p className="text-[13px] text-ink-500">Not shared outside. Use the share button above to send a university a secure link.</p>;
  return (
    <ul className="divide-y divide-line">
      {links.map((l) => (
        <li key={l.id} className="py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] text-ink-900">{l.label}</p>
              <p className="text-[12px] text-ink-500">
                {l.active ? `Expires ${formatDate(l.expiresAt)}` : l.revokedAt ? 'Switched off' : 'Expired'} · opened {l.views} {l.views === 1 ? 'time' : 'times'}
                {l.hasPassword ? ' · password' : ''}
                {l.viewOnly ? ' · view only' : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => void showLog(l.id)} className="rounded-md px-2 py-1 text-[12.5px] text-ink-700 hover:bg-ink-100">
                Log
              </button>
              {l.active && (
                <button type="button" onClick={() => void revoke(l.id)} className="rounded-md px-2 py-1 text-[12.5px] text-bad-700 hover:bg-bad-50">
                  Switch off
                </button>
              )}
            </div>
          </div>
          {open === l.id && (
            <ul className="mt-2 space-y-0.5 rounded-md bg-ink-50 p-2 text-[12px] text-ink-600">
              {!log ? (
                <li>Loading…</li>
              ) : log.length === 0 ? (
                <li>Not opened yet.</li>
              ) : (
                log.map((a, i) => (
                  <li key={i}>
                    {new Date(a.at).toLocaleString()} - {a.action.replace('_', ' ')} {a.documentName ? `· ${a.documentName}` : ''} {a.ipAddress ? `· ${a.ipAddress}` : ''}
                  </li>
                ))
              )}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
