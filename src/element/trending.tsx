import { RequestBuilder } from "@snort/system";
import { TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "./torrent-list";
import { WoTFilterToggle } from "./wot-filter-toggle";
import { useWoTFilter } from "../wot-filter";
import useWoT from "../wot";
import { useMemo } from "react";

export function LatestTorrents({ author }: { author?: string }) {
  const sub = new RequestBuilder(`torrents:latest:${author}`);
  sub
    .withFilter()
    .kinds([TorrentKind])
    .authors(author ? [author] : undefined);

  const latest = useRequestBuilder(sub);
  const filter = useWoTFilter();
  const wot = useWoT();

  const filteredTorrents = useMemo(() => {
    if (!filter.enabled) {
      return latest;
    }
    // Filter by WoT distance
    return latest.filter(torrent => {
      const distance = wot.followDistance(torrent.pubkey);
      return distance <= filter.maxDistance;
    });
  }, [latest, filter.enabled, filter.maxDistance, wot]);

  return (
    <>
      <h2>Latest Torrents</h2>
      <WoTFilterToggle />
      <TorrentList items={filteredTorrents} />
    </>
  );
}
