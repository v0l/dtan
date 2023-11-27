import "./torrent-list.css";
import { NostrLink, NostrPrefix, TaggedNostrEvent } from "@snort/system";
import { FormatBytes } from "../const";
import { Link } from "react-router-dom";
import { MagnetLink } from "./magnet";
import { Mention } from "./mention";

export function TorrentList({ items }: { items: Array<TaggedNostrEvent> }) {
  return (
    <table className="torrent-list">
      <thead>
        <tr className="bg-slate-600">
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
  const name = item.tags.find((a) => a[0] === "title")?.at(1);
  const size = item.tags
    .filter((a) => a[0] === "file")
    .map((a) => Number(a[2]))
    .reduce((acc, v) => (acc += v), 0);
  return (
    <tr className="hover:bg-slate-800">
      <td>
        {item.tags
          .filter((a) => a[0] === "t")
          .slice(0, 3)
          .map((a, i, arr) => (
            <>
              <Link
                to={`/search/?tags=${encodeURIComponent(
                  arr
                    .slice(0, i + 1)
                    .map((b) => b[1])
                    .join(","),
                )}`}
              >
                {a[1]}
              </Link>
              {arr.length !== i + 1 && " > "}
            </>
          ))}
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
        <Mention link={new NostrLink(NostrPrefix.PublicKey, item.pubkey)} />
      </td>
    </tr>
  );
}
