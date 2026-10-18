'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import type { TenantDetail } from '@crm/shared';
import { BrandMark } from '../brand-mark';
import { Button, Card } from '../ui';
import { callApi, ColorInput, Field, FormAlert, TextInput } from './form';

/**
 * How the consultancy presents itself: its name, colour, logo and the contact
 * details shown to clients who cannot sign in. Everything here is visible to
 * anyone who opens the consultancy's address, so nothing private belongs here.
 */
export function TenantBranding({
  tenant,
  base = `/api/admin/tenants/${tenant.id}`,
}: {
  tenant: Pick<TenantDetail, 'id' | 'name' | 'primaryColor' | 'contactEmail' | 'contactPhone' | 'logoUrl'>;
  /** The API prefix: the admin route by default, /api/tenancy/branding for the consultancy's own manager. */
  base?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [v, setV] = useState({
    name: tenant.name,
    primaryColor: tenant.primaryColor ?? '',
    contactEmail: tenant.contactEmail ?? '',
    contactPhone: tenant.contactPhone ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'logo'>(null);

  const set = (k: keyof typeof v) => (value: string) => setV((p) => ({ ...p, [k]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    setBusy('save');
    const res = await callApi<TenantDetail>(base, {
      method: 'PATCH',
      json: {
        name: v.name.trim(),
        primaryColor: v.primaryColor.trim() || null,
        contactEmail: v.contactEmail.trim() || null,
        contactPhone: v.contactPhone.trim() || null,
      },
    });
    setBusy(null);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      if (res.message) setMessage({ tone: 'bad', text: res.message });
      return;
    }
    setMessage({ tone: 'ok', text: 'Saved. Their portal shows the change on the next page load.' });
    router.refresh();
  }

  async function uploadLogo(file: File) {
    setMessage(null);
    setBusy('logo');
    const form = new FormData();
    form.append('file', file);
    const res = await callApi<TenantDetail>(`${base}/logo`, {
      method: 'POST',
      form,
    });
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) {
      setMessage({ tone: 'bad', text: res.fieldErrors.file ?? res.message ?? 'Upload failed.' });
      return;
    }
    router.refresh();
  }

  async function removeLogo() {
    setMessage(null);
    setBusy('logo');
    const res = await callApi<TenantDetail>(`${base}/logo`, {
      method: 'DELETE',
    });
    setBusy(null);
    if (!res.ok) {
      setMessage({ tone: 'bad', text: res.message ?? 'Could not remove the logo.' });
      return;
    }
    router.refresh();
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">Branding</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-ink-400">
        Shown on the sign-in page, in the menu, in the browser tab, and as the sender of every email.
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-ink-50 p-3.5">
        <BrandMark name={v.name || tenant.name} branding={tenant} size={48} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink-800">Logo</p>
          <p className="text-[12px] text-ink-400">PNG, JPG or WEBP, up to 1 MB. Square works best.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            id={`logo-${tenant.id}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadLogo(f);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {busy === 'logo' ? 'Working…' : tenant.logoUrl ? 'Replace' : 'Upload'}
          </Button>
          {tenant.logoUrl && (
            <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={removeLogo}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={save} noValidate className="space-y-4">
        {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            <TextInput value={v.name} onChange={set('name')} invalid={Boolean(errors.name)} />
          </Field>
          <Field
            label="Brand colour"
            error={errors.primaryColor}
            hint="Leave it empty for the standard blue. Pale colours are darkened on buttons so white text stays readable."
            className="sm:col-span-2"
          >
            <ColorInput
              value={v.primaryColor}
              onChange={set('primaryColor')}
              invalid={Boolean(errors.primaryColor)}
            />
          </Field>
          <Field label="Contact email" hint="Shown on the sign-in page for anyone who is stuck, and used as the reply-to address on emails." error={errors.contactEmail}>
            <TextInput
              type="email"
              value={v.contactEmail}
              onChange={set('contactEmail')}
              invalid={Boolean(errors.contactEmail)}
            />
          </Field>
          <Field label="Contact phone" error={errors.contactPhone}>
            <TextInput
              type="tel"
              value={v.contactPhone}
              onChange={set('contactPhone')}
              invalid={Boolean(errors.contactPhone)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save branding'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
