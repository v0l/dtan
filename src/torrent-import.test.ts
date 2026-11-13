/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { PRIVATE_TORRENT_ERROR, privateTorrentRefusal } from "./torrent-import";

const enc = (s: string) => new TextEncoder().encode(s);

describe("privateTorrentRefusal", () => {
  test("allows a torrent with no private flag", () => {
    expect(privateTorrentRefusal({ info: {} })).toBeUndefined();
    expect(privateTorrentRefusal({ info: { private: undefined } })).toBeUndefined();
  });

  test("allows an explicit integer or string zero", () => {
    expect(privateTorrentRefusal({ info: { private: 0 } })).toBeUndefined();
    expect(privateTorrentRefusal({ info: { private: "0" } })).toBeUndefined();
    expect(privateTorrentRefusal({ info: { private: enc("0") } })).toBeUndefined();
  });

  test("refuses an integer one and the equivalent bencoded strings", () => {
    expect(privateTorrentRefusal({ info: { private: 1 } })).toBe(PRIVATE_TORRENT_ERROR);
    expect(privateTorrentRefusal({ info: { private: "1" } })).toBe(PRIVATE_TORRENT_ERROR);
    expect(privateTorrentRefusal({ info: { private: enc("1") } })).toBe(PRIVATE_TORRENT_ERROR);
  });

  test("fails closed on a flag it cannot read", () => {
    for (const flag of ["yes", true, enc(""), -1, Number.NaN] as unknown[]) {
      expect(privateTorrentRefusal({ info: { private: flag } })).toBe(PRIVATE_TORRENT_ERROR);
    }
  });

  test("a second import is judged on its own flag, not the first one's", () => {
    // Sequential imports: the guard is a pure function of the torrent handed to
    // it, so a refused import cannot influence the next decision.
    expect(privateTorrentRefusal({ info: { private: 1 } })).toBe(PRIVATE_TORRENT_ERROR);
    expect(privateTorrentRefusal({ info: {} })).toBeUndefined();
    expect(privateTorrentRefusal({ info: { private: 1 } })).toBe(PRIVATE_TORRENT_ERROR);
  });
});
