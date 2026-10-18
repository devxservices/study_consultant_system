/**
 * "Chrome on Windows", "Safari on iPhone" - a browser's user-agent string as a
 * person would describe it. Good enough to spot "that sign-in was not me";
 * the full string is kept in the record for anyone who needs it.
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;

  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser || os) return browser ?? os;
  // Scripts and tools: show their name rather than nothing.
  return ua.split(/[\s/]/)[0]?.slice(0, 40) || null;
}
