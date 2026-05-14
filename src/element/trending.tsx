import { useMemo } from "react";
import { TorrentTag } from "../nostr-torrent";
import { EventKind, Nip10, RequestBuilder } from "@snort/system";
import { SSRKeepAlive, TorrentCommentKind, TorrentKind } from "../const";
import { useRequestBuilder } from "@snort/system-react";
import { dedupe, removeUndefined } from "@snort/shared";
import { TorrentList } from "./torrent-list";

export default function TrendingTorrents({ tag }: { tag: TorrentTag }) {
  const rbReactions = useMemo(() => {
    const rb = new RequestBuilder(`trending:${tag.type}:${tag.value}`).withOptions({ keepAlive: SSRKeepAlive });
    rb.withFilter()
      .kinds([TorrentCommentKind, EventKind.ZapReceipt, EventKind.Reaction, EventKind.Repost])
      .tag("K", [TorrentKind.toString()]);
    return rb;
  }, [tag]);

  const dataReactions = useRequestBuilder(rbReactions);

  const eventIds = dedupe(
    removeUndefined(dataReactions.map((e) => e.tags.find((z) => z[0] === "e" || z[0] === "E")?.[1])),
  ).map((a) => {
    const reactions = dataReactions.filter((r) => r.tags.find((t) => t[0] === "e")?.[1] === a).length;
    return {
      id: a,
      reactions,
    };
  });
  const rbTorrents = useMemo(() => {
    const rb = new RequestBuilder(`trending:${tag.type}:${tag.value}:data`).withOptions({ keepAlive: SSRKeepAlive });
    eventIds.sort((a, b) => (b.reactions > a.reactions ? 1 : -1));
    const fx = rb
      .withFilter()
      .ids(eventIds.slice(0, 20).map((a) => a.id))
      .kinds([TorrentKind]);
    if (tag.type === "generic") {
      fx.tag("t", [tag.value]);
    } else {
      fx.tag("i", [`${tag.type}:${tag.value}`]);
    }
    return rb;
  }, [eventIds]);

  const dataTopEvents = useRequestBuilder(rbTorrents);

  return <TorrentList items={dataTopEvents} showAll={true} />;
}
