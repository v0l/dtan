import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router-dom";
import { routes } from "../src/main";
import { NostrSystem } from "@snort/system";
import { SnortContext } from "@snort/system-react";

export interface SSRResult {
  html: string;
  status: number;
}

const system = new NostrSystem({});

export async function renderPage(
  url: string,
  template: string,
  acceptLanguage?: string | null,
  cookie?: string | null,
): Promise<SSRResult> {
  const handler = createStaticHandler(routes);

  const headers: Record<string, string> = { accept: "text/html" };
  if (acceptLanguage) headers["accept-language"] = acceptLanguage;
  if (cookie) headers["cookie"] = cookie;

  const fetchRequest = new Request(`http://localhost${url}`, {
    method: "GET",
    headers,
  });

  const context = await handler.query(fetchRequest);

  if (context instanceof Response) {
    return { html: "", status: context.status };
  }

  const router = createStaticRouter(handler.dataRoutes, context);

  const html = renderToString(
    <SnortContext.Provider value={system}>
      <StaticRouterProvider router={router} context={context} />
    </SnortContext.Provider>,
  );

  const resultHtml = template.replace('<!--app-html-->', html);

  return { html: resultHtml, status: 200 };
}
