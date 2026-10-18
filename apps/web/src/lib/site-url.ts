/** A platform address as a link: plain http on the web server's port in development. */
export function siteUrl(host: string): string {
  return host.endsWith('localhost') ? `http://${host}:3000` : `https://${host}`;
}
