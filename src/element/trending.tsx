import { RequestBuilder } from "@snort/system";
import { TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "./torrent-list";
import { WoTFilterToggle } from "./wot-filter-toggle";
import { useWoT } from "../wot";
import { useMemo } from "react";

export function LatestTorrents({ author }: { author?: string }) {
  const sub = new RequestBuilder(`torrents:latest:${author}`);
  sub
    .withFilter()
    .kinds([TorrentKind])
    .authors(author ? [author] : undefined);

  const latest = useRequestBuilder(sub);
  const wot = useWoT();

  const filteredTorrents = useMemo(() => {
    if (!wot.enabled || wot.trustedPubkeys.size === 0) {
      return latest;
    }
    return latest.filter(torrent => wot.trustedPubkeys.has(torrent.pubkey));
  }, [latest, wot.enabled, wot.trustedPubkeys]);

  return (
    <>
      <h2>Latest Torrents</h2>
      <WoTFilterToggle />
      <TorrentList items={filteredTorrents} />
    </>
  );
}
