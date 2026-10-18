import { UPLOAD_LIMITS } from '@crm/shared';

/**
 * Shrink a photo in the browser before uploading it.
 *
 * Clients photograph documents on phones, where a single passport page is
 * routinely 6-8 MB. Sending that over a Pakistani mobile connection is slow
 * and sometimes fails outright, so anything large is downscaled to a size a
 * consultant can still read comfortably.
 *
 * PDFs and small images are returned untouched - re-encoding a scan that is
 * already small only makes it worse.
 */
export async function compressIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= UPLOAD_LIMITS.compressImagesOverBytes) return file;
  // HEIC cannot be decoded by most browsers; send it as-is and let the server
  // keep the original rather than producing a broken blank image.
  if (file.type === 'image/heic') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_LIMITS.maxImageDimension / Math.max(bitmap.width, bitmap.height));

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    // Any failure here just means we upload the original.
    return file;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
