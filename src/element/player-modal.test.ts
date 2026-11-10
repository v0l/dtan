/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { PLAYER_ORIGIN, toBase64 } from "./player-modal";

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe("toBase64", () => {
  test("round-trips a payload with a unicode title and filename", () => {
    const json = JSON.stringify({ magnet: "magnet:?xt=urn:btih:aa", path: "日本語のファイル.mkv" });
    expect(decode(toBase64(json))).toBe(json);
  });

  test("plain btoa on the same payload throws, which is what used to break the render", () => {
    const json = JSON.stringify({ path: "日本語のファイル.mkv" });
    expect(() => btoa(json)).toThrow();
  });

  test("stays standard base64 so the player can still decode it", () => {
    expect(toBase64("abc")).toBe("YWJj");
  });

  test("the player origin is a single https origin with no path", () => {
    // `frame-src` in the CSP names an origin; anything else (a path, http, a
    // trailing slash) silently stops matching and the player never loads.
    const url = new URL(PLAYER_ORIGIN);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(PLAYER_ORIGIN);
    expect(url.pathname).toBe("/");
    expect(PLAYER_ORIGIN).not.toContain("#");
  });

  test("round-trips a payload the size of a long Japanese title", () => {
    // The fragment carries the whole JSON, so the encoder has to cope with real
    // listing titles rather than a toy string (each character is 3 UTF-8 bytes).
    const path = "あ".repeat(20_000) + ".mkv";
    const json = JSON.stringify({ magnet: `magnet:?xt=urn:btih:${"a".repeat(40)}`, path });
    // Measure bytes, not UTF-16 units: each character is 3 bytes of payload.
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(50_000);
    expect(decode(toBase64(json))).toBe(json);
  });
});
