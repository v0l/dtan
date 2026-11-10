/**
 * Guard for importing a `.torrent` into the publisher.
 *
 * Kept separate from the page component so the decision logic — which has to cope
 * with bencode handing back either an integer or a single-byte string — can be
 * tested without a DOM.
 */

export const PRIVATE_TORRENT_ERROR =
  "This .torrent is marked private. Its announce URL is usually a personal passkey, and DTAN publishes tracker tags to every relay permanently. Remove the private flag and the private tracker before publishing here.";

/**
 * Read bencode's `info.private` as a number.
 *
 * bencode decodes integers as numbers and strings as `Uint8Array`, so a torrent
 * written with `1:i1e` and one written with `1:1` must be treated the same.
 * Anything unreadable returns `undefined`, which the caller treats as private.
 */
function privateFlag(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const text =
    typeof value === "string" ? value.trim() : value instanceof Uint8Array ? new TextDecoder().decode(value).trim() : undefined;
  if (text === undefined || !/^\d+$/.test(text)) {
    return undefined;
  }
  return Number(text);
}

/**
 * Message to show when an import must be refused, or `undefined` to allow it.
 *
 * Fails closed: a flag that is present but unreadable (`"yes"`, `true`, a
 * non-UTF-8 byte) is treated as private, because the cost of being wrong is a
 * permanently published passkey.
 */
export function privateTorrentRefusal(torrent: { info?: { private?: unknown } }): string | undefined {
  const flag = torrent.info?.private;
  if (flag === undefined) {
    return undefined;
  }
  return privateFlag(flag) === 0 ? undefined : PRIVATE_TORRENT_ERROR;
}
