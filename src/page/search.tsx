import { RequestBuilder } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { SSRKeepAlive, TorrentKind } from "../const";
import { TorrentList } from "../element/torrent-list";
import { useRelays } from "../relays";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import useSearch from "../hooks/search";

export function SearchPage() {
  const { term, tags, labels } = useSearch();
  const { relays } = useRelays();
  const location = useLocation();

  const rb = useMemo(() => {
    const q = location.search;
    const rb = new RequestBuilder(`search:${q}+${term}`).withOptions({ keepAlive: SSRKeepAlive });
    const f = rb
      .withFilter()
      .relay(["wss://relay.noswhere.com", ...relays])
      .kinds([TorrentKind]);
    if (term || tags.length > 0 || labels.length > 0) {
      f.limit(100);
    }
    if (term) {
      f.search(`${term.replaceAll(" ", "+")}*`);
    }
    if (tags.length > 0) {
      f.tag("t", tags);
    }
    if (labels.length > 0) {
      f.tag("i", labels);
    }
    return rb;
  }, [term, tags, labels]);

  const data = useRequestBuilder(rb);

  return (
    <div className="flex flex-col gap-4">
      <h2>Search Results</h2>
      <TorrentList items={data} />
    </div>
  );
}
