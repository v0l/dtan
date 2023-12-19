import { ParsedFragment, transformText, tryParseNostrLink } from "@snort/system";
import { useMemo } from "react";
import { Mention } from "./mention";
import { Link } from "react-router-dom";

export function Text({ content, tags, wrap = true }: { content: string; tags: Array<Array<string>>; wrap?: boolean }) {
  const frags = useMemo(() => transformText(content, tags), [content, tags]);

  function renderFrag(f: ParsedFragment, index: number) {
    switch (f.type) {
      case "media":
        return <img key={index} src={f.content} style={{ maxHeight: "50vh" }} />;
      case "mention":
      case "link": {
        const nostrLink = tryParseNostrLink(f.content);
        if (nostrLink) {
          return <Mention key={index} link={nostrLink} />;
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

  if (wrap) {
    return <div className="text">{frags.map(renderFrag)}</div>;
  }
  return frags.map(renderFrag);
}
