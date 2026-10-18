/** Short, human date: "12 Aug", or "12 Aug 2025" when it is not this year. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '--';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * "today", "3 days ago", "5 weeks ago". Used everywhere a staleness signal
 * matters more than an exact timestamp.
 */
export function relativeDays(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return 'never';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? 'last week' : `${w} weeks ago`;
  }
  const m = Math.floor(days / 30);
  return m === 1 ? 'last month' : `${m} months ago`;
}

export function dayCount(days: number | null | undefined): string {
  if (days === null || days === undefined) return '--';
  if (days === 0) return 'today';
  return `${days}d`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Today as YYYY-MM-DD in this server's time zone (TZ), for comparing with date-only values. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
