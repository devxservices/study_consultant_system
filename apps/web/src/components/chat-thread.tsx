'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { CHAT_EVENTS, type MessageView, type ReadPayload, type TypingPayload } from '@crm/shared';
import { Avatar, cx } from './ui';
import { connectSocket } from '@/lib/socket';
import { useCan } from './permissions-context';


type Status = 'connecting' | 'live' | 'offline';

interface Pending extends MessageView {
  pending?: true;
  failed?: true;
}

/**
 * One conversation, scoped to a case.
 *
 * The socket is the fast path, not the only path: history loads over HTTP so
 * the thread renders before the websocket is up, and sending falls back to
 * HTTP if the socket is down. On a patchy mobile connection a message that
 * "didn't send" is the worst possible outcome for this product.
 */
export function ChatThread({
  caseId,
  me,
  counterpartName,
  initialMessages,
  heightClass = 'h-[460px]',
  fill = false,
}: {
  caseId: string;
  me: { id: string; name: string };
  counterpartName: string;
  initialMessages: MessageView[];
  heightClass?: string;
  /**
   * Fill the parent's height instead of a fixed box - the message list takes
   * all remaining space and scrolls, while the header and composer stay put.
   * The parent must have a bounded height. Used by the full-screen chat page.
   */
  fill?: boolean;
}) {
  const [messages, setMessages] = useState<Pending[]>(initialMessages);
  const [status, setStatus] = useState<Status>('connecting');
  // Clients always may; staff need "Message clients". The server refuses either way.
  const mayReply = useCan()('chat.send');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [theyRead, setTheyRead] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTypingLabel = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Keep the newest message in view unless the reader has scrolled up. */
  const scrollToEnd = useCallback((force = false) => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (force || nearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, []);

  useEffect(() => {
    scrollToEnd(true);
  }, [scrollToEnd]);

  /* ---------------- socket ---------------- */

  useEffect(() => {
    // The library arrives after first paint; until then sending goes over HTTP.
    const live = (socket: Socket) => {
      socketRef.current = socket;

      socket.on('connect', () => {
        setStatus('live');
        socket.emit(CHAT_EVENTS.join, { caseId });
        socket.emit(CHAT_EVENTS.read, { caseId });
      });

      socket.on('disconnect', () => setStatus('offline'));
      socket.on('connect_error', () => setStatus('offline'));

      socket.on(CHAT_EVENTS.message, (msg: MessageView) => {
        setMessages((prev) => {
          // Replace our own optimistic bubble rather than showing it twice.
          if (msg.clientRef) {
            const idx = prev.findIndex((m) => m.id === msg.clientRef);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
          }
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        scrollToEnd();
        // Anything arriving while the thread is open counts as read.
        if (msg.senderId !== me.id) socket.emit(CHAT_EVENTS.read, { caseId });
      });

      socket.on(CHAT_EVENTS.typingState, (p: TypingPayload) => {
        if (p.caseId !== caseId || p.userId === me.id) return;
        setTypingName(p.typing ? p.name : null);
        if (clearTypingLabel.current) clearTimeout(clearTypingLabel.current);
        // Failsafe: never leave a stale "typing..." on screen.
        if (p.typing) clearTypingLabel.current = setTimeout(() => setTypingName(null), 6000);
      });

      socket.on(CHAT_EVENTS.readState, (p: ReadPayload) => {
        if (p.caseId === caseId && p.readerId !== me.id) setTheyRead(p.readAt);
      });

      return () => {
        socket.emit(CHAT_EVENTS.leave, { caseId });
        socketRef.current = null;
      };
    };
    return connectSocket('/chat', live, () => setStatus('offline'));
  }, [caseId, me.id, scrollToEnd]);

  /* ---------------- sending ---------------- */

  function signalTyping() {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit(CHAT_EVENTS.typing, { caseId, typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(
      () => socket.emit(CHAT_EVENTS.typing, { caseId, typing: false }),
      1800,
    );
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    const clientRef = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Pending = {
      id: clientRef,
      caseId,
      senderId: me.id,
      senderName: me.name,
      senderRole: 'client',
      body,
      documentId: null,
      documentName: null,
      sentAt: new Date().toISOString(),
      readAt: null,
      pending: true,
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setSending(true);
    scrollToEnd(true);

    const socket = socketRef.current;
    socket?.emit(CHAT_EVENTS.typing, { caseId, typing: false });

    const settle = (saved: MessageView | null) => {
      setSending(false);
      if (!saved) {
        setMessages((prev) =>
          prev.map((m) => (m.id === clientRef ? { ...m, pending: undefined, failed: true } : m)),
        );
        return;
      }
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === clientRef);
        if (idx < 0) return prev.some((m) => m.id === saved.id) ? prev : [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
    };

    if (socket?.connected) {
      socket.emit(
        CHAT_EVENTS.send,
        { caseId, body, clientRef },
        (ack: { ok: boolean; message?: MessageView }) =>
          settle(ack?.ok && ack.message ? ack.message : null),
      );
      return;
    }

    // Socket is down - go over HTTP so the message still gets out.
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, body, clientRef }),
      });
      settle(res.ok ? ((await res.json()) as MessageView) : null);
    } catch {
      settle(null);
    }
  }

  async function retry(m: Pending) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setDraft(m.body);
  }

  const grouped = useMemo(() => groupByDay(messages), [messages]);

  return (
    <div
      className={cx(
        'flex flex-col overflow-hidden bg-paper',
        fill
          ? 'h-full border-line sm:rounded-xl sm:border sm:shadow-card'
          : 'rounded-xl border border-line shadow-card',
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={counterpartName} size={28} />
          <p className="truncate text-[14px] font-medium text-ink-950">{counterpartName}</p>
        </div>
        <ConnectionBadge status={status} />
      </header>

      <div
        ref={listRef}
        className={cx('min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3', !fill && heightClass)}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${counterpartName}`}
      >
        {messages.length === 0 && (
          <p className="py-10 text-center text-[13px] text-ink-400">
            No messages yet. Say hello.
          </p>
        )}

        {grouped.map(([day, items]) => (
          <div key={day} className="space-y-1.5">
            <p className="sticky top-0 z-10 -mx-1 py-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-400">
              {day}
            </p>
            {items.map((m) => (
              <Bubble key={m.id} m={m} mine={m.senderId === me.id} onRetry={retry} />
            ))}
          </div>
        ))}

        {typingName && (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
            <span className="flex gap-0.5" aria-hidden>
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </span>
            {typingName.split(' ')[0]} is typing
          </p>
        )}

        {theyRead && messages.some((m) => m.senderId === me.id) && (
          <p className="text-right text-[11px] text-ink-400">Seen</p>
        )}
      </div>

      {!mayReply ? (
        <p className="shrink-0 border-t border-line bg-ink-50 px-3 py-2.5 text-[12.5px] text-ink-500">
          You can read this conversation but not reply. Ask a manager for “Message clients” if you need it.
        </p>
      ) : (
      <div className="shrink-0 border-t border-line bg-paper p-2.5">
        <div className="flex items-end gap-2">
          <label htmlFor={`chat-${caseId}`} className="sr-only">
            Message {counterpartName}
          </label>
          <textarea
            id={`chat-${caseId}`}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              signalTyping();
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. On touch keyboards the
              // button is the reliable path, so both exist.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Message ${counterpartName.split(' ')[0]}...`}
            className="max-h-[140px] min-h-[38px] flex-1 resize-none rounded-md border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim()}
            className="press h-[38px] shrink-0 rounded-lg bg-brand-600 px-3.5 text-[14px] font-medium text-white hover:brightness-[0.93] disabled:opacity-40"
          >
            Send
          </button>
        </div>
        {status === 'offline' && (
          <p className="mt-1.5 text-[12px] text-warn-700">
            Reconnecting. Messages you send now still go through.
          </p>
        )}
      </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Bubble({
  m,
  mine,
  onRetry,
}: {
  m: Pending;
  mine: boolean;
  onRetry: (m: Pending) => void;
}) {
  return (
    <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('max-w-[80%] sm:max-w-[70%]', mine && 'text-right')}>
        {!mine && (
          <p className="mb-0.5 text-[11px] font-medium text-ink-400">{m.senderName}</p>
        )}
        <div
          className={cx(
            'inline-block rounded-lg px-3 py-1.5 text-left text-[14px] leading-snug',
            mine
              ? 'bg-brand-600 text-white'
              : 'border border-line bg-ink-50 text-ink-900',
            m.pending && 'opacity-60',
            m.failed && 'border border-bad-200 bg-bad-50 text-bad-700',
          )}
        >
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
        </div>
        <p
          className={cx(
            'mt-0.5 text-[11px]',
            m.failed ? 'text-bad-700' : 'text-ink-400',
          )}
        >
          {m.failed ? (
            <>
              Not sent.{' '}
              <button
                type="button"
                onClick={() => onRetry(m)}
                className="underline underline-offset-2 hover:text-bad-700"
              >
                Try again
              </button>
            </>
          ) : m.pending ? (
            'Sending...'
          ) : (
            new Date(m.sentAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })
          )}
        </p>
      </div>
    </div>
  );
}

function ConnectionBadge({ status }: { status: Status }) {
  const map = {
    live: { dot: 'bg-ok-500', text: 'Live', tone: 'text-ink-400' },
    connecting: { dot: 'bg-ink-300', text: 'Connecting', tone: 'text-ink-400' },
    offline: { dot: 'bg-warn-500', text: 'Reconnecting', tone: 'text-warn-700' },
  }[status];

  return (
    <span className={cx('flex shrink-0 items-center gap-1.5 text-[12px]', map.tone)}>
      <span className={cx('size-1.5 rounded-full', map.dot)} aria-hidden />
      {map.text}
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1 animate-bounce rounded-full bg-ink-300"
      style={{ animationDelay: delay, animationDuration: '1s' }}
    />
  );
}

/** Groups into Today / Yesterday / date, so a long thread stays readable. */
function groupByDay(messages: Pending[]): [string, Pending[]][] {
  const out = new Map<string, Pending[]>();
  for (const m of messages) {
    const d = new Date(m.sentAt);
    const today = new Date();
    const yest = new Date(Date.now() - 86_400_000);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const key = same(d, today)
      ? 'Today'
      : same(d, yest)
        ? 'Yesterday'
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const list = out.get(key);
    if (list) list.push(m);
    else out.set(key, [m]);
  }
  return [...out.entries()];
}
