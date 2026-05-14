import { useMemo } from "react";
import { NostrTorrent } from "../nostr-torrent";
import { RequestBuilder } from "@snort/system";
import { SSRKeepAlive, TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "./torrent-list";

export default function RelatedTorrents({ torrent }: { torrent: NostrTorrent }) {
  const req = useMemo(() => {
    const rb = new RequestBuilder(`torrent-related:${torrent.id}`).withOptions({ keepAlive: SSRKeepAlive });
    rb.withFilter().kinds([TorrentKind]).tag("x", [torrent.infoHash]).limit(5);
    if (torrent.imdb) {
      rb.withFilter()
        .kinds([TorrentKind])
        .tag("i", [`imdb:${torrent.imdb}`])
        .limit(5);
    }
    return rb;
  }, [torrent.id]);
  const data = useRequestBuilder(req).filter((a) => a.id !== torrent.id);

  if (data.length === 0) {
    return;
  }

  return (
    <div className="flex flex-col gap-4 bg-neutral-900 p-4 rounded-lg">
      <h3>Related Torrents</h3>
      <TorrentList items={data} showAll={true} currentInfoHash={torrent.infoHash} />
    </div>
  );
}
