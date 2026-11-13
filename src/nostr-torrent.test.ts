/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { NostrEvent } from "@snort/system";
import { leadingZeroBits, NostrTorrent } from "./nostr-torrent";

const HASH = "4cab84031abd94ce892be537d47221f7c4885c88";

function ev(tags: Array<Array<string>>, id = "f".repeat(64), content = ""): NostrEvent {
  return { id, pubkey: "a".repeat(64), created_at: 1_700_000_000, kind: 2003, tags, content, sig: "b".repeat(128) };
}

function magnetParams(magnet: string) {
  return new URLSearchParams(magnet.replace(/^magnet:\?/, ""));
}

describe("fromEvent", () => {
  test("keeps only a well formed info hash", () => {
    expect(NostrTorrent.fromEvent(ev([["x", HASH]])).infoHash).toBe(HASH);
    for (const bad of ["", "abc", "z".repeat(40), HASH + "0", "../../etc/passwd"]) {
      expect(NostrTorrent.fromEvent(ev([["x", bad]])).infoHash).toBe("");
    }
  });

  test("keeps the full value of an i tag", () => {
    // `split(":", 2)` used to yield value "movie", losing the id and the link.
    const t = NostrTorrent.fromEvent(ev([["i", "tmdb:movie:123"]]));
    expect(t.tmdb).toBe("movie:123");
    expect(NostrTorrent.externalDbLink({ type: "tmdb", value: t.tmdb! })).toBe("https://www.themoviedb.org/movie/123");
  });

  test("drops file entries with no usable size", () => {
    const t = NostrTorrent.fromEvent(
      ev([
        ["file", "a.mkv", "100"],
        ["file", "b.mkv", "not-a-number"],
        ["file", "c.mkv", "-5"],
      ]),
    );
    expect(t.files).toEqual([{ name: "a.mkv", size: 100 }]);
  });

  test("reports the lower of the claimed and the real proof of work", () => {
    // id starts with one zero nibble => 4 bits of real work.
    const id = "0" + "f".repeat(63);
    const claimed = NostrTorrent.fromEvent(ev([["nonce", "1", "20"]], id));
    expect(leadingZeroBits(id)).toBe(4);
    expect(claimed.pow).toBe(4);

    const honest = NostrTorrent.fromEvent(ev([["nonce", "1", "2"]], id));
    expect(honest.pow).toBe(2);

    expect(NostrTorrent.fromEvent(ev([["x", HASH]], id)).pow).toBe(0);
  });

  test("ignores a non-integer nonce target", () => {
    const id = "0" + "f".repeat(63);
    // `parseInt("20abc")` used to yield 20; nothing but a full decimal counts.
    expect(NostrTorrent.fromEvent(ev([["nonce", "1", "20abc"]], id)).pow).toBe(0);
  });

  test("normalises an uppercase info hash at ingestion", () => {
    const t = NostrTorrent.fromEvent(ev([["x", HASH.toUpperCase()]]));
    expect(t.infoHash).toBe(HASH);
    expect(magnetParams(t.magnetLink).getAll("xt")).toEqual([`urn:btih:${HASH}`]);
  });
});

describe("magnetLink", () => {
  test("cannot be injected through the title", () => {
    const t = NostrTorrent.fromEvent(ev([["x", HASH], ["title", "thing&tr=http://evil.example/a&xt=urn:btih:dead"]]));
    const params = magnetParams(t.magnetLink);
    expect(params.getAll("tr")).not.toContain("http://evil.example/a");
    expect(params.get("dn")).toBe("thing&tr=http://evil.example/a&xt=urn:btih:dead");
    expect(params.getAll("xt")).toEqual([`urn:btih:${HASH}`]);
  });

  test("omits xt when the info hash is not usable", () => {
    const t = NostrTorrent.fromEvent(ev([["x", "nope"], ["title", "x"]]));
    expect(magnetParams(t.magnetLink).getAll("xt")).toHaveLength(0);
  });

  test("falls back to the default trackers and escapes each one", () => {
    const params = magnetParams(NostrTorrent.fromEvent(ev([["x", HASH]])).magnetLink);
    expect(params.getAll("tr").length).toBeGreaterThan(0);
    expect(params.getAll("tr").every((tr) => /^(https?|udp):\/\//.test(tr))).toBe(true);
  });
});

describe("leadingZeroBits", () => {
  test("counts nibbles and bits", () => {
    expect(leadingZeroBits("f".repeat(64))).toBe(0);
    expect(leadingZeroBits("8" + "f".repeat(63))).toBe(0);
    expect(leadingZeroBits("4" + "f".repeat(63))).toBe(1);
    expect(leadingZeroBits("0" + "f".repeat(63))).toBe(4);
    expect(leadingZeroBits("000" + "f".repeat(61))).toBe(12);
    expect(leadingZeroBits("")).toBe(0);
  });
});
