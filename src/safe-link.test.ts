/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { isSafeHref } from "./safe-link";

describe("isSafeHref", () => {
  test("allows the schemes dtan links to", () => {
    for (const href of [
      "https://dtan.xyz/e/nevent1abc",
      "http://tracker.example/announce",
      "magnet:?xt=urn:btih:4cab84031abd94ce892be537d47221f7c4885c88",
      "lightning:lnbc1...",
      "nostr:nevent1abc",
    ]) {
      expect(isSafeHref(href)).toBe(true);
    }
  });

  test("allows in-app and in-page references", () => {
    for (const href of ["/e/nevent1abc", "/search/?tags=video", "#fn-1"]) {
      expect(isSafeHref(href)).toBe(true);
    }
  });

  test("refuses script and data schemes, including obfuscated ones", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "javascript&colon;alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "",
      "   ",
    ]) {
      expect(isSafeHref(href)).toBe(false);
    }
  });

  test("treats schemeless values as relative links", () => {
    expect(isSafeHref("some/path")).toBe(true);
  });
});
