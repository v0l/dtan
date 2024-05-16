import { unixNow } from "@snort/shared";
import { EventExt, NostrEvent, NotSignedNostrEvent } from "@snort/system";
import { Trackers } from "./const";

export interface TorrentFile {
  readonly name: string;
  readonly size: number;
}

export interface TorrentTag {
  readonly type: "tcat" | "newznab" | "tmdb" | "ttvdb" | "imdb" | "mal" | "anilist" | "generic";
  readonly value: string;
}

export class NostrTorrent {
  constructor(
    readonly id: string | undefined,
    readonly title: string,
    readonly summary: string,
    readonly infoHash: string,
    readonly publishedAt: number,
    readonly files: Array<TorrentFile>,
    readonly trackers: Array<string>,
    readonly tags: Array<TorrentTag>,
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
    const magnet = {
      xt: `urn:btih:${this.infoHash}`,
      dn: this.title,
      tr: this.trackers,
    };

    // use fallback tracker list if empty
    if (magnet.tr.length === 0) {
      magnet.tr.push(...Trackers);
    }

    const params = Object.entries(magnet)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return v.map((a) => `${k}=${encodeURIComponent(a)}`).join("&");
        } else {
          return `${k}=${v as string}`;
        }
      })
      .flat()
      .filter((a) => a.length > 0)
      .join("&");
    return `magnet:?${params}`;
  }

  /**
   * Get the URL for a non-generic external reference tag ("i" tag)
   */
  static externalDbLink(tag: TorrentTag) {
    const ts = tag.value.split(":");
    switch (tag.type) {
      case "imdb":
        return `https://www.imdb.com/title/${tag.value}/`;
      case "tmdb": {
        if (ts.length === 2) {
          return `https://www.themoviedb.org/${ts[0]}/${ts[1]}`;
        }
        break;
      }
      case "mal": {
        if (ts.length === 2) {
          return `https://myanimelist.net/${ts[0]}/${ts[1]}`;
        }
        break;
      }
      case "anilist": {
        if (ts.length === 2) {
          return `https://anilist.co/${ts[0]}/${ts[1]}`;
        }
        break;
      }
    }
  }

  /**
   * Get the nostr event for this torrent
   */
  toEvent(pubkey?: string) {
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
          infoHash = t[1];
          break;
        }
        case "file": {
          files.push({
            name: t[1],
            size: Number(t[2]),
          });
          break;
        }
        case "tracker": {
          trackers.push(t[1]);
          break;
        }
        case "i": {
          const kSplit = t[1].split(":", 2);
          if (kSplit.length === 2) {
            tags.push({
              type: kSplit[0],
              value: kSplit[1],
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
      }
    }

    return new NostrTorrent(ev.id, title, ev.content, infoHash, ev.created_at, files, trackers, tags);
  }
}
