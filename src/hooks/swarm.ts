import { IsSSR } from "../const";
import { hydratedSwarm, setSwarm, SwarmStats } from "../ssr";
import { useEffect, useState } from "react";

function fetchSwarm(infoHash: string, trackers: Array<string>): Promise<SwarmStats | undefined> {
  const q = new URLSearchParams({ info_hash: infoHash.toLowerCase(), trackers: trackers.filter((t) => t.startsWith("http")).join(",") });
  return fetch(`/api/swarm/stats?${q}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .then((d) => (d && typeof d.seeds === "number" ? d : undefined))
    .catch(() => undefined);
}

function initialSwarm(infoHash: string, trackers: Array<string>): SwarmStats | undefined {
  if (IsSSR) {
    if (!infoHash) return;
    try {
      const s: unknown = JSON.parse(swarmStats(JSON.stringify({ info_hash: infoHash, trackers })));
      if (s && typeof s === "object" && typeof (s as SwarmStats).seeds === "number") {
        const st = s as SwarmStats;
        setSwarm(st);
        return st;
      }
    } catch {}
    return;
  }
  return hydratedSwarm();
}

export function useSwarmStats(infoHash: string, trackers: Array<string>) {
  const [swarm, set] = useState<SwarmStats | undefined>(() => initialSwarm(infoHash, trackers));
  const hash = infoHash.toLowerCase();
  const trackersKey = trackers.join("|");
  const initial = swarm;
  useEffect(() => {
    if (!hash) return;
    let alive = true;
    const refresh = () => {
      fetchSwarm(hash, trackersKey.split("|").filter(Boolean)).then((s) => {
        if (alive && s) set(s);
      });
    };
    if (!initial) refresh();
    const interval = setInterval(refresh, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, trackersKey]);
  return swarm;
}
