import "./torrent-list.css";
import { NostrLink, NostrPrefix, TaggedNostrEvent } from "@snort/system";
import { FormatBytes } from "../const";
import { Link } from "react-router-dom";
import { MagnetLink } from "./magnet";
import { Mention } from "./mention";
import { useMemo } from "react";

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

function TagList({ tags }: { tags: string[][] }) {
  return tags
    .filter((a) => a[0] === "t")
    .slice(0, 3)
    .map((current, index, allTags) => (
      <TagListEntry key={current[1]} tags={allTags} startIndex={index} tag={current} />
    ));
}

function TagListEntry({ tags, startIndex, tag }: { tags: string[][]; startIndex: number; tag: string[] }) {
  const tagUrl = useMemo(() => {
    return encodeURIComponent(
      tags
        .slice(0, startIndex + 1)
        .map((b) => b[1])
        .join(","),
    );
  }, [tags, startIndex]);

  return (
    <>
      <Link to={`/search/?tags=${tagUrl}`}>{tag[1]}</Link>
      {tags.length !== startIndex + 1 && " > "}
    </>
  );
}

function TorrentTableEntry({ item }: { item: TaggedNostrEvent }) {
  const { name, size } = useMemo(() => {
    const name = item.tags.find((a) => a[0] === "title")?.at(1);
    const size = item.tags
      .filter((a) => a[0] === "file")
      .map((a) => Number(a[2]))
      .reduce((acc, v) => (acc += v), 0);
    return { name, size };
  }, [item]);

  return (
    <tr className="hover:bg-indigo-800">
      <td className="text-indigo-300">
        <TagList tags={item.tags} />
      </td>
      <td className="break-words">
        <Link to={`/e/${NostrLink.fromEvent(item).encode()}`} state={item}>
          {name}
        </Link>
      </td>
      <td className="text-neutral-300">{new Date(item.created_at * 1000).toLocaleDateString()}</td>
      <td>
        <MagnetLink item={item} />
      </td>
      <td className="whitespace-nowrap text-right text-neutral-300">{FormatBytes(size)}</td>
      <td className="text-indigo-300 whitespace-nowrap break-words text-ellipsis">
        <Mention link={new NostrLink(NostrPrefix.PublicKey, item.pubkey)} />
      </td>
    </tr>
  );
}
