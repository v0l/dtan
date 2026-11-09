/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { toBase64 } from "./player-modal";

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
});
