import { cache } from 'react';

export interface RenderClock {
  /** When this server request first read data, in ms since the epoch. */
  at: number;
  /** Unique per render, so the browser can tell a page it has shown before. */
  id: string;
}

/**
 * The moment a page's data reflects.
 *
 * `apiFetch` starts the clock on the request's first read, before any data
 * comes back, so a page stamped with it can never claim to be newer than the
 * data it shows. React's `cache` gives one clock per server request; every
 * component of the same render gets the same answer.
 */
export const renderClock = cache(
  (): RenderClock => ({ at: Date.now(), id: crypto.randomUUID() }),
);
