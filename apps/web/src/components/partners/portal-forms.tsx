'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DOCUMENT_META, DOCUMENT_TYPES } from '@crm/shared';
import { Button, cx } from '../ui';
import { Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';
import { usePost } from '../use-post';

/** The partner registers a student - with the student's consent. */
export function RegisterStudentForm() {
  const { busy, error, fieldErrors, post, router } = usePost();
  const [f, setF] = useState({
    fullName: '',
    email: '',
    phone: '',
    city: '',
    nationality: 'Pakistani',
    passportNumber: '',
    dateOfBirth: '',
    intendedLevel: '',
    intendedField: '',
    englishTest: '',
    englishScore: '',
    targetCountry: '',
    targetUniversity: '',
    targetProgram: '',
    intake: '',
    notes: '',
  });
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<{ status: string } | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await post<{ status: 'registered' | 'conflict' | 'yours'; clientId?: string }>('/api/partner-portal/students', {
      fullName: f.fullName,
      email: f.email,
      phone: f.phone,
      city: f.city || null,
      nationality: f.nationality || null,
      passportNumber: f.passportNumber || null,
      dateOfBirth: f.dateOfBirth || null,
      intendedLevel: f.intendedLevel || null,
      intendedField: f.intendedField || null,
      englishTest: f.englishTest || null,
      englishScore: f.englishScore || null,
      firstApplication: f.targetCountry ? { targetCountry: f.targetCountry, targetUniversity: f.targetUniversity || null, targetProgram: f.targetProgram || null, intake: f.intake || null } : null,
      notes: f.notes || null,
      consent,
    });
    if (!r) return;
    if (r.status === 'conflict') setResult(r);
    else router.push(`/partner/students/${r.clientId}`);
  }

  if (result?.status === 'conflict') {
    return (
      <div className="space-y-3">
        <FormAlert>
          This student is already known to the consultancy. Your registration has gone to them to decide who the student belongs to - the first to register keeps them unless they decide otherwise. You will be told the outcome.
        </FormAlert>
        <Button variant="secondary" onClick={() => setResult(null)}>
          Register another student
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name (as on the passport)" error={fieldErrors.fullName}>
          <TextInput value={f.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <TextInput type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone" error={fieldErrors.phone}>
          <TextInput value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="City">
          <TextInput value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Nationality">
          <TextInput value={f.nationality} onChange={set('nationality')} />
        </Field>
        <Field label="Passport number" hint="Helps the consultancy recognise the student">
          <TextInput value={f.passportNumber} onChange={set('passportNumber')} />
        </Field>
        <Field label="Date of birth">
          <TextInput type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
        </Field>
        <Field label="Wants to study (level)">
          <SelectInput value={f.intendedLevel} onChange={set('intendedLevel')} placeholder="-" options={['foundation', 'diploma', 'bachelor', 'master', 'phd'].map((l) => ({ value: l, label: l[0]!.toUpperCase() + l.slice(1) }))} />
        </Field>
        <Field label="Subject">
          <TextInput value={f.intendedField} onChange={set('intendedField')} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="English test">
            <TextInput value={f.englishTest} onChange={set('englishTest')} placeholder="IELTS" />
          </Field>
          <Field label="Score">
            <TextInput value={f.englishScore} onChange={set('englishScore')} placeholder="6.5" />
          </Field>
        </div>
      </div>
      <div className="rounded-lg border border-line p-4">
        <p className="mb-3 text-[13.5px] font-medium text-ink-900">Their first application (optional)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Country">
            <TextInput value={f.targetCountry} onChange={set('targetCountry')} placeholder="United Kingdom" />
          </Field>
          <Field label="Intake">
            <TextInput value={f.intake} onChange={set('intake')} placeholder="Fall 2026" />
          </Field>
          <Field label="University">
            <TextInput value={f.targetUniversity} onChange={set('targetUniversity')} />
          </Field>
          <Field label="Programme">
            <TextInput value={f.targetProgram} onChange={set('targetProgram')} />
          </Field>
        </div>
      </div>
      <Field label="Anything the consultancy should know">
        <TextArea value={f.notes} onChange={set('notes')} rows={3} />
      </Field>
      <label className="flex items-start gap-2 text-[13px] text-ink-800">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>The student has agreed to their details being shared with the consultancy, which will contact them about their application.</span>
      </label>
      {fieldErrors.consent && <p className="text-[12.5px] text-bad-700">{fieldErrors.consent}</p>}
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy || !consent}>
        {busy ? 'Registering…' : 'Register the student'}
      </Button>
    </form>
  );
}

export function StudentDocUpload({ clientId }: { clientId: string }) {
  const { busy, error, send } = usePost();
  const [type, setType] = useState('passport');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <Field label="Document">
          <SelectInput value={type} onChange={setType} options={DOCUMENT_TYPES.map((t) => ({ value: t, label: DOCUMENT_META[t]?.label ?? t }))} />
        </Field>
      </div>
      <input key={key} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
      <Button
        size="sm"
        disabled={busy || !file}
        onClick={async () => {
          const form = new FormData();
          form.append('type', type);
          form.append('file', file!);
          if (await send(`/api/partner-portal/students/${clientId}/documents`, form)) {
            setFile(null);
            setKey((k) => k + 1);
          }
        }}
      >
        {busy ? 'Uploading…' : 'Upload'}
      </Button>
      {error && <p className="w-full text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

/** A signature drawn with a finger or a mouse, kept as a PNG. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14213d';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={canvas}
        className="h-36 w-full touch-none rounded-lg border border-dashed border-line-strong bg-paper"
        onPointerDown={(e) => {
          drawing.current = true;
          canvas.current!.setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext('2d')!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext('2d')!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drawn.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (drawn.current) onChange(canvas.current!.toDataURL('image/png'));
        }}
        aria-label="Draw your signature"
      />
      <button
        type="button"
        className="mt-1 text-[12px] font-medium text-brand-700 hover:underline"
        onClick={() => {
          const c = canvas.current!;
          c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
          drawn.current = false;
          onChange(null);
        }}
      >
        Clear
      </button>
    </div>
  );
}

export function SignAgreement({ agreementId, defaultName }: { agreementId: string; defaultName: string }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [signerName, setSignerName] = useState(defaultName);
  const [signerTitle, setSignerTitle] = useState('');
  const [kind, setKind] = useState<'typed' | 'drawn'>('typed');
  const [typed, setTyped] = useState('');
  const [drawing, setDrawing] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const signature = kind === 'typed' ? typed : (drawing ?? '');
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your full name" error={fieldErrors.signerName}>
          <TextInput value={signerName} onChange={setSignerName} />
        </Field>
        <Field label="Your position" error={fieldErrors.signerTitle}>
          <TextInput value={signerTitle} onChange={setSignerTitle} placeholder="Director" />
        </Field>
      </div>
      <div className="flex gap-2">
        {(['typed', 'drawn'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', kind === k ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600')}>
            {k === 'typed' ? 'Type my name' : 'Draw my signature'}
          </button>
        ))}
      </div>
      {kind === 'typed' ? (
        <Field label="Type your name exactly as above" error={fieldErrors.signature}>
          <TextInput value={typed} onChange={setTyped} />
          {typed && <p className="mt-2 font-serif text-[24px] italic text-ink-900">{typed}</p>}
        </Field>
      ) : (
        <Field label="Sign in the box" error={fieldErrors.signature}>
          <SignaturePad onChange={setDrawing} />
        </Field>
      )}
      <label className="flex items-start gap-2 text-[13px] text-ink-800">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        <span>I have read this agreement, I agree to it, and I am authorised to sign it for my organisation.</span>
      </label>
      {error && <FormAlert>{error}</FormAlert>}
      <Button disabled={busy || !agree || !signature || signerTitle.trim().length < 2} onClick={() => post(`/api/partner-portal/agreements/${agreementId}/sign`, { signerName, signerTitle, kind, signature, agree })}>
        {busy ? 'Signing…' : 'Sign the agreement'}
      </Button>
      <p className="text-[11.5px] text-ink-400">Your name, the time, your IP address and browser, and a fingerprint of these exact terms are recorded with your signature.</p>
    </div>
  );
}
