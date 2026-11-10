import { ParsedFragment, transformText, tryParseNostrLink } from "@snort/system";
import { useMemo, useState } from "react";
import { Mention } from "./mention";
import { Link } from "react-router-dom";
import { DefaultImgProxy, proxyImg } from "@snort/shared";
import { safeHref } from "../safe-link";

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
        }
        const href = safeHref(f.content);
        if (!href) {
          return <span key={index}>{f.content}</span>;
        }
        return (
          <Link key={index} to={href} target="_blank" className="text-indigo-300" rel="noopener noreferrer">
            {f.content}
          </Link>
        );
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
    const href = safeHref(url);
    // The failed URL is still author-controlled: never turn an unsafe one into a
    // clickable link just because the preview broke.
    if (!href) {
      return <span className="text-indigo-300 break-all">{url}</span>;
    }
    return (
      <Link to={href} target="_blank" className="text-indigo-300" rel="noopener noreferrer">
        {url}
      </Link>
    );
  }
  return <img src={proxyImg(url, DefaultImgProxy)} style={{ maxHeight: "250px" }} onError={() => setError(true)} />;
}
