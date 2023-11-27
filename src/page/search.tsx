import { NoteCollection, RequestBuilder } from "@snort/system";
import { useParams } from "react-router-dom";
import { TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { TorrentList } from "../element/torrent-list";
import { Search } from "../element/search";

export function SearchPage() {
  const params = useParams();
  const term = params.term as string | undefined;

  const rb = new RequestBuilder(`search:${term}`);
  rb.withFilter()
    .kinds([TorrentKind])
    .search(term)
    .limit(100)
    .relay(["wss://relay.nostr.band", "wss://relay.noswhere.com"]);

  const data = useRequestBuilder(NoteCollection, rb);

  return (
    <>
      <Search />
      <h2>Search Results:</h2>
      <TorrentList items={data.data ?? []} />
    </>
  );
}
