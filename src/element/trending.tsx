import { RequestBuilder } from "@snort/system";
import { TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "./torrent-list";
import useWoT from "../wot";
import { useMemo, useState } from "react";
import { Button } from "./button";

export function LatestTorrents({ author }: { author?: string }) {
  const sub = new RequestBuilder(`torrents:latest:${author}`);
  sub
    .withFilter()
    .kinds([TorrentKind])
    .authors(author ? [author] : undefined);

  const latest = useRequestBuilder(sub);
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [maxDistance] = useState(2);
  const wot = useWoT();

  const filteredTorrents = useMemo(() => {
    if (!filterEnabled) {
      return latest;
    }
    // Filter by WoT distance
    return latest.filter(torrent => {
      const distance = wot.followDistance(torrent.pubkey);
      return distance <= maxDistance;
    });
  }, [latest, filterEnabled, maxDistance, wot]);

  return (
    <>
      <h2>Latest Torrents</h2>
      <div className="flex items-center gap-2 mb-4">
        <Button
          type={filterEnabled ? "primary" : "secondary"}
          small
          onClick={() => setFilterEnabled(!filterEnabled)}
        >
          {filterEnabled ? "WoT Filter: ON" : "WoT Filter: OFF"}
        </Button>
        {filterEnabled && (
          <span className="text-sm text-neutral-400">
            Filtering by Web of Trust (max distance: {maxDistance})
          </span>
        )}
      </div>
      <TorrentList items={filteredTorrents} />
    </>
  );
}
