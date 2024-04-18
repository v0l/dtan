import { useMemo } from "react";
import { NostrTorrent } from "../nostr-torrent";
import FolderIcon from "./icon/folder";
import FileIcon from "./icon/file-icon";
import { FormatBytes } from "../const";

interface NodeTree {
  isDir: boolean;
  name: string;
  size: number;
  children: NodeTree[];
}

export default function TorrentFileList({ torrent }: { torrent: NostrTorrent }) {
  const tree = useMemo(() => {
    const ret = {
      isDir: true,
      name: "/",
      size: 0,
      children: [],
    } as NodeTree;

    function addAndRecurse(a: { paths: string[]; size: number }, atNode: NodeTree) {
      if (a.paths.length > 1) {
        const newdir = a.paths.shift()!;
        let existingNode = atNode.children.find((a) => a.name === newdir);
        if (!existingNode) {
          existingNode = {
            isDir: true,
            name: newdir,
            size: 0,
            children: [],
          };
          atNode.children.push(existingNode);
        }
        addAndRecurse(a, existingNode);
      } else {
        atNode.children.push({
          isDir: false,
          name: a.paths[0],
          size: a.size,
          children: [],
        });
      }
    }

    const split = torrent.files
      .map((a) => ({
        size: a.size,
        paths: a.name.split("/"),
      }))
      .sort((a, b) => a.paths.length - b.paths.length);

    split.forEach((a) => addAndRecurse(a, ret));
    return ret;
  }, [torrent]);

  function renderNode(n: NodeTree): React.ReactNode {
    if (n.isDir && n.name === "/") {
      // skip first node and just render children
      return <>{n.children.sort((a) => (a.isDir ? -1 : 1)).map((b) => renderNode(b))}</>;
    } else if (n.isDir) {
      return (
        <>
          <div
            className="pl-1 flex gap-2 cursor-pointer"
            onClick={(e) => {
              // lazy stateless toggle
              e.currentTarget.nextElementSibling?.classList.toggle("hidden");
            }}
          >
            <FolderIcon />
            {n.name}
          </div>
          <div className="pl-4 hidden">{n.children.sort((a) => (a.isDir ? -1 : 1)).map((b) => renderNode(b))}</div>
        </>
      );
    } else {
      return (
        <div className="pl-1 flex justify-between items-center" key={n.name}>
          <div className="flex gap-2">
            <FileIcon />
            {n.name}
          </div>
          <div>{FormatBytes(n.size)}</div>
        </div>
      );
    }
  }

  return <div className="flex flex-col gap-1">{renderNode(tree)}</div>;
}
