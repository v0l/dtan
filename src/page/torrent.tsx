import { unwrap } from "@snort/shared";
import { NostrLink, RequestBuilder, TaggedNostrEvent, parseNostrLink } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { FormatBytes, TorrentKind } from "../const";
import { ProfileImage } from "../element/profile-image";
import { useLogin } from "../login";
import { Button } from "../element/button";
import { Comments } from "../element/comments";
import { Text } from "../element/text";
import { NostrTorrent } from "../nostr-torrent";
import TorrentFileList from "../element/file-tree";
import CopyIcon from "../element/icon/copy";
import MagnetIcon from "../element/icon/magnet";

export function TorrentPage() {
  const location = useLocation();
  const { id } = useParams();
  const evState = location.state && "kind" in location.state ? (location.state as TaggedNostrEvent) : undefined;

  const rb = new RequestBuilder("torrent:event");
  rb.withFilter()
    .kinds([TorrentKind])
    .link(parseNostrLink(unwrap(id)));

  const evNew = useRequestBuilder(evState ? null : rb);

  const ev = evState ?? evNew?.at(0);
  if (!ev) return;
  return <TorrentDetail item={ev} />;
}

export function TorrentDetail({ item }: { item: TaggedNostrEvent }) {
  const login = useLogin();
  const navigate = useNavigate();
  const link = NostrLink.fromEvent(item);
  const torrent = NostrTorrent.fromEvent(item);

  async function deleteTorrent() {
    const ev = await login?.builder?.delete(item.id);
    if (ev) {
      await login?.system.BroadcastEvent(ev);
      navigate(-1);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="text-2xl">{torrent.title}</div>
      <div className="flex flex-col gap-2 bg-neutral-900 p-4 rounded-lg">
        <ProfileImage pubkey={item.pubkey} withName={true} />
        <div className="flex flex-row">
          <div className="flex flex-col gap-2 flex-grow">
            <div>Size: {FormatBytes(torrent.totalSize)}</div>
            <div>Uploaded: {new Date(torrent.publishedAt * 1000).toLocaleString()}</div>
            <div className="flex items-center gap-2">
              Tags:{" "}
              <div className="flex gap-2">
                {torrent.tags.map((a, i) => {
                  if (a.type === "generic") {
                    return (
                      <div key={i} className="rounded-2xl py-1 px-4 bg-indigo-800 hover:bg-indigo-700">
                        <Link to={`/search/?tags=${a.value}`}>#{a.value}</Link>
                      </div>
                    );
                  } else {
                    return (
                      <div key={i} className="rounded-2xl py-1 px-4 bg-indigo-800 hover:bg-indigo-700">
                        <Link to={`/search/?i=${a.type}:${a.value}`}>#{a.value}</Link>
                      </div>
                    );
                  }
                })}
              </div>
            </div>
            {torrent.trackers.length > 0 && <div>Trackers: {torrent.trackers.length}</div>}
          </div>
          <div className="flex flex-col gap-2">
            <Link to={torrent.magnetLink}>
              <Button type="primary" className="flex gap-1 items-center">
                <MagnetIcon />
                Get this torrent
              </Button>
            </Link>
            <Button
              type="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(JSON.stringify(item, undefined, 2));
              }}
              className="flex gap-1 items-center"
            >
              <CopyIcon />
              Copy JSON
            </Button>
            {item.pubkey == login?.publicKey && (
              <Button type="danger" onClick={deleteTorrent}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
      {item.content && (
        <>
          <h3 className="mt-2">Description</h3>
          <pre className="font-mono text-sm bg-neutral-900 p-4 rounded-lg overflow-y-auto">
            <Text content={item.content} tags={item.tags} wrap={false}></Text>
          </pre>
        </>
      )}
      <h3 className="mt-2">Files</h3>
      <div className="flex flex-col gap-1 bg-neutral-900 p-4 rounded-lg">
        <TorrentFileList torrent={torrent} />
      </div>
      <h3 className="mt-2">Comments</h3>
      <Comments link={link} />
    </div>
  );
}
