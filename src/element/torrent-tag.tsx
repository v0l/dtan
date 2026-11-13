import { Link } from "react-router-dom";
import { NostrTorrent, TorrentTag } from "../nostr-torrent";

import IMDB from "../logo/IMDb_logo.svg";
import TPB from "../logo/tpb.jpg";
import Nyaa from "../logo/nyaa.png";
import { ReactNode } from "react";

export function TorrentTagElement({ tag }: { tag: TorrentTag }) {
  function wrap(elm: ReactNode) {
    return (
      <div key={tag.value} className="rounded-2xl py-1 px-4 bg-indigo-800 hover:bg-indigo-700">
        {elm}
      </div>
    );
  }

  function innerLink() {
    switch (tag.type) {
      case "tcat":
        return;
      case "imdb": {
        const url = NostrTorrent.externalDbLink(tag);
        return (
          <a href={url} target="_blank" rel="noopener noreferrer" title={`Open external link: ${url}`}>
            <img src={IMDB} className="h-8" />
          </a>
        );
      }
      case "tpb": {
        const url = NostrTorrent.externalDbLink(tag);
        return wrap(
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex gap-2 items-center" title={`Open external link: ${url}`}>
            <img src={TPB} className="h-6 rounded-full" />
            <span>TPB</span>
          </a>,
        );
      }
      case "nyaa": {
        const url = NostrTorrent.externalDbLink(tag);
        return wrap(
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex gap-2 items-center" title={`Open external link: ${url}`}>
            <img src={Nyaa} className="h-6 rounded-full" />
            <span>Nyaa</span>
          </a>,
        );
      }
      default:
        return wrap(
          <Link to={`/search/?tags=${encodeURIComponent(tag.value)}`} title="Search tag">
            #{tag.value}
          </Link>,
        );
    }
  }

  return innerLink();
}
