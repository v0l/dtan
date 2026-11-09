/**
 * Schemes dtan is willing to render as a link.
 *
 * Everything else -- notably `javascript:`, `data:` and `vbscript:` -- is
 * refused. React 19 blocks `javascript:` URLs at runtime, but relying on a
 * single silent guard for the whole content surface is not a great position to
 * be in, especially since the same values reach `href` through markdown.
 */
const AllowedSchemes = ["http", "https", "magnet", "lightning", "nostr"];

/**
 * True when `href` is safe to put in an anchor.
 *
 * In-app (`/e/...`) and in-page (`#fn-1`) references are always allowed. For
 * everything else the scheme is checked against the allowlist. Values with no
 * scheme at all are treated as relative links and allowed.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim().replace(/[\u0000-\u0020]/g, "");
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  // `&colon;` / `&#58;` / `&#x3a;` are decoded to `:` by the HTML parser, so in
  // server-rendered output `javascript&colon;...` arrives as `javascript:...`.
  // Normalise them before looking for a scheme.
  const normalized = trimmed.replace(/&colon;|&#0*58;|&#x0*3a;/gi, ":");
  const scheme = /^([a-z0-9+.-]+):/i.exec(normalized)?.[1]?.toLowerCase();
  return scheme === undefined || AllowedSchemes.includes(scheme);
}
