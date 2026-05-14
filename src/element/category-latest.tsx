import { useMemo } from "react";
import { RequestBuilder } from "@snort/system";
import { SSRKeepAlive, TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "./torrent-list";

interface CategoryLatestTorrentsProps {
  tags: string[];
  title: string;
  limit?: number;
}

export function CategoryLatestTorrents({ tags, title, limit = 10 }: CategoryLatestTorrentsProps) {
  const sub = useMemo(() => {
    const rb = new RequestBuilder(`torrents:latest:${tags.join(":")}`).withOptions({ keepAlive: SSRKeepAlive });
    rb.withFilter().kinds([TorrentKind]).tag("t", tags).limit(limit);
    return rb;
  }, [tags, limit]);

  const latest = useRequestBuilder(sub);
  const limitedResults = useMemo(() => latest.slice(0, limit), [latest, limit]);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xl font-bold">{title}</h3>
      <TorrentList items={limitedResults} showAll={true} />
    </div>
  );
}
