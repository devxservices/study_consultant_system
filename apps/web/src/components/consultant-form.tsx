'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { PasswordLinkResult } from '@crm/shared';
import { Button, Card } from './ui';
import { SentLink } from './password-link';

/**
 * Manager-only form to add a consultant account. The server creates both the
 * login and the staff profile; this only gathers the fields. With no password
 * typed, the new colleague is emailed a link to choose their own - the link
 * is shown here too, to send by WhatsApp if the email is slow.
 */
export function ConsultantForm({
  returnTo = '/overview/consultants',
  roles,
}: {
  returnTo?: string;
  /** Offered to managers only: a role is a set of permissions. */
  roles?: { id: string; name: string; description: string | null }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    countries: '',
    maxActiveClients: '60',
    roleId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<{ result: PasswordLinkResult; name: string; email: string } | null>(null);

  const set = (k: keyof typeof values) => (v: string) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);

    const payload = {
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim() || undefined,
      ...(values.password ? { password: values.password } : {}),
      countries: values.countries
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      maxActiveClients: Number(values.maxActiveClients) || 60,
      ...(values.roleId ? { roleId: values.roleId } : {}),
    };

    try {
      const res = await fetch('/api/consultants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { id?: string; message?: string; fieldErrors?: Record<string, string>; invite?: PasswordLinkResult | null }
        | null;

      if (!res.ok) {
        setErrors(body?.fieldErrors ?? {});
        setFormError(body?.fieldErrors ? null : (body?.message ?? 'Could not save. Try again.'));
        setBusy(false);
        return;
      }

      if (body?.invite) {
        setInvited({ result: body.invite, name: payload.fullName, email: payload.email });
        setBusy(false);
        return;
      }
      router.push(returnTo);
      router.refresh();
    } catch {
      setFormError('Cannot reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  if (invited) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">{invited.name} is on the team</h2>
        <p className="mt-1 text-[13px] text-ink-600">They choose their own password from the link, then sign in with {invited.email}.</p>
        <SentLink result={invited.result} email={invited.email} name={invited.name} />
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => {
              router.push(returnTo);
              router.refresh();
            }}
          >
            Done
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && (
        <div
          role="alert"
          className="rounded-md border border-bad-200 bg-bad-50 px-3 py-2.5 text-[13px] text-bad-700"
        >
          {formError}
        </div>
      )}

      <Card className="p-4 sm:p-5">
        <h2 className="mb-4 text-[15px] font-semibold text-ink-950">Their details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errors.fullName} className="sm:col-span-2">
            <Input value={values.fullName} onChange={set('fullName')} placeholder="e.g. Sara Malik" />
          </Field>

          <Field label="Email address" required error={errors.email}>
            <Input
              type="email"
              value={values.email}
              onChange={set('email')}
              placeholder="name@consultancy.pk"
            />
          </Field>

          <Field label="Phone number" error={errors.phone}>
            <Input
              type="tel"
              value={values.phone}
              onChange={set('phone')}
              placeholder="+92 300 1234567"
            />
          </Field>

          <Field
            label="Password (optional)"
            hint="Leave it empty and they are emailed a link to choose their own. Or set one (8+ characters) to tell them in person."
            error={errors.password}
            className="sm:col-span-2"
          >
            <Input
              type="text"
              value={values.password}
              onChange={set('password')}
              placeholder="Leave empty to email an invitation"
            />
          </Field>

          <Field
            label="Countries they handle"
            hint="Comma-separated, e.g. United Kingdom, Ireland"
            error={errors.countries}
            className="sm:col-span-2"
          >
            <Input
              value={values.countries}
              onChange={set('countries')}
              placeholder="United Kingdom, Ireland"
            />
          </Field>

          <Field
            label="Client capacity"
            hint="The workload ceiling used on the dashboard."
            error={errors.maxActiveClients}
          >
            <Input
              type="number"
              value={values.maxActiveClients}
              onChange={set('maxActiveClients')}
              placeholder="60"
            />
          </Field>

          {roles && roles.length > 0 && (
            <Field
              label="Role"
              hint={roles.find((r) => r.id === values.roleId)?.description ?? 'Without one, the consultancy’s defaults apply.'}
              error={errors.roleId}
            >
              <select
                value={values.roleId}
                onChange={(e) => set('roleId')(e.target.value)}
                className="h-10 w-full rounded-lg border border-line-strong bg-paper px-3 text-[14px] text-ink-900"
              >
                <option value="">No role - consultancy defaults</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add to the team'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-[13px] font-medium text-ink-700">
        {label}
        {required && <span className="text-bad-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-ink-400">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-md border border-line-strong bg-paper px-3 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500"
    />
  );
}
