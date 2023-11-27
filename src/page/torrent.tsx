import { unwrap } from "@snort/shared";
import { NostrLink, NoteCollection, RequestBuilder, TaggedNostrEvent, parseNostrLink } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FormatBytes, TorrentKind } from "../const";
import { ProfileImage } from "../element/profile-image";
import { MagnetLink } from "../element/magnet";
import { useLogin } from "../login";
import { Button } from "../element/button";
import { Comments } from "../element/comments";

export function TorrentPage() {
  const location = useLocation();
  const { id } = useParams();
  const evState = location.state && "kind" in location.state ? (location.state as TaggedNostrEvent) : undefined;

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
  const login = useLogin();
  const navigate = useNavigate();
  const link = NostrLink.fromEvent(item);
  const name = item.tags.find((a) => a[0] === "title")?.at(1);
  const size = item.tags
    .filter((a) => a[0] === "file")
    .map((a) => Number(a[2]))
    .reduce((acc, v) => (acc += v), 0);
  const files = item.tags.filter((a) => a[0] === "file");
  const tags = item.tags.filter((a) => a[0] === "t").map((a) => a[1]);

  async function deleteTorrent() {
    const ev = await login?.builder?.delete(item.id);
    if (ev) {
      await login?.system.BroadcastEvent(ev);
      navigate(-1);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center text-xl">
        <ProfileImage pubkey={item.pubkey} />
        {name}
      </div>
      <div className="flex flex-col gap-1 bg-slate-700 p-2 rounded">
        <div>Size: {FormatBytes(size)}</div>
        <div>Uploaded: {new Date(item.created_at * 1000).toLocaleDateString()}</div>
        <div className="flex items-center gap-2">
          Tags:{" "}
          <div className="flex gap-1">
            {tags.map((a) => (
              <div className="rounded p-1 bg-slate-400">#{a}</div>
            ))}
          </div>
        </div>
        <div>
          <MagnetLink item={item} className="flex gap-1 items-center">
            Get this torrent
          </MagnetLink>
        </div>
      </div>
      <h3>Description</h3>
      <pre className="font-mono text-xs bg-slate-700 p-2 rounded overflow-y-auto">{item.content}</pre>
      <h3>Files</h3>
      <div className="flex flex-col gap-1 bg-slate-700 p-2 rounded">
        {files.map((a) => (
          <div className="flex items-center gap-2">
            {a[1]}
            <small className="text-slate-500 font-semibold">{FormatBytes(Number(a[2]))}</small>
          </div>
        ))}
      </div>
      {item.pubkey == login?.publicKey && (
        <Button className="bg-red-600 hover:bg-red-800" onClick={deleteTorrent}>
          Delete
        </Button>
      )}
      <h3>Comments</h3>
      <Comments link={link} />
    </div>
  );
}
