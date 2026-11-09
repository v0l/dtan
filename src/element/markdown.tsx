import { marked, Token } from "marked";
import { forwardRef, ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { isSafeHref } from "../safe-link";

import markedFootnote, { Footnotes, Footnote, FootnoteRef } from "marked-footnote";
import { Text, ImageFrag } from "./text";

interface MarkdownProps {
  content: string;
  tags?: Array<Array<string>>;
  className?: string;
}

function renderToken(t: Token | Footnotes | Footnote | FootnoteRef, tags: Array<Array<string>>): ReactNode {
  try {
    switch (t.type) {
      case "paragraph": {
        return <p>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : <Text content={t.raw} tags={tags} />}</p>;
      }
      case "image": {
        return <ImageFrag url={t.href} />;
      }
      case "heading": {
        switch (t.depth) {
          case 1:
            return <h1>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</h1>;
          case 2:
            return <h2>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</h2>;
          case 3:
            return <h3>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</h3>;
          case 4:
            return <h4>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</h4>;
          case 5:
            return <h5>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</h5>;
          case 6:
            return <h6>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</h6>;
        }
        throw new Error("Invalid heading");
      }
      case "codespan": {
        return <code className="bg-neutral-600 light:bg-neutral-300 px-2 py-0.5 rounded-lg text-sm">{t.text}</code>;
      }
      case "code": {
        return <pre className="bg-neutral-600 light:bg-neutral-300 px-2 py-0.5 rounded-lg text-sm">{t.text}</pre>;
      }
      case "br": {
        return <br />;
      }
      case "hr": {
        return <hr />;
      }
      case "blockquote": {
        return <blockquote>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</blockquote>;
      }
      case "link": {
        const href = t.href as string;
        const children = t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw;
        // Markdown can carry any scheme. Render only what we trust as a link;
        // leave anything else as inert text rather than a dead or dangerous href.
        if (!isSafeHref(href)) {
          return <span>{children}</span>;
        }
        return (
          <Link to={href} className="text-highlight no-underline hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </Link>
        );
      }
      case "list": {
        if (t.ordered) {
          return <ol className="list-decimal ml-4">{(t.items as Token[]).map(a => renderToken(a, tags))}</ol>;
        } else {
          return <ul className="list-disc">{(t.items as Token[]).map(a => renderToken(a, tags))}</ul>;
        }
      }
      case "list_item": {
        return <li>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</li>;
      }
      case "em": {
        return <em>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</em>;
      }
      case "del": {
        return <s>{t.tokens ? t.tokens.map(a => renderToken(a, tags)) : t.raw}</s>;
      }
      case "footnoteRef": {
        return (
          <sup>
            <Link to={`#fn-${t.label}`} className="super">
              [{t.label}]
            </Link>
          </sup>
        );
      }
      case "footnotes":
      case "footnote": {
        return;
      }
      default: {
        if ("tokens" in t) {
          return (t.tokens as Array<Token>).map(a => renderToken(a, tags));
        }
        return <Text content={t.raw} tags={tags} />
      }
    }
  } catch (e) {
    console.error(e);
  }
}

const Markdown = forwardRef<HTMLDivElement, MarkdownProps>((props: MarkdownProps, ref) => {
  const parsed = useMemo(() => {
    return marked.use(markedFootnote()).lexer(props.content);
  }, [props.content, props.tags]);

  return (
    <div className={props.className} ref={ref}>
      {parsed.filter(a => a.type !== "footnote" && a.type !== "footnotes").map(a => renderToken(a, props.tags ?? []))}
    </div>
  );
});

Markdown.displayName = "Markdown";

export { Markdown };
