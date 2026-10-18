import type { DriveDocumentView, UploadSessionView } from '@crm/shared';
import { compressIfNeeded } from './compress';

/** Where a file goes and what it is. Any of these may be left out. */
export interface UploadTarget {
  clientId?: string;
  caseId?: string;
  folderId?: string;
  typeKey?: string;
  replacesId?: string;
  expiresOn?: string;
  issuedOn?: string;
}

export interface UploadProgress {
  phase: 'preparing' | 'uploading' | 'finishing';
  /** 0-100. */
  percent: number;
  /** Set when a photo was made smaller before sending. */
  reducedFrom?: number;
}

export class UploadError extends Error {}

/** Files above this go up in chunks that survive a dropped connection. */
const SINGLE_REQUEST_MAX = 4 * 1024 * 1024;
const RETRIES = 4;

/**
 * Sends one file to the drive, the way that suits its size.
 *
 * Photos are made smaller in the browser first (a 7 MB passport photo lands
 * at a few hundred KB). Small files go in one request with a real progress
 * bar. Large ones go in 2 MB chunks: each chunk is retried with backoff, and
 * an interrupted upload - a dropped connection, a closed tab - picks up from
 * the last chunk the server has rather than starting again.
 */
export async function uploadToDrive(
  original: File,
  target: UploadTarget,
  onProgress: (p: UploadProgress) => void,
): Promise<DriveDocumentView> {
  onProgress({ phase: 'preparing', percent: 0 });
  const file = await compressIfNeeded(original);
  const reducedFrom = file.size < original.size ? original.size : undefined;
  if (file.size <= SINGLE_REQUEST_MAX) return single(file, target, (percent) => onProgress({ phase: 'uploading', percent, reducedFrom }));
  return chunked(file, target, (percent) => onProgress({ phase: percent >= 100 ? 'finishing' : 'uploading', percent, reducedFrom }));
}

function single(file: File, target: UploadTarget, onPercent: (n: number) => void): Promise<DriveDocumentView> {
  const form = new FormData();
  form.set('file', file);
  for (const [k, v] of Object.entries(target)) if (v) form.set(k, v);
  return new Promise((resolve, reject) => {
    // XHR rather than fetch: it reports upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drive/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPercent(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText) as DriveDocumentView);
      reject(new UploadError(errorText(xhr.responseText, xhr.status)));
    };
    xhr.onerror = () => reject(new UploadError('Could not reach the server. Check your connection and try again.'));
    xhr.send(form);
  });
}

async function chunked(file: File, target: UploadTarget, onPercent: (n: number) => void): Promise<DriveDocumentView> {
  const resumeKey = `upload:${file.name}:${file.size}:${file.lastModified}:${target.folderId ?? target.caseId ?? target.clientId ?? ''}`;
  let session: UploadSessionView | null = null;

  // An upload of this same file that was cut off: carry on from it.
  const saved = safeGet(resumeKey);
  if (saved) {
    const res = await fetch(`/api/drive/uploads/${saved}`).catch(() => null);
    if (res?.ok) session = (await res.json()) as UploadSessionView;
  }
  if (!session) {
    const res = await fetch('/api/drive/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, size: file.size, ...target }),
    });
    if (!res.ok) throw new UploadError(errorText(await res.text(), res.status));
    session = (await res.json()) as UploadSessionView;
    safeSet(resumeKey, session.id);
  }

  let received = session.received;
  onPercent(Math.round((received / file.size) * 100));
  while (received < file.size) {
    const part = file.slice(received, received + session.chunkSize);
    received = await putChunk(session.id, received, part);
    onPercent(Math.min(99, Math.round((received / file.size) * 100)));
  }

  const done = await fetch(`/api/drive/uploads/${session.id}/complete`, { method: 'POST' });
  if (!done.ok) throw new UploadError(errorText(await done.text(), done.status));
  safeRemove(resumeKey);
  onPercent(100);
  return (await done.json()) as DriveDocumentView;
}

/** One chunk, retried with backoff; returns how much the server now has. */
async function putChunk(id: string, offset: number, part: Blob): Promise<number> {
  let lastError = 'Upload interrupted.';
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(`/api/drive/uploads/${id}?offset=${offset}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: part,
      });
      const body = (await res.json().catch(() => null)) as { received?: number; message?: string } | null;
      // The server says where it is - follow it, whether ahead or behind.
      if (typeof body?.received === 'number' && (res.ok || res.status === 400)) {
        if (res.ok || body.received !== offset) return body.received;
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new UploadError(body?.message ?? 'The upload was refused.');
      lastError = body?.message ?? lastError;
    } catch (err) {
      if (err instanceof UploadError) throw err;
      lastError = 'The connection dropped. Retrying…';
    }
    await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
  }
  throw new UploadError(`${lastError} Try again - the upload will continue where it stopped.`);
}

function errorText(raw: string, status: number): string {
  try {
    const body = JSON.parse(raw) as { message?: string; fieldErrors?: Record<string, string> };
    return body.fieldErrors?.file ?? body.message ?? `Upload failed (${status}).`;
  } catch {
    return status === 413 ? 'That file is too large.' : `Upload failed (${status}).`;
  }
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: resuming just will not survive a reload */
  }
}
function safeRemove(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    /* nothing to do */
  }
}
