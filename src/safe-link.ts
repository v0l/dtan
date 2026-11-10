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
 * Normalise an `href` and return the value that should be rendered, or
 * `undefined` when it must not become a link.
 *
 * Only surrounding whitespace is trimmed. Whitespace or control characters
 * *inside* the value are refused rather than deleted: deleting them rewrites the
 * URL (`https://ex.com/a b` -> `https://ex.com/ab`) and sends the reader
 * somewhere the author never wrote.
 *
 * `//host/path` is refused. It is protocol-relative, so it leaves the site, and
 * treating it as a relative link was an open redirect hiding behind a check that
 * only looked at the first character.
 */
export function safeHref(href: string): string | undefined {
  const trimmed = href.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (trimmed.length === 0) return undefined;
  if (/[\u0000-\u0020\u007f]/.test(trimmed)) return undefined;
  if (trimmed.startsWith("//")) return undefined;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  // `&colon;` / `&#58;` / `&#x3a;` are decoded to `:` by the HTML parser, so in
  // server-rendered output `javascript&colon;...` arrives as `javascript:...`.
  // Normalise them before looking for a scheme. (React re-escapes `&` in
  // attributes, which already neutralises this class; the check is cheap and does
  // not depend on that behaviour.)
  const normalized = trimmed.replace(/&colon;|&#0*58;|&#x0*3a;/gi, ":");
  const scheme = /^([a-z0-9+.-]+):/i.exec(normalized)?.[1]?.toLowerCase();
  return scheme === undefined || AllowedSchemes.includes(scheme) ? trimmed : undefined;
}

/** True when `href` is safe to put in an anchor. */
export function isSafeHref(href: string): boolean {
  return safeHref(href) !== undefined;
}
