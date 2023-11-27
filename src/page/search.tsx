import { NoteCollection, RequestBuilder } from "@snort/system";
import { useLocation, useParams } from "react-router-dom";
import { TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "../element/torrent-list";
import { Search } from "../element/search";

export function SearchPage() {
  const params = useParams();
  const location = useLocation();
  const term = params.term as string | undefined;
  const q = new URLSearchParams(location.search ?? "");
  const tags = q.get("tags")?.split(",") ?? [];

  const rb = new RequestBuilder(`search:${term}+${tags.join(",")}`);
  const f = rb
    .withFilter()
    .kinds([TorrentKind])
    .search(term)
    .limit(100)
    .relay(["wss://relay.nostr.band", "wss://relay.noswhere.com"]);
  if (tags.length > 0) {
    f.tag("t", tags);
  }

  const data = useRequestBuilder(NoteCollection, rb);

  return (
    <div className="flex flex-col gap-2">
      <Search term={term} tags={tags} />
      <h2>Search Results:</h2>
      <TorrentList items={data.data ?? []} />
    </div>
  );
}
