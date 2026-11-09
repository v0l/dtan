import { ParsedFragment, transformText, tryParseNostrLink } from "@snort/system";
import { useMemo, useState } from "react";
import { Mention } from "./mention";
import { Link } from "react-router-dom";
import { DefaultImgProxy, proxyImg } from "@snort/shared";
import { isSafeHref } from "../safe-link";

export function Text({ content, tags, wrap = true }: { content: string; tags: Array<Array<string>>; wrap?: boolean }) {
  const frags = useMemo(() => transformText(content, tags), [content, tags]);

  function renderFrag(f: ParsedFragment, index: number) {
    switch (f.type) {
      case "media":
        return <ImageFrag key={index} url={f.content} />;
      case "mention":
      case "link": {
        const nostrLink = tryParseNostrLink(f.content);
        if (nostrLink) {
          return <Mention key={index} link={nostrLink} />;
        } else if (!isSafeHref(f.content)) {
          return <span key={index}>{f.content}</span>;
        } else {
          return (
            <Link key={index} to={f.content} target="_blank" className="text-indigo-300" rel="noopener noreferrer">
              {f.content}
            </Link>
          );
        }
      }
      default: {
        return <span key={index}>{f.content}</span>;
      }
    }
  }

  return frags.map(renderFrag);
}

export function ImageFrag({ url }: { url: string }) {
  const [error, setError] = useState(false);

  // use plain link if image preview fails
  if (error) {
    return (
      <Link to={url} target="_blank" className="text-indigo-300" rel="noopener noreferrer">
        {url}
      </Link>
    );
  }
  return <img src={proxyImg(url, DefaultImgProxy)} style={{ maxHeight: "250px" }} onError={() => setError(true)} />;
}
