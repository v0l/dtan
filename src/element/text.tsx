import { ParsedFragment, transformText, tryParseNostrLink } from "@snort/system";
import { useMemo } from "react";
import { Mention } from "./mention";
import { Link } from "react-router-dom";

export function Text({ content, tags }: { content: string; tags: Array<Array<string>> }) {
  const frags = useMemo(() => transformText(content, tags), [content, tags]);

  function renderFrag(f: ParsedFragment) {
    switch (f.type) {
      case "mention":
      case "link": {
        const link = tryParseNostrLink(f.content);
        if (link) {
          return <Mention link={link} />;
        } else {
          return (
            <Link to={f.content} target="_blank">
              {f.content}
            </Link>
          );
        }
      }
      default: {
        return <span>{f.content}</span>;
      }
    }
  }

  return <div className="text">{frags.map(renderFrag)}</div>;
}
