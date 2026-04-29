// Single source of truth for Keepr's running version on the JS side.
// Vite injects __KEEPR_VERSION__ from package.json at build time; the
// fallback only matters in unit tests where the define is absent.

export const CURRENT_VERSION: string =
  typeof __KEEPR_VERSION__ !== "undefined" ? __KEEPR_VERSION__ : "0.0.0";

export function isNewer(remote: string, current: string): boolean {
  const r = remote.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true;
    if ((r[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}
