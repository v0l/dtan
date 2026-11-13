/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CSP_FULL } from "./csp";

const ssr = JSON.parse(readFileSync(new URL("../ssr.json", import.meta.url), "utf8"));
const nginx = readFileSync(new URL("../docker/nginx.conf", import.meta.url), "utf8");
const set: Record<string, string> = ssr.headers?.find((r: { prefix: string }) => r.prefix === "/")?.set ?? {};

describe("SSR response headers", () => {
  test("the CSP header equals the policy in csp.ts", () => {
    expect(set["Content-Security-Policy"]).toBe(CSP_FULL);
  });

  test("every hardening header nginx sends is sent by the SSR server too", () => {
    const nginxHeaders = [...nginx.matchAll(/add_header (\S+) "([^"]+)" always;/g)];
    expect(nginxHeaders.length).toBeGreaterThanOrEqual(6);
    for (const [, name, value] of nginxHeaders) {
      expect(set[name]).toBe(value);
    }
  });
});
