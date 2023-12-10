import { unwrap } from "@snort/shared";
import { NostrLink, NoteCollection, RequestBuilder, TaggedNostrEvent, parseNostrLink } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { FormatBytes, TorrentKind } from "../const";
import { ProfileImage } from "../element/profile-image";
import { MagnetLink } from "../element/magnet";
import { useLogin } from "../login";
import { Button } from "../element/button";
import { Comments } from "../element/comments";
import { useMemo } from "react";
import RichTextContent from "../element/rich-text-content";

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

  const files = item.tags.filter((a) => a[0] === "file");
  const size = useMemo(() => files.map((a) => Number(a[2])).reduce((acc, v) => (acc += v), 0), [files]);
  const sortedFiles = useMemo(() => files.sort((a, b) => (a[1] < b[1] ? -1 : 1)), [files]);

  const tags = item.tags.filter((a) => a[0] === "t").map((a) => a[1]);

  async function deleteTorrent() {
    const ev = await login?.builder?.delete(item.id);
    if (ev) {
      await login?.system.BroadcastEvent(ev);
      navigate(-1);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex gap-4 items-center text-xl">
        <ProfileImage pubkey={item.pubkey} />
        {name}
      </div>
      <div className=" bg-neutral-900 p-4 rounded-lg">
        <div className="flex flex-row">
          <div className="flex flex-col gap-2 flex-grow">
            <div>Size: {FormatBytes(size)}</div>
            <div>Uploaded: {new Date(item.created_at * 1000).toLocaleDateString()}</div>
            <div className="flex items-center gap-2">
              Tags:{" "}
              <div className="flex gap-2">
                {tags.map((a) => (
                  <div className="rounded-2xl py-1 px-4 bg-indigo-800 hover:bg-indigo-700">
                    <Link to={`/search/?tags=${a}`}>#{a}</Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <MagnetLink
              item={item}
              className="flex gap-1 items-center px-4 py-3 rounded-full justify-center bg-indigo-800 hover:bg-indigo-700"
            >
              Get this torrent
            </MagnetLink>
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
            <RichTextContent text={item.content}></RichTextContent>
          </pre>
        </>
      )}
      <h3 className="mt-2">Files</h3>
      <div className="file-list flex flex-col gap-1 bg-neutral-900 p-4 rounded-lg">
        <table className="w-max">
          <thead>
            <th>
              <b>Filename</b>
            </th>
            <th>
              <b>Size</b>
            </th>
          </thead>
          {sortedFiles.map((a) => (
            <tr>
              <td className="pr-4">{a[1]}</td>
              <td className="text-neutral-500 font-semibold text-right text-sm">{FormatBytes(Number(a[2]))}</td>
            </tr>
          ))}
        </table>
      </div>
      <h3 className="mt-2">Comments</h3>
      <Comments link={link} />
    </div>
  );
}
