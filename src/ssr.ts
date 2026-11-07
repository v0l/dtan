import type { CachedMetadata, TaggedNostrEvent } from "@snort/system";
import { useEffect } from "react";
import { IsSSR } from "./const";

export interface Head {
  title?: string;
  description?: string;
  path?: string;
  type?: "website" | "article";
  image?: string;
  published?: string;
  modified?: string;
  noindex?: boolean;
}

export interface SsrData {
  queries: Record<string, Array<TaggedNostrEvent>>;
  profiles: Record<string, CachedMetadata>;
  swarm?: SwarmStats;
}

export interface SwarmStats {
  seeds: number;
  leeches: number;
  at: number;
}

export interface SsrState extends SsrData {
  status: number;
  head: Head;
  now: number;
}

declare global {
  function relayQuery(filters: string): string;
  function swarmStats(input: string): string;
}

let current: SsrState | undefined;

export function beginSsr(): SsrState {
  current = { status: 200, head: {}, queries: {}, profiles: {}, now: 0 };
  return current;
}

export function endSsr() {
  current = undefined;
}

export function ssrState() {
  return current;
}

export function setStatus(code: number) {
  if (current) current.status = Math.max(current.status, code);
}

export function setSwarm(swarm: SwarmStats | undefined) {
  if (current) current.swarm = swarm;
}

export function renderNow() {
  return current?.now ?? Math.floor(Date.now() / 1000);
}

export function useHead(head: Head) {
  if (IsSSR && current) {
    current.head = { ...current.head, ...head };
  }
  useEffect(() => {
    document.title = head.title ? `${head.title} | DTAN.XYZ` : "DTAN.XYZ";
  }, [head.title]);
}

let hydration: SsrData | undefined;
let hydrating = false;

export function loadHydration() {
  const el = typeof document !== "undefined" ? document.getElementById("ssr-data") : null;
  if (el?.textContent) {
    hydration = JSON.parse(el.textContent) as SsrData;
    hydrating = true;
  }
}

export function finishHydration() {
  hydrating = false;
}

export function hydratedEvents(id: string) {
  return hydrating ? hydration?.queries[id] : undefined;
}

export function hydratedProfile(pubkey: string) {
  return hydration?.profiles[pubkey];
}

export function hydratedSwarm() {
  return hydration?.swarm;
}
