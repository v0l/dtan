import { unwrap } from "@snort/shared";
import { NoteCollection, RequestBuilder, TaggedNostrEvent, parseNostrLink } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { useLocation, useParams } from "react-router-dom";
import { FormatBytes, TorrentKind } from "../const";
import { ProfileImage } from "../element/profile-image";
import { MagnetLink } from "../element/magnet";

export function TorrentPage() {
  const location = useLocation();
  const { id } = useParams();
  const evState = "kind" in location.state ? (location.state as TaggedNostrEvent) : undefined;

  const rb = new RequestBuilder("torrent:event");
  rb.withFilter()
    .kinds([TorrentKind])
    .link(parseNostrLink(unwrap(id)));

  const evNew = useRequestBuilder(NoteCollection, evState ? null : rb);

  const ev = evState ?? evNew.data?.at(0);
  if (!ev) return;
  return <TorrentDetail item={ev} />;
}

export function TorrentDetail({ item }: { item: TaggedNostrEvent }) {
  const name = item.tags.find((a) => a[0] === "title")?.at(1);
  const size = Number(item.tags.find((a) => a[0] === "size")?.at(1));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center text-xl">
        <ProfileImage pubkey={item.pubkey} />
        {name}
      </div>
      <div className="flex flex-col gap-1 bg-slate-700 p-2 rounded">
        <div>Size: {FormatBytes(size)}</div>
        <div>Uploaded: {new Date(item.created_at * 1000).toLocaleDateString()}</div>
        <div>
          <MagnetLink item={item} className="flex gap-1 items-center">
            Get this torrent
          </MagnetLink>
        </div>
      </div>
      <h3>Description</h3>
      <pre className="font-mono text-xs bg-slate-700 p-2 rounded overflow-y-auto">{item.content}</pre>
    </div>
  );
}
