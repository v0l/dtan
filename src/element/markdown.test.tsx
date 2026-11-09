/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  test("renders a javascript: link as inert text", () => {
    const html = renderToStaticMarkup(<Markdown content="[click me](javascript:alert(1))" />);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
  });

  test("renders a data: link as inert text", () => {
    const html = renderToStaticMarkup(<Markdown content="[x](data:text/html,<script>alert(1)</script>)" />);
    expect(html).not.toContain("data:text/html");
  });
});
