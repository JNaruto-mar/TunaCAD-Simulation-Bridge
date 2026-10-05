/** Exact browser origins admitted by the native owner. Not authentication. */
export const EXPLICIT_PRODUCTION_ORIGIN = 'https://tunacad.com';
export function isExplicitWorkspaceOrigin(origin: string): boolean {
  if (origin === EXPLICIT_PRODUCTION_ORIGIN) return true;
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return false;
  try { const url = new URL(origin); return url.origin === origin && Number(url.port) > 0; }
  catch { return false; }
}
