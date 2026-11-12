'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LOGO_MAX_BYTES, LOGO_TYPES, type TenantDetail } from '@crm/shared';
import { BrandLockup, BrandMark } from '../brand-mark';
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
  tenant: Pick<
    TenantDetail,
    'id' | 'name' | 'primaryColor' | 'contactEmail' | 'contactPhone' | 'logoUrl' | 'fullLogoUrl'
  >;
  /** The API prefix: the admin route by default, /api/tenancy/branding for the consultancy's own manager. */
  base?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    name: tenant.name,
    primaryColor: tenant.primaryColor ?? '',
    contactEmail: tenant.contactEmail ?? '',
    contactPhone: tenant.contactPhone ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  // Logo problems are said beside the logos, not down by the form.
  const [logoMessage, setLogoMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'save' | LogoKind>(null);

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

  const logoPath = (kind: LogoKind) => (kind === 'full' ? `${base}/logo/full` : `${base}/logo`);

  async function uploadLogo(kind: LogoKind, file: File) {
    setLogoMessage(null);
    // Said here, before a byte is sent; the server checks all of it again.
    if (file.type && !(LOGO_TYPES as readonly string[]).includes(file.type)) {
      setLogoMessage('Upload a PNG, JPG or WEBP image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoMessage(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Logos can be up to ${LOGO_MAX_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    setBusy(kind);
    const form = new FormData();
    form.append('file', file);
    const res = await callApi<TenantDetail>(logoPath(kind), {
      method: 'POST',
      form,
    });
    setBusy(null);
    if (!res.ok) {
      setLogoMessage(res.fieldErrors.file ?? res.message ?? 'Upload failed.');
      return;
    }
    router.refresh();
  }

  async function removeLogo(kind: LogoKind) {
    setLogoMessage(null);
    setBusy(kind);
    const res = await callApi<TenantDetail>(logoPath(kind), {
      method: 'DELETE',
    });
    setBusy(null);
    if (!res.ok) {
      setLogoMessage(res.message ?? 'Could not remove it.');
      return;
    }
    router.refresh();
  }

  const name = v.name || tenant.name;

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">Branding</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-ink-400">
        Shown on the sign-in page, in the menu, in the browser tab, and as the sender of every email.
      </p>

      {logoMessage && (
        <div className="mb-3">
          <FormAlert tone="bad">{logoMessage}</FormAlert>
        </div>
      )}
      <div className="mb-5 divide-y divide-line rounded-lg border border-line bg-ink-50">
        <LogoRow
          title="Icon"
          hint="The browser tab and the collapsed menu. PNG, JPG or WEBP up to 5 MB, ideally square and at least 256 × 256; empty margins are trimmed and it is centred for you. Without one, your initials on your brand colour are used."
          preview={<BrandMark name={name} branding={tenant} size={44} />}
          uploaded={Boolean(tenant.logoUrl)}
          busy={busy}
          kind="icon"
          onUpload={uploadLogo}
          onRemove={removeLogo}
        />
        <LogoRow
          title="Full logo"
          hint="The open menu and the sign-in page. A wide PNG with a transparent background works best, about 4 × 1 (for example 800 × 200), up to 5 MB; empty margins are trimmed for you. Without one, the icon and your name are shown."
          preview={
            // What the open menu shows today: the upload, or the icon and name standing in.
            <BrandLockup
              name={name}
              branding={tenant}
              markSize={26}
              logoHeight={34}
              className="gap-2"
              nameClassName="line-clamp-2 text-[12px] leading-tight"
            />
          }
          uploaded={Boolean(tenant.fullLogoUrl)}
          busy={busy}
          kind="full"
          onUpload={uploadLogo}
          onRemove={removeLogo}
        />
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
            hint="Leave it empty for the standard orange. Pale colours are darkened on buttons so white text stays readable."
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

type LogoKind = 'icon' | 'full';

/** One of the two logos: its preview, what it is for, and upload / replace / remove. */
function LogoRow({
  title,
  hint,
  preview,
  uploaded,
  busy,
  kind,
  onUpload,
  onRemove,
}: {
  title: string;
  hint: string;
  preview: ReactNode;
  uploaded: boolean;
  busy: null | 'save' | LogoKind;
  kind: LogoKind;
  onUpload: (kind: LogoKind, file: File) => Promise<void>;
  onRemove: (kind: LogoKind) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-start gap-4 p-3.5">
      {/* One size of well for both, so the two rows line up. */}
      <span className="flex h-[72px] w-[148px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-paper px-3">
        {preview}
      </span>
      <div className="min-w-[200px] flex-1">
        <p className="text-[13px] font-medium text-ink-800">{title}</p>
        <p className="text-[12px] leading-relaxed text-ink-400">{hint}</p>
        <div className="mt-2.5 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={LOGO_TYPES.join(',')}
            className="sr-only"
            aria-label={`${title} file`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onUpload(kind, f);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {busy === kind ? 'Working…' : uploaded ? 'Replace' : 'Upload'}
          </Button>
          {uploaded && (
            <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void onRemove(kind)}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
