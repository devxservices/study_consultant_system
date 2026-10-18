'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { BoardCard, BoardColumn, BoardView } from '@crm/shared';
import { Button, Pill, cx } from '../ui';
import { callApi, FormAlert, TextArea } from '../forms';
import { Modal } from '../modal';
import { STAGE_COLOR_DOT } from './stage-builder';

/**
 * The pipeline as columns: one per stage of the chosen workflow, each
 * application a card, the ones waiting longest at the top. Dragging a card
 * to another column moves the application, with the same rules as the case
 * page - a reason for going back or skipping ahead, sign-off and
 * managers-only stages enforced by the server.
 */
export function Board({
  board,
  base,
  consultants,
}: {
  board: BoardView;
  base: '/overview' | '/desk';
  /** Offered as a filter to people who see everyone's applications. */
  consultants: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [columns, setColumns] = useState<BoardColumn[]>(board.columns);
  const [drag, setDrag] = useState<{ card: BoardCard; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ card: BoardCard; from: string; to: string; message: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();

  useEffect(() => setColumns(board.columns), [board]);

  function setParam(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) setParam({ q: q || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function shift(card: BoardCard, from: string, to: string): BoardColumn[] {
    return columns.map((c) => {
      if (c.key === from) return { ...c, total: c.total - 1, overdue: c.overdue - (card.overdue ? 1 : 0), cards: c.cards.filter((x) => x.id !== card.id) };
      if (c.key === to) return { ...c, total: c.total + 1, cards: [{ ...card, stageKey: to, daysInStage: 0, overdue: false, awaitingApproval: c.approvalRequired }, ...c.cards] };
      return c;
    });
  }

  async function move(card: BoardCard, from: string, to: string, why?: string) {
    const before = columns;
    setColumns(shift(card, from, to));
    setError(null);
    setBusy(true);
    const res = await callApi(`/api/cases/${card.id}/stage`, { method: 'POST', json: { stageKey: to, reason: why?.trim() || undefined } });
    setBusy(false);
    if (!res.ok) {
      setColumns(before);
      if (res.fieldErrors.reason && !why) {
        setAsk({ card, from, to, message: res.fieldErrors.reason });
        return;
      }
      setError(`${card.clientName}: ${res.fieldErrors.reason ?? res.message ?? 'could not be moved.'}`);
      return;
    }
    setAsk(null);
    setReason('');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Workflow"
          className="h-9 rounded-lg border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900"
          value={board.workflow.id}
          onChange={(e) => setParam({ templateId: e.target.value, country: undefined })}
        >
          {board.workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.country ? ` (${w.country})` : ''} · {w.activeCases}
            </option>
          ))}
        </select>
        {consultants && (
          <select
            aria-label="Consultant"
            className="h-9 rounded-lg border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900"
            value={params.get('consultantId') ?? ''}
            onChange={(e) => setParam({ consultantId: e.target.value || undefined })}
          >
            <option value="">Everyone</option>
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input
          aria-label="Find"
          className="h-9 w-56 rounded-lg border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900 placeholder:text-ink-300"
          placeholder="Find a student or reference"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ml-auto text-[12.5px] text-ink-400">Drag a card to move the application. Oldest first in each column.</span>
      </div>

      {error && <FormAlert>{error}</FormAlert>}

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3" role="list" aria-label="Stages">
        {columns.map((col) => (
          <section
            key={col.key}
            role="listitem"
            aria-label={`${col.name}: ${col.total}`}
            onDragOver={(e) => {
              if (!drag || drag.from === col.key) return;
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (drag && drag.from !== col.key) void move(drag.card, drag.from, col.key);
              setDrag(null);
            }}
            className={cx(
              'flex w-[272px] shrink-0 flex-col rounded-xl bg-ink-50/80 ring-1 ring-line transition-colors',
              over === col.key && 'bg-brand-50 ring-brand-400',
            )}
          >
            <header className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span className={cx('size-2.5 shrink-0 rounded-full', STAGE_COLOR_DOT[col.color])} aria-hidden />
              <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-900" title={col.name}>
                {col.name}
              </h3>
              <span className="tnum text-[12.5px] font-medium text-ink-500">{col.total}</span>
            </header>
            <div className="flex flex-wrap gap-1 px-3 pb-2 text-[11px]">
              <span className="text-ink-400">{col.slaDays}d limit</span>
              {col.overdue > 0 && <Pill tone="bad">{col.overdue} overdue</Pill>}
              {col.approvalRequired && <Pill tone="warn">Sign-off</Pill>}
              {col.movableBy === 'managers' && <Pill tone="neutral">Managers move</Pill>}
            </div>
            <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {col.cards.map((card) => (
                <li
                  key={card.id}
                  draggable={!busy}
                  onDragStart={() => setDrag({ card, from: col.key })}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  className={cx('cursor-grab rounded-lg bg-paper p-2.5 shadow-card ring-1 ring-line active:cursor-grabbing', card.overdue && 'ring-bad-200')}
                >
                  <Link href={`${base}/cases/${card.id}`} className="block min-w-0" draggable={false}>
                    <p className="truncate text-[13.5px] font-medium text-ink-950">{card.clientName}</p>
                    <p className="truncate text-[12px] text-ink-500">
                      {card.reference}
                      {card.targetUniversity ? ` · ${card.targetUniversity}` : ''}
                      {card.intake ? ` · ${card.intake}` : ''}
                    </p>
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span className={cx('tnum font-medium', card.overdue ? 'text-bad-700' : 'text-ink-500')}>
                      {card.daysInStage}d{card.overdue ? ` · ${card.daysInStage - card.slaDays}d over` : ''}
                    </span>
                    {card.consultantName && <span className="truncate text-ink-400">· {card.consultantName}</span>}
                    {card.awaitingApproval && <Pill tone="warn">Needs sign-off</Pill>}
                    {card.versionBehind && <Pill tone="neutral">Older version</Pill>}
                  </div>
                </li>
              ))}
              {col.cards.length === 0 && <li className="px-1 py-3 text-center text-[12px] text-ink-400">Nothing here</li>}
              {col.total > col.cards.length && (
                <li className="px-1 text-center text-[12px] text-ink-500">
                  and {col.total - col.cards.length} more -{' '}
                  <Link className="text-brand-700 hover:underline" href={`${pathname}?${new URLSearchParams({ ...Object.fromEntries(params), perColumn: '100' }).toString()}`}>
                    show up to 100
                  </Link>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>

      <Modal open={Boolean(ask)} onClose={() => setAsk(null)} title="This move needs a reason" description={ask?.message}>
        <div className="space-y-3">
          <TextArea value={reason} onChange={setReason} rows={2} placeholder="Why is it moving this way? Saved in its history." />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => ask && move(ask.card, ask.from, ask.to, reason)} disabled={busy || reason.trim().length < 3}>
              {busy ? 'Moving…' : 'Move it'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
