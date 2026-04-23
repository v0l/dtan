import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router-dom";
import { routes } from "../src/main";
import { NostrSystem } from "@snort/system";
import { SnortContext } from "@snort/system-react";
import { getHydrationScript } from "../src/ssr-hydration";
import { DefaultRelays, IsSSR } from "../src/const";

export interface SSRResult {
  html: string;
  status: number;
}

console.log(`ServerConfig:\n\tSSR=${IsSSR}\n\tRelays=${DefaultRelays.join(",")}`);

const system = new NostrSystem({});
const relayConnect = Promise.all(DefaultRelays.map((r) => system.ConnectToRelay(r, { read: true, write: false })))

export async function renderPage(
  url: string,
  template: string,
  acceptLanguage?: string | null,
  cookie?: string | null,
): Promise<SSRResult> {
  await relayConnect;

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

  renderToString(
    <SnortContext.Provider value={system}>
      <StaticRouterProvider router={router} context={context} />
    </SnortContext.Provider>,
  );

  await system.FetchAll();
  
  const html = renderToString(
    <SnortContext.Provider value={system}>
      <StaticRouterProvider router={router} context={context} />
    </SnortContext.Provider>,
  );

  const hydrationScript = getHydrationScript(system);
  const resultHtml = template.replace('<!--app-html-->', html).replace('</head>', `${hydrationScript}</head>`);

  return { html: resultHtml, status: 200 };
}
