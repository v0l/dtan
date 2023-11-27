import { NoteCollection, RequestBuilder } from "@snort/system";
import { TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "./torrent-list";

export function LatestTorrents() {
  const sub = new RequestBuilder("torrents:latest");
  sub.withFilter().kinds([TorrentKind]).limit(100);

  const latest = useRequestBuilder(NoteCollection, sub);

  return (
    <>
      <h3>Latest Torrents</h3>
      <TorrentList items={latest.data ?? []} />
    </>
  );
}
