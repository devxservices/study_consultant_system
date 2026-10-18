'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button, cx } from './ui';

/**
 * The form kit every screen shares, so every form in the product looks, labels
 * and reports errors the same way: field errors under their field, anything
 * else in one banner, and a network failure named as a network failure.
 */

export interface ApiResult<T> {
  ok: boolean;
  data: T | null;
  message: string | null;
  fieldErrors: Record<string, string>;
}

export async function callApi<T>(
  url: string,
  init: { method: string; json?: unknown; form?: FormData },
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    });
    if (res.status === 204) return { ok: true, data: null, message: null, fieldErrors: {} };
    const body = (await res.json().catch(() => null)) as
      | (T & { message?: string | string[]; fieldErrors?: Record<string, string> })
      | null;

    if (!res.ok) {
      const fieldErrors = body?.fieldErrors ?? {};
      const raw = body?.message;
      const text = Array.isArray(raw) ? raw.join(' ') : raw;
      const message =
        Object.keys(fieldErrors).length > 0
          ? null
          : (text ??
            (res.status >= 500
              ? 'The server could not do that. Please try again shortly.'
              : 'That did not work. Please try again.'));
      return { ok: false, data: null, message, fieldErrors };
    }
    return { ok: true, data: body, message: null, fieldErrors: {} };
  } catch {
    return {
      ok: false,
      data: null,
      message: 'Cannot reach the server. Check your connection and try again.',
      fieldErrors: {},
    };
  }
}

/** Every field answers focus the same way: a brand border and a soft ring. */
const FOCUS =
  'transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:shadow-[0_0_0_4px_var(--color-brand-100)] focus:outline-none';

const CONTROL = `w-full min-w-0 rounded-lg border bg-paper px-3 text-[14px] text-ink-900 placeholder:text-ink-300 ${FOCUS}`;

export function Field({
  label,
  required,
  hint,
  error,
  className,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-[13px] font-medium text-ink-700">
        {label}
        {required && <span className="text-bad-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-ink-400">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  prefix,
  suffix,
  invalid,
  autoComplete,
  inputMode,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
  autoComplete?: string;
  inputMode?: 'decimal' | 'numeric' | 'email' | 'tel' | 'text';
  disabled?: boolean;
}) {
  const input = (
    <input
      id={id}
      type={type}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      aria-invalid={invalid || undefined}
      className={cx(
        'h-10 w-full min-w-0 bg-paper px-3 text-[14px] text-ink-900 placeholder:text-ink-300 disabled:bg-ink-50 disabled:text-ink-500',
        prefix || suffix ? 'border-0 focus:outline-none' : `rounded-lg border ${FOCUS}`,
        !(prefix || suffix) && (invalid ? 'border-bad-500' : 'border-line-strong'),
      )}
    />
  );
  if (!prefix && !suffix) return input;

  return (
    <div
      className={cx(
        'flex h-10 items-center overflow-hidden rounded-lg border bg-paper transition-[border-color,box-shadow] duration-150 focus-within:border-brand-500 focus-within:shadow-[0_0_0_4px_var(--color-brand-100)]',
        invalid ? 'border-bad-500' : 'border-line-strong',
      )}
    >
      {prefix && <span className="shrink-0 pl-3 text-[14px] text-ink-400">{prefix}</span>}
      {input}
      {suffix && <span className="shrink-0 pr-3 text-[14px] text-ink-400">{suffix}</span>}
    </div>
  );
}

export function SelectInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  /** Adds an empty first option with this label. */
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'h-10', invalid ? 'border-bad-500' : 'border-line-strong')}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'py-2', invalid ? 'border-bad-500' : 'border-line-strong')}
    />
  );
}

/** A colour swatch plus the hex, kept in step with each other. */
export function ColorInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={valid ? value : '#343b48'}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick a colour"
        className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-paper p-1"
      />
      <TextInput value={value} onChange={onChange} placeholder="#1e88e5" invalid={invalid} />
    </div>
  );
}

export function FormAlert({ children, tone = 'bad' }: { children: ReactNode; tone?: 'bad' | 'ok' }) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg px-3.5 py-2.5 text-[13px] ring-1',
        tone === 'bad' ? 'animate-[shake_0.38s_ease-in-out] bg-bad-50 text-bad-700 ring-bad-200' : 'bg-ok-50 text-ok-700 ring-ok-200',
      )}
    >
      {children}
    </div>
  );
}

/** A card heading used inside form cards. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl bg-paper p-4 shadow-card sm:p-5', className)}>
      <h2 className="text-[16px] font-medium text-ink-950">{title}</h2>
      {description && <p className="mt-0.5 text-[12.5px] text-ink-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A destructive action that has to say why: the button opens a reason box,
 * and only a reason of a real sentence lets it go through. Used for voiding
 * money - the reason is what the record shows forever after.
 */
export function ReasonAction({
  label,
  confirmLabel,
  url,
  explanation,
  placeholder,
  size = 'sm',
  variant = 'ghost',
}: {
  label: string;
  confirmLabel: string;
  url: string;
  explanation: string;
  placeholder?: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary' | 'danger';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await callApi(url, { method: 'POST', json: { reason: reason.trim() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.reason ?? res.message);
      return;
    }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  if (!open) {
    return (
      <Button size={size} variant={variant} onClick={() => setOpen(true)} className="print:hidden">
        {label}
      </Button>
    );
  }
  return (
    <div className="popover w-full space-y-2 rounded-lg bg-bad-50/70 p-3 ring-1 ring-bad-200 [--origin:top] print:hidden">
      <p className="text-[12.5px] text-ink-600">{explanation}</p>
      <TextArea value={reason} onChange={setReason} rows={2} placeholder={placeholder ?? 'Why?'} />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={go} disabled={busy || reason.trim().length < 5}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** A plain one-click API action that refreshes the page afterwards. */
export function ActionButton({
  url,
  method = 'POST',
  json,
  children,
  variant = 'secondary',
  size = 'sm',
  confirm: confirmText,
  className,
  redirectTo,
}: {
  url: string;
  method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  confirm?: string;
  className?: string;
  /** Where to go once it worked - for actions that remove the page's own record. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={cx('inline-flex flex-col items-end gap-1', className)}>
      <Button
        size={size}
        variant={variant}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setError(null);
          const res = await callApi(url, { method, json });
          setBusy(false);
          if (!res.ok) setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
          else if (redirectTo) {
            router.push(redirectTo);
            router.refresh();
          } else router.refresh();
        }}
      >
        {busy ? 'Working…' : children}
      </Button>
      {error && <span className="max-w-[260px] text-right text-[12px] text-bad-700">{error}</span>}
    </span>
  );
}
