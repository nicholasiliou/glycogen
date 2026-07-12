/**
 * Resolve a path to a file in /public against Vite's configured base URL.
 *
 * In dev the base is "/" so paths are unchanged; on GitHub Pages the app is
 * served from "/glycogen/", so a bare "/fonts/x.otf" would 404. Always route
 * public asset URLs through this helper.
 */
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
