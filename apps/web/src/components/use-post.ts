'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './forms';

/**
 * Sends a change and shows the result: the page it leads to when `then`
 * names one, else this page again. Navigation goes first and the refresh
 * after it - a refresh started first can swallow the navigation.
 */
export function usePost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function post<T = { id?: string }>(
    url: string,
    json: unknown,
    method: 'POST' | 'PUT' = 'POST',
    then?: (data: T) => string | null,
  ): Promise<T | null> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const res = await callApi<T>(url, { method, json });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.fieldErrors);
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
      return null;
    }
    const data = (res.data ?? {}) as T;
    const next = then?.(data);
    if (next) router.push(next);
    router.refresh();
    return data;
  }

  async function send<T = unknown>(url: string, form: FormData): Promise<T | null> {
    setBusy(true);
    setError(null);
    const res = await callApi<T>(url, { method: 'POST', form });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
      return null;
    }
    router.refresh();
    return (res.data ?? {}) as T;
  }

  return { busy, error, fieldErrors, post, send, router, setError };
}
