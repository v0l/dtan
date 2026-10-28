const g = globalThis as Record<string, any>;

const ORIGIN = "http://ssr.local";

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function encode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export class MiniSearchParams {
  private list: [string, string][] = [];

  constructor(init?: string | Record<string, string> | [string, string][] | MiniSearchParams) {
    if (typeof init === "string") {
      for (const part of init.replace(/^\?/, "").split("&")) {
        if (!part) continue;
        const i = part.indexOf("=");
        this.list.push(i < 0 ? [decode(part), ""] : [decode(part.slice(0, i)), decode(part.slice(i + 1))]);
      }
    } else if (init instanceof MiniSearchParams) {
      this.list = init.list.map(([k, v]) => [k, v]);
    } else if (Array.isArray(init)) {
      this.list = init.map(([k, v]) => [String(k), String(v)]);
    } else if (init) {
      this.list = Object.entries(init).map(([k, v]) => [k, String(v)]);
    }
  }

  get(k: string): string | null {
    return this.list.find(([n]) => n === k)?.[1] ?? null;
  }
  getAll(k: string): string[] {
    return this.list.filter(([n]) => n === k).map(([, v]) => v);
  }
  has(k: string): boolean {
    return this.list.some(([n]) => n === k);
  }
  set(k: string, v: string): void {
    const i = this.list.findIndex(([n]) => n === k);
    if (i < 0) this.list.push([k, String(v)]);
    else this.list = [...this.list.slice(0, i), [k, String(v)], ...this.list.slice(i + 1).filter(([n]) => n !== k)];
  }
  append(k: string, v: string): void {
    this.list.push([k, String(v)]);
  }
  delete(k: string): void {
    this.list = this.list.filter(([n]) => n !== k);
  }
  forEach(fn: (v: string, k: string) => void): void {
    this.list.forEach(([k, v]) => fn(v, k));
  }
  keys(): IterableIterator<string> {
    return this.list.map(([k]) => k)[Symbol.iterator]();
  }
  values(): IterableIterator<string> {
    return this.list.map(([, v]) => v)[Symbol.iterator]();
  }
  entries(): IterableIterator<[string, string]> {
    return this.list[Symbol.iterator]();
  }
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
  toString(): string {
    return this.list.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&");
  }
}

export class MiniURL {
  protocol = "http:";
  host = "ssr.local";
  pathname = "/";
  search = "";
  hash = "";
  searchParams: MiniSearchParams;
  private opaque = false;

  constructor(input: string, base?: string) {
    let rest = input;
    const scheme = /^([a-z][a-z0-9+.-]*:)(\/\/)?(.*)$/is.exec(input);
    if (scheme && scheme[2]) {
      const m = /^([^/?#]*)(.*)$/s.exec(scheme[3])!;
      this.protocol = scheme[1].toLowerCase();
      this.host = m[1];
      rest = m[2] || "/";
    } else if (scheme) {
      this.protocol = scheme[1].toLowerCase();
      this.host = "";
      this.opaque = true;
      rest = scheme[3];
    } else {
      const b = new MiniURL(base ?? ORIGIN);
      this.protocol = b.protocol;
      this.host = b.host;
      if (rest.startsWith("//")) {
        const m = /^\/\/([^/?#]*)(.*)$/s.exec(rest)!;
        this.host = m[1];
        rest = m[2] || "/";
      } else if (!rest.startsWith("/")) {
        rest = b.pathname.replace(/[^/]*$/, "") + rest;
      }
    }
    const h = rest.indexOf("#");
    if (h >= 0) {
      this.hash = rest.slice(h);
      rest = rest.slice(0, h);
    }
    const q = rest.indexOf("?");
    if (q >= 0) {
      this.search = rest.slice(q) === "?" ? "" : rest.slice(q);
      rest = rest.slice(0, q);
    }
    this.pathname = this.opaque ? rest : rest || "/";
    this.searchParams = new MiniSearchParams(this.search);
  }

  get origin(): string {
    return this.opaque ? "null" : `${this.protocol}//${this.host}`;
  }
  get href(): string {
    const qs = this.searchParams.toString();
    const head = this.opaque ? this.protocol : `${this.origin}`;
    return `${head}${this.pathname}${qs ? "?" + qs : ""}${this.hash}`;
  }
  toString(): string {
    return this.href;
  }
}

class MiniTextEncoder {
  encoding = "utf-8";
  encode(s = ""): Uint8Array {
    const out: number[] = [];
    for (const ch of s) {
      let c = ch.codePointAt(0)!;
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }
  encodeInto(s: string, dest: Uint8Array) {
    const bytes = this.encode(s);
    const n = Math.min(bytes.length, dest.length);
    dest.set(bytes.subarray(0, n));
    return { read: s.length, written: n };
  }
}

class MiniTextDecoder {
  encoding = "utf-8";
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return "";
    const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let out = "";
    for (let i = 0; i < b.length; ) {
      const c = b[i++];
      let cp = c;
      if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      else if (c >= 0xe0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      else if (c >= 0xc0) cp = ((c & 31) << 6) | (b[i++] & 63);
      out += String.fromCodePoint(cp);
    }
    return out;
  }
}

function forward(level: string) {
  return (...args: unknown[]) => {
    if (typeof g.hostLog === "function") {
      g.hostLog(level, args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(" "));
    }
  };
}

if (typeof g.console === "undefined") {
  g.console = { log: forward("log"), info: forward("info"), debug: () => undefined, warn: forward("warn"), error: forward("error") };
}
if (typeof g.URL !== "function") g.URL = MiniURL;
if (typeof g.URLSearchParams !== "function") g.URLSearchParams = MiniSearchParams;
if (typeof g.TextEncoder !== "function") g.TextEncoder = MiniTextEncoder;
if (typeof g.TextDecoder !== "function") g.TextDecoder = MiniTextDecoder;
if (typeof g.setTimeout !== "function") {
  let id = 0;
  g.setTimeout = () => ++id;
  g.setInterval = () => ++id;
  g.clearTimeout = () => undefined;
  g.clearInterval = () => undefined;
}
if (typeof g.queueMicrotask !== "function") g.queueMicrotask = (fn: () => void) => Promise.resolve().then(fn);
if (typeof g.performance !== "object") g.performance = { now: () => Date.now() };

if (typeof g.MessageChannel !== "function") {
  g.MessageChannel = class {
    port1 = { onmessage: null as null | (() => void), postMessage: () => undefined, close: () => undefined };
    port2 = { postMessage: () => undefined, close: () => undefined };
  };
}

if (typeof g.crypto !== "object" || typeof g.crypto.getRandomValues !== "function") {
  g.crypto = {
    getRandomValues: (a: Uint8Array) => {
      for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      return a;
    },
    randomUUID: () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? Math.random() * 16 : 8 + Math.random() * 4) | 0).toString(16)),
  };
}

export function setServerLocation(url: string): void {
  const u = new MiniURL(url, ORIGIN);
  g.location = { origin: ORIGIN, protocol: "http:", host: "ssr.local", hostname: "ssr.local", pathname: u.pathname, search: u.search, href: u.href, hash: "" };
}
