'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { localIsoDate, CURRENCIES, DATE_FORMATS, formatMoney, parseBankStatement, parseCsv, parseMoney, type DateFormat, type UnmatchedLedgerLine } from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextInput } from '../forms';
import { Modal } from '../modal';

/**
 * Import a bank statement: pick the CSV, say which column is which, see the
 * first lines read exactly as they will be, then import. Lines already
 * imported are skipped.
 */
export function ImportStatement({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('statement.csv');
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState({ date: '0', description: '1', amount: '2', debit: '', credit: '', reference: '' });
  const [split, setSplit] = useState(false);
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MM-DD');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (csv ? parseCsv(csv) : []), [csv]);
  const headers = rows[0] ?? [];
  const columns = headers.map((h, i) => ({ value: String(i), label: hasHeader ? `${i + 1}. ${h || '(blank)'}` : `Column ${i + 1}` }));
  const input = {
    csv,
    fileName,
    hasHeader,
    dateFormat,
    dateColumn: Number(map.date),
    descriptionColumn: Number(map.description),
    amountColumn: split ? null : Number(map.amount),
    debitColumn: split && map.debit !== '' ? Number(map.debit) : null,
    creditColumn: split && map.credit !== '' ? Number(map.credit) : null,
    referenceColumn: map.reference !== '' ? Number(map.reference) : null,
  };
  const preview = useMemo(() => {
    if (!csv) return null;
    try {
      return parseBankStatement(input);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csv, hasHeader, dateFormat, map, split]);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await callApi<{ imported: number; duplicates: number; errors: { row: number; message: string }[] }>(`/api/finance/bank/${accountId}/import`, { method: 'POST', json: input });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not import it.');
      return;
    }
    setResult(`${res.data.imported} lines imported${res.data.duplicates ? `, ${res.data.duplicates} already there` : ''}${res.data.errors.length ? `, ${res.data.errors.length} unreadable` : ''}.`);
    router.refresh();
  }

  const pick = (k: keyof typeof map, label: string, optional = false) => (
    <Field label={label}>
      <SelectInput value={map[k]} onChange={(v) => setMap((m) => ({ ...m, [k]: v }))} placeholder={optional ? 'None' : undefined} options={columns} />
    </Field>
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>Import statement</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import a bank statement" description="A CSV exported from online banking. Nothing is matched until you say so." wide>
        <div className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setCsv(await f.text());
              setResult(null);
            }}
            className="block w-full text-[13px] text-ink-700"
          />
          {csv && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {pick('date', 'Date column')}
                {pick('description', 'Description column')}
                {pick('reference', 'Reference column', true)}
                {split ? (
                  <>
                    {pick('debit', 'Money out column')}
                    {pick('credit', 'Money in column')}
                  </>
                ) : (
                  pick('amount', 'Amount column (in +, out −)')
                )}
                <Field label="Dates look like">
                  <SelectInput value={dateFormat} onChange={(v) => setDateFormat(v as DateFormat)} options={DATE_FORMATS.map((d) => ({ value: d, label: d }))} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-4 text-[13px] text-ink-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> First row is headings
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Money in and out are separate columns
                </label>
              </div>
              {preview && (
                <div className="rounded-lg border border-line">
                  <p className="border-b border-line px-3 py-2 text-[12.5px] text-ink-500">
                    {preview.lines.length} lines read{preview.errors.length ? `, ${preview.errors.length} unreadable (row ${preview.errors[0]!.row}: ${preview.errors[0]!.message})` : ''}
                  </p>
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {preview.lines.slice(0, 5).map((l) => (
                        <tr key={l.row} className="border-b border-line last:border-0">
                          <td className="tnum px-3 py-1.5 text-ink-500">{l.date}</td>
                          <td className="px-3 py-1.5 text-ink-800">{l.description}</td>
                          <td className={cx('tnum px-3 py-1.5 text-right', l.amount < 0 ? 'text-bad-700' : 'text-ok-700')}>{(l.amount / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {error && <FormAlert>{error}</FormAlert>}
          {result && <FormAlert tone="ok">{result}</FormAlert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button disabled={busy || !preview?.lines.length} onClick={go}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** One unmatched statement line: match it to a ledger line, or book it. */
export function MatchLine({
  lineId,
  amount,
  currency,
  suggestions,
  candidates,
  accounts,
}: {
  lineId: string;
  amount: number;
  currency: string;
  suggestions: string[];
  candidates: UnmatchedLedgerLine[];
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const same = candidates.filter((c) => c.amount === amount);
  const [choice, setChoice] = useState(suggestions[0] ?? '');
  const [booking, setBooking] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (c: UnmatchedLedgerLine) => `${c.memo.slice(0, 48)} · ${c.entryDate.slice(5)}`;

  async function post(url: string, json: unknown) {
    setBusy(true);
    setError(null);
    const res = await callApi(url, { method: 'POST', json });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
    router.refresh();
  }

  if (booking) {
    return (
      <div className="space-y-1.5">
        <SelectInput value={accountId} onChange={setAccountId} placeholder="The other side…" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        <TextInput value={memo} onChange={setMemo} placeholder={amount < 0 ? 'e.g. Bank fee for October' : 'e.g. Interest'} />
        {error && <p className="text-[12px] text-bad-700">{error}</p>}
        <div className="flex gap-1.5">
          <Button size="sm" disabled={busy || !accountId || memo.trim().length < 3} onClick={() => post(`/api/finance/bank/lines/${lineId}/entry`, { accountId, memo: memo.trim() })}>
            Book and match
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBooking(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {same.length > 0 ? (
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <SelectInput value={choice} onChange={setChoice} placeholder={`${same.length} ledger line${same.length === 1 ? '' : 's'} for ${formatMoney(Math.abs(amount), currency)}…`} options={same.map((c) => ({ value: c.lineId, label: `${suggestions.includes(c.lineId) ? '★ ' : ''}${label(c)}` }))} />
          </div>
          <Button size="sm" disabled={busy || !choice} onClick={() => post(`/api/finance/bank/lines/${lineId}/match`, { journalLineId: choice })}>
            Match
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-400">Nothing in the books for this amount.</p>
      )}
      <button type="button" className="text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setBooking(true)}>
        Book it from the statement
      </button>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

/** Count the cash at the end of a day against what the books say. */
export function CashCount({ accounts, baseCurrency }: { accounts: { id: string; name: string }[]; baseCurrency: string }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(localIsoDate());
  const [currency, setCurrency] = useState(baseCurrency);
  const [expected, setExpected] = useState<number | null>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const countedMinor = parseMoney(counted);

  async function check() {
    setError(null);
    const res = await callApi<{ expected: number }>(`/api/finance/day-close/expected?accountId=${accountId}&date=${date}&currency=${currency}`, { method: 'GET' });
    if (!res.ok || !res.data) return setError(res.message ?? 'Could not work it out.');
    setExpected(res.data.expected);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Account">
          <SelectInput value={accountId} onChange={(v) => { setAccountId(v); setExpected(null); }} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
        <Field label="Day">
          <TextInput type="date" value={date} onChange={(v) => { setDate(v); setExpected(null); }} />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={(v) => { setCurrency(v); setExpected(null); }} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
      </div>
      {expected === null ? (
        <Button variant="secondary" onClick={check} disabled={!accountId}>
          What should be there?
        </Button>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-700">
            The books say <span className="tnum font-semibold">{formatMoney(expected, currency)}</span> at the end of {date}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Counted">
              <TextInput value={counted} onChange={setCounted} inputMode="decimal" />
            </Field>
            <Field label="Note" hint="Optional">
              <TextInput value={note} onChange={setNote} />
            </Field>
          </div>
          {countedMinor !== null && countedMinor !== expected && (
            <p className={cx('text-[13px]', countedMinor > expected ? 'text-warn-700' : 'text-bad-700')}>
              {countedMinor > expected ? 'Over' : 'Short'} by {formatMoney(Math.abs(countedMinor - expected), currency)} - booked to “Cash over and short” so the books match the drawer.
            </p>
          )}
          {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
          <Button
            disabled={busy || countedMinor === null}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const res = await callApi('/api/finance/day-close', { method: 'POST', json: { accountId, date, currency, counted: countedMinor, note: note || null } });
              setBusy(false);
              if (!res.ok) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
              setExpected(null);
              setCounted('');
              setNote('');
              router.refresh();
            }}
          >
            Close the day
          </Button>
        </>
      )}
      {expected === null && error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}
