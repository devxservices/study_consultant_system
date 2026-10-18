'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_STATUS_TONE,
  type DriveDocumentView,
  type DriveFolderView,
} from '@crm/shared';
import { formatBytes, formatDate } from '@/lib/format';
import { Button, Pill, cx } from '../ui';
import { callApi } from '../forms';
import { Popover } from '../popover';
import { IconCopy, IconDots, IconDownload, IconFile, IconFolder, IconLock, IconShare, IconStar, IconTrash, IconUndo } from '../icons';
import { COLOR_DOT, FolderDialog, FolderPicker, ShareDialog, TextDialog } from './dialogs';
import { PreviewPanel } from './preview-panel';

export interface DriveAbilities {
  manage: boolean;
  share: boolean;
  review: boolean;
  manager: boolean;
  trash: boolean;
}

/**
 * The drive's contents: folders as cards, documents as a list or a grid.
 * Select several to work on them together; open one to preview, review and
 * share it beside the list.
 */
export function DriveItems({
  folders,
  documents,
  layout,
  basePath,
  abilities,
  trashView,
  openId,
}: {
  folders: DriveFolderView[];
  documents: DriveDocumentView[];
  layout: 'list' | 'grid';
  basePath: string;
  abilities: DriveAbilities;
  trashView: boolean;
  openId?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openDoc, setOpenDoc] = useState<string | null>(openId ?? null);
  const [rename, setRename] = useState<DriveDocumentView | null>(null);
  const [tagging, setTagging] = useState(false);
  const [moving, setMoving] = useState<{ ids: string[]; clientId: string | null; copy: boolean } | null>(null);
  const [folderEdit, setFolderEdit] = useState<DriveFolderView | null>(null);
  const [share, setShare] = useState<{ documentId?: string; folderId?: string; name: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // A refreshed list may have lost the selected documents.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => documents.some((d) => d.id === id))));
  }, [documents]);
  // A document opened by link (a checklist row) may not be on this page of the list.
  const [external, setExternal] = useState<DriveDocumentView | null>(null);
  useEffect(() => {
    if (!openDoc || documents.some((d) => d.id === openDoc)) {
      setExternal(null);
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/drive/documents/${openDoc}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DriveDocumentView>) : null))
      .then(setExternal)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [openDoc, documents]);
  const current = useMemo(
    () => documents.find((d) => d.id === openDoc) ?? (external?.id === openDoc ? external : null),
    [documents, openDoc, external],
  );
  const chosen = documents.filter((d) => selected.has(d.id));
  const allChosen = documents.length > 0 && selected.size === documents.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    const res = await callApi<{ done: number; failed: { id: string; message: string }[] }>('/api/drive/bulk', {
      method: 'POST',
      json: { action, documentIds: [...selected], ...extra },
    });
    if (!res.ok || !res.data) {
      setNotice({ tone: 'bad', text: res.message ?? 'That did not work.' });
      return res.message ?? 'That did not work.';
    }
    const { done, failed } = res.data;
    setNotice({
      tone: failed.length ? 'bad' : 'ok',
      text: `${done} done${failed.length ? `, ${failed.length} not: ${[...new Set(failed.map((f) => f.message))].join('; ')}` : '.'}`,
    });
    setSelected(new Set());
    router.refresh();
    return null;
  }

  async function act(url: string, method: 'POST' | 'PATCH' | 'DELETE', json?: unknown): Promise<string | null> {
    const res = await callApi(url, { method, json });
    if (!res.ok) {
      const m = res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.';
      setNotice({ tone: 'bad', text: m });
      return m;
    }
    router.refresh();
    return null;
  }

  const star = (itemType: 'folder' | 'document', itemId: string, starred: boolean) =>
    act('/api/drive/star', 'POST', { itemType, itemId, starred });

  return (
    <div>
      {notice && (
        <p role="status" className={cx('mb-3 rounded-lg px-3 py-2 text-[13px]', notice.tone === 'ok' ? 'bg-ok-50 text-ok-700' : 'bg-bad-50 text-bad-700')}>
          {notice.text}
        </p>
      )}

      {folders.length > 0 && (
        <section aria-label="Folders" className="mb-5">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-400">Folders</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {folders.map((f) => (
              <li key={f.id} className="group relative rounded-xl bg-paper shadow-card">
                <Link href={trashView ? '#' : `${basePath}?folderId=${f.id}`} className="lift press flex items-center gap-3 rounded-xl px-3.5 py-3" onClick={(e) => trashView && e.preventDefault()}>
                  <span className="relative">
                    <IconFolder size={26} className="text-info-500" />
                    {f.color && <span className={cx('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-paper', COLOR_DOT[f.color])} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-[14px] font-medium text-ink-900">
                      {f.name}
                      {f.restricted && <IconLock size={13} className="shrink-0 text-warn-600" aria-label="Restricted" />}
                    </span>
                    <span className="block text-[12px] text-ink-400">
                      {f.documentCount} {f.documentCount === 1 ? 'file' : 'files'}
                      {f.folderCount ? ` · ${f.folderCount} ${f.folderCount === 1 ? 'folder' : 'folders'}` : ''}
                      {f.sharedWithPartners ? ' · partners' : ''}
                    </span>
                  </span>
                </Link>
                <div className="absolute right-1.5 top-1.5 flex items-center">
                  {f.starred && <IconStar size={14} className="mr-1 fill-warn-500 text-warn-500" aria-label="Starred" />}
                  <ItemMenu label={`Folder ${f.name}`}>
                    {(close) =>
                      trashView ? (
                        <MenuItem icon={<IconUndo size={15} />} onClick={() => { close(); void act(`/api/drive/folders/${f.id}/restore`, 'POST'); }}>
                          Restore
                        </MenuItem>
                      ) : (
                        <>
                          <MenuItem icon={<IconStar size={15} />} onClick={() => { close(); void star('folder', f.id, !f.starred); }}>
                            {f.starred ? 'Remove star' : 'Star'}
                          </MenuItem>
                          {abilities.manage && (
                            <MenuItem icon={<IconFolder size={15} />} onClick={() => { close(); setFolderEdit(f); }}>
                              Rename, colour{abilities.manager ? ', access' : ''}
                            </MenuItem>
                          )}
                          <MenuItem icon={<IconDownload size={15} />} href={`/api/drive/zip?folderId=${f.id}`} onClick={close}>
                            Download as ZIP
                          </MenuItem>
                          {abilities.share && (
                            <MenuItem icon={<IconShare size={15} />} onClick={() => { close(); setShare({ folderId: f.id, name: f.name }); }}>
                              Share outside
                            </MenuItem>
                          )}
                          {abilities.manage && !(f.systemKey && f.clientId) && (
                            <MenuItem icon={<IconTrash size={15} />} danger onClick={() => { close(); void act(`/api/drive/folders/${f.id}/trash`, 'POST'); }}>
                              Move to trash
                            </MenuItem>
                          )}
                        </>
                      )
                    }
                  </ItemMenu>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {documents.length > 0 && (
        <section aria-label="Documents">
          <div className="mb-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-400">
              <input
                type="checkbox"
                checked={allChosen}
                onChange={() => setSelected(allChosen ? new Set() : new Set(documents.map((d) => d.id)))}
                className="size-4 accent-brand-700"
                aria-label="Select all documents"
              />
              Files
            </label>
          </div>

          {layout === 'grid' ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {documents.map((d) => (
                <li key={d.id} className={cx('group relative overflow-hidden rounded-xl bg-paper shadow-card', selected.has(d.id) && 'ring-2 ring-brand-500')}>
                  <button type="button" onClick={() => setOpenDoc(d.id)} className="block w-full text-left">
                    <Thumb doc={d} />
                    <div className="px-3 py-2">
                      <p className="truncate text-[13px] font-medium text-ink-900">{d.fileName}</p>
                      <p className="truncate text-[11.5px] text-ink-500">{d.clientName ?? d.typeLabel}</p>
                      <div className="mt-1">
                        <Pill tone={DOCUMENT_STATUS_TONE[d.status]}>{DOCUMENT_STATUS_LABEL[d.status]}</Pill>
                      </div>
                    </div>
                  </button>
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={() => toggle(d.id)}
                    className="absolute left-2 top-2 size-4 accent-brand-700"
                    aria-label={`Select ${d.fileName}`}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-hidden rounded-xl bg-paper shadow-card">
              <table className="w-full border-collapse text-[13px]">
                <thead className="hidden bg-ink-50 text-left text-[11.5px] uppercase tracking-wide text-ink-500 md:table-header-group">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="w-[44%] px-2 py-2 font-medium">Name</th>
                    <th className="px-2 py-2 font-medium">Student</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Expires</th>
                    <th className="px-2 py-2 font-medium">Uploaded</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id} className={cx('border-t border-line first:border-t-0 hover:bg-ink-50', selected.has(d.id) && 'bg-brand-50/60')}>
                      <td className="w-10 px-3 py-2 align-middle">
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="size-4 accent-brand-700" aria-label={`Select ${d.fileName}`} />
                      </td>
                      <td className="max-w-0 px-2 py-2">
                        <button type="button" onClick={() => setOpenDoc(d.id)} className="flex w-full min-w-0 items-center gap-2 text-left">
                          <IconFile size={17} className="shrink-0 text-ink-400" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 truncate font-medium text-ink-900">
                              {d.starred && <IconStar size={12} className="shrink-0 fill-warn-500 text-warn-500" />}
                              <span className="truncate">{d.fileName}</span>
                              {d.versionCount > 1 && <span className="shrink-0 text-[11px] text-ink-400">v{d.version}</span>}
                            </span>
                            <span className="block truncate text-[11.5px] text-ink-500">
                              {d.typeLabel}
                              {d.tags.length > 0 && ` · ${d.tags.join(', ')}`}
                              <span className="md:hidden">{d.clientName ? ` · ${d.clientName}` : ''}</span>
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="hidden max-w-[160px] truncate px-2 py-2 text-ink-700 md:table-cell">
                        {d.clientId ? (
                          <Link href={`${basePath}?clientId=${d.clientId}`} className="hover:text-brand-700">
                            {d.clientName}
                          </Link>
                        ) : (
                          <span className="text-ink-400">Agency</span>
                        )}
                      </td>
                      <td className="hidden px-2 py-2 md:table-cell">
                        <Pill tone={DOCUMENT_STATUS_TONE[d.status]} dot>
                          {DOCUMENT_STATUS_LABEL[d.status]}
                        </Pill>
                      </td>
                      <td className="hidden whitespace-nowrap px-2 py-2 md:table-cell">
                        {d.expiresOn ? (
                          <span className={cx(d.daysToExpiry !== null && d.daysToExpiry < 0 ? 'text-bad-700' : d.daysToExpiry !== null && d.daysToExpiry <= 90 ? 'text-warn-700' : 'text-ink-700')}>
                            {formatDate(d.expiresOn)}
                          </span>
                        ) : (
                          <span className="text-ink-300">-</span>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-2 py-2 text-ink-500 md:table-cell">
                        {formatDate(d.uploadedAt)} · {formatBytes(d.fileSize)}
                      </td>
                      <td className="px-2 py-2">
                        <ItemMenu label={`Document ${d.fileName}`}>
                          {(close) => (
                            <>
                              <MenuItem icon={<IconFile size={15} />} onClick={() => { close(); setOpenDoc(d.id); }}>
                                Open
                              </MenuItem>
                              <MenuItem icon={<IconDownload size={15} />} href={d.downloadUrl} onClick={close}>
                                Download
                              </MenuItem>
                              {trashView ? (
                                <MenuItem icon={<IconUndo size={15} />} onClick={() => { close(); void act(`/api/documents/${d.id}/restore`, 'POST'); }}>
                                  Restore
                                </MenuItem>
                              ) : (
                                <>
                                  <MenuItem icon={<IconStar size={15} />} onClick={() => { close(); void star('document', d.id, !d.starred); }}>
                                    {d.starred ? 'Remove star' : 'Star'}
                                  </MenuItem>
                                  {d.canOrganise && (
                                    <>
                                      <MenuItem icon={<IconFile size={15} />} onClick={() => { close(); setRename(d); }}>
                                        Rename
                                      </MenuItem>
                                      <MenuItem icon={<IconFolder size={15} />} onClick={() => { close(); setMoving({ ids: [d.id], clientId: d.clientId, copy: false }); }}>
                                        Move to…
                                      </MenuItem>
                                      <MenuItem icon={<IconCopy size={15} />} onClick={() => { close(); setMoving({ ids: [d.id], clientId: d.clientId, copy: true }); }}>
                                        Copy to…
                                      </MenuItem>
                                    </>
                                  )}
                                  {abilities.share && (
                                    <MenuItem icon={<IconShare size={15} />} onClick={() => { close(); setShare({ documentId: d.id, name: d.fileName }); }}>
                                      Share outside
                                    </MenuItem>
                                  )}
                                  {d.canTrash && (
                                    <MenuItem icon={<IconTrash size={15} />} danger onClick={() => { close(); void act(`/api/documents/${d.id}`, 'DELETE'); }}>
                                      Move to trash
                                    </MenuItem>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </ItemMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-20 z-30 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-paper px-4 py-3 shadow-raise lg:bottom-4">
          <span className="mr-auto text-[13.5px] font-medium text-ink-800">{selected.size} selected</span>
          <a href={`/api/drive/zip?ids=${[...selected].join(',')}`} className="press inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-800 shadow-tile hover:bg-ink-50">
            <IconDownload size={15} />
            ZIP
          </a>
          {trashView ? (
            abilities.trash && (
              <Button size="sm" variant="secondary" onClick={() => void bulk('restore')}>
                Restore
              </Button>
            )
          ) : (
            <>
              {abilities.review && (
                <>
                  <Button size="sm" onClick={() => void bulk('approve')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void bulk('under_review')}>
                    Under review
                  </Button>
                </>
              )}
              {abilities.manage && new Set(chosen.map((d) => d.clientId)).size === 1 && (
                <Button size="sm" variant="secondary" onClick={() => setMoving({ ids: [...selected], clientId: chosen[0]?.clientId ?? null, copy: false })}>
                  Move
                </Button>
              )}
              {abilities.manage && (
                <Button size="sm" variant="secondary" onClick={() => setTagging(true)}>
                  Tag
                </Button>
              )}
              {abilities.trash && (
                <Button size="sm" variant="ghost" onClick={() => void bulk('trash')}>
                  <IconTrash size={15} />
                  Trash
                </Button>
              )}
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {current && (
        <PreviewPanel doc={current} basePath={basePath} canShare={abilities.share} manager={abilities.manager} onClose={() => setOpenDoc(null)} />
      )}

      <TextDialog
        open={rename !== null}
        onClose={() => setRename(null)}
        title="Rename"
        label="Name"
        initial={rename?.fileName.replace(/\.[a-z0-9]+$/i, '') ?? ''}
        confirm="Rename"
        onSubmit={(v) => act(`/api/drive/documents/${rename!.id}`, 'PATCH', { fileName: v })}
      />
      <TextDialog open={tagging} onClose={() => setTagging(false)} title={`Tag ${selected.size} documents`} label="Tag" placeholder="e.g. certified" confirm="Add tag" onSubmit={(v) => bulk('tag', { tag: v })} />
      <FolderPicker
        open={moving !== null}
        onClose={() => setMoving(null)}
        title={moving?.copy ? 'Copy to folder' : 'Move to folder'}
        confirm={moving?.copy ? 'Copy here' : 'Move here'}
        clientId={moving?.clientId ?? null}
        onPick={async (folderId) => {
          if (!moving || !folderId) return 'Choose a folder.';
          if (moving.copy) return act(`/api/drive/documents/${moving.ids[0]}/copy`, 'POST', { folderId });
          if (moving.ids.length === 1) return act(`/api/drive/documents/${moving.ids[0]}`, 'PATCH', { folderId });
          return bulk('move', { folderId });
        }}
      />
      <FolderDialog open={folderEdit !== null} onClose={() => setFolderEdit(null)} onSaved={() => router.refresh()} folder={folderEdit} manager={abilities.manager} />
      <ShareDialog open={share !== null} onClose={() => setShare(null)} target={share} />
    </div>
  );
}

function Thumb({ doc }: { doc: DriveDocumentView }) {
  if (doc.mimeType.startsWith('image/') && doc.mimeType !== 'image/heic') {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- private, authorised file
      <img src={doc.fileUrl} alt="" loading="lazy" className="h-32 w-full bg-ink-50 object-cover" />
    );
  }
  return (
    <div className="flex h-32 items-center justify-center bg-ink-50">
      <span className="rounded-md bg-paper px-2 py-1 text-[11px] font-semibold uppercase text-ink-500 shadow-tile">
        {doc.mimeType === 'application/pdf' ? 'PDF' : doc.mimeType.includes('word') ? 'DOCX' : 'FILE'}
      </span>
    </div>
  );
}

function ItemMenu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  return (
    <Popover
      label={label}
      panelClassName="w-52 p-1"
      trigger={({ props }) => (
        <button {...props} className="press rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800" aria-label={`Actions for ${label}`}>
          <IconDots size={17} />
        </button>
      )}
    >
      {(close) => <div role="menu">{children(close)}</div>}
    </Popover>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  href,
  danger = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const cls = cx(
    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]',
    danger ? 'text-bad-700 hover:bg-bad-50' : 'text-ink-700 hover:bg-ink-50 hover:text-ink-950',
  );
  if (href) {
    return (
      <a role="menuitem" href={href} className={cls} onClick={onClick}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
