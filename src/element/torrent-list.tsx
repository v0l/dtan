import "./torrent-list.css";
import { NostrLink, NostrPrefix, TaggedNostrEvent } from "@snort/system";
import { FormatBytes } from "../const";
import { Link } from "react-router-dom";
import { Mention } from "./mention";
import { useMemo } from "react";
import { NostrTorrent } from "../nostr-torrent";
import MagnetIcon from "./icon/magnet";
import useWoT from "../wot";

export function TorrentList({ items }: { items: Array<TaggedNostrEvent> }) {
  return (
    <table className="torrent-list mb-8">
      <thead>
        <tr className="h-8">
          <th className="rounded-tl-lg">Category</th>
          <th>Name</th>
          <th>Uploaded</th>
          <th></th>
          <th>Size</th>
          <th className="rounded-tr-lg">From</th>
        </tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <TorrentTableEntry item={a} key={a.id} />
        ))}
      </tbody>
    </table>
  );
}

function TagList({ torrent }: { torrent: NostrTorrent }) {
  return torrent.categoryPath
    .slice(0, 3)
    .map((current, index, allTags) => <TagListEntry key={current} tags={allTags} startIndex={index} tag={current} />);
}

function TagListEntry({ tags, startIndex, tag }: { tags: string[]; startIndex: number; tag: string }) {
  const tagUrl = useMemo(() => {
    return encodeURIComponent(tags.slice(0, startIndex + 1).join(","));
  }, [tags, startIndex]);

  return (
    <>
      <Link to={`/search/?tags=${tagUrl}`}>{tag}</Link>
      {tags.length !== startIndex + 1 && " > "}
    </>
  );
}

function TorrentTableEntry({ item }: { item: TaggedNostrEvent }) {
  const torrent = NostrTorrent.fromEvent(item);
  const wot = useWoT();
  const followDistance = wot.followDistance(item.pubkey);
  const followedByCount = wot.followedByCount(item.pubkey);

  return (
    <tr className="hover:bg-indigo-800">
      <td className="text-indigo-300">
        <TagList torrent={torrent} />
      </td>
      <td className="break-words">
        <Link to={`/e/${NostrLink.fromEvent(item).encode()}`} state={item}>
          {torrent.title?.trim() || "Untitled"}
        </Link>
      </td>
      <td className="text-neutral-300">{new Date(torrent.publishedAt * 1000).toLocaleDateString()}</td>
      <td>
        <Link to={torrent.magnetLink}>
          <MagnetIcon />
        </Link>
      </td>
      <td className="whitespace-nowrap text-right text-neutral-300">{FormatBytes(torrent.totalSize)}</td>
      <td className="text-indigo-300 whitespace-nowrap break-words text-ellipsis">
        <div className="flex items-center gap-2">
          <Mention link={new NostrLink(NostrPrefix.PublicKey, item.pubkey)} />
          {followDistance < Infinity && (
            <span className="text-xs text-neutral-400" title={`Followed by ${followedByCount} friends`}>
              d:{followDistance}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
