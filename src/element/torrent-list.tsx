import "./torrent-list.css";
import { hexToBech32 } from "@snort/shared";
import { NostrLink, TaggedNostrEvent } from "@snort/system";
import { useUserProfile } from "@snort/system-react";
import { FormatBytes } from "../const";
import { Link } from "react-router-dom";
import { MagnetLink } from "./magnet";

export function TorrentList({ items }: { items: Array<TaggedNostrEvent> }) {
  return (
    <table className="torrent-list">
      <thead>
        <tr>
          <th>Category</th>
          <th>Name</th>
          <th>Uploaded</th>
          <th></th>
          <th>Size</th>
          <th>From</th>
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

function TorrentTableEntry({ item }: { item: TaggedNostrEvent }) {
  const profile = useUserProfile(item.pubkey);
  const name = item.tags.find((a) => a[0] === "title")?.at(1);
  const size = item.tags.filter(a => a[0] === "file").map(a => Number(a[2])).reduce((acc, v) => acc += v, 0);
  const npub = hexToBech32("npub", item.pubkey);
  return (
    <tr>
      <td>
        {item.tags
          .filter((a) => a[0] === "t")
          .map((a) => a[1])
          .join(" > ")}
      </td>
      <td>
        <Link to={`/e/${NostrLink.fromEvent(item).encode()}`} state={item}>
          {name}
        </Link>
      </td>
      <td>{new Date(item.created_at * 1000).toLocaleDateString()}</td>
      <td>
        <MagnetLink item={item} />
      </td>
      <td>{FormatBytes(size)}</td>
      <td>
        <Link to={`/p/${npub}`}>{profile?.name ?? npub.slice(0, 12)}</Link>
      </td>
    </tr>
  );
}
