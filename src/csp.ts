/**
 * The Content-Security-Policy in one place.
 *
 * The Docker image sends this as a header (`docker/nginx.conf`). The nsite and
 * Blossom copies are static uploads that cannot set headers, so the build injects
 * the same policy as a `<meta>` tag. Two directives are deliberately absent from
 * the meta copy because a `<meta>` CSP cannot express them; nginx is their only
 * source. `src/csp.test.ts` fails if the two copies drift.
 */
export const CSP_DIRECTIVES: ReadonlyArray<readonly [name: string, value: string]> = [
  ["default-src", "'self'"],
  ["script-src", "'self' 'wasm-unsafe-eval'"],
  ["style-src", "'self' 'unsafe-inline'"],
  ["img-src", "'self' data: blob: https:"],
  ["font-src", "'self'"],
  ["connect-src", "'self' https: wss: blob:"],
  ["media-src", "'self' https: blob:"],
  ["worker-src", "'self' blob:"],
  ["manifest-src", "'self'"],
  ["frame-src", "https://wt-player.pages.dev"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
];

/** Directives that only the response header can carry. */
export const CSP_HEADER_ONLY_DIRECTIVES: ReadonlyArray<readonly [name: string, value: string]> = [
  ["frame-ancestors", "'none'"],
  ["upgrade-insecure-requests", ""],
];

function serialize(directives: ReadonlyArray<readonly [string, string]>): string {
  return directives.map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}

/** The policy injected into `index.html` at build time. */
export const CSP = serialize(CSP_DIRECTIVES);

/** The policy nginx must send; equals the meta policy plus the header-only pair. */
export const CSP_FULL = serialize([...CSP_DIRECTIVES, ...CSP_HEADER_ONLY_DIRECTIVES]);
