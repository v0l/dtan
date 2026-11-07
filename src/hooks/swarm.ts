import { useEffect, useState } from "react";
import { IsSSR } from "../const";
import { hydratedSwarm, setSwarm, SwarmStats } from "../ssr";

export type SwarmView = { state: "loading" } | { state: "unavailable" } | ({ state: "ready" } & SwarmStats);

const RefreshMs = 60_000;

function isStats(value: unknown): value is SwarmStats {
  return !!value && typeof value === "object" && typeof (value as SwarmStats).seeds === "number" && typeof (value as SwarmStats).leeches === "number";
}

async function fetchSwarm(infoHash: string, trackers: Array<string>): Promise<SwarmStats | undefined> {
  const query = new URLSearchParams({ info_hash: infoHash, trackers: trackers.filter((t) => /^(https?|udp):/.test(t)).slice(0, 10).join(",") });
  try {
    const rsp = await fetch(`/api/swarm/stats?${query}`);
    const data: unknown = rsp.ok ? await rsp.json() : undefined;
    return isStats(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function initialSwarm(infoHash: string, trackers: Array<string>): SwarmStats | undefined {
  if (!IsSSR) return hydratedSwarm(infoHash);
  try {
    const data: unknown = JSON.parse(swarmStats(JSON.stringify({ info_hash: infoHash, trackers })));
    if (isStats(data)) {
      setSwarm({ [infoHash]: data });
      return data;
    }
  } catch {
    return undefined;
  }
}

export function useSwarmStats(rawInfoHash: string, trackers: Array<string>): SwarmView {
  const infoHash = rawInfoHash.toLowerCase();
  const trackersKey = trackers.join(",");
  const [loaded, setLoaded] = useState<{ infoHash: string; stats?: SwarmStats }>();
  const initial = initialSwarm(infoHash, trackers);

  useEffect(() => {
    if (!infoHash) return;
    let alive = true;
    const refresh = async () => {
      const stats = await fetchSwarm(infoHash, trackersKey.split(",").filter(Boolean));
      if (alive) setLoaded((prev) => (stats || prev?.infoHash !== infoHash ? { infoHash, stats } : prev));
    };
    if (!initial) void refresh();
    const timer = setInterval(refresh, RefreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [infoHash, trackersKey]);

  const current = loaded?.infoHash === infoHash ? loaded : undefined;
  const stats = current?.stats ?? initial;
  if (stats) return { state: "ready", ...stats };
  return { state: current ? "unavailable" : "loading" };
}

const MaxBatch = 100;

async function fetchBatch(infoHashes: Array<string>): Promise<Record<string, SwarmStats>> {
  const query = new URLSearchParams({ info_hash: infoHashes.slice(0, MaxBatch).join(",") });
  try {
    const rsp = await fetch(`/api/swarm/batch?${query}`);
    const data: unknown = rsp.ok ? await rsp.json() : undefined;
    if (!data || typeof data !== "object") return {};
    return Object.fromEntries(Object.entries(data).filter(([, v]) => isStats(v))) as Record<string, SwarmStats>;
  } catch {
    return {};
  }
}

function initialBatch(infoHashes: Array<string>): Record<string, SwarmStats> {
  if (!infoHashes.length) return {};
  if (!IsSSR) {
    const known: Record<string, SwarmStats> = {};
    for (const hash of infoHashes) {
      const stats = hydratedSwarm(hash);
      if (stats) known[hash] = stats;
    }
    return known;
  }
  try {
    const data: unknown = JSON.parse(swarmStatsBatch(JSON.stringify({ info_hashes: infoHashes.slice(0, MaxBatch) })));
    const known = data && typeof data === "object" ? Object.fromEntries(Object.entries(data).filter(([, v]) => isStats(v))) : {};
    setSwarm(known as Record<string, SwarmStats>);
    return known as Record<string, SwarmStats>;
  } catch {
    return {};
  }
}

export function useSwarmBatch(rawInfoHashes: Array<string>): Record<string, SwarmStats> {
  const infoHashes = [...new Set(rawInfoHashes.filter(Boolean).map((h) => h.toLowerCase()))];
  const key = infoHashes.join(",");
  const initial = initialBatch(infoHashes);
  const [fetched, setFetched] = useState<Record<string, SwarmStats>>({});

  useEffect(() => {
    const wanted = key.split(",").filter(Boolean);
    if (!wanted.length) return;
    let alive = true;
    const refresh = async (hashes: Array<string>) => {
      const stats = await fetchBatch(hashes);
      if (alive && Object.keys(stats).length) setFetched((prev) => ({ ...prev, ...stats }));
    };
    void refresh(wanted.filter((h) => !initial[h]));
    const timer = setInterval(() => refresh(wanted), RefreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key]);

  return { ...initial, ...fetched };
}
