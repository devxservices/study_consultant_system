'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { PasswordLinkResult, TenantDetail } from '@crm/shared';
import { SentLink } from '../password-link';
import { Button, Card } from '../ui';
import { callApi, ColorInput, Field, FormAlert, TextInput } from './form';

/** "Global Study Consultants" -> "global-study-consultants", until someone edits it. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * Onboarding: the consultancy and its first manager in one submission. The
 * server creates both in one transaction, so there is no half-made consultancy
 * to clean up if anything fails, and resubmitting is refused rather than
 * duplicated.
 */
export function TenantCreateForm({ platformDomain, trialEndsOn }: { platformDomain: string; trialEndsOn: string }) {
  const router = useRouter();
  const [v, setV] = useState({
    name: '',
    slug: '',
    primaryColor: '',
    contactEmail: '',
    contactPhone: '',
    managerName: '',
    managerEmail: '',
    managerPassword: '',
    trialEndsOn,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<{ id: string; result: PasswordLinkResult } | null>(null);

  const set = (k: keyof typeof v) => (value: string) =>
    setV((prev) => {
      const next = { ...prev, [k]: value };
      if (k === 'name' && !slugTouched) next.slug = slugify(value);
      return next;
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);

    const res = await callApi<TenantDetail & { invite: PasswordLinkResult | null }>('/api/admin/tenants', {
      method: 'POST',
      json: {
        name: v.name.trim(),
        slug: v.slug.trim(),
        primaryColor: v.primaryColor.trim() || undefined,
        contactEmail: v.contactEmail.trim() || undefined,
        contactPhone: v.contactPhone.trim() || undefined,
        manager: {
          fullName: v.managerName.trim(),
          email: v.managerEmail.trim(),
          ...(v.managerPassword ? { password: v.managerPassword } : {}),
        },
        trialEndsOn: v.trialEndsOn || null,
      },
    });

    if (!res.ok || !res.data) {
      setErrors(res.fieldErrors);
      setFormError(res.message);
      setBusy(false);
      return;
    }

    if (res.data.invite) {
      setInvited({ id: res.data.id, result: res.data.invite });
      setBusy(false);
      return;
    }
    router.push(`/admin/tenants/${res.data.id}`);
    router.refresh();
  }

  if (invited) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">{v.name.trim()} is ready</h2>
        <p className="mt-1 text-[13px] text-ink-600">
          {v.managerName.trim()} chooses a password from the link, then signs in with {v.managerEmail.trim()}.
        </p>
        <SentLink result={invited.result} email={v.managerEmail.trim()} name={v.managerName.trim()} />
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => {
              router.push(`/admin/tenants/${invited.id}`);
              router.refresh();
            }}
          >
            Open the consultancy
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}

      <Card className="p-4 sm:p-5">
        <h2 className="mb-4 text-[15px] font-semibold text-ink-950">The consultancy</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2" htmlFor="t-name">
            <TextInput
              id="t-name"
              value={v.name}
              onChange={set('name')}
              placeholder="e.g. Global Study Consultants"
              invalid={Boolean(errors.name)}
            />
          </Field>

          <Field
            label="Address"
            required
            error={errors.slug}
            hint="Permanent - it stays the same when the name changes. They can add their own domain later."
            className="sm:col-span-2"
            htmlFor="t-slug"
          >
            <TextInput
              id="t-slug"
              value={v.slug}
              onChange={(value) => {
                setSlugTouched(true);
                set('slug')(value.toLowerCase());
              }}
              placeholder="global-study"
              suffix={`.${platformDomain}`}
              invalid={Boolean(errors.slug)}
            />
          </Field>

          <Field
            label="Brand colour"
            error={errors.primaryColor}
            hint="Used for buttons and highlights. Leave empty for the default graphite."
            htmlFor="t-color"
          >
            <ColorInput
              value={v.primaryColor}
              onChange={set('primaryColor')}
              invalid={Boolean(errors.primaryColor)}
            />
          </Field>

          <div className="hidden sm:block" />

          <Field label="Contact email" error={errors.contactEmail} hint="Shown to clients who cannot sign in.">
            <TextInput
              type="email"
              value={v.contactEmail}
              onChange={set('contactEmail')}
              placeholder="hello@example.com"
              invalid={Boolean(errors.contactEmail)}
            />
          </Field>

          <Field label="Contact phone" error={errors.contactPhone}>
            <TextInput
              type="tel"
              value={v.contactPhone}
              onChange={set('contactPhone')}
              placeholder="+92 42 111 222 333"
              invalid={Boolean(errors.contactPhone)}
            />
          </Field>

          <Field
            label="Free trial until"
            error={errors.trialEndsOn}
            hint="The last day before payment is due. Leave it empty for no end date; record payments on the consultancy’s page."
          >
            <TextInput type="date" value={v.trialEndsOn} onChange={set('trialEndsOn')} invalid={Boolean(errors.trialEndsOn)} />
          </Field>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">Their first manager</h2>
        <p className="mb-4 mt-0.5 text-[12.5px] text-ink-400">
          Signs in at the address above and adds the rest of the team.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errors['manager.fullName']} className="sm:col-span-2">
            <TextInput
              value={v.managerName}
              onChange={set('managerName')}
              placeholder="e.g. Sara Malik"
              invalid={Boolean(errors['manager.fullName'])}
            />
          </Field>
          <Field label="Email address" required error={errors['manager.email']}>
            <TextInput
              type="email"
              value={v.managerEmail}
              onChange={set('managerEmail')}
              placeholder="manager@example.com"
              invalid={Boolean(errors['manager.email'])}
            />
          </Field>
          <Field
            label="Password (optional)"
            error={errors['manager.password']}
            hint="Leave it empty and they are emailed a link to choose their own."
          >
            <TextInput
              value={v.managerPassword}
              onChange={set('managerPassword')}
              placeholder="Leave empty to email an invitation"
              invalid={Boolean(errors['manager.password'])}
            />
          </Field>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create consultancy'}
        </Button>
      </div>
    </form>
  );
}
