/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CSP } from "./csp";

/** Split a policy into directive -> value, preserving nothing about order. */
function parse(policy: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of policy.split(";")) {
    const directive = part.trim();
    if (directive.length === 0) continue;
    const split = directive.search(/\s/);
    const name = (split === -1 ? directive : directive.slice(0, split)).toLowerCase();
    const value = split === -1 ? "" : directive.slice(split + 1).trim();
    out.set(name, value);
  }
  return out;
}

const nginxConf = readFileSync(new URL("../docker/nginx.conf", import.meta.url), "utf8");
const headerMatch = /add_header Content-Security-Policy "([^"]+)" always;/.exec(nginxConf);
const header = parse(headerMatch?.[1] ?? "");
const meta = parse(CSP);

describe("CSP: header and meta copies", () => {
  test("nginx actually sends a policy", () => {
    expect(headerMatch).not.toBeNull();
    expect(header.size).toBeGreaterThan(5);
  });

  test("every directive in the meta copy is identical to the header", () => {
    // Drift here is silent and dangerous: the Docker image and the static copies
    // would enforce different policies, and neither would report it.
    for (const [name, value] of meta) {
      expect(header.get(name)).toBe(value);
    }
  });

  test("the only header-only directives are the two a meta cannot carry", () => {
    const headerOnly = [...header.keys()].filter((name) => !meta.has(name)).sort();
    expect(headerOnly).toEqual(["frame-ancestors", "upgrade-insecure-requests"]);
    expect(header.get("frame-ancestors")).toBe("'none'");
  });

  test("the policy does not quietly gain unsafe-eval", () => {
    const tokens = (policy: string | undefined) => (policy ?? "").split(/\s+/).filter(Boolean);
    expect(tokens(header.get("script-src"))).not.toContain("'unsafe-eval'");
    expect(tokens(meta.get("script-src"))).toContain("'wasm-unsafe-eval'");
  });
});
