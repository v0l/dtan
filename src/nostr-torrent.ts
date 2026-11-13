import { unixNow } from "@snort/shared";
import { EventExt, NostrEvent, NotSignedNostrEvent, TaggedNostrEvent } from "@snort/system";
import { Trackers } from "./const";

export interface TorrentFile {
  readonly name: string;
  readonly size: number;
}

export interface TorrentTag {
  readonly type: "tcat" | "newznab" | "tmdb" | "ttvdb" | "imdb" | "mal" | "anilist" | "tpb" | "generic" | "nyaa";
  readonly value: string;
}

const InfoHash = /^[0-9a-fA-F]{40}$/;

/** Leading zero bits of a hex string, ie. the NIP-13 difficulty of an event id. */
export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (Number.isNaN(v)) return bits;
    if (v === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(v) - 28;
    break;
  }
  return bits;
}

export class NostrTorrent {
  #event?: TaggedNostrEvent;

  constructor(
    readonly id: string | undefined,
    readonly title: string,
    readonly summary: string,
    readonly infoHash: string,
    readonly publishedAt: number,
    readonly files: Array<TorrentFile>,
    readonly trackers: Array<string>,
    readonly tags: Array<TorrentTag>,
    readonly pow: number,
  ) {}

  get newznab() {
    return this.#getTagValue("newznab");
  }

  get imdb() {
    return this.#getTagValue("imdb");
  }

  get tmdb() {
    return this.#getTagValue("tmdb");
  }

  get ttvdb() {
    return this.#getTagValue("ttvdb");
  }

  get mal() {
    return this.#getTagValue("mal");
  }

  get anilist() {
    return this.#getTagValue("anilist");
  }

  get totalSize() {
    return this.files.reduce((acc, v) => acc + v.size, 0);
  }

  /**
   * Get the category path ie. video->movie->hd
   */
  get categoryPath() {
    const tcat = this.#getTagValue("tcat");
    if (tcat) {
      return tcat.split(",");
    } else {
      // v0: ordered tags before tcat proposal
      const regularTags = this.tags.filter((a) => a.type === "generic").slice(0, 3);
      return regularTags.map((a) => a.value);
    }
  }

  get tcat() {
    return this.categoryPath.join(",");
  }

  get magnetLink() {
    const trackers = this.trackers.length > 0 ? this.trackers : Trackers;

    // `xt` keeps its colons literal: they are legal in a query string and some
    // clients do not percent-decode the urn. Everything else is escaped, so a
    // crafted title or tracker cannot inject extra magnet parameters.
    const parts: Array<string> = [];
    if (this.infoHash.length > 0) {
      parts.push(`xt=${encodeURIComponent(`urn:btih:${this.infoHash}`).replace(/%3A/gi, ":")}`);
    }
    parts.push(`dn=${encodeURIComponent(this.title)}`);
    for (const tracker of trackers) {
      parts.push(`tr=${encodeURIComponent(tracker)}`);
    }
    return `magnet:?${parts.join("&")}`;
  }

  /**
   * Get the URL for a non-generic external reference tag ("i" tag)
   */
  static externalDbLink(tag: TorrentTag) {
    const ts = tag.value.split(":");
    const enc = (s: string) => encodeURIComponent(s);
    switch (tag.type) {
      case "imdb":
        return `https://www.imdb.com/title/${enc(tag.value)}/`;
      case "tmdb": {
        if (ts.length === 2) {
          return `https://www.themoviedb.org/${enc(ts[0])}/${enc(ts[1])}`;
        }
        break;
      }
      case "mal": {
        if (ts.length === 2) {
          return `https://myanimelist.net/${enc(ts[0])}/${enc(ts[1])}`;
        }
        break;
      }
      case "anilist": {
        if (ts.length === 2) {
          return `https://anilist.co/${enc(ts[0])}/${enc(ts[1])}`;
        }
        break;
      }
      case "tpb":
        return `https://thepiratebay.org/description.php?id=${enc(tag.value)}`;
      case "nyaa":
        return `https://nyaa.si/view/${enc(tag.value)}`;
    }
  }

  /**
   * Get the nostr event for this torrent
   */
  toEvent(pubkey?: string) {
    if (this.#event) {
      return this.#event;
    }
    const ret = {
      id: this.id,
      kind: 2003,
      content: this.summary,
      created_at: unixNow(),
      pubkey: pubkey ?? "",
      tags: [
        ["title", this.title],
        ["x", this.infoHash],
      ],
    } as NotSignedNostrEvent;

    for (const file of this.files) {
      ret.tags.push(["file", file.name, String(file.size)]);
    }
    for (const tracker of this.trackers) {
      ret.tags.push(["tracker", tracker]);
    }
    for (const tag of this.tags.filter((a) => a.type === "generic")) {
      ret.tags.push(["t", tag.value]);
    }
    for (const tag of this.tags.filter((a) => a.type !== "generic")) {
      ret.tags.push(["i", `${tag.type}:${tag.value}`]);
    }

    if (ret.id === undefined) {
      ret.id = EventExt.createId(ret);
    }
    return ret;
  }

  #getTagValue(t: TorrentTag["type"]) {
    const tag = this.tags.find((a) => a.type === t);
    return tag?.value;
  }

  static fromEvent(ev: NostrEvent) {
    let infoHash = "";
    let title = "";
    let powTarget = 0;
    const files: Array<TorrentFile> = [];
    const trackers: Array<string> = [];
    const tags: Array<TorrentTag> = [];

    for (const t of ev.tags) {
      const key = t[0];
      if (!t[1]) continue;
      switch (key) {
        case "title": {
          title = t[1];
          break;
        }
        // v0: btih tag
        case "btih":
        case "x": {
          if (InfoHash.test(t[1])) {
            // Canonicalise here, at the single ingestion point. The relay-side
            // `#x` filter and the duplicate marker compare strings exactly, so an
            // event published with an uppercase hash would otherwise not dedupe
            // against the same torrent published lowercase, and the magnet link
            // would inherit whichever case arrived first.
            infoHash = t[1].toLowerCase();
          }
          break;
        }
        case "file": {
          const size = Number(t[2]);
          if (Number.isFinite(size) && size >= 0) {
            files.push({
              name: t[1],
              size,
            });
          }
          break;
        }
        case "tracker": {
          trackers.push(t[1]);
          break;
        }
        case "i": {
          // Not `split(":", 2)`: that drops everything after the second field,
          // so `tmdb:movie:123` used to become value "movie" and lose the id.
          const idx = t[1].indexOf(":");
          if (idx > 0 && idx < t[1].length - 1) {
            tags.push({
              type: t[1].slice(0, idx),
              value: t[1].slice(idx + 1),
            } as TorrentTag);
          }
          break;
        }
        case "t": {
          tags.push({
            type: "generic",
            value: t[1],
          } as TorrentTag);
          break;
        }
        // v0: imdb tag
        case "imdb": {
          tags.push({
            type: "imdb",
            value: t[1],
          });
          break;
        }
        case "nonce": {
          // A full decimal integer only: `parseInt` would accept "20abc" as 20.
          if (typeof t[2] === "string" && /^\d+$/.test(t[2])) {
            powTarget = parseInt(t[2], 10);
          }
          break;
        }
      }
    }

    // NIP-13: the `nonce` tag carries the difficulty the author claims to have
    // reached, but the event id is what actually has to meet it. Report the
    // lower of the two so the badge in torrent-list cannot be inflated by
    // claiming a target the id never satisfied.
    const pow = Math.min(powTarget, leadingZeroBits(ev.id ?? ""));

    let ret = new NostrTorrent(ev.id, title, ev.content, infoHash, ev.created_at, files, trackers, tags, pow);
    ret.#event = ev;
    return ret;
  }
}
